import { execFile } from 'node:child_process';

const run = (args, timeoutMs) =>
  new Promise((resolve) => {
    execFile('iperf3', args, { timeout: timeoutMs, encoding: 'utf8' }, (error, stdout) => {
      resolve({ stdout: String(stdout ?? ''), error: error?.message ?? null });
    });
  });

export async function checkIperf() {
  const probe = await run(['--version'], 5000);
  if (probe.error && !probe.stdout) {
    return { available: false, version: null };
  }
  const match = probe.stdout.match(/iperf\s+([0-9]+\.[0-9]+(?:\.[0-9]+)?)/i);
  return { available: true, version: match?.[1] ?? null };
}

function parseBps(stdout, sumKey) {
  try {
    const doc = JSON.parse(stdout);
    const bps = doc?.end?.[sumKey]?.bits_per_second;
    return typeof bps === 'number' && Number.isFinite(bps) ? Math.round(bps) : null;
  } catch {
    return null;
  }
}

// Débit TCP descendant puis montant vers le serveur. Ne lève jamais :
// renvoie error explicite si iperf3 absent, serveur injoignable, etc.
// (Upstream fait aussi l'UDP ; ici TCP seul pour limiter la durée sur le terrain.)
export async function runIperf(server, durationS) {
  const duration = Math.max(1, Math.min(30, Number(durationS) || 5));
  const timeoutMs = duration * 2 * 1000 + 15000;
  const down = await run(['-c', server, '-t', String(duration), '-R', '-J'], timeoutMs);
  const up = await run(['-c', server, '-t', String(duration), '-J'], timeoutMs);
  const tcpDownBps = down.error ? null : parseBps(down.stdout, 'sum_received');
  const tcpUpBps = up.error ? null : parseBps(up.stdout, 'sum_sent');
  const errors = [down.error && `descendant : ${down.error}`, up.error && `montant : ${up.error}`]
    .filter(Boolean)
    .join(' ; ');
  return {
    tcpDownBps,
    tcpUpBps,
    durationS: duration,
    error:
      tcpDownBps === null && tcpUpBps === null
        ? errors || 'Mesure iperf impossible.'
        : errors || null,
  };
}

export const toMbps = (bps) =>
  bps === null || bps === undefined ? null : Math.round((bps / 1_000_000) * 100) / 100;

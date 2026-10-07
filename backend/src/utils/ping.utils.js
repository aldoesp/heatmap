import { execFile } from 'node:child_process';

const PROBE_COUNT = 5;

// BSSID factice renvoyé par Android quand il masque la vraie adresse
// (même garde-fou que l'upstream wifi-heatmapper).
export const PLACEHOLDER_BSSID = '02:00:00:00:00:00';

export const isPlaceholderBssid = (bssid) =>
  String(bssid ?? '').toLowerCase() === PLACEHOLDER_BSSID;

const run = (command, args, timeout) =>
  new Promise((resolve) => {
    execFile(command, args, { timeout, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolve({
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
        error: error?.message ?? null,
      });
    });
  });

export function parseDefaultGateway(output) {
  const match = String(output ?? '').match(/\bdefault\s+via\s+(\d{1,3}(?:\.\d{1,3}){3})\b/);
  return match?.[1]?.trim() ?? null;
}

export function parsePingOutput(output, gatewayIp, probesSent = PROBE_COUNT) {
  // Seules les lignes de réponse portent un RTT ("time 4006ms" du résumé exclu).
  const replyLines = String(output ?? '')
    .split('\n')
    .filter((line) => /bytes from|icmp_seq|reply from|réponse de/i.test(line))
    .join('\n');
  const samples = [
    ...replyLines.matchAll(
      /(?:time|temps|zeit|tiempo|tempo)\s*([=<])?\s*(\d+(?:[.,]\d+)?)\s*ms/gi
    ),
  ].map((m) => {
    const time = Number(m[2].replace(',', '.'));
    return m[1] === '<' ? time / 2 : time;
  });
  const lossMatch =
    String(output ?? '').match(/(\d+(?:[.,]\d+)?)%\s*(?:packet\s*loss|loss|(?:de\s+)?perte)/i) ??
    String(output ?? '').match(/(?:loss|perte)\s*[=:]\s*(\d+(?:[.,]\d+)?)\s*%/i);
  if (samples.length === 0 && !lossMatch) return null;

  const sorted = [...samples].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return {
    gatewayIp,
    medianRttMs:
      sorted.length === 0
        ? null
        : sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid],
    packetLossPercent: lossMatch
      ? Number(lossMatch[1].replace(',', '.'))
      : ((probesSent - samples.length) / probesSent) * 100,
    probesSent,
    probesReceived: samples.length,
  };
}

// Ping de la passerelle par défaut (5 sondes). Ne lève jamais :
// renvoie error explicite si ip/ping absent ou injoignable.
export async function measureGatewayPing() {
  const route = await run('ip', ['-4', 'route', 'show', 'default'], 2000);
  const gatewayIp = parseDefaultGateway(route.stdout);
  if (!gatewayIp) {
    return {
      gatewayIp: null,
      medianRttMs: null,
      packetLossPercent: null,
      probesSent: 0,
      probesReceived: 0,
      error: route.error ?? 'Passerelle IPv4 introuvable.',
    };
  }
  const result = await run('ping', ['-n', '-c', String(PROBE_COUNT), gatewayIp], 9000);
  return (
    parsePingOutput(`${result.stdout}\n${result.stderr}`, gatewayIp) ?? {
      gatewayIp,
      medianRttMs: null,
      packetLossPercent: null,
      probesSent: 0,
      probesReceived: 0,
      error: result.error ?? 'Réponse ping illisible.',
    }
  );
}

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

export async function pingStats(host, count = 20) {
  let out;
  try {
    ({ stdout: out } = await run(
      'ping',
      ['-c', String(count), '-i', '0.2', '-w', '5', '-q', host],
      { env: { ...process.env, LANG: 'C' }, timeout: 8000 }
    ));
  } catch (e) {
    out = e.stdout ?? ''; // ping sort en erreur si 100 % de perte
  }

  const loss = out.match(/([\d.]+)% packet loss/);
  const rtt = out.match(/= ([\d.]+)\/([\d.]+)\/([\d.]+)(?:\/([\d.]+))? ms/);

  return {
    host,
    ts: new Date().toISOString(),
    loss: loss ? +loss[1] : 100,
    min: rtt ? +rtt[1] : null,
    latency: rtt ? +rtt[2] : null,
    max: rtt ? +rtt[3] : null,
    jitter: rtt?.[4] ? +rtt[4] : null,
  };
}

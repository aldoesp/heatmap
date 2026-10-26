import { getDb } from '../database/db.js';

export function insertPingStats(stats) {
  const db = getDb();
  db.prepare(
    `INSERT INTO ping_stats (host, measured_at, loss_pct, rtt_min, rtt_avg, rtt_max, jitter)
     VALUES (@host, @measured_at, @loss_pct, @rtt_min, @rtt_avg, @rtt_max, @jitter)`
  ).run({
    host: stats.host,
    measured_at: stats.ts,
    loss_pct: stats.loss,
    rtt_min: stats.min,
    rtt_avg: stats.latency,
    rtt_max: stats.max,
    jitter: stats.jitter,
  });
  return findLatestPingStatsByHost(stats.host);
}

export function findLatestPingStatsByHost(host) {
  return getDb()
    .prepare('SELECT * FROM ping_stats WHERE host = ? ORDER BY measured_at DESC LIMIT 1')
    .get(host) ?? null;
}
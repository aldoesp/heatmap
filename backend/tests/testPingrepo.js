import { insertPingStats } from '../src/repositories/pingStats.repository.js';

const row = insertPingStats({
  host: '1.1.1.1',
  ts: new Date().toISOString(),
  loss: 0,
  min: 12.3,
  latency: 14.5,
  max: 18.1,
  jitter: 1.2,
});
console.log(row);

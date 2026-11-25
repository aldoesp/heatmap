import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const REVISION_HEADER = 'X-Heatmap-Revision';
const instanceId = randomUUID();
const mutations = new AsyncLocalStorage();
const writeMethods = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);
let revision = 0;

export function getDataRevision() {
  return { instanceId, revision };
}

export function trackMutation(req, res, next) {
  if (!writeMethods.has(req.method)) return next();
  return mutations.run({ res, first: 0, last: 0, contiguous: true }, next);
}

// Appeler immédiatement après la validation de l'écriture par SQLite.
// Un savepoint n'est pas un commit : la transaction externe doit passer
// par commitDataTransaction pour notifier après sa validation.
function recordDataWrite(db, changes = 1) {
  if (!changes || db.inTransaction) return;
  revision++;
  const mutation = mutations.getStore();
  if (!mutation || !mutation.contiguous || mutation.res.headersSent) return;
  if (mutation.last && mutation.last + 1 !== revision) {
    mutation.contiguous = false;
    mutation.res.removeHeader(REVISION_HEADER);
    return;
  }
  mutation.first ||= revision;
  mutation.last = revision;
  mutation.res.setHeader(REVISION_HEADER, `${instanceId}:${mutation.first}:${revision}`);
}

export function runDataWrite(db, sql, ...params) {
  const result = db.prepare(sql).run(...params);
  recordDataWrite(db, result.changes);
  return result;
}

export function commitDataTransaction(db, write) {
  const result = db.transaction(write)();
  recordDataWrite(db);
  return result;
}

import type { AccessPoint, PersistedPlan } from '../types/plan';
import type { PersistedProject } from '../types/project';

const DB_NAME = 'wifi-diag';
const STORE = 'blobs';
const PLAN_KEY = 'upload:plan';
const BLOB_KEY = 'plan-image';

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putBlob(key: string, blob: Blob): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(blob, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function getBlob(key: string): Promise<Blob | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as Blob | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function deleteBlob(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function savePlan(
  plan: PersistedPlan['plan'] | null,
  accessPoints: AccessPoint[],
  image: Blob | null
): Promise<void> {
  if (!plan || !image) {
    localStorage.removeItem(PLAN_KEY);
    return;
  }
  const payload: PersistedPlan = { plan, accessPoints };
  localStorage.setItem(PLAN_KEY, JSON.stringify(payload));
  const existingProject = loadProject();
  saveProject({
    plan,
    accessPoints,
    scanPoints: existingProject?.scanPoints ?? [],
  });
  try {
    await putBlob(BLOB_KEY, image);
  } catch {
    /* IndexedDB indisponible : on garde au moins le JSON */
  }
}

export async function loadPlan(): Promise<{
  plan: PersistedPlan['plan'];
  accessPoints: AccessPoint[];
  image: Blob;
} | null> {
  const raw = localStorage.getItem(PLAN_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as PersistedPlan;
    if (!parsed?.plan) return null;
    const image = await getBlob(BLOB_KEY);
    if (!image) return null;
    return { plan: parsed.plan, accessPoints: parsed.accessPoints ?? [], image };
  } catch {
    return null;
  }
}

export function clearPlan(): void {
  localStorage.removeItem(PLAN_KEY);
  localStorage.removeItem(PROJECT_KEY);
  void deleteBlob(BLOB_KEY).catch(() => {});
}

const PROJECT_KEY = 'wifiAnalyzer.project';

export function loadProject(): PersistedProject | null {
  try {
    const raw = localStorage.getItem(PROJECT_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedProject;
  } catch {
    return null;
  }
}

export function saveProject(project: PersistedProject): void {
  try {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  } catch {
    /* silencieux */
  }
}

export async function getPlanBlob(): Promise<Blob | null> {
  try {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(BLOB_KEY);
      req.onsuccess = () => resolve((req.result as Blob | undefined) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}
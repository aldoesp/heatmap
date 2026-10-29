import { randomUUID } from 'node:crypto';
import { rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { AppError } from '../utils/AppError.js';
import {
  getPlanExtension,
  validateUploadedPlan,
  deleteStoredPlanFile,
} from '../services/plans.service.js';
import {
  insertPlan,
  listPlans,
  findPlanById,
  renamePlan as renamePlanRow,
  deletePlan as deletePlanRow,
} from '../repositories/plans.repository.js';
import {
  insertAccessPoint,
  listAccessPointsByPlan,
  deleteAccessPoint,
  updateAccessPoint,
  findAccessPointById,
} from '../repositories/accessPoints.repository.js';
import {
  insertScanPoint,
  listScanPointsByPlan,
  findScanPointById,
  deleteScanPoint,
  updateScanPoint,
} from '../repositories/scanPoints.repository.js';
import { heatmapByPlan, getHistoryByPlan, listNetworksByPlan, exportPlanCsv, speedByPlan } from '../repositories/scans.repository.js';
import {
  listMappingsByPlan,
  insertMapping,
  deleteMapping,
} from '../repositories/apMappings.repository.js';
import {
  insertPolygon,
  listPolygonsByPlan,
  findPolygonById,
  updatePolygon,
  deletePolygon,
} from '../repositories/polygons.repository.js';
import { listApPositionsByPlan, upsertApPosition, deleteApPosition } from '../repositories/apPositions.repository.js';

const planNameFromFile = (originalname) =>
  path.parse(originalname).name.trim() || 'Plan';

const isValidCoord = (v) => Number.isFinite(v) && v >= 0 && v <= 1;

export const createPlan = async (req, res, next) => {
  const file = req.file;
  if (!file) {
    return next(new AppError('Aucun fichier image reçu.', 400));
  }

  let storedFileName = null;
  try {
    const dimensions = await validateUploadedPlan(file);
    const extension = getPlanExtension(file.mimetype);
    const id = randomUUID();
    const fileName = `${id}.${extension}`;
    const filePath = new URL(`../../uploads/plans/${fileName}`, import.meta.url);
    await rename(file.path, filePath);
    storedFileName = fileName;

    const row = insertPlan({
      id,
      name: planNameFromFile(file.originalname),
      file_name: path.basename(file.originalname),
      stored_file: fileName,
      image_url: `/uploads/plans/${fileName}`,
      mime: file.mimetype,
      width: dimensions.width,
      height: dimensions.height,
      size_bytes: file.size,
    });

    res.status(201).json({
      id: row.id,
      name: row.name,
      imageUrl: row.image_url,
      fileName: row.file_name,
      width: row.width,
      height: row.height,
      sizeBytes: row.size_bytes,
    });
  } catch (error) {
    // Cohérence fichier/DB : le fichier temporaire multer n'existe peut-être déjà
    // plus (validateUploadedPlan le supprime en cas d'image invalide), et le fichier
    // renommé doit être supprimé si l'insertion SQLite a échoué après.
    await unlink(file.path).catch(() => {});
    if (storedFileName) {
      await deleteStoredPlanFile(storedFileName).catch(() => {});
    }
    next(error);
  }
};

const toPlanResponse = (row) => ({
  id: row.id,
  name: row.name,
  imageUrl: row.image_url,
  fileName: row.file_name,
  width: row.width,
  height: row.height,
  sizeBytes: row.size_bytes,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

export const getPlans = (_req, res) => {
  res.json(listPlans().map(toPlanResponse));
};

export const getPlan = (req, res, next) => {
  const row = findPlanById(req.params.id);
  if (!row) return next(new AppError('Plan introuvable.', 404));
  res.json(toPlanResponse(row));
};

export const patchPlan = (req, res, next) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name || name.length > 120) {
    return next(new AppError('Nom de plan invalide.', 400));
  }
  const row = renamePlanRow(req.params.id, name);
  if (!row) return next(new AppError('Plan introuvable.', 404));
  res.json(toPlanResponse(row));
};

export const createAccessPoint = (req, res, next) => {
  const plan = findPlanById(req.params.id);
  if (!plan) return next(new AppError('Plan introuvable.', 404));
  const name = String(req.body?.name ?? '').trim();
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  if (!name || name.length > 64) return next(new AppError('Nom AP invalide.', 400));
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return next(new AppError('Coordonnées x/y invalides (0-1 attendu).', 400));
  }
  try {
    res.status(201).json(insertAccessPoint({ plan_id: plan.id, name, x, y }));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return next(new AppError('Ce nom est déjà utilisé.', 409));
    }
    next(err);
  }
};

export const getAccessPoints = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  res.json(listAccessPointsByPlan(req.params.id));
};

export const removeAccessPoint = (req, res, next) => {
  if (!deleteAccessPoint(req.params.apId)) {
    return next(new AppError('Point d’accès introuvable.', 404));
  }
  res.status(204).end();
};

export const patchAccessPoint = (req, res, next) => {
  const patch = {};
  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name || name.length > 64) {
      return next(new AppError('Nom AP invalide.', 400));
    }
    patch.name = name;
  }
  for (const key of ['x', 'y']) {
    if (req.body?.[key] !== undefined) {
      const v = Number(req.body[key]);
      if (!isValidCoord(v)) {
        return next(new AppError('Coordonnées x/y invalides (0-1 attendu).', 400));
      }
      patch[key] = v;
    }
  }
  if (req.body?.bssids !== undefined) {
    if (!Array.isArray(req.body.bssids) || req.body.bssids.length > 16) {
      return next(new AppError('BSSID invalide (ex. 9e:05:d6:96:e8:30).', 400));
    }
    const normalized = [];
    const seen = new Set();
    for (const v of req.body.bssids) {
      const b = String(v).trim().toLowerCase();
      if (!BSSID_RE.test(b)) {
        return next(new AppError('BSSID invalide (ex. 9e:05:d6:96:e8:30).', 400));
      }
      if (!seen.has(b)) {
        seen.add(b);
        normalized.push(b);
      }
    }
    const ap = findAccessPointById(req.params.apId);
    if (ap) {
      const others = listAccessPointsByPlan(ap.plan_id).filter((a) => a.id !== req.params.apId);
      const used = new Set(others.flatMap((a) => a.bssids || []));
      if (normalized.some((b) => used.has(b))) {
        return next(new AppError('Ce BSSID est déjà associé à un autre AP.', 409));
      }
    }
    patch.bssids = normalized;
  }
  if (Object.keys(patch).length === 0) {
    return next(new AppError('Rien à mettre à jour.', 400));
  }
  try {
    const row = updateAccessPoint(req.params.apId, patch);
    if (!row) return next(new AppError('Point d’accès introuvable.', 404));
    res.json(row);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return next(new AppError('Ce nom est déjà utilisé.', 409));
    }
    next(err);
  }
};

export const createScanPoint = (req, res, next) => {
  const plan = findPlanById(req.params.id);
  if (!plan) return next(new AppError('Plan introuvable.', 404));
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  if (!isValidCoord(x) || !isValidCoord(y)) {
    return next(new AppError('Coordonnées x/y invalides (0-1 attendu).', 400));
  }
  res.status(201).json(insertScanPoint({ plan_id: plan.id, x, y }));
};

export const getScanPoints = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  res.json(listScanPointsByPlan(req.params.id));
};

export const removeScanPoint = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  const point = findScanPointById(req.params.pointId);
  if (!point || point.plan_id !== req.params.id) {
    return next(new AppError('Point de scan introuvable pour ce plan.', 404));
  }
  deleteScanPoint(point.id); // cascade : scans + observations
  res.status(204).end();
};

export const patchScanPoint = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  const point = findScanPointById(req.params.pointId);
  if (!point || point.plan_id !== req.params.id) {
    return next(new AppError('Point de scan introuvable pour ce plan.', 404));
  }
  const patch = {};
  if (req.body?.note !== undefined) {
    if (typeof req.body.note !== 'string') {
      return next(new AppError('Note invalide.', 400));
    }
    const note = req.body.note.trim();
    if (!note) {
      return next(new AppError('La note ne peut pas être vide.', 400));
    }
    if (note.length > 500) {
      return next(new AppError('La note ne doit pas dépasser 500 caractères.', 400));
    }
    patch.note = note;
  }
  if (req.body?.is_enabled !== undefined) {
    if (req.body.is_enabled !== 0 && req.body.is_enabled !== 1 && req.body.is_enabled !== false && req.body.is_enabled !== true) {
      return next(new AppError('is_enabled doit être 0 ou 1.', 400));
    }
    patch.is_enabled = req.body.is_enabled ? 1 : 0;
  }
  if (Object.keys(patch).length === 0) {
    return next(new AppError('Rien à mettre à jour.', 400));
  }
  const updated = updateScanPoint(point.id, patch);
  if (!updated) return next(new AppError('Point de scan introuvable pour ce plan.', 404));
  res.json(updated);
};

export const removePlan = async (req, res, next) => {
  const plan = findPlanById(req.params.id);
  if (!plan) return next(new AppError('Plan introuvable.', 404));
  try {
    deletePlanRow(plan.id); // cascade : APs, points, scans, observations
    await deleteStoredPlanFile(plan.stored_file);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
};

export const getHeatmap = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  const { ssid, bssid, connected, band } = req.query;
  // Même normalisation que validateScanQuery : 2.4 | 5 | 6 -> '2.4GHz'...
  let bandFilter;
  if (band !== undefined) {
    if (!['2.4', '5', '6'].includes(String(band))) {
      return next(new AppError('band doit être 2.4, 5 ou 6.', 400));
    }
    bandFilter = `${band}GHz`;
  }
  res.json(heatmapByPlan(req.params.id, {
    ssid: ssid ? String(ssid) : undefined,
    bssid: bssid ? String(bssid) : undefined,
    connected: connected === '1' || connected === 'true',
    band: bandFilter,
  }));
};

export const getHeatmapSpeed = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  res.json(speedByPlan(req.params.id));
};

export const getHistory = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  res.json(getHistoryByPlan(req.params.id));
};

export const getNetworks = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  res.json(listNetworksByPlan(req.params.id));
};

export const exportCsv = (req, res, next) => {
  const plan = findPlanById(req.params.id);
  if (!plan) return next(new AppError('Plan introuvable.', 404));
  const csv = exportPlanCsv(plan.id);
  const safeName = plan.name.replace(/[^\w\-àâäéèêëîïôöùûüç]+/gi, '_').slice(0, 60) || 'plan';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${safeName}-releves.csv"`);
  res.send('\ufeff' + csv); // BOM pour Excel
};

const BSSID_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i;

export const getMappings = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  res.json(listMappingsByPlan(req.params.id));
};

export const createMapping = (req, res, next) => {
  const plan = findPlanById(req.params.id);
  if (!plan) return next(new AppError('Plan introuvable.', 404));
  const name = String(req.body?.name ?? '').trim();
  const bssid = String(req.body?.bssid ?? '').trim().toLowerCase();
  if (!name || name.length > 64) return next(new AppError('Nom de borne invalide.', 400));
  if (!BSSID_RE.test(bssid)) {
    return next(new AppError('Adresse MAC invalide (ex. 9e:05:d6:96:e8:30).', 400));
  }
  try {
    res.status(201).json(insertMapping({ plan_id: plan.id, name, bssid }));
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return next(new AppError('Ce BSSID a déjà un nom sur ce plan.', 409));
    }
    next(err);
  }
};

export const removeMapping = (req, res, next) => {
  if (!deleteMapping(req.params.mappingId)) {
    return next(new AppError('Correspondance introuvable.', 404));
  }
  res.status(204).end();
};

/* ==========================================================================
   Zones de délimitation (polygones dessinés sur le plan)
   ========================================================================== */

const polygonArea = (vertices) => {
  let twiceArea = 0;
  for (let index = 0; index < vertices.length; index += 1) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    twiceArea += current.x * next.y - next.x * current.y;
  }
  return Math.abs(twiceArea) / 2;
};

/**
 * Valide la forme minimale d'un polygone : au moins trois sommets distincts,
 * coordonnées finies dans [0,1] et aire strictement positive. Les contrôles
 * plus fins (auto-intersection, seuils d'aire en pixels) sont faits côté UI.
 */
const normalizePolygonVertices = (raw) => {
  if (!Array.isArray(raw) || raw.length < 3) {
    return { error: 'Un polygone doit comporter au moins 3 sommets.' };
  }
  const vertices = [];
  for (const point of raw) {
    const x = Number(point?.x);
    const y = Number(point?.y);
    if (!isValidCoord(x) || !isValidCoord(y)) {
      return { error: 'Coordonnées x/y invalides (0-1 attendu).' };
    }
    vertices.push({ x, y });
  }

  const distinct = [];
  for (const vertex of vertices) {
    const seen = distinct.some(
      (other) =>
        Math.abs(other.x - vertex.x) <= 1e-9 && Math.abs(other.y - vertex.y) <= 1e-9
    );
    if (!seen) distinct.push(vertex);
  }
  if (distinct.length < 3) {
    return { error: 'Un polygone doit comporter au moins 3 sommets distincts.' };
  }
  if (polygonArea(vertices) <= 1e-9) {
    return { error: 'Un polygone doit avoir une aire non nulle.' };
  }
  return { vertices };
};

export const getPolygons = (req, res, next) => {
  if (!findPlanById(req.params.id)) return next(new AppError('Plan introuvable.', 404));
  res.json(listPolygonsByPlan(req.params.id));
};

export const createPolygon = (req, res, next) => {
  const plan = findPlanById(req.params.id);
  if (!plan) return next(new AppError('Plan introuvable.', 404));
  const parsed = normalizePolygonVertices(req.body?.vertices);
  if (parsed.error) return next(new AppError(parsed.error, 400));
  res.status(201).json(insertPolygon({ plan_id: plan.id, vertices: parsed.vertices }));
};

export const patchPolygon = (req, res, next) => {
  const existing = findPolygonById(req.params.polygonId);
  if (!existing) return next(new AppError('Zone introuvable.', 404));
  const parsed = normalizePolygonVertices(req.body?.vertices);
  if (parsed.error) return next(new AppError(parsed.error, 400));
  res.json(updatePolygon(existing.id, parsed.vertices));
};

export const removePolygon = (req, res, next) => {
  if (!deletePolygon(req.params.polygonId)) {
    return next(new AppError('Zone introuvable.', 404));
  }
  res.status(204).end();
};


export const getApPositions = (req, res, next) => {
  res.json(listApPositionsByPlan(req.params.id));
};

export const putApPosition = (req, res, next) => {
  const plan = findPlanById(req.params.id);
  if (!plan) return next(new AppError('Plan introuvable.', 404));
  const bssid = String(req.params.bssid || '').trim().toLowerCase();
  if (!/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/.test(bssid)) {
    return next(new AppError('BSSID invalide.', 400));
  }
  const x = Number(req.body?.x);
  const y = Number(req.body?.y);
  if (!Number.isFinite(x) || x < 0 || x > 1 || !Number.isFinite(y) || y < 0 || y > 1) {
    return next(new AppError('Coordonnées invalides.', 400));
  }
  res.json(upsertApPosition({ plan_id: plan.id, bssid, x, y }));
};

export const removeApPosition = (req, res, next) => {
  const bssid = String(req.params.bssid || '').trim().toLowerCase();
  if (!deleteApPosition(req.params.id, bssid)) {
    return next(new AppError('Position introuvable.', 404));
  }
  res.status(204).end();
};

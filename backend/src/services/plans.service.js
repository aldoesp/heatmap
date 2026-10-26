import { mkdir, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { imageSize } from 'image-size';
import { AppError } from '../utils/AppError.js';

export const UPLOADS_DIRECTORY = fileURLToPath(
  new URL('../../uploads/', import.meta.url)
);
export const PLANS_DIRECTORY = path.join(UPLOADS_DIRECTORY, 'plans');

const MIME_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
]);
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

export async function ensurePlansDirectory() {
  await mkdir(PLANS_DIRECTORY, { recursive: true });
}

export function getPlanExtension(mimeType) {
  return MIME_TYPES.get(mimeType);
}

export async function validateUploadedPlan(file) {
  if (!file) {
    throw new AppError('Aucun fichier image reçu.', 400);
  }

  if (file.size > MAX_IMAGE_BYTES) {
    await unlink(file.path);
    throw new AppError('Cette image dépasse la limite de 10 Mo.', 413);
  }

  try {
    const dimensions = imageSize(await readFile(file.path));
    const expectedType = MIME_TYPES.get(file.mimetype);
    if (
      !expectedType ||
      dimensions.type !== expectedType ||
      !Number.isSafeInteger(dimensions.width) ||
      !Number.isSafeInteger(dimensions.height) ||
      dimensions.width <= 0 ||
      dimensions.height <= 0
    ) {
      throw new Error('Le contenu ne correspond pas à un format image accepté.');
    }

    return dimensions;
  } catch (error) {
    await unlink(file.path).catch(() => {});
    throw new AppError(
      error instanceof Error ? error.message : 'Image invalide.',
      400
    );
  }
}

// Supprime un fichier image d'un plan. Refuse tout chemin sortant de PLANS_DIRECTORY.
export async function deleteStoredPlanFile(storedFile) {
  const base = path.resolve(PLANS_DIRECTORY);
  const target = path.resolve(base, path.basename(storedFile ?? ''));
  if (target === base || !target.startsWith(base + path.sep)) {
    throw new AppError('Nom de fichier invalide.', 400);
  }
  await unlink(target).catch((err) => {
    if (err?.code !== 'ENOENT') throw err;
  });
}

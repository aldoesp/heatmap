import Delaunator from 'delaunator';
import type { PlanData } from '../types/plan.js';

export type Band = '2.4GHz' | '5GHz' | '6GHz';

/**
 * Périmètre d'un maillage. Un maillage ne doit jamais mélanger deux plans,
 * deux BSSID ou deux fréquences/bandes.
 */
export interface InterpolationScope {
  planId: string;
  surveyId: string | null;
  bssid: string;
  frequency_mhz: number | null;
  band: Band;
}

/**
 * Mesure RSSI normalisée, construite depuis HeatmapRow + le contexte du plan.
 * x/y sont normalisés 0-1, avec y=0 en bas du plan.
 */
export interface RssiMeasurement {
  scan_point_id: string;
  planId: string;
  surveyId: string | null;
  bssid: string;
  frequency_mhz: number | null;
  band: Band;
  x: number;
  y: number;
  rssi: number;
}

export type PlanReference = Pick<PlanData, 'id' | 'width' | 'height'>;

export interface TriangulationInput {
  scope: InterpolationScope;
  plan: PlanReference;
  measurements: RssiMeasurement[];
}

/** Point exprimé dans le repère pixel du plan, origine en bas à gauche. */
export interface GeometryPoint {
  sourceId: string;
  xPx: number;
  yPx: number;
  rssi: number;
}

export interface Triangle {
  id: string;
  a: GeometryPoint;
  b: GeometryPoint;
  c: GeometryPoint;
  /** Aire doublée, toujours positive après orientation canonique. */
  area2: number;
  /** Vrai si le plus long côté du triangle <= seuil de support. */
  supported: boolean;
}

export interface InterpolationMesh {
  scope: InterpolationScope;
  width: number;
  height: number;
  points: GeometryPoint[];
  triangles: Triangle[];
  /** Zone de délimitation associée, si le maillage a été contraint. */
  polygonId?: string | null;
  /** Seuil (px) au-delà duquel un triangle est considéré non supporté. */
  supportThresholdPx: number;
}

/** Point de requête exprimé dans le repère pixel du plan. */
export interface PlanQueryPoint {
  xPx: number;
  yPx: number;
}

export type TriangleVertices = Pick<Triangle, 'a' | 'b' | 'c'>;

export type BarycentricResult =
  | {
      status: 'INTERPOLATED';
      lambdaA: number;
      lambdaB: number;
      lambdaC: number;
      rssi: number;
    }
  | {
      status: 'OUTSIDE';
      rssi: null;
    }
  | {
      status: 'DEGENERATE';
      rssi: null;
    }
  | {
      status: 'INVALID';
      rssi: null;
      reason: string;
    };

export type ValidationIssueCode =
  | 'INVALID_ID'
  | 'INVALID_PLAN'
  | 'INVALID_COORDINATE'
  | 'INVALID_RSSI'
  | 'INVALID_BSSID'
  | 'INVALID_FREQUENCY'
  | 'INVALID_BAND'
  | 'MIXED_SCOPE'
  | 'DUPLICATE_ID_CONFLICT';

export interface ValidationIssue {
  code: ValidationIssueCode;
  message: string;
  scan_point_id?: string;
  field?: string;
}

export type TriangulationResult =
  | {
      status: 'READY';
      mesh: InterpolationMesh;
      dropped: ValidationIssue[];
    }
  | {
      status: 'INSUFFICIENT_POINTS';
      distinctPointCount: number;
      dropped: ValidationIssue[];
    }
  | {
      status: 'COLLINEAR_POINTS';
      distinctPointCount: number;
      dropped: ValidationIssue[];
    }
  | {
      status: 'INVALID_INPUT';
      issues: ValidationIssue[];
    };

export type SampleResult =
  | {
      status: 'INTERPOLATED';
      triangleId: string;
      lambdaA: number;
      lambdaB: number;
      lambdaC: number;
      rssi: number;
      supported: boolean;
    }
  | {
      status: 'OUTSIDE';
      rssi: null;
    }
  | {
      status: 'INVALID_QUERY';
      reason: string;
    };

const BSSID_RE = /^([0-9a-f]{2}:){5}[0-9a-f]{2}$/;
const EPS_BARY = 1e-9;
const AREA_FACTOR = 1e-9;

function makeIssue(
  code: ValidationIssueCode,
  message: string,
  scanPointId?: string,
  field?: string
): ValidationIssue {
  const issue: ValidationIssue = { code, message };
  if (scanPointId !== undefined) issue.scan_point_id = scanPointId;
  if (field !== undefined) issue.field = field;
  return issue;
}

function normalizeBssid(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const bssid = value.trim().toLowerCase();
  return BSSID_RE.test(bssid) ? bssid : null;
}

function isValidBand(value: unknown): value is Band {
  return value === '2.4GHz' || value === '5GHz' || value === '6GHz';
}

function isValidRssi(value: number): boolean {
  return Number.isInteger(value) && value >= -127 && value <= 0;
}

function bandForFrequency(frequency: number): Band | null {
  if (frequency >= 2400 && frequency <= 2500) return '2.4GHz';
  if (frequency >= 5150 && frequency <= 5895) return '5GHz';
  if (frequency >= 5925 && frequency <= 7125) return '6GHz';
  return null;
}

function validateScope(input: TriangulationInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const { scope, plan } = input;

  if (typeof scope.planId !== 'string' || scope.planId.trim() === '') {
    issues.push(makeIssue('INVALID_PLAN', 'planId est requis.', undefined, 'scope.planId'));
  }
  if (typeof plan.id !== 'string' || plan.id.trim() === '') {
    issues.push(makeIssue('INVALID_PLAN', "L'identifiant du plan est requis.", undefined, 'plan.id'));
  }
  if (scope.planId !== plan.id) {
    issues.push(
      makeIssue(
        'INVALID_PLAN',
        'Le plan du périmètre ne correspond pas au plan fourni.',
        undefined,
        'plan.id'
      )
    );
  }
  if (!Number.isFinite(plan.width) || plan.width <= 0) {
    issues.push(
      makeIssue('INVALID_PLAN', 'La largeur du plan doit être finie et positive.', undefined, 'plan.width')
    );
  }
  if (!Number.isFinite(plan.height) || plan.height <= 0) {
    issues.push(
      makeIssue('INVALID_PLAN', 'La hauteur du plan doit être finie et positive.', undefined, 'plan.height')
    );
  }
  if (normalizeBssid(scope.bssid) === null) {
    issues.push(makeIssue('INVALID_BSSID', 'BSSID de périmètre invalide.', undefined, 'scope.bssid'));
  }
  if (!isValidBand(scope.band)) {
    issues.push(makeIssue('INVALID_BAND', 'Bande de périmètre invalide.', undefined, 'scope.band'));
  }

  const frequency = scope.frequency_mhz;
  if (frequency !== null) {
    if (!Number.isFinite(frequency) || frequency <= 0) {
      issues.push(
        makeIssue(
          'INVALID_FREQUENCY',
          'La fréquence doit être finie et positive.',
          undefined,
          'scope.frequency_mhz'
        )
      );
    } else if (isValidBand(scope.band) && bandForFrequency(frequency) !== scope.band) {
      issues.push(
        makeIssue(
          'INVALID_FREQUENCY',
          'La fréquence ne correspond pas à la bande du périmètre.',
          undefined,
          'scope.frequency_mhz'
        )
      );
    }
  }

  return issues;
}

function measurementHasScopeIssue(
  measurement: RssiMeasurement,
  scope: InterpolationScope,
  scopeBssid: string
): boolean {
  if (measurement.planId !== scope.planId) return true;
  if ((measurement.surveyId ?? null) !== (scope.surveyId ?? null)) return true;
  if ((measurement.frequency_mhz ?? null) !== (scope.frequency_mhz ?? null)) return true;
  if (isValidBand(measurement.band) && measurement.band !== scope.band) return true;

  const measurementBssid = normalizeBssid(measurement.bssid);
  return measurementBssid !== null && measurementBssid !== scopeBssid;
}

function validateMeasurement(measurement: RssiMeasurement): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const pointId = measurement.scan_point_id;

  if (typeof pointId !== 'string' || pointId.trim() === '') {
    issues.push(makeIssue('INVALID_ID', 'scan_point_id est requis.', undefined, 'scan_point_id'));
  }
  if (normalizeBssid(measurement.bssid) === null) {
    issues.push(makeIssue('INVALID_BSSID', 'BSSID invalide.', pointId, 'bssid'));
  }
  if (!isValidBand(measurement.band)) {
    issues.push(makeIssue('INVALID_BAND', 'Bande invalide.', pointId, 'band'));
  }

  const frequency = measurement.frequency_mhz;
  if (frequency !== null) {
    if (!Number.isFinite(frequency) || frequency <= 0) {
      issues.push(
        makeIssue('INVALID_FREQUENCY', 'Fréquence invalide.', pointId, 'frequency_mhz')
      );
    } else if (isValidBand(measurement.band) && bandForFrequency(frequency) !== measurement.band) {
      issues.push(
        makeIssue(
          'INVALID_FREQUENCY',
          'La fréquence ne correspond pas à la bande de la mesure.',
          pointId,
          'frequency_mhz'
        )
      );
    }
  }

  if (!Number.isFinite(measurement.x) || measurement.x < 0 || measurement.x > 1) {
    issues.push(
      makeIssue('INVALID_COORDINATE', 'x doit être un nombre fini entre 0 et 1.', pointId, 'x')
    );
  }
  if (!Number.isFinite(measurement.y) || measurement.y < 0 || measurement.y > 1) {
    issues.push(
      makeIssue('INVALID_COORDINATE', 'y doit être un nombre fini entre 0 et 1.', pointId, 'y')
    );
  }
  if (!isValidRssi(measurement.rssi)) {
    issues.push(
      makeIssue(
        'INVALID_RSSI',
        'Le RSSI doit être un entier entre -127 et 0 dBm.',
        pointId,
        'rssi'
      )
    );
  }

  return issues;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareNumbers(a: number, b: number): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function comparePoints(a: GeometryPoint, b: GeometryPoint): number {
  return (
    compareNumbers(a.xPx, b.xPx) ||
    compareNumbers(a.yPx, b.yPx) ||
    compareStrings(a.sourceId, b.sourceId)
  );
}

function coordinateKey(x: number, y: number): string {
  return `${x}|${y}`;
}

/**
 * Construit un maillage Delaunay RSSI pur, sans dépendance au rendu.
 *
 * Les mesures invalides sont écartées avec un diagnostic. Un mélange de
 * périmètres est une erreur globale et ne produit aucun triangle partiel.
 */
export function triangulateRssi(
  input: TriangulationInput,
  options?: { supportFactor?: number }
): TriangulationResult {
  const scopeIssues = validateScope(input);
  if (scopeIssues.length > 0) {
    return { status: 'INVALID_INPUT', issues: scopeIssues };
  }

  const scopeBssid = normalizeBssid(input.scope.bssid);
  if (scopeBssid === null) {
    return {
      status: 'INVALID_INPUT',
      issues: [makeIssue('INVALID_BSSID', 'BSSID de périmètre invalide.', undefined, 'scope.bssid')],
    };
  }

  const mixedScopeIssues: ValidationIssue[] = [];
  for (const measurement of input.measurements) {
    if (measurementHasScopeIssue(measurement, input.scope, scopeBssid)) {
      mixedScopeIssues.push(
        makeIssue(
          'MIXED_SCOPE',
          'La mesure ne correspond pas au périmètre du maillage.',
          measurement.scan_point_id
        )
      );
    }
  }
  if (mixedScopeIssues.length > 0) {
    return { status: 'INVALID_INPUT', issues: mixedScopeIssues };
  }

  const dropped: ValidationIssue[] = [];
  const coordinateById = new Map<string, string>();
  const pointByCoordinate = new Map<string, GeometryPoint>();

  for (const measurement of input.measurements) {
    const measurementIssues = validateMeasurement(measurement);
    if (measurementIssues.length > 0) {
      dropped.push(...measurementIssues);
      continue;
    }

    const key = coordinateKey(measurement.x, measurement.y);
    const previousCoordinate = coordinateById.get(measurement.scan_point_id);
    if (previousCoordinate !== undefined && previousCoordinate !== key) {
      return {
        status: 'INVALID_INPUT',
        issues: [
          makeIssue(
            'DUPLICATE_ID_CONFLICT',
            'Un même scan_point_id apparaît à plusieurs coordonnées.',
            measurement.scan_point_id
          ),
        ],
      };
    }
    coordinateById.set(measurement.scan_point_id, key);

    const candidate: GeometryPoint = {
      sourceId: measurement.scan_point_id,
      xPx: measurement.x * input.plan.width,
      yPx: measurement.y * input.plan.height,
      rssi: measurement.rssi,
    };
    const previous = pointByCoordinate.get(key);
    const candidateWins =
      previous === undefined ||
      candidate.rssi > previous.rssi ||
      (candidate.rssi === previous.rssi &&
        compareStrings(candidate.sourceId, previous.sourceId) < 0);

    if (candidateWins) pointByCoordinate.set(key, candidate);
  }

  const points = [...pointByCoordinate.values()].sort(comparePoints);
  if (points.length < 3) {
    return {
      status: 'INSUFFICIENT_POINTS',
      distinctPointCount: points.length,
      dropped,
    };
  }

  const delaunay = Delaunator.from(
    points,
    (point) => point.xPx,
    (point) => point.yPx
  );
  const planArea = input.plan.width * input.plan.height;
  const epsilonArea = AREA_FACTOR * Math.max(1, planArea);
  const supportFactor = options?.supportFactor ?? 3;
  const supportThresholdPx = supportFactor * medianNearestNeighborDistancePx(points);
  const triangles: Triangle[] = [];

  for (let index = 0; index < delaunay.triangles.length; index += 3) {
    const a = points[delaunay.triangles[index]];
    const b = points[delaunay.triangles[index + 1]];
    const c = points[delaunay.triangles[index + 2]];

    if (a === undefined || b === undefined || c === undefined) continue;

    let area2 =
      (b.xPx - a.xPx) * (c.yPx - a.yPx) -
      (c.xPx - a.xPx) * (b.yPx - a.yPx);

    if (!Number.isFinite(area2) || Math.abs(area2) / 2 <= epsilonArea) continue;

    let second = b;
    let third = c;
    if (area2 < 0) {
      second = c;
      third = b;
      area2 = -area2;
    }

    const sideA = Math.hypot(second.xPx - a.xPx, second.yPx - a.yPx);
    const sideB = Math.hypot(third.xPx - second.xPx, third.yPx - second.yPx);
    const sideC = Math.hypot(a.xPx - third.xPx, a.yPx - third.yPx);
    const longestSide = Math.max(sideA, sideB, sideC);

    triangles.push({
      id: `t${triangles.length}`,
      a,
      b: second,
      c: third,
      area2,
      supported: longestSide <= supportThresholdPx,
    });
  }

  if (triangles.length === 0) {
    return {
      status: 'COLLINEAR_POINTS',
      distinctPointCount: points.length,
      dropped,
    };
  }

  return {
    status: 'READY',
    mesh: {
      scope: { ...input.scope, bssid: scopeBssid },
      width: input.plan.width,
      height: input.plan.height,
      points,
      triangles,
      supportThresholdPx,
    },
    dropped,
  };
}

export type PreparedBarycentricTriangle =
  | {
      status: 'READY';
      a: GeometryPoint;
      b: GeometryPoint;
      c: GeometryPoint;
      denominator: number;
    }
  | {
      status: 'DEGENERATE';
    }
  | {
      status: 'INVALID';
      reason: string;
    };

/**
 * Prépare un triangle pour des interpolations répétées : validation des
 * sommets et calcul de l'aire effectués une seule fois.
 */
export function prepareBarycentricTriangle(
  triangle: TriangleVertices
): PreparedBarycentricTriangle {
  const { a, b, c } = triangle;
  for (const vertex of [a, b, c]) {
    if (
      !Number.isFinite(vertex.xPx) ||
      !Number.isFinite(vertex.yPx) ||
      !isValidRssi(vertex.rssi)
    ) {
      return {
        status: 'INVALID',
        reason: 'Les sommets du triangle doivent avoir des coordonnées et des RSSI valides.',
      };
    }
  }

  const denominator =
    (b.yPx - c.yPx) * (a.xPx - c.xPx) +
    (c.xPx - b.xPx) * (a.yPx - c.yPx);
  if (!Number.isFinite(denominator)) {
    return {
      status: 'INVALID',
      reason: "L'aire du triangle n'est pas finie.",
    };
  }

  const longestEdge = Math.max(
    Math.hypot(a.xPx - b.xPx, a.yPx - b.yPx),
    Math.hypot(b.xPx - c.xPx, b.yPx - c.yPx),
    Math.hypot(c.xPx - a.xPx, c.yPx - a.yPx)
  );
  const scale = Math.max(1, longestEdge);
  const epsilonArea = AREA_FACTOR * scale * scale;
  if (Math.abs(denominator) / 2 <= epsilonArea) {
    return { status: 'DEGENERATE' };
  }

  return { status: 'READY', a, b, c, denominator };
}

/**
 * Interpole le RSSI d'un point P dans un triangle déjà préparé.
 *
 * Unités et repère :
 * - `xPx`/`yPx` sont exprimés en pixels du plan, avec l'origine en bas à
 *   gauche. P et les trois sommets doivent utiliser exactement le même repère ;
 * - les RSSI des sommets sont en dBm, entiers dans `[-127, 0]`.
 *
 * Tolérances numériques :
 * - `EPS_BARY = 1e-9` sur la somme et les bornes des poids normalisés. C'est
 *   très supérieur à l'erreur d'arrondi des doubles pour ces calculs, tout en
 *   restant négligeable devant un pixel de déplacement ;
 * - un triangle est considéré dégénéré si son aire est inférieure ou égale à
 *   `1e-9 × (plus long côté)²`. Ce seuil relatif à l'échelle du triangle évite
 *   une division par une aire quasi nulle sans rejeter un triangle réellement
 *   utilisable.
 *
 * Aucun RSSI de remplacement n'est produit : `rssi` vaut `null` si P est hors
 * du triangle, si le triangle est dégénéré ou si les entrées sont invalides.
 */
export function interpolatePreparedTriangle(
  point: PlanQueryPoint,
  prepared: Extract<PreparedBarycentricTriangle, { status: 'READY' }>
): BarycentricResult {
  if (!Number.isFinite(point.xPx) || !Number.isFinite(point.yPx)) {
    return {
      status: 'INVALID',
      rssi: null,
      reason: 'Les coordonnées de requête doivent être finies.',
    };
  }

  const { a, b, c, denominator } = prepared;
  let lambdaA =
    ((b.yPx - c.yPx) * (point.xPx - c.xPx) +
      (c.xPx - b.xPx) * (point.yPx - c.yPx)) /
    denominator;
  let lambdaB =
    ((c.yPx - a.yPx) * (point.xPx - c.xPx) +
      (a.xPx - c.xPx) * (point.yPx - c.yPx)) /
    denominator;
  let lambdaC = 1 - lambdaA - lambdaB;

  const sum = lambdaA + lambdaB + lambdaC;
  if (!Number.isFinite(sum) || Math.abs(sum - 1) > EPS_BARY) {
    return {
      status: 'INVALID',
      rssi: null,
      reason: 'La somme des coordonnées barycentriques est invalide.',
    };
  }

  if (
    lambdaA < -EPS_BARY ||
    lambdaB < -EPS_BARY ||
    lambdaC < -EPS_BARY ||
    lambdaA > 1 + EPS_BARY ||
    lambdaB > 1 + EPS_BARY ||
    lambdaC > 1 + EPS_BARY
  ) {
    return { status: 'OUTSIDE', rssi: null };
  }

  if (lambdaA < 0) lambdaA = 0;
  if (lambdaB < 0) lambdaB = 0;
  if (lambdaC < 0) lambdaC = 0;

  const total = lambdaA + lambdaB + lambdaC;
  if (!Number.isFinite(total) || total <= 0) {
    return {
      status: 'INVALID',
      rssi: null,
      reason: 'La normalisation des coordonnées barycentriques a échoué.',
    };
  }

  lambdaA /= total;
  lambdaB /= total;
  lambdaC /= total;

  const rssi = lambdaA * a.rssi + lambdaB * b.rssi + lambdaC * c.rssi;
  if (!Number.isFinite(rssi)) {
    return {
      status: 'INVALID',
      rssi: null,
      reason: "Le RSSI interpolé n'est pas fini.",
    };
  }

  return {
    status: 'INTERPOLATED',
    lambdaA,
    lambdaB,
    lambdaC,
    rssi,
  };
}

/**
 * Variante numérique sans allocation, destinée aux boucles de rasterisation.
 * Retourne `null` hors du triangle, pour un triangle invalide ou si le calcul
 * n'est pas fini. Le résultat doit rester identique à
 * `interpolatePreparedTriangle` (vérifié par les tests).
 */
export function rssiAtPreparedTriangle(
  xPx: number,
  yPx: number,
  prepared: Extract<PreparedBarycentricTriangle, { status: 'READY' }>
): number | null {
  if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) return null;

  const { a, b, c, denominator } = prepared;
  let lambdaA =
    ((b.yPx - c.yPx) * (xPx - c.xPx) +
      (c.xPx - b.xPx) * (yPx - c.yPx)) /
    denominator;
  let lambdaB =
    ((c.yPx - a.yPx) * (xPx - c.xPx) +
      (a.xPx - c.xPx) * (yPx - c.yPx)) /
    denominator;
  let lambdaC = 1 - lambdaA - lambdaB;

  if (
    lambdaA < -EPS_BARY ||
    lambdaB < -EPS_BARY ||
    lambdaC < -EPS_BARY ||
    lambdaA > 1 + EPS_BARY ||
    lambdaB > 1 + EPS_BARY ||
    lambdaC > 1 + EPS_BARY
  ) {
    return null;
  }

  if (lambdaA < 0) lambdaA = 0;
  if (lambdaB < 0) lambdaB = 0;
  if (lambdaC < 0) lambdaC = 0;

  const total = lambdaA + lambdaB + lambdaC;
  if (!Number.isFinite(total) || total <= 0) return null;

  lambdaA /= total;
  lambdaB /= total;
  lambdaC /= total;

  const rssi = lambdaA * a.rssi + lambdaB * b.rssi + lambdaC * c.rssi;
  return Number.isFinite(rssi) ? rssi : null;
}

/**
 * Interpole le RSSI d'un point P dans un triangle ABC par coordonnées
 * barycentriques.
 *
 * Cette fonction reste l'API pure de référence ; pour un grand nombre de
 * requêtes sur le même triangle, utiliser `prepareBarycentricTriangle` puis
 * `interpolatePreparedTriangle`.
 */
export function interpolateBarycentric(
  point: PlanQueryPoint,
  triangle: TriangleVertices
): BarycentricResult {
  const prepared = prepareBarycentricTriangle(triangle);
  if (prepared.status === 'DEGENERATE') {
    return { status: 'DEGENERATE', rssi: null };
  }
  if (prepared.status === 'INVALID') {
    return { status: 'INVALID', rssi: null, reason: prepared.reason };
  }
  return interpolatePreparedTriangle(point, prepared);
}

/**
 * Échantillonne le maillage en coordonnées pixel plan (origine en bas).
 * Aucun point hors triangle ne reçoit de valeur : pas d'extrapolation.
 */
export function sampleTriangleMesh(
  mesh: InterpolationMesh,
  xPx: number,
  yPx: number
): SampleResult {
  if (!Number.isFinite(xPx) || !Number.isFinite(yPx)) {
    return {
      status: 'INVALID_QUERY',
      reason: 'Les coordonnées de requête doivent être finies.',
    };
  }

  for (const triangle of mesh.triangles) {
    const result = interpolateBarycentric({ xPx, yPx }, triangle);

    if (result.status === 'INTERPOLATED') {
      return {
        status: 'INTERPOLATED',
        triangleId: triangle.id,
        lambdaA: result.lambdaA,
        lambdaB: result.lambdaB,
        lambdaC: result.lambdaC,
        rssi: result.rssi,
        supported: triangle.supported,
      };
    }

    if (result.status === 'INVALID') {
      return { status: 'INVALID_QUERY', reason: result.reason };
    }
  }

  return { status: 'OUTSIDE', rssi: null };
}

export function medianNearestNeighborDistancePx(points: GeometryPoint[]): number {
  if (points.length < 2) return 0;
  const nearest: number[] = [];
  for (let i = 0; i < points.length; i += 1) {
    let min = Infinity;
    for (let j = 0; j < points.length; j += 1) {
      if (i === j) continue;
      const d = Math.hypot(points[i].xPx - points[j].xPx, points[i].yPx - points[j].yPx);
      if (d < min) min = d;
    }
    nearest.push(min);
  }
  nearest.sort((a, b) => a - b);
  const mid = Math.floor(nearest.length / 2);
  if (nearest.length % 2 === 0) {
    return (nearest[mid - 1] + nearest[mid]) / 2;
  }
  return nearest[mid];
}

import type { BodyType } from '../../types/site';
import type { ParameterEvaluation, SpecStatus } from '../similarity/similarityEngine';

export function getPlanetRadiusM(body: BodyType): number {
  if (body === 'MOON') return 1737400;
  if (body === 'MARS') return 3389500;
  return 6371000;
}

export function isPolarMoonSite(body: BodyType, lat: number): boolean {
  return body === 'MOON' && Math.abs(lat) > 80;
}

export interface PolarMetersPoint {
  x: number;
  y: number;
  pole: 'south' | 'north';
}

/**
 * Standard IAU Polar Stereographic projection in meters around the Moon pole (central meridian 0).
 * Matches NASA Trek LRO_WAC_Mosaic_SPole60_100m_v02 and LRO_LOLA_DEM_SPole75_30mp_v04.
 */
export function latLonToPolarMeters(
  lat: number,
  lon: number,
  body: BodyType = 'MOON'
): PolarMetersPoint {
  const r = getPlanetRadiusM(body);
  const lonRad = (lon * Math.PI) / 180;
  if (lat < 0) {
    const colatHalf = ((90 + lat) * Math.PI) / 360;
    const rho = 2 * r * Math.tan(Math.max(0, colatHalf));
    return {
      x: rho * Math.sin(lonRad),
      y: rho * Math.cos(lonRad),
      pole: 'south',
    };
  }
  const colatHalf = ((90 - lat) * Math.PI) / 360;
  const rho = 2 * r * Math.tan(Math.max(0, colatHalf));
  return {
    x: rho * Math.sin(lonRad),
    y: -rho * Math.cos(lonRad),
    pole: 'north',
  };
}

export function polarMetersToLatLon(
  x: number,
  y: number,
  pole: 'south' | 'north',
  body: BodyType = 'MOON'
): { lat: number; lon: number } {
  const r = getPlanetRadiusM(body);
  const rho = Math.hypot(x, y);
  if (rho < 1e-3) {
    return { lat: pole === 'south' ? -90 : 90, lon: 0 };
  }
  const c = 2 * Math.atan(rho / (2 * r));
  if (pole === 'south') {
    const lat = -90 + (c * 180) / Math.PI;
    const lon = (Math.atan2(x, y) * 180) / Math.PI;
    return { lat, lon };
  }
  const lat = 90 - (c * 180) / Math.PI;
  const lon = (Math.atan2(x, -y) * 180) / Math.PI;
  return { lat, lon };
}

export interface PolarMeterBbox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  cx: number;
  cy: number;
  pole: 'south' | 'north';
}

export function getPolarMeterBbox(
  lat: number,
  lon: number,
  radiusKm: number,
  body: BodyType = 'MOON'
): PolarMeterBbox {
  const center = latLonToPolarMeters(lat, lon, body);
  const halfM = Math.max(1000, radiusKm * 1000);
  return {
    minX: Math.round(center.x - halfM),
    minY: Math.round(center.y - halfM),
    maxX: Math.round(center.x + halfM),
    maxY: Math.round(center.y + halfM),
    cx: center.x,
    cy: center.y,
    pole: center.pole,
  };
}

/**
 * Checks an RGBA image pixel buffer for empty/transparent frames, flat single-color tiles,
 * or 1D streaking artifacts (variation along only one axis).
 */
export function validateImagePixelBuffer(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): { valid: boolean; reason: string | null } {
  if (width < 4 || height < 4 || rgba.length < width * height * 4) {
    return { valid: false, reason: 'Empty imagery tile' };
  }

  let opaqueCount = 0;
  let minLum = 255;
  let maxLum = 0;
  const lums = new Float32Array(width * height);

  for (let i = 0; i < width * height; i++) {
    const idx = i * 4;
    const a = rgba[idx + 3] ?? 0;
    if (a < 16) {
      lums[i] = NaN;
      continue;
    }
    opaqueCount += 1;
    const lum = 0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2];
    lums[i] = lum;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
  }

  if (opaqueCount < width * height * 0.05) {
    return { valid: false, reason: 'Blank / transparent imagery tile' };
  }

  if (maxLum - minLum < 2.0) {
    return { valid: false, reason: 'Single-color / flat imagery tile' };
  }

  let flatRows = 0;
  let activeRows = 0;
  for (let y = 0; y < height; y++) {
    let rMin = 255;
    let rMax = 0;
    let rCnt = 0;
    for (let x = 0; x < width; x++) {
      const l = lums[y * width + x];
      if (!Number.isFinite(l)) continue;
      rCnt += 1;
      if (l < rMin) rMin = l;
      if (l > rMax) rMax = l;
    }
    if (rCnt >= 3) {
      activeRows += 1;
      if (rMax - rMin < 1.2) flatRows += 1;
    }
  }

  let flatCols = 0;
  let activeCols = 0;
  for (let x = 0; x < width; x++) {
    let cMin = 255;
    let cMax = 0;
    let cCnt = 0;
    for (let y = 0; y < height; y++) {
      const l = lums[y * width + x];
      if (!Number.isFinite(l)) continue;
      cCnt += 1;
      if (l < cMin) cMin = l;
      if (l > cMax) cMax = l;
    }
    if (cCnt >= 3) {
      activeCols += 1;
      if (cMax - cMin < 1.2) flatCols += 1;
    }
  }

  if ((activeRows >= 4 && flatRows / activeRows > 0.94) || (activeCols >= 4 && flatCols / activeCols > 0.94)) {
    return { valid: false, reason: '1D streaked imagery detected (single-axis repeat)' };
  }

  return { valid: true, reason: null };
}

/**
 * Physical meters per Leaflet screen pixel at zoom z for EPSG:3857 on the given planetary radius.
 */
export function metersPerPxAtZoom(
  body: BodyType,
  lat: number,
  zoom: number,
  isSimpleKmCrs = false
): number {
  if (isSimpleKmCrs) {
    return 1000 / Math.max(0.01, Math.pow(2, zoom));
  }
  const worldCircM = 2 * Math.PI * getPlanetRadiusM(body);
  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  return (worldCircM * cosLat) / (256 * Math.pow(2, zoom));
}

export interface EqualScaleFitResult {
  zoom: number;
  metersPerPx: number;
}

/**
 * Computes exact Leaflet EPSG:3857 zoom (or CRS.Simple km zoom when polar) so that a square
 * `roiSpanKm × roiSpanKm` fills `(1 - 2 * paddingFraction)` of the pane's limiting dimension (>=70% with 8% pad).
 */
export function computeEqualScaleZoom(params: {
  body: BodyType;
  lat: number;
  roiSpanKm: number;
  paneWidthPx: number;
  paneHeightPx: number;
  paddingFraction?: number;
  isSimpleKmCrs?: boolean;
}): EqualScaleFitResult {
  const pad = params.paddingFraction ?? 0.08;
  const limitingPx = Math.max(160, Math.min(params.paneWidthPx, params.paneHeightPx));
  const targetSpanPx = limitingPx * Math.max(0.5, 1 - 2 * pad);
  const metersPerPx = (params.roiSpanKm * 1000) / targetSpanPx;

  if (params.isSimpleKmCrs) {
    // CRS.Simple: 1 coordinate unit (= 1 km) spans 2^zoom pixels
    const pxPerKm = targetSpanPx / Math.max(1, params.roiSpanKm);
    const zoom = Math.log2(Math.max(0.1, pxPerKm));
    return {
      zoom: Number(zoom.toFixed(3)),
      metersPerPx,
    };
  }

  const worldCircM = 2 * Math.PI * getPlanetRadiusM(params.body);
  const cosLat = Math.max(0.15, Math.cos((params.lat * Math.PI) / 180));
  const zoom = Math.log2((worldCircM * cosLat) / (256 * metersPerPx));
  return {
    zoom: Number(zoom.toFixed(3)),
    metersPerPx,
  };
}

const NICE_KM_STEPS = [0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];

export function computeNiceScaleBar(
  metersPerPx: number,
  targetWidthPx = 76
): { km: number; label: string; widthPx: number } {
  const safeMPerPx = Math.max(0.5, metersPerPx);
  const idealKm = (targetWidthPx * safeMPerPx) / 1000;
  let bestKm = NICE_KM_STEPS[0];
  let bestDiff = Infinity;
  for (const step of NICE_KM_STEPS) {
    const px = (step * 1000) / safeMPerPx;
    if (px < 36 || px > 132) continue;
    const diff = Math.abs(step - idealKm);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestKm = step;
    }
  }
  const widthPx = Math.max(36, Math.min(132, Math.round((bestKm * 1000) / safeMPerPx)));
  const label = bestKm < 1 ? `${Math.round(bestKm * 1000)} m` : `${bestKm} km`;
  return { km: bestKm, label, widthPx };
}

export interface ScoreConfidenceBadge {
  label: 'Low match' | 'Moderate' | 'Strong' | 'Pending' | 'Insufficient data';
  isLow: boolean;
  toneColor: string;
  paramSummary: string;
}

export function classifyScoreConfidence(
  scorePct: number | null | undefined,
  availableCount: number,
  totalCount: number,
  specStatus?: SpecStatus
): ScoreConfidenceBadge {
  const paramSummary = `${availableCount} of ${totalCount} parameters`;
  if (specStatus === 'INSUFFICIENT-DATA') {
    return {
      label: 'Insufficient data',
      isLow: true,
      toneColor: '#E08A5B',
      paramSummary,
    };
  }
  if (scorePct === null || scorePct === undefined) {
    return {
      label: 'Pending',
      isLow: false,
      toneColor: '#9AA3B2',
      paramSummary,
    };
  }
  if (scorePct < 70) {
    return {
      label: 'Low match',
      isLow: true,
      toneColor: '#D9A441',
      paramSummary,
    };
  }
  if (scorePct <= 85) {
    return {
      label: 'Moderate',
      isLow: false,
      toneColor: '#E2E6ED',
      paramSummary,
    };
  }
  return {
    label: 'Strong',
    isLow: false,
    toneColor: '#A8C09B',
    paramSummary,
  };
}

const SHORT_PARAM_NAMES: Record<string, string> = {
  slope: 'slope',
  relief: 'relief',
  roughness: 'roughness',
  morphology: 'morphology',
  thermal: 'temperature',
  lithology: 'lithology',
  aridity: 'aridity',
};

export function summarizeMatchDrivers(parameters: ParameterEvaluation[]): {
  strongest: string[];
  weakest: string | null;
  line: string;
} {
  const avail = parameters
    .filter((p) => p.available && p.scorePct !== null)
    .slice()
    .sort((a, b) => (b.scorePct ?? 0) - (a.scorePct ?? 0));

  if (avail.length === 0) {
    return {
      strongest: [],
      weakest: null,
      line: 'Acquiring terrain & environmental metrics…',
    };
  }

  const strongest = avail
    .slice(0, Math.min(2, avail.length))
    .map((p) => SHORT_PARAM_NAMES[p.key] ?? p.label.toLowerCase());

  const weakestItem = avail.length > 1 ? avail[avail.length - 1] : null;
  const weakest = weakestItem ? (SHORT_PARAM_NAMES[weakestItem.key] ?? weakestItem.label.toLowerCase()) : null;

  const line = weakest
    ? `Strong: ${strongest.join(', ')} · Weak: ${weakest}`
    : `Strong: ${strongest.join(', ')}`;

  return { strongest, weakest, line };
}

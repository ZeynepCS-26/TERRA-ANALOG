import type {
  DemGridData,
  GeoBounds,
  TerrainFeatures,
  TelemetryFilterState,
} from '../../types/site';

export const SLOPE_BINS = [
  { label: '0–5°', lo: 0, hi: 5, mid: 2.5 },
  { label: '5–10°', lo: 5, hi: 10, mid: 7.5 },
  { label: '10–15°', lo: 10, hi: 15, mid: 12.5 },
  { label: '15–20°', lo: 15, hi: 20, mid: 17.5 },
  { label: '20–25°', lo: 20, hi: 25, mid: 22.5 },
  { label: '25–30°', lo: 25, hi: 30, mid: 27.5 },
  { label: '30–35°', lo: 30, hi: 35, mid: 32.5 },
  { label: '35°+', lo: 35, hi: 90, mid: 40 },
];

export const ASPECT_SECTORS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function decodeTerrariumPixel(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function extractTerrainFeatures(
  elevations: ArrayLike<number>,
  width: number,
  height: number,
  resolutionMPerPx: number,
  source: string,
  fetchedAtIso: string,
  cached = false
): TerrainFeatures {
  if (width < 3 || height < 3 || elevations.length < width * height) {
    throw new Error(`Invalid DEM grid dimensions ${width}x${height}`);
  }

  let minElevM = Infinity;
  let maxElevM = -Infinity;
  let sumElev = 0;
  let validCount = 0;

  for (let i = 0; i < width * height; i++) {
    const z = elevations[i];
    if (!Number.isFinite(z)) continue;
    if (z < minElevM) minElevM = z;
    if (z > maxElevM) maxElevM = z;
    sumElev += z;
    validCount += 1;
  }

  if (validCount === 0) {
    throw new Error('DEM grid contains no finite elevation samples.');
  }

  const meanElevM = sumElev / validCount;
  const reliefM = Math.max(0, maxElevM - minElevM);

  let sqDiffSum = 0;
  for (let i = 0; i < width * height; i++) {
    const z = elevations[i];
    if (!Number.isFinite(z)) continue;
    const d = z - meanElevM;
    sqDiffSum += d * d;
  }
  const elevationStdDevM = Math.sqrt(sqDiffSum / validCount);

  const totalCells = width * height;
  const noDataCount = totalCells - validCount;
  const noDataPct = Number(((noDataCount / totalCells) * 100).toFixed(1));
  const cellM = Math.max(1, resolutionMPerPx);
  const slopes: number[] = [];
  const slopeBinCounts = new Array<number>(SLOPE_BINS.length).fill(0);
  const aspectCounts = new Array<number>(8).fill(0);
  let triSum = 0;
  let triCount = 0;
  let depressionCount = 0;
  const lowElevThreshold = minElevM + reliefM * 0.25;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const z1 = elevations[(y - 1) * width + (x - 1)];
      const z2 = elevations[(y - 1) * width + x];
      const z3 = elevations[(y - 1) * width + (x + 1)];
      const z4 = elevations[y * width + (x - 1)];
      const z5 = elevations[y * width + x];
      const z6 = elevations[y * width + (x + 1)];
      const z7 = elevations[(y + 1) * width + (x - 1)];
      const z8 = elevations[(y + 1) * width + x];
      const z9 = elevations[(y + 1) * width + (x + 1)];

      // Skip incomplete 3x3 kernels bordering PSR "no data" cells to avoid cliff artifacts
      if (
        !Number.isFinite(z1) ||
        !Number.isFinite(z2) ||
        !Number.isFinite(z3) ||
        !Number.isFinite(z4) ||
        !Number.isFinite(z5) ||
        !Number.isFinite(z6) ||
        !Number.isFinite(z7) ||
        !Number.isFinite(z8) ||
        !Number.isFinite(z9)
      ) {
        continue;
      }

      // Horn's 3x3 slope & aspect in true metric cell spacing
      const dzdx = (z3 + 2 * z6 + z9 - (z1 + 2 * z4 + z7)) / (8 * cellM);
      const dzdy = (z7 + 2 * z8 + z9 - (z1 + 2 * z2 + z3)) / (8 * cellM);
      const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
      const slopeDeg = (slopeRad * 180) / Math.PI;
      slopes.push(slopeDeg);

      let bIdx = SLOPE_BINS.findIndex((b) => slopeDeg >= b.lo && slopeDeg < b.hi);
      if (bIdx < 0) bIdx = SLOPE_BINS.length - 1;
      slopeBinCounts[bIdx] += 1;

      if (slopeDeg > 0.2) {
        const aspectRad = Math.atan2(dzdy, -dzdx);
        const deg = (((aspectRad * 180) / Math.PI) + 360) % 360;
        const sector = Math.floor(((deg + 22.5) % 360) / 45);
        aspectCounts[sector] += 1;
      }

      // 3x3 Terrain Ruggedness Index (TRI)
      const absDiffMean =
        (Math.abs(z5 - z1) +
          Math.abs(z5 - z2) +
          Math.abs(z5 - z3) +
          Math.abs(z5 - z4) +
          Math.abs(z5 - z6) +
          Math.abs(z5 - z7) +
          Math.abs(z5 - z8) +
          Math.abs(z5 - z9)) /
        8;
      triSum += absDiffMean;
      triCount += 1;

      const neighborMean = (z1 + z2 + z3 + z4 + z6 + z7 + z8 + z9) / 8;
      if (z5 <= lowElevThreshold || z5 < neighborMean - 0.5) {
        depressionCount += 1;
      }
    }
  }

  slopes.sort((a, b) => a - b);
  const nSlopes = slopes.length;
  const slopeMeanDeg = slopes.reduce((a, b) => a + b, 0) / Math.max(1, nSlopes);
  const slopeMedianDeg = nSlopes > 0 ? slopes[Math.floor(nSlopes * 0.5)] : 0;
  const slopeP95Deg = nSlopes > 0 ? slopes[Math.min(nSlopes - 1, Math.floor(nSlopes * 0.95))] : 0;
  const slopeMaxDeg = nSlopes > 0 ? slopes[nSlopes - 1] : 0;

  const slopeHistogram = slopeBinCounts.map((c) =>
    Number(((c / Math.max(1, nSlopes)) * 100).toFixed(2))
  );

  const aspectTotal = aspectCounts.reduce((a, b) => a + b, 0);
  const aspectHistogram = aspectCounts.map((c) =>
    aspectTotal > 0 ? Number(((c / aspectTotal) * 100).toFixed(2)) : 12.5
  );

  const deg = detectDegenerateDem(elevations, width, height);
  const slopeWarning = slopeMeanDeg > 45 || slopeP95Deg > 45;
  const demQualityOk = !deg.isDegenerate && !slopeWarning && nSlopes >= 9 && noDataPct < 85;
  const demQualityReason = deg.isDegenerate
    ? deg.reason
    : slopeWarning
      ? `Check DEM quality (slope > 45°: ${slopeMeanDeg.toFixed(1)}° mean / ${slopeP95Deg.toFixed(1)}° p95)`
      : noDataPct >= 85
        ? `Insufficient DEM coverage (${noDataPct}% no data)`
        : nSlopes < 9
          ? 'Insufficient valid 3x3 terrain kernels'
          : null;

  return {
    minElevM: Number(minElevM.toFixed(1)),
    maxElevM: Number(maxElevM.toFixed(1)),
    meanElevM: Number(meanElevM.toFixed(1)),
    reliefM: Number(reliefM.toFixed(1)),
    slopeMeanDeg: Number(slopeMeanDeg.toFixed(2)),
    slopeMedianDeg: Number(slopeMedianDeg.toFixed(2)),
    slopeP95Deg: Number(slopeP95Deg.toFixed(2)),
    slopeMaxDeg: Number(slopeMaxDeg.toFixed(2)),
    slopeHistogram,
    elevationStdDevM: Number(elevationStdDevM.toFixed(1)),
    triMeanM: Number((triSum / Math.max(1, triCount)).toFixed(2)),
    aspectHistogram,
    basinRatioPct: Number(((depressionCount / Math.max(1, triCount)) * 100).toFixed(1)),
    noDataCount,
    noDataPct,
    slopeWarning,
    demQualityOk,
    demQualityReason,
    provenance: {
      source,
      tag: cached ? 'cached' : 'measured',
      resolutionMPerPx: Math.round(cellM),
      fetchedAtIso,
    },
  };
}

export function sampleElevationAtUVStrict(
  dem: DemGridData,
  u: number,
  v: number
): number | null {
  if (!Number.isFinite(u) || !Number.isFinite(v) || u < 0 || u > 1 || v < 0 || v > 1) {
    return null;
  }
  const fx = u * (dem.width - 1);
  const fy = v * (dem.height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(dem.width - 1, x0 + 1);
  const y1 = Math.min(dem.height - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;

  const z00 = dem.elevations[y0 * dem.width + x0];
  const z10 = dem.elevations[y0 * dem.width + x1];
  const z01 = dem.elevations[y1 * dem.width + x0];
  const z11 = dem.elevations[y1 * dem.width + x1];
  if (
    !Number.isFinite(z00) ||
    !Number.isFinite(z10) ||
    !Number.isFinite(z01) ||
    !Number.isFinite(z11)
  ) {
    return null;
  }

  const top = z00 * (1 - tx) + z10 * tx;
  const bot = z01 * (1 - tx) + z11 * tx;
  return top * (1 - ty) + bot * ty;
}

export function sampleElevationAtUV(dem: DemGridData, u: number, v: number): number {
  const nu = clamp(u, 0, 1);
  const nv = clamp(v, 0, 1);
  const strict = sampleElevationAtUVStrict(dem, nu, nv);
  return strict ?? 0;
}

export function sampleSlopeAspectAtUV(
  dem: DemGridData,
  u: number,
  v: number
): { slopeDeg: number | null; aspectDeg: number | null } {
  const epsU = 1 / Math.max(4, dem.width - 1);
  const epsV = 1 / Math.max(4, dem.height - 1);
  const dxM = Math.max(1, dem.resolutionMPerPx * 2);
  const dyM = dxM;
  const zL = sampleElevationAtUVStrict(dem, clamp(u - epsU, 0, 1), clamp(v, 0, 1));
  const zR = sampleElevationAtUVStrict(dem, clamp(u + epsU, 0, 1), clamp(v, 0, 1));
  const zU = sampleElevationAtUVStrict(dem, clamp(u, 0, 1), clamp(v - epsV, 0, 1));
  const zD = sampleElevationAtUVStrict(dem, clamp(u, 0, 1), clamp(v + epsV, 0, 1));
  if (zL === null || zR === null || zU === null || zD === null) {
    return { slopeDeg: null, aspectDeg: null };
  }
  const dzdx = (zR - zL) / dxM;
  const dzdy = (zD - zU) / dyM;
  const slopeDeg = (Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy)) * 180) / Math.PI;
  const aspectDeg = (((Math.atan2(dzdy, -dzdx) * 180) / Math.PI) + 360) % 360;
  return {
    slopeDeg: Number(slopeDeg.toFixed(1)),
    aspectDeg: Number(aspectDeg.toFixed(0)),
  };
}

export interface ElevationPercentileStats {
  minM: number;
  maxM: number;
  p2M: number;
  p98M: number;
}

export function computePercentilesP2P98(elevations: ArrayLike<number>): ElevationPercentileStats {
  const valid: number[] = [];
  for (let i = 0; i < elevations.length; i++) {
    const z = Number(elevations[i]);
    if (Number.isFinite(z) && z > -32760 && Math.abs(z) < 1e7) {
      valid.push(z);
    }
  }
  if (valid.length === 0) {
    return { minM: 0, maxM: 1, p2M: 0, p98M: 1 };
  }
  valid.sort((a, b) => a - b);
  const minM = valid[0];
  const maxM = valid[valid.length - 1];
  const p2M = valid[Math.floor((valid.length - 1) * 0.02)];
  const p98M = valid[Math.min(valid.length - 1, Math.ceil((valid.length - 1) * 0.98))];
  return {
    minM: Number(minM.toFixed(1)),
    maxM: Number(maxM.toFixed(1)),
    p2M: Number(p2M.toFixed(1)),
    p98M: Number(Math.max(p2M + 1e-3, p98M).toFixed(1)),
  };
}

export function detectDegenerateDem(
  elevations: ArrayLike<number>,
  width: number,
  height: number
): { isDegenerate: boolean; reason: string | null } {
  if (width < 3 || height < 3 || elevations.length < width * height) {
    return { isDegenerate: true, reason: 'DEM grid too small (< 3x3).' };
  }

  let min = Infinity;
  let max = -Infinity;
  let validCount = 0;
  for (let i = 0; i < width * height; i++) {
    const v = Number(elevations[i]);
    if (!Number.isFinite(v)) continue;
    validCount += 1;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (validCount === 0 || validCount < width * height * 0.15) {
    return {
      isDegenerate: true,
      reason: 'Insufficient DEM data (excessive no-data / shadowed pixels).',
    };
  }
  if (!Number.isFinite(min) || max - min < 1e-3) {
    return { isDegenerate: true, reason: 'All DEM elevation values are identical (flat raster).' };
  }

  let rowVariation = 0;
  let colVariation = 0;
  for (let y = 0; y < height; y++) {
    let rowBase: number | null = null;
    for (let x = 0; x < width; x++) {
      const v = Number(elevations[y * width + x]);
      if (!Number.isFinite(v)) continue;
      if (rowBase === null) {
        rowBase = v;
      } else {
        rowVariation += Math.abs(v - rowBase);
      }
    }
  }
  for (let x = 0; x < width; x++) {
    let colBase: number | null = null;
    for (let y = 0; y < height; y++) {
      const v = Number(elevations[y * width + x]);
      if (!Number.isFinite(v)) continue;
      if (colBase === null) {
        colBase = v;
      } else {
        colVariation += Math.abs(v - colBase);
      }
    }
  }
  if (rowVariation < 1e-2 || colVariation < 1e-2) {
    return {
      isDegenerate: true,
      reason: 'DEM varies along only a single axis (1D striped raster).',
    };
  }

  return { isDegenerate: false, reason: null };
}

export function computeHillshadeAtUV(
  dem: DemGridData,
  u: number,
  v: number,
  azimuthDeg = 315,
  altitudeDeg = 35,
  zFactor = 1.2
): number {
  const epsU = 1 / Math.max(8, dem.width - 1);
  const epsV = 1 / Math.max(8, dem.height - 1);
  const cellM = Math.max(4, dem.resolutionMPerPx);
  const dx = 2 * epsU * (dem.width - 1) * cellM;
  const dy = 2 * epsV * (dem.height - 1) * cellM;

  const zL = sampleElevationAtUV(dem, u - epsU, v);
  const zR = sampleElevationAtUV(dem, u + epsU, v);
  const zU = sampleElevationAtUV(dem, u, v - epsV);
  const zD = sampleElevationAtUV(dem, u, v + epsV);

  const dzdx = ((zR - zL) / Math.max(1, dx)) * zFactor;
  const dzdy = ((zD - zU) / Math.max(1, dy)) * zFactor;

  const zenithRad = ((90 - clamp(altitudeDeg, 5, 85)) * Math.PI) / 180;
  const azimuthRad = ((360 - azimuthDeg + 90) * Math.PI) / 180;
  const slopeRad = Math.atan(Math.sqrt(dzdx * dzdx + dzdy * dzdy));
  const aspectRad = Math.atan2(dzdy, -dzdx);

  const shade =
    Math.cos(zenithRad) * Math.cos(slopeRad) +
    Math.sin(zenithRad) * Math.sin(slopeRad) * Math.cos(azimuthRad - aspectRad);

  return clamp(shade, 0.08, 1);
}

export function generateDemNormalMapRgba(
  dem: DemGridData,
  zFactor = 1.3
): Uint8Array {
  const w = dem.width;
  const h = dem.height;
  const out = new Uint8Array(w * h * 4);
  const cellM = Math.max(4, dem.resolutionMPerPx);

  for (let y = 0; y < h; y++) {
    const yPrev = Math.max(0, y - 1);
    const yNext = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const xPrev = Math.max(0, x - 1);
      const xNext = Math.min(w - 1, x + 1);
      const zL = dem.elevations[y * w + xPrev] ?? 0;
      const zR = dem.elevations[y * w + xNext] ?? 0;
      const zU = dem.elevations[yPrev * w + x] ?? 0;
      const zD = dem.elevations[yNext * w + x] ?? 0;

      const dzdx = ((zR - zL) / (2 * cellM)) * zFactor;
      const dzdy = ((zD - zU) / (2 * cellM)) * zFactor;

      let nx = -dzdx;
      let ny = dzdy;
      let nz = 1.0;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len;
      ny /= len;
      nz /= len;

      const idx = (y * w + x) * 4;
      out[idx] = Math.round((nx * 0.5 + 0.5) * 255);
      out[idx + 1] = Math.round((ny * 0.5 + 0.5) * 255);
      out[idx + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      out[idx + 3] = 255;
    }
  }
  return out;
}

export function boundsToSpanKm(bounds: GeoBounds, latCenter: number, body: 'MARS' | 'MOON' | 'EARTH'): number {
  const rKm = body === 'MOON' ? 1737.4 : body === 'MARS' ? 3389.5 : 6371.0;
  const dLatRad = ((bounds.maxLat - bounds.minLat) * Math.PI) / 180;
  const dLonRad = ((bounds.maxLon - bounds.minLon) * Math.PI) / 180;
  const dy = rKm * dLatRad;
  const dx = rKm * Math.cos((latCenter * Math.PI) / 180) * dLonRad;
  return Number(((Math.abs(dx) + Math.abs(dy)) / 2).toFixed(2));
}

export interface RealTransectSample {
  step: number;
  distKm: number;
  targetElevM: number | null;
  analogElevM: number | null;
  targetRelM: number | null;
  analogRelM: number | null;
  deltaM: number | null;
}

export interface RealTransectSummary {
  points: RealTransectSample[];
  rmseM: number | null;
  pearsonR: number | null;
  lengthKm: number;
  targetAvailable: boolean;
  analogAvailable: boolean;
}

export function computePearsonR(xs: number[], ys: number[]): number {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i];
    sumY += ys[i];
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const denom = Math.sqrt(denX * denY);
  if (denom < 1e-9) return 0;
  return clamp(num / denom, -1, 1);
}

export function computeRealTransectProfile(
  targetDem: DemGridData | null | undefined,
  analogDem: DemGridData | null | undefined,
  spanKm: number,
  pointA: { u: number; v: number },
  pointB: { u: number; v: number },
  steps = 32
): RealTransectSummary {
  const targetAvailable = Boolean(targetDem && targetDem.elevations.length > 4);
  const analogAvailable = Boolean(analogDem && analogDem.elevations.length > 4);
  const du = pointB.u - pointA.u;
  const dv = pointB.v - pointA.v;
  const lengthKm = Number(Math.max(0.5, Math.sqrt(du * du + dv * dv) * Math.max(2, spanKm)).toFixed(2));

  const rawT: Array<number | null> = [];
  const rawA: Array<number | null> = [];

  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const u = pointA.u + du * t;
    const v = pointA.v + dv * t;
    rawT.push(targetDem && targetAvailable ? sampleElevationAtUVStrict(targetDem, u, v) : null);
    rawA.push(analogDem && analogAvailable ? sampleElevationAtUVStrict(analogDem, u, v) : null);
  }

  const validT = rawT.filter((v): v is number => v !== null);
  const validA = rawA.filter((v): v is number => v !== null);
  const meanT = validT.length > 0 ? validT.reduce((a, b) => a + b, 0) / validT.length : 0;
  const meanA = validA.length > 0 ? validA.reduce((a, b) => a + b, 0) / validA.length : 0;

  const relTs: number[] = [];
  const relAs: number[] = [];
  let sqErr = 0;
  let pairCount = 0;

  const points: RealTransectSample[] = [];
  for (let i = 0; i < steps; i++) {
    const t = steps === 1 ? 0 : i / (steps - 1);
    const tVal = rawT[i];
    const aVal = rawA[i];
    const relT = tVal !== null ? Math.round(tVal - meanT) : null;
    const relA = aVal !== null ? Math.round(aVal - meanA) : null;
    const deltaM = relT !== null && relA !== null ? Math.abs(relT - relA) : null;

    if (relT !== null && relA !== null) {
      relTs.push(relT);
      relAs.push(relA);
      sqErr += (relT - relA) ** 2;
      pairCount += 1;
    }

    points.push({
      step: i,
      distKm: Number((t * lengthKm).toFixed(2)),
      targetElevM: tVal !== null ? Math.round(tVal) : null,
      analogElevM: aVal !== null ? Math.round(aVal) : null,
      targetRelM: relT,
      analogRelM: relA,
      deltaM,
    });
  }

  return {
    points,
    rmseM: pairCount > 0 ? Number(Math.sqrt(sqErr / pairCount).toFixed(1)) : null,
    pearsonR: pairCount >= 2 ? Number(computePearsonR(relTs, relAs).toFixed(3)) : null,
    lengthKm,
    targetAvailable,
    analogAvailable,
  };
}

export function buildElevationHistogramFromDem(
  dem: DemGridData,
  buckets = 7
): number[] {
  let min = Infinity;
  let max = -Infinity;
  for (const z of dem.elevations) {
    if (z < min) min = z;
    if (z > max) max = z;
  }
  const span = Math.max(1e-6, max - min);
  const counts = new Array<number>(buckets).fill(0);
  for (const z of dem.elevations) {
    const idx = Math.min(buckets - 1, Math.max(0, Math.floor(((z - min) / span) * buckets)));
    counts[idx] += 1;
  }
  const total = Math.max(1, dem.elevations.length);
  return counts.map((c) => Number(((c / total) * 100).toFixed(1)));
}

export function buildSlopeHistogramChartRows(
  targetFeatures: TerrainFeatures | null | undefined,
  analogFeatures: TerrainFeatures | null | undefined,
  filters: TelemetryFilterState
) {
  return SLOPE_BINS.map((bin, idx) => ({
    label: bin.label,
    targetPct: targetFeatures ? targetFeatures.slopeHistogram[idx] ?? 0 : null,
    analogPct: analogFeatures ? analogFeatures.slopeHistogram[idx] ?? 0 : null,
    inSpec: bin.mid <= filters.slopeMaxDeg,
  }));
}

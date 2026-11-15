import {
  DEFAULT_SIMILARITY_WEIGHTS,
  DEFAULT_TELEMETRY_FILTERS,
  type DataTag,
  type SimilarityWeights,
  type SiteRecord,
  type TelemetryFilterState,
} from '../../types/site';
import { detectDegenerateDem } from '../terrain/terrainExtractor';

export type SpecStatus = 'IN-SPEC' | 'MARGINAL' | 'OUT-OF-SPEC' | 'INSUFFICIENT-DATA';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export function checkSiteDemQuality(site: SiteRecord): { ok: boolean; reason: string | null } {
  if (site.demGrid) {
    const deg = detectDegenerateDem(site.demGrid.elevations, site.demGrid.width, site.demGrid.height);
    if (deg.isDegenerate) {
      return { ok: false, reason: deg.reason ?? 'Degenerate DEM raster' };
    }
  }
  if (site.features) {
    if (site.features.demQualityOk === false) {
      return { ok: false, reason: site.features.demQualityReason ?? 'DEM quality check failed' };
    }
    if (
      site.features.slopeWarning ||
      site.features.slopeMeanDeg > 45 ||
      site.features.slopeP95Deg > 45
    ) {
      return {
        ok: false,
        reason: `Check DEM quality (slope > 45°: ${site.features.slopeP95Deg.toFixed(1)}° p95)`,
      };
    }
  }
  if (site.demStatus === 'unavailable' && !site.geminiEstimate && !site.features) {
    return { ok: false, reason: site.demError || 'DEM unavailable for this site' };
  }
  return { ok: true, reason: null };
}

export type ParameterKey =
  | 'slope'
  | 'relief'
  | 'roughness'
  | 'morphology'
  | 'thermal'
  | 'lithology'
  | 'aridity';

export interface ParameterEvaluation {
  key: ParameterKey;
  label: string;
  available: boolean;
  scorePct: number | null;
  rawWeightPct: number;
  effectiveWeightPct: number;
  tag: DataTag;
  targetValueLabel: string;
  analogValueLabel: string;
  targetSource: string;
  analogSource: string;
}

export interface RadarAxisPoint {
  axis: string;
  target: number;
  analog: number;
}

export interface SiteSimilarityResult {
  targetId: string;
  analogId: string;
  scorePct: number | null;
  availableCount: number;
  totalCount: number;
  confidence: ConfidenceLevel;
  specStatus: SpecStatus;
  specReason: string;
  parameters: ParameterEvaluation[];
  radarData: RadarAxisPoint[];
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/**
 * Derive a 0..100 mafic/basaltic keyword index from verified lithology text only.
 */
export function inferBasalticAffinityFromText(text: string | null | undefined): number | null {
  if (!text || !text.trim()) return null;
  const s = text.toLowerCase();
  let score = 45;
  if (/basalt|mafic|ultramafic|olivine|pyroxene|gabbro|serpentin|ophiolite|anorthosite|scoria|tephra|lava/.test(s)) {
    score += 38;
  }
  if (/volcanic|igneous|andesit|pyroclast|tuff|breccia/.test(s)) {
    score += 18;
  }
  if (/carbonate|hydromagnesite|dolomite|limestone|evaporite|sulfate|jarosite|gypsum|hematite/.test(s)) {
    score += 14;
  }
  if (/alluvial|granite|sandstone|quartz|shale|mudstone|clay|silt/.test(s)) {
    score -= 8;
  }
  return Math.round(clamp(score, 15, 96));
}

function tokenizeLithology(text: string): Set<string> {
  const keywords = [
    'basalt', 'mafic', 'ultramafic', 'olivine', 'carbonate', 'hydromagnesite',
    'dolomite', 'sulfate', 'gypsum', 'jarosite', 'hematite', 'iron', 'clay',
    'smectite', 'phyllosilicate', 'breccia', 'impact', 'alluvial', 'delta',
    'lacustrine', 'evaporite', 'salt', 'halite', 'tephra', 'scoria', 'lava',
    'volcanic', 'sandstone', 'anorthosite', 'permafrost', 'ice', 'regolith',
    'highland', 'massif', 'serpentinite', 'gabbro',
  ];
  const lower = text.toLowerCase();
  const out = new Set<string>();
  for (const kw of keywords) {
    if (lower.includes(kw)) out.add(kw);
  }
  return out;
}

function bhattacharyyaSimilarity(histA: number[], histB: number[]): number {
  const len = Math.min(histA.length, histB.length);
  if (len === 0) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < len; i++) {
    sumA += Math.max(0, histA[i]);
    sumB += Math.max(0, histB[i]);
  }
  if (sumA <= 0 || sumB <= 0) return 0;
  let bc = 0;
  for (let i = 0; i < len; i++) {
    bc += Math.sqrt((Math.max(0, histA[i]) / sumA) * (Math.max(0, histB[i]) / sumB));
  }
  return clamp(bc * 100, 0, 100);
}

/** Resolve slope value with strict precedence: Crew override > Measured DEM > Gemini image estimate */
function resolveSlopeInfo(site: SiteRecord): {
  available: boolean;
  meanDeg: number | null;
  maxDeg: number | null;
  histogram: number[] | null;
  tag: DataTag;
  source: string;
  reliability: number;
} {
  if (typeof site.crewOverrides?.meanSlopeDeg === 'number') {
    return {
      available: true,
      meanDeg: site.crewOverrides.meanSlopeDeg,
      maxDeg: site.crewOverrides.meanSlopeDeg * 1.6,
      histogram: null,
      tag: 'crew-reported',
      source: 'Crew-reported field telemetry',
      reliability: 1.0,
    };
  }
  if (site.features) {
    return {
      available: true,
      meanDeg: site.features.slopeMeanDeg,
      maxDeg: site.features.slopeMaxDeg,
      histogram: site.features.slopeHistogram,
      tag: site.features.provenance.tag,
      source: `${site.features.provenance.source} (${site.features.provenance.resolutionMPerPx ?? '?'} m/px)`,
      reliability: 1.0,
    };
  }
  if (typeof site.geminiEstimate?.estimatedMeanSlopeDeg === 'number') {
    return {
      available: true,
      meanDeg: site.geminiEstimate.estimatedMeanSlopeDeg,
      maxDeg: site.geminiEstimate.estimatedMeanSlopeDeg * 1.6,
      histogram: null,
      tag: 'estimated',
      source: `Gemini image estimate (${site.geminiEstimate.confidencePct}% conf.)`,
      reliability: 0.35,
    };
  }
  return {
    available: false,
    meanDeg: null,
    maxDeg: null,
    histogram: null,
    tag: 'unavailable',
    source: 'unavailable',
    reliability: 0,
  };
}

function resolveReliefInfo(site: SiteRecord): {
  available: boolean;
  reliefM: number | null;
  tag: DataTag;
  source: string;
  reliability: number;
} {
  if (site.features) {
    return {
      available: true,
      reliefM: site.features.reliefM,
      tag: site.features.provenance.tag,
      source: `${site.features.provenance.source}`,
      reliability: 1.0,
    };
  }
  if (typeof site.geminiEstimate?.estimatedReliefM === 'number') {
    return {
      available: true,
      reliefM: site.geminiEstimate.estimatedReliefM,
      tag: 'estimated',
      source: `Gemini image estimate (${site.geminiEstimate.confidencePct}% conf.)`,
      reliability: 0.35,
    };
  }
  return {
    available: false,
    reliefM: null,
    tag: 'unavailable',
    source: 'unavailable',
    reliability: 0,
  };
}

function resolveThermalInfo(site: SiteRecord): {
  available: boolean;
  minC: number | null;
  maxC: number | null;
  tag: DataTag;
  source: string;
} {
  const crewMin = site.crewOverrides?.tempMinC;
  const crewMax = site.crewOverrides?.tempMaxC;
  if (typeof crewMin === 'number' || typeof crewMax === 'number') {
    const minVal = typeof crewMin === 'number' ? crewMin : site.climate?.tempMinC ?? crewMax!;
    const maxVal = typeof crewMax === 'number' ? crewMax : site.climate?.tempMaxC ?? crewMin!;
    return {
      available: true,
      minC: Math.min(minVal, maxVal),
      maxC: Math.max(minVal, maxVal),
      tag: 'crew-reported',
      source: 'Crew-reported thermometer log',
    };
  }
  if (
    site.climate &&
    typeof site.climate.tempMinC === 'number' &&
    typeof site.climate.tempMaxC === 'number'
  ) {
    return {
      available: true,
      minC: site.climate.tempMinC,
      maxC: site.climate.tempMaxC,
      tag: site.climate.provenance.tag,
      source: site.climate.provenance.source,
    };
  }
  return {
    available: false,
    minC: null,
    maxC: null,
    tag: 'unavailable',
    source: 'unavailable',
  };
}

function resolveLithologyInfo(site: SiteRecord): {
  available: boolean;
  text: string | null;
  basalticPct: number | null;
  tag: DataTag;
  source: string;
  reliability: number;
} {
  if (site.crewOverrides?.lithology && site.crewOverrides.lithology.trim()) {
    const txt = site.crewOverrides.lithology.trim();
    return {
      available: true,
      text: txt,
      basalticPct: inferBasalticAffinityFromText(txt),
      tag: 'crew-reported',
      source: 'Crew-reported field geology',
      reliability: 1.0,
    };
  }
  if (site.geology?.lithology) {
    return {
      available: true,
      text: site.geology.lithology,
      basalticPct:
        site.geology.basalticIndexPct ?? inferBasalticAffinityFromText(site.geology.lithology),
      tag: site.geology.provenance.tag,
      source: site.geology.provenance.source,
      reliability: 1.0,
    };
  }
  if (site.geminiEstimate?.probableGeology) {
    return {
      available: true,
      text: site.geminiEstimate.probableGeology,
      basalticPct: inferBasalticAffinityFromText(site.geminiEstimate.probableGeology),
      tag: 'estimated',
      source: `Gemini image estimate (${site.geminiEstimate.confidencePct}% conf.)`,
      reliability: 0.35,
    };
  }
  return {
    available: false,
    text: null,
    basalticPct: null,
    tag: 'unavailable',
    source: 'unavailable',
    reliability: 0,
  };
}

function combineTag(tagA: DataTag, tagB: DataTag): DataTag {
  if (tagA === 'unavailable' || tagB === 'unavailable') return 'unavailable';
  if (tagA === 'estimated' || tagB === 'estimated') return 'estimated';
  if (tagA === 'crew-reported' || tagB === 'crew-reported') return 'crew-reported';
  if (tagA === 'cached' || tagB === 'cached') return 'cached';
  return 'measured';
}

export function evaluateSiteSimilarity(
  target: SiteRecord,
  analog: SiteRecord,
  weights: SimilarityWeights = DEFAULT_SIMILARITY_WEIGHTS,
  filters: TelemetryFilterState = DEFAULT_TELEMETRY_FILTERS
): SiteSimilarityResult {
  const tDemQual = checkSiteDemQuality(target);
  const aDemQual = checkSiteDemQuality(analog);
  const demQualityFailed = !tDemQual.ok || !aDemQual.ok;
  const demQualityFailureReason = !tDemQual.ok ? tDemQual.reason : aDemQual.reason;

  const tSlope = tDemQual.ok ? resolveSlopeInfo(target) : { available: false, meanDeg: null, maxDeg: null, histogram: null, tag: 'unavailable' as DataTag, source: 'DEM quality failed', reliability: 0 };
  const aSlope = aDemQual.ok ? resolveSlopeInfo(analog) : { available: false, meanDeg: null, maxDeg: null, histogram: null, tag: 'unavailable' as DataTag, source: 'DEM quality failed', reliability: 0 };
  const tRelief = tDemQual.ok ? resolveReliefInfo(target) : { available: false, reliefM: null, tag: 'unavailable' as DataTag, source: 'DEM quality failed', reliability: 0 };
  const aRelief = aDemQual.ok ? resolveReliefInfo(analog) : { available: false, reliefM: null, tag: 'unavailable' as DataTag, source: 'DEM quality failed', reliability: 0 };
  const tThermal = resolveThermalInfo(target);
  const aThermal = resolveThermalInfo(analog);
  const tLith = resolveLithologyInfo(target);
  const aLith = resolveLithologyInfo(analog);

  const rawList: Array<{
    key: ParameterKey;
    label: string;
    rawWeight: number;
    available: boolean;
    scorePct: number | null;
    reliability: number;
    tag: DataTag;
    targetValueLabel: string;
    analogValueLabel: string;
    targetSource: string;
    analogSource: string;
  }> = [];

  // 1. Slope distribution
  {
    const available = tSlope.available && aSlope.available;
    let scorePct: number | null = null;
    if (available && tSlope.meanDeg !== null && aSlope.meanDeg !== null) {
      const meanSim = clamp(100 - Math.abs(tSlope.meanDeg - aSlope.meanDeg) * 3.4, 5, 100);
      if (tSlope.histogram && aSlope.histogram) {
        const histSim = bhattacharyyaSimilarity(tSlope.histogram, aSlope.histogram);
        scorePct = Number((histSim * 0.65 + meanSim * 0.35).toFixed(1));
      } else {
        scorePct = Number(meanSim.toFixed(1));
      }
    }
    rawList.push({
      key: 'slope',
      label: 'Slope distribution',
      rawWeight: weights.slope,
      available,
      scorePct,
      reliability: Math.min(tSlope.reliability, aSlope.reliability),
      tag: combineTag(tSlope.tag, aSlope.tag),
      targetValueLabel: tSlope.meanDeg !== null ? `${tSlope.meanDeg.toFixed(1)}° mean` : 'N/A',
      analogValueLabel: aSlope.meanDeg !== null ? `${aSlope.meanDeg.toFixed(1)}° mean` : 'N/A',
      targetSource: tSlope.source,
      analogSource: aSlope.source,
    });
  }

  // 2. Relief envelope
  {
    const available = tRelief.available && aRelief.available;
    let scorePct: number | null = null;
    if (available && tRelief.reliefM !== null && aRelief.reliefM !== null) {
      const lo = Math.max(1, Math.min(tRelief.reliefM, aRelief.reliefM));
      const hi = Math.max(1, Math.max(tRelief.reliefM, aRelief.reliefM));
      const logRatio = Math.abs(Math.log10(hi / lo));
      scorePct = Number(clamp(100 - logRatio * 55, 10, 100).toFixed(1));
    }
    rawList.push({
      key: 'relief',
      label: 'Elevation relief',
      rawWeight: weights.relief,
      available,
      scorePct,
      reliability: Math.min(tRelief.reliability, aRelief.reliability),
      tag: combineTag(tRelief.tag, aRelief.tag),
      targetValueLabel: tRelief.reliefM !== null ? `${Math.round(tRelief.reliefM)} m` : 'N/A',
      analogValueLabel: aRelief.reliefM !== null ? `${Math.round(aRelief.reliefM)} m` : 'N/A',
      targetSource: tRelief.source,
      analogSource: aRelief.source,
    });
  }

  // 3. Surface roughness (TRI & elevation stdDev)
  {
    const available = !demQualityFailed && Boolean(target.features && analog.features);
    let scorePct: number | null = null;
    if (available && target.features && analog.features) {
      const triLo = Math.max(0.5, Math.min(target.features.triMeanM, analog.features.triMeanM));
      const triHi = Math.max(0.5, Math.max(target.features.triMeanM, analog.features.triMeanM));
      const triScore = clamp(100 - Math.abs(Math.log10(triHi / triLo)) * 48, 12, 100);
      const sdLo = Math.max(1, Math.min(target.features.elevationStdDevM, analog.features.elevationStdDevM));
      const sdHi = Math.max(1, Math.max(target.features.elevationStdDevM, analog.features.elevationStdDevM));
      const sdScore = clamp(100 - Math.abs(Math.log10(sdHi / sdLo)) * 48, 12, 100);
      scorePct = Number((triScore * 0.6 + sdScore * 0.4).toFixed(1));
    }
    rawList.push({
      key: 'roughness',
      label: 'Surface roughness (TRI)',
      rawWeight: weights.roughness,
      available,
      scorePct,
      reliability: available ? 1.0 : 0,
      tag:
        available && target.features && analog.features
          ? combineTag(target.features.provenance.tag, analog.features.provenance.tag)
          : 'unavailable',
      targetValueLabel: tDemQual.ok && target.features ? `${target.features.triMeanM.toFixed(1)} m TRI` : 'N/A',
      analogValueLabel: aDemQual.ok && analog.features ? `${analog.features.triMeanM.toFixed(1)} m TRI` : 'N/A',
      targetSource: tDemQual.ok ? (target.features?.provenance.source ?? 'unavailable') : 'DEM quality failed',
      analogSource: aDemQual.ok ? (analog.features?.provenance.source ?? 'unavailable') : 'DEM quality failed',
    });
  }

  // 4. Basin / depression & aspect morphology
  {
    const available = !demQualityFailed && Boolean(target.features && analog.features);
    let scorePct: number | null = null;
    if (available && target.features && analog.features) {
      const basinScore = clamp(
        100 - Math.abs(target.features.basinRatioPct - analog.features.basinRatioPct) * 1.9,
        15,
        100
      );
      const aspectSim = bhattacharyyaSimilarity(
        target.features.aspectHistogram,
        analog.features.aspectHistogram
      );
      scorePct = Number((basinScore * 0.6 + aspectSim * 0.4).toFixed(1));
    }
    rawList.push({
      key: 'morphology',
      label: 'Basin & aspect morphology',
      rawWeight: weights.morphology,
      available,
      scorePct,
      reliability: available ? 1.0 : 0,
      tag:
        available && target.features && analog.features
          ? combineTag(target.features.provenance.tag, analog.features.provenance.tag)
          : 'unavailable',
      targetValueLabel: tDemQual.ok && target.features ? `${target.features.basinRatioPct}% basin` : 'N/A',
      analogValueLabel: aDemQual.ok && analog.features ? `${analog.features.basinRatioPct}% basin` : 'N/A',
      targetSource: tDemQual.ok ? (target.features?.provenance.source ?? 'unavailable') : 'DEM quality failed',
      analogSource: aDemQual.ok ? (analog.features?.provenance.source ?? 'unavailable') : 'DEM quality failed',
    });
  }

  // 5. Thermal range parity
  {
    const available = tThermal.available && aThermal.available;
    let scorePct: number | null = null;
    if (available && tThermal.minC !== null && tThermal.maxC !== null && aThermal.minC !== null && aThermal.maxC !== null) {
      const interLo = Math.max(tThermal.minC, aThermal.minC);
      const interHi = Math.min(tThermal.maxC, aThermal.maxC);
      const overlap = Math.max(0, interHi - interLo);
      const union = Math.max(1, Math.max(tThermal.maxC, aThermal.maxC) - Math.min(tThermal.minC, aThermal.minC));
      const iou = (overlap / union) * 100;
      const midT = (tThermal.minC + tThermal.maxC) / 2;
      const midA = (aThermal.minC + aThermal.maxC) / 2;
      const midSim = clamp(100 - Math.abs(midT - midA) * 0.65, 10, 100);
      scorePct = Number(clamp(iou * 0.45 + midSim * 0.55, 8, 99).toFixed(1));
    }
    rawList.push({
      key: 'thermal',
      label: 'Thermal envelope',
      rawWeight: weights.thermal,
      available,
      scorePct,
      reliability: available ? 1.0 : 0,
      tag: combineTag(tThermal.tag, aThermal.tag),
      targetValueLabel:
        tThermal.minC !== null ? `${tThermal.minC}..${tThermal.maxC}°C` : 'N/A',
      analogValueLabel:
        aThermal.minC !== null ? `${aThermal.minC}..${aThermal.maxC}°C` : 'N/A',
      targetSource: tThermal.source,
      analogSource: aThermal.source,
    });
  }

  // 6. Lithology & mineralogy match
  {
    const available = tLith.available && aLith.available;
    let scorePct: number | null = null;
    if (available && tLith.text && aLith.text) {
      const tokT = tokenizeLithology(tLith.text);
      const tokA = tokenizeLithology(aLith.text);
      const unionSize = new Set([...tokT, ...tokA]).size;
      let shared = 0;
      for (const k of tokT) {
        if (tokA.has(k)) shared += 1;
      }
      const jaccard = unionSize > 0 ? (shared / unionSize) * 100 : 25;
      const bT = tLith.basalticPct ?? 50;
      const bA = aLith.basalticPct ?? 50;
      const idxSim = clamp(100 - Math.abs(bT - bA) * 1.4, 15, 100);
      scorePct = Number(clamp(jaccard * 0.45 + idxSim * 0.55, 12, 98).toFixed(1));
    }
    rawList.push({
      key: 'lithology',
      label: 'Lithology parity',
      rawWeight: weights.lithology,
      available,
      scorePct,
      reliability: Math.min(tLith.reliability, aLith.reliability),
      tag: combineTag(tLith.tag, aLith.tag),
      targetValueLabel: tLith.text ? tLith.text.slice(0, 40) : 'N/A',
      analogValueLabel: aLith.text ? aLith.text.slice(0, 40) : 'N/A',
      targetSource: tLith.source,
      analogSource: aLith.source,
    });
  }

  // 7. Aridity / moisture parity
  {
    const tArid = target.climate?.aridityScore ?? null;
    const aArid = analog.climate?.aridityScore ?? null;
    const available = tArid !== null && aArid !== null;
    const scorePct = available
      ? Number(clamp(100 - Math.abs(tArid! - aArid!) * 1.15, 10, 100).toFixed(1))
      : null;
    rawList.push({
      key: 'aridity',
      label: 'Aridity & moisture',
      rawWeight: weights.aridity,
      available,
      scorePct,
      reliability: available ? 1.0 : 0,
      tag:
        available && target.climate && analog.climate
          ? combineTag(target.climate.provenance.tag, analog.climate.provenance.tag)
          : 'unavailable',
      targetValueLabel: tArid !== null ? `${tArid}/100` : 'N/A',
      analogValueLabel: aArid !== null ? `${aArid}/100` : 'N/A',
      targetSource: target.climate?.provenance.source ?? 'unavailable',
      analogSource: analog.climate?.provenance.source ?? 'unavailable',
    });
  }

  // Re-normalize weights strictly over AVAILABLE parameters (never pad missing parameters!)
  const availableItems = rawList.filter((item) => item.available && item.scorePct !== null);
  const effectiveWeightMass = availableItems.reduce(
    (sum, item) => sum + item.rawWeight * item.reliability,
    0
  );

  const parameters: ParameterEvaluation[] = rawList.map((item) => {
    const effPct =
      item.available && effectiveWeightMass > 0
        ? Number((((item.rawWeight * item.reliability) / effectiveWeightMass) * 100).toFixed(1))
        : 0;
    return {
      key: item.key,
      label: item.label,
      available: item.available,
      scorePct: item.scorePct,
      rawWeightPct: item.rawWeight,
      effectiveWeightPct: effPct,
      tag: item.tag,
      targetValueLabel: item.targetValueLabel,
      analogValueLabel: item.analogValueLabel,
      targetSource: item.targetSource,
      analogSource: item.analogSource,
    };
  });

  const availableCount = availableItems.length;
  const totalCount = rawList.length;

  let baseScore: number | null = null;
  if (availableCount > 0 && effectiveWeightMass > 0) {
    const weightedSum = parameters.reduce(
      (sum, p) => sum + (p.available && p.scorePct !== null ? p.scorePct * (p.effectiveWeightPct / 100) : 0),
      0
    );
    baseScore = weightedSum;
  }

  // Operational threshold gate checks (only evaluate on available measured/crew metrics)
  let filterPenalty = 0;
  const reasons: string[] = [];

  if (aSlope.maxDeg !== null && aSlope.maxDeg > filters.slopeMaxDeg) {
    const excess = aSlope.maxDeg - filters.slopeMaxDeg;
    filterPenalty += excess * 0.45;
    reasons.push(`Max slope ${aSlope.maxDeg.toFixed(1)}° > ${filters.slopeMaxDeg}° cap`);
  }
  if (aLith.basalticPct !== null && aLith.basalticPct < filters.mineralIndexMinPct) {
    const deficit = filters.mineralIndexMinPct - aLith.basalticPct;
    filterPenalty += deficit * 0.35;
    reasons.push(`Mineral index ${aLith.basalticPct}% < ${filters.mineralIndexMinPct}% min`);
  }
  if (aThermal.minC !== null && aThermal.minC < filters.tempMinThresholdC) {
    const cold = filters.tempMinThresholdC - aThermal.minC;
    filterPenalty += cold * 0.2;
    reasons.push(`Temp ${aThermal.minC}°C < ${filters.tempMinThresholdC}°C floor`);
  }

  const finalScore =
    !demQualityFailed && baseScore !== null
      ? Number(clamp(baseScore - filterPenalty, 5, 99.5).toFixed(1))
      : null;

  // Data confidence assessment
  const estimatedCount = parameters.filter((p) => p.available && p.tag === 'estimated').length;
  let confidence: ConfidenceLevel = 'low';
  if (!demQualityFailed && availableCount >= 6 && estimatedCount === 0) {
    confidence = 'high';
  } else if (!demQualityFailed && availableCount >= 4 && estimatedCount <= 2) {
    confidence = 'medium';
  }

  let specStatus: SpecStatus = 'IN-SPEC';
  if (demQualityFailed || availableCount < 2) {
    specStatus = 'INSUFFICIENT-DATA';
  } else if (reasons.length >= 2 || filterPenalty > 7) {
    specStatus = 'OUT-OF-SPEC';
  } else if (reasons.length === 1 || filterPenalty > 0) {
    specStatus = 'MARGINAL';
  }

  const specReason = demQualityFailed
    ? `Insufficient data: ${demQualityFailureReason ?? 'DEM quality check failed'}`
    : availableCount < 2
      ? `Only ${availableCount} of ${totalCount} parameters available`
      : reasons.length === 0
        ? `Nominal (${availableCount} of ${totalCount} parameters verified)`
        : reasons.join(' · ');

  // Normalized radar axes derived from actual site metrics (never random)
  const radarData: RadarAxisPoint[] = [
    {
      axis: 'Slope',
      target: tSlope.meanDeg !== null ? Math.round(clamp((tSlope.meanDeg / 35) * 100, 5, 100)) : 0,
      analog: aSlope.meanDeg !== null ? Math.round(clamp((aSlope.meanDeg / 35) * 100, 5, 100)) : 0,
    },
    {
      axis: 'Relief',
      target: tRelief.reliefM !== null ? Math.round(clamp((Math.log10(Math.max(10, tRelief.reliefM)) / 4) * 100, 5, 100)) : 0,
      analog: aRelief.reliefM !== null ? Math.round(clamp((Math.log10(Math.max(10, aRelief.reliefM)) / 4) * 100, 5, 100)) : 0,
    },
    {
      axis: 'Roughness',
      target: target.features ? Math.round(clamp((target.features.triMeanM / 45) * 100, 5, 100)) : 0,
      analog: analog.features ? Math.round(clamp((analog.features.triMeanM / 45) * 100, 5, 100)) : 0,
    },
    {
      axis: 'Basin',
      target: target.features ? Math.round(clamp(target.features.basinRatioPct, 5, 100)) : 0,
      analog: analog.features ? Math.round(clamp(analog.features.basinRatioPct, 5, 100)) : 0,
    },
    {
      axis: 'Thermal',
      target: tThermal.maxC !== null ? Math.round(clamp(((tThermal.maxC + 200) / 320) * 100, 5, 100)) : 0,
      analog: aThermal.maxC !== null ? Math.round(clamp(((aThermal.maxC + 200) / 320) * 100, 5, 100)) : 0,
    },
    {
      axis: 'Lithology',
      target: tLith.basalticPct ?? 0,
      analog: aLith.basalticPct ?? 0,
    },
    {
      axis: 'Aridity',
      target: target.climate?.aridityScore ?? 0,
      analog: analog.climate?.aridityScore ?? 0,
    },
  ];

  return {
    targetId: target.id,
    analogId: analog.id,
    scorePct: finalScore,
    availableCount,
    totalCount,
    confidence,
    specStatus,
    specReason,
    parameters,
    radarData,
  };
}

export function rankAnalogsForTarget(
  target: SiteRecord,
  analogs: SiteRecord[],
  weights: SimilarityWeights = DEFAULT_SIMILARITY_WEIGHTS,
  filters: TelemetryFilterState = DEFAULT_TELEMETRY_FILTERS
): Array<{ analog: SiteRecord; result: SiteSimilarityResult }> {
  return analogs
    .map((analog) => ({
      analog,
      result: evaluateSiteSimilarity(target, analog, weights, filters),
    }))
    .sort((a, b) => (b.result.scorePct ?? -1) - (a.result.scorePct ?? -1));
}

export function similarityScoreToColor(scorePct: number | null): string {
  if (scorePct === null) return '#9AA3B2';
  const t = clamp((scorePct - 50) / 45, 0, 1);
  if (t < 0.5) {
    const k = t * 2;
    const r = Math.round(181 + (217 - 181) * k);
    const g = Math.round(72 + (164 - 72) * k);
    const b = Math.round(58 + (65 - 58) * k);
    return `rgb(${r}, ${g}, ${b})`;
  }
  const k = (t - 0.5) * 2;
  const r = Math.round(217 + (143 - 217) * k);
  const g = Math.round(164 + (168 - 164) * k);
  const b = Math.round(65 + (134 - 65) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

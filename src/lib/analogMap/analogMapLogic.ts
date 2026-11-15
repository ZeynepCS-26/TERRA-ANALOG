import {
  DEFAULT_SIMILARITY_WEIGHTS,
  DEFAULT_TELEMETRY_FILTERS,
  type SimilarityWeights,
  type SiteRecord,
  type TelemetryFilterState,
} from '../../types/site';
import { evaluateSiteSimilarity } from '../similarity/similarityEngine';

export interface AnalogBestMatch {
  analog: SiteRecord;
  bestTarget: SiteRecord;
  scorePct: number | null;
}

export function getBestTargetForAnalog(
  analog: SiteRecord,
  targets: SiteRecord[],
  weights: SimilarityWeights = DEFAULT_SIMILARITY_WEIGHTS,
  filters: TelemetryFilterState = DEFAULT_TELEMETRY_FILTERS
): AnalogBestMatch {
  let bestTarget = targets[0];
  let bestScore: number | null = null;

  for (const target of targets) {
    const res = evaluateSiteSimilarity(target, analog, weights, filters);
    if (res.scorePct !== null && (bestScore === null || res.scorePct > bestScore)) {
      bestScore = res.scorePct;
      bestTarget = target;
    }
  }

  return {
    analog,
    bestTarget,
    scorePct: bestScore !== null ? Number(bestScore.toFixed(1)) : null,
  };
}

export function computeBubbleRadius(
  scorePct: number | null,
  minScore = 55,
  maxScore = 98,
  minRadius = 7,
  maxRadius = 21
): number {
  if (scorePct === null) return minRadius;
  const span = Math.max(1, maxScore - minScore);
  const t = Math.max(0, Math.min(1, (scorePct - minScore) / span));
  return Number((minRadius + t * (maxRadius - minRadius)).toFixed(2));
}

export function getOrderedAnalogIds(analogs: SiteRecord[]): string[] {
  return [...analogs].sort((a, b) => a.lon - b.lon).map((a) => a.id);
}

export function getNextAnalogId(
  orderedIds: string[],
  currentId: string | null,
  direction: 1 | -1
): string | null {
  if (orderedIds.length === 0) return null;
  if (!currentId) {
    return direction === 1 ? orderedIds[0] : orderedIds[orderedIds.length - 1];
  }
  const idx = orderedIds.indexOf(currentId);
  if (idx === -1) return orderedIds[0];
  const nextIdx = (idx + direction + orderedIds.length) % orderedIds.length;
  return orderedIds[nextIdx];
}

export function clampTooltipPosition(
  anchorX: number,
  anchorY: number,
  viewportW: number,
  viewportH: number,
  tooltipW = 290,
  tooltipH = 68,
  offset = 18
): { left: number; top: number } {
  const preferRight = anchorX + offset + tooltipW <= viewportW - 16;
  const rawLeft = preferRight ? anchorX + offset : anchorX - offset - tooltipW;
  const left = Math.max(16, Math.min(viewportW - tooltipW - 16, rawLeft));
  const rawTop = anchorY - tooltipH * 0.5;
  const top = Math.max(16, Math.min(viewportH - tooltipH - 16, rawTop));
  return { left, top };
}

import type { SimilarityWeights, SiteRecord, TelemetryFilterState } from '../../types/site';
import { DEFAULT_SIMILARITY_WEIGHTS, DEFAULT_TELEMETRY_FILTERS } from '../../types/site';

export interface TerraAnalogProjectBundle {
  schemaVersion: 'terra-analog/v2';
  exportedAtIso: string;
  activeTargetId: string;
  activeAnalogId: string;
  weights: SimilarityWeights;
  filters: TelemetryFilterState;
  sites: SiteRecord[];
}

export function serializeProjectBundle(params: {
  sites: SiteRecord[];
  activeTargetId: string;
  activeAnalogId: string;
  weights: SimilarityWeights;
  filters: TelemetryFilterState;
}): string {
  // Strip raw oversized demGrid arrays if needed? No — keep compact demGrid (64x64 = 4096 floats ~ 30KB/site)
  // only for user-created / uploaded GeoTIFF sites so shared JSON bundles stay fast & self-contained!
  const portableSites = params.sites.map((s) => ({
    ...s,
    demGrid: s.ingestMethod === 'geotiff_upload' ? s.demGrid : undefined,
  }));

  const bundle: TerraAnalogProjectBundle = {
    schemaVersion: 'terra-analog/v2',
    exportedAtIso: new Date().toISOString(),
    activeTargetId: params.activeTargetId,
    activeAnalogId: params.activeAnalogId,
    weights: params.weights,
    filters: params.filters,
    sites: portableSites,
  };
  return JSON.stringify(bundle, null, 2);
}

export function parseProjectBundle(rawJson: string): TerraAnalogProjectBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch {
    throw new Error('Invalid JSON file.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Project file must be a JSON object.');
  }

  const obj = parsed as Partial<TerraAnalogProjectBundle>;
  if (obj.schemaVersion !== 'terra-analog/v2' || !Array.isArray(obj.sites)) {
    throw new Error('Unsupported project schema. Expected terra-analog/v2 with sites array.');
  }

  const validSites: SiteRecord[] = [];
  for (const item of obj.sites) {
    if (
      item &&
      typeof item === 'object' &&
      typeof item.id === 'string' &&
      typeof item.name === 'string' &&
      (item.body === 'MARS' || item.body === 'MOON' || item.body === 'EARTH') &&
      typeof item.lat === 'number' &&
      typeof item.lon === 'number'
    ) {
      validSites.push(item as SiteRecord);
    }
  }

  if (validSites.length === 0) {
    throw new Error('Project file contains no valid sites.');
  }

  return {
    schemaVersion: 'terra-analog/v2',
    exportedAtIso: obj.exportedAtIso ?? new Date().toISOString(),
    activeTargetId: typeof obj.activeTargetId === 'string' ? obj.activeTargetId : validSites[0].id,
    activeAnalogId: typeof obj.activeAnalogId === 'string' ? obj.activeAnalogId : validSites[0].id,
    weights: { ...DEFAULT_SIMILARITY_WEIGHTS, ...(obj.weights ?? {}) },
    filters: { ...DEFAULT_TELEMETRY_FILTERS, ...(obj.filters ?? {}) },
    sites: validSites,
  };
}

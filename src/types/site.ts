export type BodyType = 'MARS' | 'MOON' | 'EARTH';

export type DataTag =
  | 'measured'
  | 'estimated'
  | 'crew-reported'
  | 'cached'
  | 'unavailable';

export type IngestMethod =
  | 'seed'
  | 'catalog'
  | 'map_pick'
  | 'coords'
  | 'nomenclature'
  | 'image_upload'
  | 'geotiff_upload';

export interface GeoBounds {
  minLon: number;
  maxLon: number;
  minLat: number;
  maxLat: number;
}

export interface DemGridData {
  width: number;
  height: number;
  /** Row-major elevation values in meters (top row = maxLat, left col = minLon) */
  elevations: number[];
  bounds: GeoBounds;
  resolutionMPerPx: number;
  source: string;
  fetchedAtIso: string;
  cached?: boolean;
}

export interface ProvenanceInfo {
  source: string;
  tag: DataTag;
  resolutionMPerPx?: number;
  fetchedAtIso?: string;
  note?: string;
}

export interface TerrainFeatures {
  minElevM: number;
  maxElevM: number;
  meanElevM: number;
  reliefM: number;
  slopeMeanDeg: number;
  slopeMedianDeg: number;
  slopeP95Deg: number;
  slopeMaxDeg: number;
  /** 8 bins: [0-5, 5-10, 10-15, 15-20, 20-25, 25-30, 30-35, 35+] in % summing to 100 */
  slopeHistogram: number[];
  elevationStdDevM: number;
  /** 3x3 Terrain Ruggedness Index mean (meters) */
  triMeanM: number;
  /** 8 compass sectors: N, NE, E, SE, S, SW, W, NW in % summing to 100 */
  aspectHistogram: number[];
  basinRatioPct: number;
  noDataCount?: number;
  noDataPct?: number;
  slopeWarning?: boolean;
  demQualityOk?: boolean;
  demQualityReason?: string | null;
  provenance: ProvenanceInfo;
}

export interface ClimateMetrics {
  tempMinC: number | null;
  tempMaxC: number | null;
  tempMeanC: number | null;
  humidityMeanPct: number | null;
  precipAnnualMm: number | null;
  /** 0..100 derived aridity index when climate data exists, else null */
  aridityScore: number | null;
  provenance: ProvenanceInfo;
}

export interface GeologyMetrics {
  lithology: string | null;
  unitCode?: string | null;
  unitName?: string | null;
  age?: string | null;
  /** Derived 0..100 mafic/basaltic keyword index only when lithology text exists, else null */
  basalticIndexPct: number | null;
  provenance: ProvenanceInfo;
}

export interface GeminiImageEstimate {
  morphology: string;
  surfaceTexture: string;
  probableGeology: string;
  estimatedMeanSlopeDeg: number | null;
  estimatedReliefM: number | null;
  confidencePct: number;
  notes: string;
  imagePreviewDataUrl?: string;
  analyzedAtIso: string;
}

export interface CrewOverrides {
  tempMinC?: number | null;
  tempMaxC?: number | null;
  meanSlopeDeg?: number | null;
  lithology?: string | null;
  regolithNotes?: string | null;
  updatedAtIso: string;
}

export interface SiteRecord {
  id: string;
  name: string;
  body: BodyType;
  lat: number;
  lon: number;
  radiusKm: number;
  spanDeg: number;
  bounds: GeoBounds;
  country?: string;
  isoCode?: string;
  summary?: string;
  missionProgram?: string;
  ingestMethod: IngestMethod;
  notes: string;
  createdAtIso: string;
  updatedAtIso: string;
  demStatus: 'idle' | 'loading' | 'ready' | 'unavailable';
  demError?: string | null;
  demGrid?: DemGridData | null;
  features?: TerrainFeatures | null;
  climate?: ClimateMetrics | null;
  geology?: GeologyMetrics | null;
  geminiEstimate?: GeminiImageEstimate | null;
  crewOverrides?: CrewOverrides | null;
}

export interface TelemetryFilterState {
  slopeMaxDeg: number;
  contourIntervalM: number;
  mineralIndexMinPct: number;
  tempMinThresholdC: number;
}

export const DEFAULT_TELEMETRY_FILTERS: TelemetryFilterState = {
  slopeMaxDeg: 36,
  contourIntervalM: 100,
  mineralIndexMinPct: 45,
  tempMinThresholdC: -120,
};

export interface SimilarityWeights {
  slope: number;
  relief: number;
  roughness: number;
  morphology: number;
  thermal: number;
  lithology: number;
  aridity: number;
}

export const DEFAULT_SIMILARITY_WEIGHTS: SimilarityWeights = {
  slope: 25,
  relief: 15,
  roughness: 15,
  morphology: 10,
  thermal: 15,
  lithology: 12,
  aridity: 8,
};

export interface SourceHealthStatus {
  id: string;
  label: string;
  status: 'available' | 'proxied' | 'unavailable';
  detail: string;
  checkedAtIso: string;
}

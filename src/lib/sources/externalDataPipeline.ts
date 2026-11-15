import { lookupPlanetaryClimateTable } from '../../data/planetaryClimateTables';
import type {
  BodyType,
  ClimateMetrics,
  DemGridData,
  GeminiImageEstimate,
  GeoBounds,
  GeologyMetrics,
  SiteRecord,
  SourceHealthStatus,
} from '../../types/site';
import { inferBasalticAffinityFromText } from '../similarity/similarityEngine';
import {
  buildDemCacheKey,
  loadCachedDemGrid,
  saveCachedDemGrid,
} from '../storage/siteDb';
import { runTerrainExtractionWorker } from '../terrain/terrainWorkerClient';
import { fetchAwsTerrariumDem } from './awsTerrarium';
import { fetchPlanetaryTrekDem } from './geotiffClient';

export interface NomenclatureSearchResult {
  id: string;
  name: string;
  body: BodyType;
  featureType: string;
  lat: number;
  lon: number;
  source: string;
}

export async function fetchSourcesHealth(): Promise<SourceHealthStatus[]> {
  try {
    const res = await fetch('/api/sources/status', { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = (await res.json()) as { sources?: SourceHealthStatus[] };
    return data.sources ?? [];
  } catch {
    return [];
  }
}

export async function searchNomenclature(
  query: string,
  body: BodyType | 'ALL' = 'ALL'
): Promise<NomenclatureSearchResult[]> {
  if (query.trim().length < 2) return [];
  const res = await fetch(
    `/api/gis/nomenclature?q=${encodeURIComponent(query.trim())}&body=${body}`,
    { signal: AbortSignal.timeout(9000) }
  );
  if (!res.ok) return [];
  const data = (await res.json()) as { results?: NomenclatureSearchResult[] };
  return data.results ?? [];
}

export async function analyzeSiteImageWithGemini(
  imageBase64: string,
  mimeType: string,
  bodyHint: BodyType
): Promise<GeminiImageEstimate> {
  const res = await fetch('/api/analyze-image', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64, mimeType, bodyHint }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error || `Image analysis failed (HTTP ${res.status})`);
  }
  return {
    morphology: String(data.morphology || 'unclassified'),
    surfaceTexture: String(data.surfaceTexture || 'unclassified'),
    probableGeology: String(data.probableGeology || 'unclassified'),
    estimatedMeanSlopeDeg:
      typeof data.estimatedMeanSlopeDeg === 'number'
        ? Number(data.estimatedMeanSlopeDeg.toFixed(1))
        : null,
    estimatedReliefM:
      typeof data.estimatedReliefM === 'number' ? Math.round(data.estimatedReliefM) : null,
    confidencePct:
      typeof data.confidencePct === 'number' ? Math.round(data.confidencePct) : 50,
    notes: String(data.notes || ''),
    analyzedAtIso: data.analyzedAtIso || new Date().toISOString(),
  };
}

export async function fetchEarthGeologyMacrostrat(
  lat: number,
  lon: number
): Promise<GeologyMetrics> {
  const fetchedAtIso = new Date().toISOString();
  try {
    const url = `https://macrostrat.org/api/v2/geologic_units/map?lat=${lat.toFixed(4)}&lng=${lon.toFixed(4)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      success?: {
        data?: Array<{
          name?: string;
          strat_name?: string;
          lith?: string;
          descrip?: string;
          b_int_name?: string;
          t_int_name?: string;
          unit_id?: number;
          map_id?: number;
        }>;
      };
    };
    const rows = json.success?.data ?? [];
    if (rows.length === 0) {
      return {
        lithology: null,
        basalticIndexPct: null,
        provenance: { source: 'Macrostrat (no unit polygon)', tag: 'unavailable', fetchedAtIso },
      };
    }
    const primary = rows[0];
    const rawLith = [primary.lith, primary.name, primary.descrip].filter(Boolean).join(' · ');
    const cleanedLith = rawLith
      .replace(/Major:\{|Minor:\{|Minor\{|\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 140);
    const age = [primary.b_int_name, primary.t_int_name].filter(Boolean).join('–') || null;
    return {
      lithology: cleanedLith || primary.name || 'Mapped geological unit',
      unitCode: primary.map_id ? `MS-${primary.map_id}` : null,
      unitName: primary.strat_name || primary.name || null,
      age,
      basalticIndexPct: inferBasalticAffinityFromText(cleanedLith),
      provenance: { source: 'Macrostrat v2 API', tag: 'measured', fetchedAtIso },
    };
  } catch {
    return {
      lithology: null,
      basalticIndexPct: null,
      provenance: { source: 'Macrostrat unavailable', tag: 'unavailable', fetchedAtIso },
    };
  }
}

export async function fetchMarsGeologyUsgs(bounds: GeoBounds): Promise<GeologyMetrics> {
  const fetchedAtIso = new Date().toISOString();
  try {
    const bbox = `${bounds.minLon.toFixed(3)},${bounds.minLat.toFixed(3)},${bounds.maxLon.toFixed(3)},${bounds.maxLat.toFixed(3)}`;
    const url = `https://astrogeology.usgs.gov/pygeoapi/collections/mars/sim3292_global_geologic_map/units/items?bbox=${bbox}&limit=3&f=json`;
    const res = await fetch(url, { signal: AbortSignal.timeout(7000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as {
      features?: Array<{
        properties?: { unit?: string; unitdesc?: string; spharea_km?: number };
      }>;
    };
    const feat = json.features?.[0]?.properties;
    if (!feat || (!feat.unitdesc && !feat.unit)) {
      return {
        lithology: null,
        basalticIndexPct: null,
        provenance: { source: 'USGS SIM 3292 (no unit match)', tag: 'unavailable', fetchedAtIso },
      };
    }
    const desc = feat.unitdesc || feat.unit || 'Mars geologic unit';
    return {
      lithology: desc,
      unitCode: feat.unit || null,
      unitName: feat.unitdesc || null,
      age: feat.unit?.startsWith('N')
        ? 'Noachian'
        : feat.unit?.startsWith('H')
          ? 'Hesperian'
          : feat.unit?.startsWith('A')
            ? 'Amazonian'
            : null,
      basalticIndexPct: inferBasalticAffinityFromText(desc),
      provenance: { source: 'USGS SIM 3292 (pygeoapi)', tag: 'measured', fetchedAtIso },
    };
  } catch {
    return {
      lithology: null,
      basalticIndexPct: null,
      provenance: { source: 'USGS SIM 3292 unavailable', tag: 'unavailable', fetchedAtIso },
    };
  }
}

export async function fetchEarthClimate(lat: number, lon: number): Promise<ClimateMetrics> {
  const fetchedAtIso = new Date().toISOString();
  // Primary: NASA POWER Climatology API (30-year climatology)
  try {
    const url = `https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M,T2M_MAX,T2M_MIN,RH2M,PRECTOTCORR&community=RE&longitude=${lon.toFixed(
      4
    )}&latitude=${lat.toFixed(4)}&format=JSON`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = (await res.json()) as {
        properties?: {
          parameter?: Record<string, Record<string, number>>;
        };
      };
      const p = json.properties?.parameter;
      if (p?.T2M && p?.T2M_MIN && p?.T2M_MAX) {
        const vals = (rec: Record<string, number>) =>
          Object.entries(rec)
            .filter(([k, v]) => k !== 'ANN' && Number.isFinite(v) && v > -900)
            .map(([, v]) => v);
        const mins = vals(p.T2M_MIN);
        const maxs = vals(p.T2M_MAX);
        const means = vals(p.T2M);
        const rhs = p.RH2M ? vals(p.RH2M) : [];
        const precs = p.PRECTOTCORR ? vals(p.PRECTOTCORR) : [];

        if (mins.length > 0 && maxs.length > 0) {
          const tempMinC = Number(Math.min(...mins).toFixed(1));
          const tempMaxC = Number(Math.max(...maxs).toFixed(1));
          const tempMeanC = Number((means.reduce((a, b) => a + b, 0) / means.length).toFixed(1));
          const humidityMeanPct =
            rhs.length > 0 ? Math.round(rhs.reduce((a, b) => a + b, 0) / rhs.length) : null;
          // PRECTOTCORR is mm/day -> annual mm
          const precipAnnualMm =
            precs.length > 0
              ? Math.round((precs.reduce((a, b) => a + b, 0) / precs.length) * 365)
              : null;
          const aridityScore =
            precipAnnualMm !== null
              ? Math.round(Math.max(15, Math.min(100, 100 - Math.log10(Math.max(1, precipAnnualMm)) * 24)))
              : null;

          return {
            tempMinC,
            tempMaxC,
            tempMeanC,
            humidityMeanPct,
            precipAnnualMm,
            aridityScore,
            provenance: { source: 'NASA POWER Climatology', tag: 'measured', fetchedAtIso },
          };
        }
      }
    }
  } catch {
    // Fallback to Open-Meteo Archive below
  }

  // Fallback: Open-Meteo 1-year daily archive
  try {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat.toFixed(
      4
    )}&longitude=${lon.toFixed(
      4
    )}&start_date=2024-01-01&end_date=2024-12-31&daily=temperature_2m_min,temperature_2m_max,temperature_2m_mean,precipitation_sum&timezone=UTC`;
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (res.ok) {
      const json = (await res.json()) as {
        daily?: {
          temperature_2m_min?: Array<number | null>;
          temperature_2m_max?: Array<number | null>;
          temperature_2m_mean?: Array<number | null>;
          precipitation_sum?: Array<number | null>;
        };
      };
      const mins = (json.daily?.temperature_2m_min ?? []).filter((v): v is number => v !== null);
      const maxs = (json.daily?.temperature_2m_max ?? []).filter((v): v is number => v !== null);
      const means = (json.daily?.temperature_2m_mean ?? []).filter((v): v is number => v !== null);
      const precs = (json.daily?.precipitation_sum ?? []).filter((v): v is number => v !== null);
      if (mins.length > 0 && maxs.length > 0) {
        const precipAnnualMm = Math.round(precs.reduce((a, b) => a + b, 0));
        return {
          tempMinC: Number(Math.min(...mins).toFixed(1)),
          tempMaxC: Number(Math.max(...maxs).toFixed(1)),
          tempMeanC: Number((means.reduce((a, b) => a + b, 0) / means.length).toFixed(1)),
          humidityMeanPct: null,
          precipAnnualMm,
          aridityScore: Math.round(
            Math.max(15, Math.min(100, 100 - Math.log10(Math.max(1, precipAnnualMm)) * 24))
          ),
          provenance: { source: 'Open-Meteo 2024 Archive', tag: 'measured', fetchedAtIso },
        };
      }
    }
  } catch {
    // Clean unavailable state
  }

  return {
    tempMinC: null,
    tempMaxC: null,
    tempMeanC: null,
    humidityMeanPct: null,
    precipAnnualMm: null,
    aridityScore: null,
    provenance: { source: 'Climate APIs unavailable', tag: 'unavailable', fetchedAtIso },
  };
}

/**
 * Acquires real DEM + Web Worker terrain features + real climate + real geology
 * for a SiteRecord. Uses IndexedDB offline cache automatically when offline or previously fetched.
 */
export async function enrichSiteRealData(
  site: SiteRecord,
  options?: { forceRefresh?: boolean; skipMetadata?: boolean }
): Promise<SiteRecord> {
  let demGrid: DemGridData | null = site.demGrid ?? null;
  let demStatus: SiteRecord['demStatus'] = site.demGrid ? 'ready' : 'loading';
  let demError: string | null = null;
  const cacheKey = buildDemCacheKey(site);

  // 1. Check cached DEM in IndexedDB if not already on object (or when offline)
  if (!demGrid && !options?.forceRefresh) {
    demGrid = await loadCachedDemGrid(cacheKey);
  }

  // 2. Fetch live DEM if not present
  if (!demGrid && site.ingestMethod !== 'image_upload') {
    const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
    if (!isOffline) {
      try {
        if (site.body === 'EARTH') {
          demGrid = await fetchAwsTerrariumDem(site.bounds, site.lat, 96, site.lon);
        } else {
          demGrid = await fetchPlanetaryTrekDem(site.body, site.bounds, 96, {
            lat: site.lat,
            lon: site.lon,
            radiusKm: site.radiusKm,
          });
        }
        await saveCachedDemGrid(cacheKey, demGrid);
      } catch (err) {
        demError = err instanceof Error ? err.message : 'DEM endpoint unavailable';
      }
    } else {
      demError = 'Offline and no cached DEM raster found in IndexedDB.';
    }
  }

  let features = site.features ?? null;
  if (demGrid && (!features || options?.forceRefresh || site.demGrid !== demGrid)) {
    try {
      features = await runTerrainExtractionWorker(demGrid);
      demStatus = 'ready';
    } catch (err) {
      demError = err instanceof Error ? err.message : 'Terrain feature extraction failed.';
      demStatus = 'unavailable';
    }
  } else if (!demGrid) {
    demStatus = site.ingestMethod === 'image_upload' && site.geminiEstimate ? 'idle' : 'unavailable';
  } else {
    demStatus = 'ready';
  }

  // 3. Climate & Geology
  let climate = site.climate ?? null;
  let geology = site.geology ?? null;

  if (!options?.skipMetadata) {
    if (!climate || climate.provenance.tag === 'unavailable') {
      if (site.body === 'EARTH') {
        climate = await fetchEarthClimate(site.lat, site.lon);
      } else {
        climate = lookupPlanetaryClimateTable(site.body, site.lat, features?.meanElevM ?? null);
      }
    }

    if (!geology || geology.provenance.tag === 'unavailable') {
      if (site.body === 'EARTH') {
        geology = await fetchEarthGeologyMacrostrat(site.lat, site.lon);
      } else if (site.body === 'MARS') {
        geology = await fetchMarsGeologyUsgs(site.bounds);
      } else {
        geology = {
          lithology: null,
          basalticIndexPct: null,
          provenance: {
            source: 'USGS Moon geologic vector API unavailable',
            tag: 'unavailable',
            fetchedAtIso: new Date().toISOString(),
          },
        };
      }
    }
  }

  return {
    ...site,
    demStatus,
    demError,
    demGrid,
    features,
    climate,
    geology,
    updatedAtIso: new Date().toISOString(),
  };
}

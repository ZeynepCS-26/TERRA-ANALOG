import { create } from 'zustand';
import {
  buildEmptySiteRecord,
  EARTH_ANALOG_CATALOG,
  INITIAL_TARGET_SEEDS,
} from '../data/candidates';
import type { MapLayerMode, ScientificColormap, TransectPoint } from '../lib/elevation/colormaps';
import { formatCoordLabel, formatSiteFullName, formatSiteShortName } from '../lib/formatSite';
import { parseScreenFromLocation, screenToHash, type ScreenRoute } from '../lib/routing/hashRoute';
import {
  enrichSiteRealData,
  fetchSourcesHealth,
} from '../lib/sources/externalDataPipeline';
import {
  deleteSiteFromDb,
  loadAllSitesFromDb,
  saveSiteToDb,
  saveSitesBulkToDb,
} from '../lib/storage/siteDb';
import { parseProjectBundle, serializeProjectBundle } from '../lib/storage/projectExport';
import { rankAnalogsForTarget } from '../lib/similarity/similarityEngine';
import {
  DEFAULT_SIMILARITY_WEIGHTS,
  DEFAULT_TELEMETRY_FILTERS,
  type BodyType,
  type CrewOverrides,
  type SimilarityWeights,
  type SiteRecord,
  type SourceHealthStatus,
  type TelemetryFilterState,
} from '../types/site';

export type AppScreen = ScreenRoute;
export type LabTabId = 'map' | 'terrain3d' | 'spectral' | 'matrix';
export type RightDrawerTab = 'analog' | 'layers' | 'calibration' | 'info' | null;
export type Layer3dMode = 'surface' | 'hillshade' | 'elevation' | 'slope';

export interface OverlayFlags {
  geologyUnits: boolean;
  graticule: boolean;
}

export interface CursorTelemetry {
  side: 'target' | 'analog';
  lat: number;
  lon: number;
  elevM: number | null;
  slopeDeg: number | null;
}

export interface DossierDraft {
  missionTitle: string;
  leadScientist: string;
  campaignWindow: string;
  missionObjectives: string;
  mobilityConstraint: string;
  sciencePriorities: string;
  executiveSummary: string;
  siteRationale: string;
  terrainHazardAssessment: string;
  instrumentTestPlan: string;
  operationalRecommendation: string;
  logisticsNotes: string;
  riskMitigationMatrix: Array<{
    hazard: string;
    likelihood: 'LOW' | 'MED' | 'HIGH';
    severity: 'MODERATE' | 'MAJOR' | 'CRITICAL';
    mitigation: string;
  }>;
}

export interface MapPickRequest {
  active: boolean;
  body: BodyType;
  pickedLat: number | null;
  pickedLon: number | null;
  pickedRadiusKm: number | null;
}

function createInitialSeedSites(): SiteRecord[] {
  const targets = INITIAL_TARGET_SEEDS.map((t) =>
    buildEmptySiteRecord({
      id: t.id,
      name: t.name,
      body: t.body,
      lat: t.lat,
      lon: t.lon,
      radiusKm: t.radiusKm,
      ingestMethod: 'seed',
      missionProgram: t.missionProgram,
      summary: t.fieldNote,
      notes: t.fieldNote,
    })
  );

  const candidates = EARTH_ANALOG_CATALOG.map((c) =>
    buildEmptySiteRecord({
      id: c.id,
      name: c.name,
      body: 'EARTH',
      lat: c.lat,
      lon: c.lon,
      radiusKm: c.radiusKm,
      ingestMethod: 'catalog',
      country: c.country,
      isoCode: c.isoCode,
      summary: c.fieldNote,
      notes: c.fieldNote,
    })
  );

  return [...targets, ...candidates];
}

function buildDraftFromSites(target: SiteRecord | undefined, analog: SiteRecord | undefined): DossierDraft {
  const tName = target ? formatSiteFullName(target) : 'Selected Planetary Target';
  const tShort = target ? formatSiteShortName(target) : 'Target';
  const aName = analog ? formatSiteFullName(analog) : 'Selected Earth Analog';
  const tSlope = target?.features?.slopeMeanDeg;
  const aSlope = analog?.features?.slopeMeanDeg;
  const tRelief = target?.features?.reliefM;
  const aRelief = analog?.features?.reliefM;
  const tLith = target?.crewOverrides?.lithology ?? target?.geology?.lithology ?? 'Pending orbital unit lookup';
  const aLith = analog?.crewOverrides?.lithology ?? analog?.geology?.lithology ?? 'Pending Macrostrat lookup';

  return {
    missionTitle: `${tShort} — ${aName} Field Calibration Campaign`,
    leadScientist: 'Mission Operations & Planetary Geology Team',
    campaignWindow: '2026 Field Analog Window',
    missionObjectives: `Verify mobility, sampling hardware, and terrain parity between ${tName} and terrestrial site ${aName}.`,
    mobilityConstraint:
      typeof tSlope === 'number'
        ? `Target mean slope ${tSlope.toFixed(1)}° (${target?.features?.slopeP95Deg?.toFixed(1) ?? 'N/A'}° p95) across ${tLith}.`
        : `Slope envelope pending DEM acquisition across ${tLith}.`,
    sciencePriorities: `Mineralogical parity check (${tLith} vs ${aLith}).`,
    executiveSummary: `TERRA-ANALOG comparative assessment pairing ${tName} (${target ? formatCoordLabel(target.lat, target.lon) : 'N/A'}) with terrestrial analog ${aName} (${analog ? formatCoordLabel(analog.lat, analog.lon) : 'N/A'}).`,
    siteRationale: `${analog?.summary || ''} Lithology target: ${tLith}; analog: ${aLith}.`.trim(),
    terrainHazardAssessment: `Target relief: ${typeof tRelief === 'number' ? `${Math.round(tRelief)} m` : 'unavailable'} (mean slope ${typeof tSlope === 'number' ? `${tSlope.toFixed(1)}°` : 'N/A'}); analog relief: ${typeof aRelief === 'number' ? `${Math.round(aRelief)} m` : 'unavailable'} (mean slope ${typeof aSlope === 'number' ? `${aSlope.toFixed(1)}°` : 'N/A'}).`,
    instrumentTestPlan: `1. Calibrate optical & Raman spectrometers against local outcrop units (${aLith}).\n2. Run autonomous traverse & hazard avoidance across slope gradients up to ${typeof aSlope === 'number' ? `${(aSlope * 1.4).toFixed(0)}°` : 'site limit'}.\n3. Verify thermal cycling and sample sealing protocols.`,
    operationalRecommendation: `Evaluate field readiness based on verified parameter coverage and crew-reported site constraints.`,
    logisticsNotes: `Coordinates ${analog ? formatCoordLabel(analog.lat, analog.lon) : 'N/A'}. ${analog?.notes || ''}`.trim(),
    riskMitigationMatrix: [
      {
        hazard: `Local slope stability (analog mean ${typeof aSlope === 'number' ? `${aSlope.toFixed(1)}°` : 'N/A'})`,
        likelihood: 'MED',
        severity: 'MAJOR',
        mitigation: 'Constrain autonomous traverse below calibration slope cap and verify traction in field notes.',
      },
      {
        hazard: `Thermal envelope (${analog?.climate?.tempMinC ?? 'N/A'}°C to ${analog?.climate?.tempMaxC ?? 'N/A'}°C)`,
        likelihood: 'MED',
        severity: 'MODERATE',
        mitigation: 'Schedule actuator and battery thermal conditioning prior to drilling operations.',
      },
    ],
  };
}

function getInitialScreen(): ScreenRoute {
  if (typeof window === 'undefined') return 'landing';
  return parseScreenFromLocation(window.location.hash, window.location.search);
}

function syncUrlHash(screen: ScreenRoute, replace = false) {
  if (typeof window === 'undefined') return;
  const targetHash = screenToHash(screen);
  if (window.location.hash !== targetHash) {
    if (replace) {
      window.history.replaceState(null, '', targetHash);
    } else {
      window.location.hash = targetHash;
    }
  }
}

const initialSeed = createInitialSeedSites();

interface WorkspaceStore {
  initialized: boolean;
  screen: ScreenRoute;
  mapFocusAnalogOnOpen: boolean;
  hasUnsavedEdits: boolean;
  sites: SiteRecord[];
  activeTargetId: string;
  activeAnalogId: string;
  filters: TelemetryFilterState;
  weights: SimilarityWeights;
  transectA: TransectPoint;
  transectB: TransectPoint;
  syncViews: boolean;
  swipeMode: boolean;
  swipeRatio: number;
  activeLayer: MapLayerMode;
  hillshadeEnabled: boolean;
  hillshadeZFactor: number;
  elevationOverlayEnabled: boolean;
  elevationOverlayOpacity: number;
  sunAzimuthDeg: number;
  layer3dMode: Layer3dMode;
  link3dCameras: boolean;
  show3dWireframe: boolean;
  colormap: ScientificColormap;
  verticalExaggeration: number;
  overlayFlags: OverlayFlags;
  activeLabTab: LabTabId;
  rightDrawer: RightDrawerTab;
  elevationExpanded: boolean;
  dossierOpen: boolean;
  dossierStep: number;
  addWizardOpen: boolean;
  mapPick: MapPickRequest;
  acquiringCount: number;
  acquiringLabel: string | null;
  isOffline: boolean;
  sourceHealth: SourceHealthStatus[];
  cursorTelemetry: CursorTelemetry | null;
  dossierDraft: DossierDraft;
  recenterNonce: number;
  mapZoomCommand: { nonce: number; delta: number };
  devDebugMode: boolean;

  initStoreFromDb: () => Promise<void>;
  refreshSourceHealth: () => Promise<void>;
  setOfflineStatus: (offline: boolean) => void;
  setScreen: (screen: ScreenRoute, options?: { focusAnalog?: boolean; skipHash?: boolean; replaceHash?: boolean }) => void;
  setMapFocusAnalogOnOpen: (focus: boolean) => void;
  setHasUnsavedEdits: (dirty: boolean) => void;
  enterWorkspaceFromAnalog: (analogId: string, bestTargetId: string) => void;
  selectTarget: (id: string) => void;
  selectAnalog: (id: string) => void;
  selectPair: (targetId: string, analogId: string) => void;
  enrichSiteById: (id: string, forceRefresh?: boolean) => Promise<SiteRecord | null>;
  enrichTopAnalogsBatch: (limit?: number) => Promise<void>;
  addOrUpdateSite: (site: SiteRecord, autoEnrich?: boolean) => Promise<SiteRecord>;
  deleteSiteById: (id: string) => Promise<void>;
  updateSiteNotes: (id: string, notes: string) => Promise<void>;
  updateCrewOverrides: (id: string, overrides: CrewOverrides | null) => Promise<void>;
  exportProjectJson: () => string;
  importProjectJson: (rawJson: string) => Promise<{ count: number }>;
  updateFilter: <K extends keyof TelemetryFilterState>(key: K, value: TelemetryFilterState[K]) => void;
  resetFilters: () => void;
  updateWeight: <K extends keyof SimilarityWeights>(key: K, value: number) => void;
  resetWeights: () => void;
  setTransectEndpoints: (a: TransectPoint, b: TransectPoint) => void;
  setSyncViews: (sync: boolean) => void;
  setSwipeMode: (swipe: boolean) => void;
  setSwipeRatio: (ratio: number) => void;
  setActiveLayer: (layer: MapLayerMode) => void;
  cycleLayer: () => void;
  setHillshadeEnabled: (enabled: boolean) => void;
  setHillshadeZFactor: (z: number) => void;
  setElevationOverlayEnabled: (enabled: boolean) => void;
  setElevationOverlayOpacity: (opacity: number) => void;
  setSunAzimuthDeg: (deg: number) => void;
  setLayer3dMode: (mode: Layer3dMode) => void;
  setLink3dCameras: (linked: boolean) => void;
  setShow3dWireframe: (show: boolean) => void;
  setColormap: (cm: ScientificColormap) => void;
  setVerticalExaggeration: (z: number) => void;
  toggleOverlayFlag: (flag: keyof OverlayFlags) => void;
  setActiveLabTab: (tab: LabTabId) => void;
  setRightDrawer: (drawer: RightDrawerTab) => void;
  toggleRightDrawer: (drawer: Exclude<RightDrawerTab, null>) => void;
  setElevationExpanded: (expanded: boolean) => void;
  setDossierOpen: (open: boolean) => void;
  setDossierStep: (step: number) => void;
  setAddWizardOpen: (open: boolean) => void;
  startMapPickMode: (body: BodyType) => void;
  completeMapPick: (lat: number, lon: number, radiusKm: number, body: BodyType) => void;
  cancelMapPick: () => void;
  setCursorTelemetry: (telemetry: CursorTelemetry | null) => void;
  updateDossierDraft: (patch: Partial<DossierDraft>) => void;
  resetDossierFromActiveSites: () => void;
  triggerRecenter: () => void;
  triggerMapZoom: (delta: number) => void;
  toggleDevDebugMode: () => void;
}

const LAYER_ORDER: MapLayerMode[] = ['relief', 'hypsometric', 'slope', 'aspect'];
const inFlightEnrich = new Map<string, Promise<SiteRecord | null>>();

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  initialized: false,
  screen: getInitialScreen(),
  mapFocusAnalogOnOpen: false,
  hasUnsavedEdits: false,
  sites: initialSeed,
  activeTargetId: 'jezero',
  activeAnalogId: 'salda_lake',
  filters: { ...DEFAULT_TELEMETRY_FILTERS },
  weights: { ...DEFAULT_SIMILARITY_WEIGHTS },
  transectA: { u: 0.14, v: 0.48 },
  transectB: { u: 0.86, v: 0.52 },
  syncViews: true,
  swipeMode: false,
  swipeRatio: 0.5,
  activeLayer: 'relief',
  hillshadeEnabled: true,
  hillshadeZFactor: 1.2,
  elevationOverlayEnabled: false,
  elevationOverlayOpacity: 0.3,
  sunAzimuthDeg: 315,
  layer3dMode: 'surface',
  link3dCameras: true,
  show3dWireframe: false,
  colormap: 'cividis',
  verticalExaggeration: 1.3,
  overlayFlags: {
    geologyUnits: false,
    graticule: false,
  },
  activeLabTab: 'map',
  rightDrawer: null,
  elevationExpanded: false,
  dossierOpen: false,
  dossierStep: 0,
  addWizardOpen: false,
  mapPick: {
    active: false,
    body: 'EARTH',
    pickedLat: null,
    pickedLon: null,
    pickedRadiusKm: null,
  },
  acquiringCount: 0,
  acquiringLabel: null,
  isOffline: typeof navigator !== 'undefined' ? navigator.onLine === false : false,
  sourceHealth: [],
  cursorTelemetry: null,
  dossierDraft: buildDraftFromSites(
    initialSeed.find((s) => s.id === 'jezero'),
    initialSeed.find((s) => s.id === 'salda_lake')
  ),
  recenterNonce: 0,
  mapZoomCommand: { nonce: 0, delta: 0 },
  devDebugMode: false,

  initStoreFromDb: async () => {
    if (get().initialized) return;
    const saved = await loadAllSitesFromDb();
    let merged = initialSeed;
    if (saved.length > 0) {
      const byId = new Map<string, SiteRecord>();
      for (const s of initialSeed) byId.set(s.id, s);
      for (const s of saved) byId.set(s.id, s);
      merged = Array.from(byId.values());
    } else {
      await saveSitesBulkToDb(initialSeed);
    }

    const s = get();
    const t = merged.find((x) => x.id === s.activeTargetId) ?? merged.find((x) => x.body !== 'EARTH');
    const a = merged.find((x) => x.id === s.activeAnalogId) ?? merged.find((x) => x.body === 'EARTH');

    set({
      initialized: true,
      sites: merged,
      activeTargetId: t?.id ?? s.activeTargetId,
      activeAnalogId: a?.id ?? s.activeAnalogId,
      dossierDraft: buildDraftFromSites(t, a),
    });

    void get().refreshSourceHealth();
    if (t) void get().enrichSiteById(t.id);
    if (a) void get().enrichSiteById(a.id);
  },

  refreshSourceHealth: async () => {
    const list = await fetchSourcesHealth();
    if (list.length > 0) {
      set({ sourceHealth: list });
    }
  },

  setOfflineStatus: (offline) => set({ isOffline: offline }),

  setScreen: (screen, options) => {
    if (!options?.skipHash) {
      syncUrlHash(screen, Boolean(options?.replaceHash));
    }
    set((state) => ({
      screen,
      mapFocusAnalogOnOpen:
        options?.focusAnalog !== undefined
          ? options.focusAnalog
          : screen === 'map'
            ? state.mapFocusAnalogOnOpen
            : false,
      hasUnsavedEdits: screen === 'landing' ? false : state.hasUnsavedEdits,
    }));
  },

  setMapFocusAnalogOnOpen: (focus) => set({ mapFocusAnalogOnOpen: focus }),
  setHasUnsavedEdits: (dirty) => set({ hasUnsavedEdits: dirty }),

  enterWorkspaceFromAnalog: (analogId, bestTargetId) => {
    const s = get();
    const target = s.sites.find((x) => x.id === bestTargetId);
    const analog = s.sites.find((x) => x.id === analogId);
    syncUrlHash('workspace');
    set({
      screen: 'workspace',
      mapFocusAnalogOnOpen: false,
      hasUnsavedEdits: false,
      activeTargetId: bestTargetId,
      activeAnalogId: analogId,
      rightDrawer: null,
      dossierDraft: buildDraftFromSites(target, analog),
    });
    void get().enrichSiteById(bestTargetId);
    void get().enrichSiteById(analogId);
  },

  selectTarget: (id) => {
    const s = get();
    const target = s.sites.find((x) => x.id === id);
    if (!target) return;
    const analogs = s.sites.filter((x) => x.body === 'EARTH');
    const ranked = rankAnalogsForTarget(target, analogs, s.weights, s.filters);
    const nextAnalog = ranked[0]?.analog ?? analogs[0];
    set({
      activeTargetId: id,
      activeAnalogId: nextAnalog?.id ?? s.activeAnalogId,
      hasUnsavedEdits: false,
      dossierDraft: buildDraftFromSites(target, nextAnalog),
    });
    void get().enrichSiteById(id);
    if (nextAnalog) void get().enrichSiteById(nextAnalog.id);
  },

  selectAnalog: (id) => {
    const s = get();
    const target = s.sites.find((x) => x.id === s.activeTargetId);
    const analog = s.sites.find((x) => x.id === id);
    set({
      activeAnalogId: id,
      hasUnsavedEdits: false,
      dossierDraft: buildDraftFromSites(target, analog),
    });
    void get().enrichSiteById(id);
  },

  selectPair: (targetId, analogId) => {
    const s = get();
    const target = s.sites.find((x) => x.id === targetId);
    const analog = s.sites.find((x) => x.id === analogId);
    set({
      activeTargetId: targetId,
      activeAnalogId: analogId,
      hasUnsavedEdits: false,
      dossierDraft: buildDraftFromSites(target, analog),
    });
    void get().enrichSiteById(targetId);
    void get().enrichSiteById(analogId);
  },

  enrichSiteById: async (id, forceRefresh = false) => {
    if (!forceRefresh && inFlightEnrich.has(id)) {
      return inFlightEnrich.get(id)!;
    }

    const site = get().sites.find((s) => s.id === id);
    if (!site) return null;
    if (!forceRefresh && site.demStatus === 'ready' && site.features && site.climate && site.geology) {
      return site;
    }

    const promise = (async () => {
      set((state) => ({
        acquiringCount: state.acquiringCount + 1,
        acquiringLabel: `Acquiring terrain data (${formatSiteShortName(site)})…`,
        sites: state.sites.map((x) => (x.id === id ? { ...x, demStatus: 'loading' } : x)),
      }));
      try {
        const enriched = await enrichSiteRealData(site, { forceRefresh });
        await saveSiteToDb(enriched);
        set((state) => {
          const nextSites = state.sites.map((x) => (x.id === id ? enriched : x));
          const curT = nextSites.find((x) => x.id === state.activeTargetId);
          const curA = nextSites.find((x) => x.id === state.activeAnalogId);
          return {
            sites: nextSites,
            dossierDraft: state.hasUnsavedEdits ? state.dossierDraft : buildDraftFromSites(curT, curA),
          };
        });
        return enriched;
      } catch (err) {
        const failed: SiteRecord = {
          ...site,
          demStatus: 'unavailable',
          demError: err instanceof Error ? err.message : 'Acquisition error',
        };
        set((state) => ({
          sites: state.sites.map((x) => (x.id === id ? failed : x)),
        }));
        return failed;
      } finally {
        inFlightEnrich.delete(id);
        set((state) => ({
          acquiringCount: Math.max(0, state.acquiringCount - 1),
          acquiringLabel: state.acquiringCount <= 1 ? null : state.acquiringLabel,
        }));
      }
    })();

    inFlightEnrich.set(id, promise);
    return promise;
  },

  enrichTopAnalogsBatch: async (limit = 10) => {
    const earthSites = get().sites.filter(
      (s) => s.body === 'EARTH' && s.demStatus !== 'ready' && s.demStatus !== 'loading'
    );
    const batch = earthSites.slice(0, limit);
    for (let i = 0; i < batch.length; i += 3) {
      await Promise.all(batch.slice(i, i + 3).map((s) => get().enrichSiteById(s.id)));
    }
  },

  addOrUpdateSite: async (site, autoEnrich = true) => {
    await saveSiteToDb(site);
    set((state) => {
      const exists = state.sites.some((s) => s.id === site.id);
      const nextSites = exists
        ? state.sites.map((s) => (s.id === site.id ? site : s))
        : [site, ...state.sites];
      const nextTargetId = site.body !== 'EARTH' ? site.id : state.activeTargetId;
      const nextAnalogId = site.body === 'EARTH' ? site.id : state.activeAnalogId;
      return {
        sites: nextSites,
        activeTargetId: nextTargetId,
        activeAnalogId: nextAnalogId,
        hasUnsavedEdits: false,
      };
    });

    if (autoEnrich) {
      const enriched = await get().enrichSiteById(site.id, false);
      return enriched ?? site;
    }
    return site;
  },

  deleteSiteById: async (id) => {
    await deleteSiteFromDb(id);
    set((state) => {
      const remaining = state.sites.filter((s) => s.id !== id);
      const targets = remaining.filter((s) => s.body !== 'EARTH');
      const analogs = remaining.filter((s) => s.body === 'EARTH');
      const nextTargetId =
        state.activeTargetId === id ? targets[0]?.id ?? '' : state.activeTargetId;
      const nextAnalogId =
        state.activeAnalogId === id ? analogs[0]?.id ?? '' : state.activeAnalogId;
      return {
        sites: remaining,
        activeTargetId: nextTargetId,
        activeAnalogId: nextAnalogId,
      };
    });
  },

  updateSiteNotes: async (id, notes) => {
    const site = get().sites.find((s) => s.id === id);
    if (!site) return;
    const updated: SiteRecord = {
      ...site,
      notes,
      updatedAtIso: new Date().toISOString(),
    };
    await saveSiteToDb(updated);
    set((state) => ({
      sites: state.sites.map((s) => (s.id === id ? updated : s)),
    }));
  },

  updateCrewOverrides: async (id, overrides) => {
    const site = get().sites.find((s) => s.id === id);
    if (!site) return;
    const updated: SiteRecord = {
      ...site,
      crewOverrides: overrides,
      updatedAtIso: new Date().toISOString(),
    };
    await saveSiteToDb(updated);
    set((state) => ({
      sites: state.sites.map((s) => (s.id === id ? updated : s)),
      hasUnsavedEdits: false,
    }));
  },

  exportProjectJson: () => {
    const s = get();
    return serializeProjectBundle({
      sites: s.sites,
      activeTargetId: s.activeTargetId,
      activeAnalogId: s.activeAnalogId,
      weights: s.weights,
      filters: s.filters,
    });
  },

  importProjectJson: async (rawJson) => {
    const bundle = parseProjectBundle(rawJson);
    await saveSitesBulkToDb(bundle.sites);
    set({
      sites: bundle.sites,
      activeTargetId: bundle.activeTargetId,
      activeAnalogId: bundle.activeAnalogId,
      weights: bundle.weights,
      filters: bundle.filters,
    });
    return { count: bundle.sites.length };
  },

  updateFilter: (key, value) =>
    set((s) => ({
      filters: { ...s.filters, [key]: value },
    })),
  resetFilters: () => set({ filters: { ...DEFAULT_TELEMETRY_FILTERS } }),
  updateWeight: (key, value) =>
    set((s) => ({
      weights: { ...s.weights, [key]: value },
    })),
  resetWeights: () => set({ weights: { ...DEFAULT_SIMILARITY_WEIGHTS } }),
  setTransectEndpoints: (a, b) => set({ transectA: a, transectB: b }),
  setSyncViews: (sync) => set({ syncViews: sync }),
  setSwipeMode: (swipe) => set({ swipeMode: swipe }),
  setSwipeRatio: (ratio) => set({ swipeRatio: Math.max(0.1, Math.min(0.9, ratio)) }),
  setActiveLayer: (layer) => set({ activeLayer: layer }),
  cycleLayer: () =>
    set((s) => {
      const idx = LAYER_ORDER.indexOf(s.activeLayer);
      return { activeLayer: LAYER_ORDER[(idx + 1) % LAYER_ORDER.length] };
    }),
  setHillshadeEnabled: (enabled) => set({ hillshadeEnabled: enabled }),
  setHillshadeZFactor: (z) => set({ hillshadeZFactor: Math.max(0.5, Math.min(3.0, z)) }),
  setElevationOverlayEnabled: (enabled) => set({ elevationOverlayEnabled: enabled }),
  setElevationOverlayOpacity: (opacity) =>
    set({ elevationOverlayOpacity: Math.max(0.1, Math.min(0.35, opacity)) }),
  setSunAzimuthDeg: (deg) => set({ sunAzimuthDeg: ((deg % 360) + 360) % 360 }),
  setLayer3dMode: (mode) => set({ layer3dMode: mode }),
  setLink3dCameras: (linked) => set({ link3dCameras: linked }),
  setShow3dWireframe: (show) => set({ show3dWireframe: show }),
  setColormap: (cm) => set({ colormap: cm }),
  setVerticalExaggeration: (z) => set({ verticalExaggeration: Math.max(0.6, Math.min(2.4, z)) }),
  toggleOverlayFlag: (flag) =>
    set((s) => ({
      overlayFlags: { ...s.overlayFlags, [flag]: !s.overlayFlags[flag] },
    })),
  setActiveLabTab: (tab) => set({ activeLabTab: tab }),
  setRightDrawer: (drawer) => set({ rightDrawer: drawer }),
  toggleRightDrawer: (drawer) =>
    set((s) => ({
      rightDrawer: s.rightDrawer === drawer ? null : drawer,
    })),
  setElevationExpanded: (expanded) => set({ elevationExpanded: expanded }),
  setDossierOpen: (open) => set({ dossierOpen: open }),
  setDossierStep: (step) => set({ dossierStep: Math.max(0, Math.min(5, step)) }),
  setAddWizardOpen: (open) =>
    set((s) => ({
      addWizardOpen: open,
      mapPick: open ? s.mapPick : { ...s.mapPick, active: false },
    })),
  startMapPickMode: (body) => {
    syncUrlHash('workspace');
    set({
      addWizardOpen: false,
      activeLabTab: 'map',
      screen: 'workspace',
      mapPick: {
        active: true,
        body,
        pickedLat: null,
        pickedLon: null,
        pickedRadiusKm: null,
      },
    });
  },
  completeMapPick: (lat, lon, radiusKm, body) =>
    set({
      addWizardOpen: true,
      mapPick: {
        active: false,
        body,
        pickedLat: Number(lat.toFixed(4)),
        pickedLon: Number(lon.toFixed(4)),
        pickedRadiusKm: Number(radiusKm.toFixed(2)),
      },
    }),
  cancelMapPick: () =>
    set((s) => ({
      addWizardOpen: true,
      mapPick: { ...s.mapPick, active: false },
    })),
  setCursorTelemetry: (telemetry) => set({ cursorTelemetry: telemetry }),
  updateDossierDraft: (patch) =>
    set((s) => ({
      hasUnsavedEdits: true,
      dossierDraft: { ...s.dossierDraft, ...patch },
    })),
  resetDossierFromActiveSites: () => {
    const s = get();
    const t = s.sites.find((x) => x.id === s.activeTargetId);
    const a = s.sites.find((x) => x.id === s.activeAnalogId);
    set({
      hasUnsavedEdits: false,
      dossierDraft: buildDraftFromSites(t, a),
    });
  },
  triggerRecenter: () => set((s) => ({ recenterNonce: s.recenterNonce + 1 })),
  triggerMapZoom: (delta) =>
    set((s) => ({ mapZoomCommand: { nonce: s.mapZoomCommand.nonce + 1, delta } })),
  toggleDevDebugMode: () => set((s) => ({ devDebugMode: !s.devDebugMode })),
}));

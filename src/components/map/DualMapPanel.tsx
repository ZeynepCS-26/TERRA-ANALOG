import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import { ArrowUpDown, MapPin, X } from 'lucide-react';
import { computeBoundsFromCenter } from '../../data/candidates';
import { evaluateColormapRGB, type ScientificColormap } from '../../lib/elevation/colormaps';
import { formatSiteShortName } from '../../lib/formatSite';
import {
  computeEqualScaleZoom,
  computeNiceScaleBar,
  metersPerPxAtZoom,
  validateImagePixelBuffer,
} from '../../lib/geo/dualMapMath';
import {
  getMetricWindowBbox,
  projectGeoToMeters,
  selectSiteProjection,
  unprojectMetersToGeo,
  type SiteProjectionInfo,
} from '../../lib/geo/polarProjection';
import {
  computeHillshadeAtUV,
  computePercentilesP2P98,
  detectDegenerateDem,
  sampleElevationAtUVStrict,
  sampleSlopeAspectAtUV,
} from '../../lib/terrain/terrainExtractor';
import { useWorkspaceStore } from '../../store/useWorkspaceStore';
import type { GeoBounds, SiteRecord } from '../../types/site';
import { ElevationProfileChart } from '../charts/ElevationProfileChart';

interface DualMapPanelProps {
  visible?: boolean;
}

const POLAR_ROI_HALF_KM = 10; // 20 x 20 km square ROI
const POLAR_WIDE_HALF_KM = 50; // 100 x 100 km backdrop imagery

function get20KmRoiBounds(site: SiteRecord): GeoBounds {
  return computeBoundsFromCenter(site.lat, site.lon, 10, site.body).bounds;
}

function uvToLatLon(bounds: GeoBounds, u: number, v: number): [number, number] {
  const lat = bounds.maxLat - v * (bounds.maxLat - bounds.minLat);
  const lon = bounds.minLon + u * (bounds.maxLon - bounds.minLon);
  return [lat, lon];
}

function latLonToUV(bounds: GeoBounds, lat: number, lon: number): { u: number; v: number } {
  const u = Math.max(
    0.02,
    Math.min(0.98, (lon - bounds.minLon) / Math.max(1e-6, bounds.maxLon - bounds.minLon))
  );
  const v = Math.max(
    0.02,
    Math.min(0.98, (bounds.maxLat - lat) / Math.max(1e-6, bounds.maxLat - bounds.minLat))
  );
  return { u, v };
}

function getWideImageryBounds(site: SiteRecord): GeoBounds {
  const wide = computeBoundsFromCenter(site.lat, site.lon, 28, site.body).bounds;
  return {
    minLon: wide.minLon,
    maxLon: wide.maxLon,
    minLat: Math.max(-89.9, wide.minLat),
    maxLat: Math.min(89.9, wide.maxLat),
  };
}

function getImageryUrlForSite(
  site: SiteRecord,
  wideBounds: GeoBounds,
  projInfo: SiteProjectionInfo
): string {
  if (projInfo.isPolar && projInfo.supported) {
    const mb = getMetricWindowBbox(site.body, site.lat, site.lon, POLAR_WIDE_HALF_KM, 'imagery');
    const projParam =
      projInfo.id === 'EPSG:3031'
        ? 'epsg3031'
        : projInfo.id === 'EPSG:3413'
          ? 'epsg3413'
          : mb.pole === 'south'
            ? 'stereo_south'
            : 'stereo_north';
    const mbbox = `${mb.minX},${mb.minY},${mb.maxX},${mb.maxY}`;
    return `/api/gis/imagery?body=${site.body}&proj=${projParam}&mbbox=${encodeURIComponent(mbbox)}&size=1024`;
  }
  const sr = Math.abs(site.lat) > 82 ? '4326' : '3857';
  const bbox = `${wideBounds.minLon.toFixed(5)},${wideBounds.minLat.toFixed(5)},${wideBounds.maxLon.toFixed(5)},${wideBounds.maxLat.toFixed(5)}`;
  return `/api/gis/imagery?body=${site.body}&bbox=${encodeURIComponent(bbox)}&size=1024&sr=${sr}`;
}

function checkLoadedImageOverlay(img: HTMLImageElement | undefined): { valid: boolean; reason: string | null } {
  if (!img || img.naturalWidth < 4 || img.naturalHeight < 4) {
    return { valid: false, reason: 'Empty imagery response' };
  }
  try {
    const sampleSize = 64;
    const canvas = document.createElement('canvas');
    canvas.width = sampleSize;
    canvas.height = sampleSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { valid: true, reason: null };
    ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
    const data = ctx.getImageData(0, 0, sampleSize, sampleSize).data;
    return validateImagePixelBuffer(data, sampleSize, sampleSize);
  } catch {
    // Tainted external image fallback if browser blocks canvas readback
    return { valid: true, reason: null };
  }
}

function getBodyToneClass(body: SiteRecord['body']): string {
  if (body === 'MARS') return 'body-tone-mars';
  if (body === 'MOON') return 'body-tone-moon';
  return 'body-tone-earth';
}

function clamp255(v: number): number {
  return Math.max(0, Math.min(255, v));
}

interface DemGridLayerOptions {
  site: SiteRecord;
  mode: 'hillshade' | 'elevation';
  colormap: ScientificColormap;
  zFactor: number;
  sunAzimuthDeg: number;
  p2M: number;
  p98M: number;
  polarSimpleKmHalfSpan?: number;
  onZoomCoverageChange?: (hasCoverage: boolean) => void;
}

function createBilinearDemLayer(opts: DemGridLayerOptions): L.GridLayer | null {
  const dem = opts.site.demGrid;
  if (!dem) return null;

  const LayerClass = L.GridLayer.extend({
    createTile(coords: L.Coords) {
      const tile = document.createElement('canvas');
      const size = this.getTileSize();
      const w = size.x + 2;
      const h = size.y + 2;
      tile.width = w;
      tile.height = h;
      tile.style.width = `${w}px`;
      tile.style.height = `${h}px`;
      tile.style.marginLeft = '-1px';
      tile.style.marginTop = '-1px';
      tile.style.imageRendering = 'auto';

      const ctx = tile.getContext('2d');
      if (!ctx) return tile;

      const map = (this as unknown as { _map?: L.Map })._map;
      if (!map) return tile;

      const nwPoint = coords.scaleBy(size);
      const nw = map.unproject(nwPoint.subtract([1, 1]), coords.z);
      const se = map.unproject(nwPoint.add([size.x + 1, size.y + 1]), coords.z);

      const polarHalf = opts.polarSimpleKmHalfSpan;
      const b = polarHalf
        ? { minLon: -polarHalf, maxLon: polarHalf, minLat: -polarHalf, maxLat: polarHalf }
        : dem.bounds;

      if (se.lng < b.minLon || nw.lng > b.maxLon || nw.lat < b.minLat || se.lat > b.maxLat) {
        return tile;
      }

      let screenMPerPx: number;
      if (polarHalf) {
        const tileKm = Math.abs(se.lng - nw.lng);
        screenMPerPx = (tileKm * 1000) / Math.max(1, size.x);
      } else {
        const approxTileLonDeg = Math.abs(se.lng - nw.lng);
        const planetR =
          opts.site.body === 'MOON' ? 1737400 : opts.site.body === 'MARS' ? 3389500 : 6371000;
        const tileMeters =
          ((approxTileLonDeg * Math.PI) / 180) *
          planetR *
          Math.max(0.15, Math.cos((opts.site.lat * Math.PI) / 180));
        screenMPerPx = tileMeters / Math.max(1, size.x);
      }

      if (screenMPerPx < dem.resolutionMPerPx * 0.015) {
        opts.onZoomCoverageChange?.(false);
        return tile;
      }
      opts.onZoomCoverageChange?.(true);

      const img = ctx.createImageData(w, h);
      const siteLatSpan = Math.max(1e-6, b.maxLat - b.minLat);
      const siteLonSpan = Math.max(1e-6, b.maxLon - b.minLon);
      const pSpan = Math.max(1e-3, opts.p98M - opts.p2M);

      const latTop = nw.lat;
      const latBot = se.lat;
      const lonLeft = nw.lng;
      const lonRight = se.lng;
      const latDelta = latTop - latBot;
      const lonDelta = lonRight - lonLeft;

      for (let py = 0; py < h; py++) {
        const lat = latTop - ((py + 0.5) / h) * latDelta;
        const v = (b.maxLat - lat) / siteLatSpan;
        if (v < 0 || v > 1) continue;

        for (let px = 0; px < w; px++) {
          const lon = lonLeft + ((px + 0.5) / w) * lonDelta;
          const u = (lon - b.minLon) / siteLonSpan;
          if (u < 0 || u > 1) continue;

          // Keep PSR "no data" cells strictly transparent (null) rather than interpolating cliffs
          const elevM = sampleElevationAtUVStrict(dem, u, v);
          if (elevM === null) continue;

          const edgeDist = Math.min(u, 1 - u, v, 1 - v);
          const feather = edgeDist < 0.03 ? Math.max(0, edgeDist / 0.03) : 1;

          const idx = (py * w + px) * 4;
          if (opts.mode === 'hillshade') {
            const rawShade = computeHillshadeAtUV(dem, u, v, opts.sunAzimuthDeg, 35, opts.zFactor);
            const centered = Math.max(0, Math.min(1, 0.93 + (rawShade - 0.57) * 1.15));
            const gVal = Math.round(clamp255(centered * 255));
            img.data[idx] = gVal;
            img.data[idx + 1] = gVal;
            img.data[idx + 2] = gVal;
            img.data[idx + 3] = Math.round(255 * feather);
          } else {
            const norm = Math.max(0, Math.min(1, (elevM - opts.p2M) / pSpan));
            const [cr, cg, cb] = evaluateColormapRGB(opts.colormap, norm);
            img.data[idx] = cr;
            img.data[idx + 1] = cg;
            img.data[idx + 2] = cb;
            img.data[idx + 3] = Math.round(255 * feather);
          }
        }
      }

      ctx.imageSmoothingEnabled = true;
      ctx.putImageData(img, 0, 0);
      return tile;
    },
  });

  return new (LayerClass as unknown as new () => L.GridLayer)();
}

export const DualMapPanel: React.FC<DualMapPanelProps> = ({ visible = true }) => {
  const sites = useWorkspaceStore((s) => s.sites);
  const activeTargetId = useWorkspaceStore((s) => s.activeTargetId);
  const activeAnalogId = useWorkspaceStore((s) => s.activeAnalogId);
  const swipeMode = useWorkspaceStore((s) => s.swipeMode);
  const swipeRatio = useWorkspaceStore((s) => s.swipeRatio);
  const hillshadeEnabled = useWorkspaceStore((s) => s.hillshadeEnabled);
  const hillshadeZFactor = useWorkspaceStore((s) => s.hillshadeZFactor);
  const elevationOverlayEnabled = useWorkspaceStore((s) => s.elevationOverlayEnabled);
  const elevationOverlayOpacity = useWorkspaceStore((s) => s.elevationOverlayOpacity);
  const sunAzimuthDeg = useWorkspaceStore((s) => s.sunAzimuthDeg);
  const colormap = useWorkspaceStore((s) => s.colormap);
  const overlayFlags = useWorkspaceStore((s) => s.overlayFlags);
  const transectA = useWorkspaceStore((s) => s.transectA);
  const transectB = useWorkspaceStore((s) => s.transectB);
  const mapPick = useWorkspaceStore((s) => s.mapPick);
  const syncViews = useWorkspaceStore((s) => s.syncViews);
  const rightDrawer = useWorkspaceStore((s) => s.rightDrawer);
  const recenterNonce = useWorkspaceStore((s) => s.recenterNonce);
  const mapZoomCommand = useWorkspaceStore((s) => s.mapZoomCommand);
  const elevationExpanded = useWorkspaceStore((s) => s.elevationExpanded);
  const devDebugMode = useWorkspaceStore((s) => s.devDebugMode);

  const setSwipeRatio = useWorkspaceStore((s) => s.setSwipeRatio);
  const setTransectEndpoints = useWorkspaceStore((s) => s.setTransectEndpoints);
  const setCursorTelemetry = useWorkspaceStore((s) => s.setCursorTelemetry);
  const completeMapPick = useWorkspaceStore((s) => s.completeMapPick);
  const cancelMapPick = useWorkspaceStore((s) => s.cancelMapPick);
  const enrichSiteById = useWorkspaceStore((s) => s.enrichSiteById);

  const target =
    sites.find((t) => t.id === activeTargetId) ?? sites.find((s) => s.body !== 'EARTH') ?? sites[0];
  const analog =
    sites.find((a) => a.id === activeAnalogId) ?? sites.find((s) => s.body === 'EARTH') ?? sites[0];

  const targetProj = useMemo(
    () => (target ? selectSiteProjection(target.body, target.lat) : null),
    [target?.body, target?.lat]
  );
  const analogProj = useMemo(
    () => (analog ? selectSiteProjection(analog.body, analog.lat) : null),
    [analog?.body, analog?.lat]
  );

  const targetContainerRef = useRef<HTMLDivElement | null>(null);
  const analogContainerRef = useRef<HTMLDivElement | null>(null);
  const splitStageRef = useRef<HTMLDivElement | null>(null);

  const targetMapRef = useRef<L.Map | null>(null);
  const analogMapRef = useRef<L.Map | null>(null);
  const syncGuardRef = useRef(false);
  const baseScaleRef = useRef<{
    targetZoom: number;
    analogZoom: number;
    baseMetersPerPx: number;
  }>({ targetZoom: 10, analogZoom: 10, baseMetersPerPx: 40 });
  const lastFittedSizeRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });
  const prevZoomNonceRef = useRef<number>(mapZoomCommand.nonce);

  const targetOverlayGroupRef = useRef<L.LayerGroup | null>(null);
  const analogOverlayGroupRef = useRef<L.LayerGroup | null>(null);
  const targetLayersRef = useRef<L.Layer[]>([]);
  const analogLayersRef = useRef<L.Layer[]>([]);

  const [draggingDivider, setDraggingDivider] = useState(false);
  const [targetZoomCoverage, setTargetZoomCoverage] = useState(true);
  const [analogZoomCoverage, setAnalogZoomCoverage] = useState(true);
  const [targetImageryError, setTargetImageryError] = useState<string | null>(null);
  const [analogImageryError, setAnalogImageryError] = useState<string | null>(null);
  const [scaleBar, setScaleBar] = useState<{ label: string; widthPx: number }>({
    label: '5 km',
    widthPx: 76,
  });
  const [debugDims, setDebugDims] = useState<string>('');

  const targetStats = useMemo(() => {
    const dem = target?.demGrid;
    if (!dem) return null;
    const pct = computePercentilesP2P98(dem.elevations);
    const deg = detectDegenerateDem(dem.elevations, dem.width, dem.height);
    return { pct, deg };
  }, [target?.demGrid]);

  const analogStats = useMemo(() => {
    const dem = analog?.demGrid;
    if (!dem) return null;
    const pct = computePercentilesP2P98(dem.elevations);
    const deg = detectDegenerateDem(dem.elevations, dem.width, dem.height);
    return { pct, deg };
  }, [analog?.demGrid]);

  useEffect(() => {
    if (target?.demGrid && targetStats) {
      console.info(
        `[TERRA-ANALOG DEM] target=${target.id} proj=${targetProj?.id ?? 'unknown'} source="${target.demGrid.source}" grid=${target.demGrid.width}x${target.demGrid.height} res=${target.demGrid.resolutionMPerPx}m/px min=${targetStats.pct.minM}m max=${targetStats.pct.maxM}m p2=${targetStats.pct.p2M}m p98=${targetStats.pct.p98M}m`
      );
      if (targetStats.deg.isDegenerate) {
        console.error(`[TERRA-ANALOG DEM ERROR] target=${target.id}: ${targetStats.deg.reason}`);
      }
    }
    if (analog?.demGrid && analogStats) {
      console.info(
        `[TERRA-ANALOG DEM] analog=${analog.id} proj=${analogProj?.id ?? 'unknown'} source="${analog.demGrid.source}" grid=${analog.demGrid.width}x${analog.demGrid.height} res=${analog.demGrid.resolutionMPerPx}m/px min=${analogStats.pct.minM}m max=${analogStats.pct.maxM}m p2=${analogStats.pct.p2M}m p98=${analogStats.pct.p98M}m`
      );
      if (analogStats.deg.isDegenerate) {
        console.error(`[TERRA-ANALOG DEM ERROR] analog=${analog.id}: ${analogStats.deg.reason}`);
      }
    }
  }, [
    target?.id,
    target?.demGrid,
    targetStats,
    targetProj?.id,
    analog?.id,
    analog?.demGrid,
    analogStats,
    analogProj?.id,
  ]);

  const refreshScaleAndDebug = useCallback((aMap: L.Map | null, analogSite: SiteRecord | undefined) => {
    if (aMap && analogSite) {
      const aProj = selectSiteProjection(analogSite.body, analogSite.lat);
      const mPerPx = metersPerPxAtZoom(analogSite.body, analogSite.lat, aMap.getZoom(), aProj.isPolar);
      const nice = computeNiceScaleBar(mPerPx, 78);
      setScaleBar({ label: nice.label, widthPx: nice.widthPx });
      if (useWorkspaceStore.getState().devDebugMode) {
        const tEl = targetContainerRef.current;
        const aEl = analogContainerRef.current;
        const s = useWorkspaceStore.getState();
        const curT = s.sites.find((x) => x.id === s.activeTargetId);
        const tProj = curT ? selectSiteProjection(curT.body, curT.lat) : null;
        setDebugDims(
          `T:${tEl?.clientWidth ?? 0}x${tEl?.clientHeight ?? 0} (${tProj?.id ?? '?'}) · A:${aEl?.clientWidth ?? 0}x${aEl?.clientHeight ?? 0} (${aProj.id}) · ${Math.round(mPerPx)} m/px`
        );
      }
    } else if (useWorkspaceStore.getState().devDebugMode) {
      const tEl = targetContainerRef.current;
      const aEl = analogContainerRef.current;
      setDebugDims(
        `T:${tEl?.clientWidth ?? 0}x${tEl?.clientHeight ?? 0} · A:${aEl?.clientWidth ?? 0}x${aEl?.clientHeight ?? 0}`
      );
    }
  }, []);

  useEffect(() => {
    if (devDebugMode) {
      refreshScaleAndDebug(analogMapRef.current, analog);
    }
  }, [devDebugMode, target?.id, analog?.id, targetProj?.id, analogProj?.id, refreshScaleAndDebug, analog]);

  /**
   * Fits both panes to exact equal physical scale (km/px) so the 20x20 km ROI fills >=70%
   * (8% padding on each side = 84% along the limiting axis) of both panes.
   */
  const fitEqualScaleRoi = useCallback(() => {
    const tMap = targetMapRef.current;
    const aMap = analogMapRef.current;
    const tEl = targetContainerRef.current;
    const aEl = analogContainerRef.current;
    if (!tEl || !aEl) return;

    const s = useWorkspaceStore.getState();
    const curT = s.sites.find((x) => x.id === s.activeTargetId);
    const curA = s.sites.find((x) => x.id === s.activeAnalogId);
    if (!curT || !curA) return;

    const tRect = tEl.getBoundingClientRect();
    const aRect = aEl.getBoundingClientRect();
    if (tRect.width < 40 || tRect.height < 40 || aRect.width < 40 || aRect.height < 40) return;

    const paneW = Math.min(tRect.width, aRect.width);
    const paneH = Math.min(tRect.height, aRect.height);
    const tProj = selectSiteProjection(curT.body, curT.lat);
    const aProj = selectSiteProjection(curA.body, curA.lat);

    const aFit = computeEqualScaleZoom({
      body: curA.body,
      lat: curA.lat,
      roiSpanKm: 20,
      paneWidthPx: paneW,
      paneHeightPx: paneH,
      paddingFraction: 0.08,
      isSimpleKmCrs: aProj.isPolar,
    });
    const tFit = computeEqualScaleZoom({
      body: curT.body,
      lat: curT.lat,
      roiSpanKm: 20,
      paneWidthPx: paneW,
      paneHeightPx: paneH,
      paddingFraction: 0.08,
      isSimpleKmCrs: tProj.isPolar,
    });

    syncGuardRef.current = true;
    if (tMap && tProj.supported) {
      tMap.invalidateSize({ animate: false });
      tMap.setView(tProj.isPolar ? [0, 0] : [curT.lat, curT.lon], tFit.zoom, { animate: false });
    }
    if (aMap && aProj.supported) {
      aMap.invalidateSize({ animate: false });
      aMap.setView(aProj.isPolar ? [0, 0] : [curA.lat, curA.lon], aFit.zoom, { animate: false });
    }

    baseScaleRef.current = {
      targetZoom: tFit.zoom,
      analogZoom: aFit.zoom,
      baseMetersPerPx: aFit.metersPerPx,
    };
    lastFittedSizeRef.current = { w: Math.round(paneW), h: Math.round(paneH) };

    setTargetZoomCoverage(true);
    setAnalogZoomCoverage(true);
    refreshScaleAndDebug(aMap, curA);

    requestAnimationFrame(() => {
      syncGuardRef.current = false;
    });
  }, [refreshScaleAndDebug]);

  // Initialize Leaflet maps (recreate when polar projection id or support state changes)
  useEffect(() => {
    if (!targetContainerRef.current || !analogContainerRef.current || !target || !analog || !targetProj || !analogProj) {
      return;
    }

    const tMap = targetProj.supported
      ? L.map(targetContainerRef.current, {
          crs: targetProj.isPolar ? L.CRS.Simple : L.CRS.EPSG3857,
          center: targetProj.isPolar ? [0, 0] : [target.lat, target.lon],
          zoom: targetProj.isPolar ? 5 : 10,
          zoomSnap: 0.1,
          zoomDelta: 0.5,
          zoomControl: false,
          attributionControl: false,
          minZoom: targetProj.isPolar ? 1 : 2,
          maxZoom: targetProj.isPolar ? 10 : 16,
        })
      : null;

    const aMap = analogProj.supported
      ? L.map(analogContainerRef.current, {
          crs: analogProj.isPolar ? L.CRS.Simple : L.CRS.EPSG3857,
          center: analogProj.isPolar ? [0, 0] : [analog.lat, analog.lon],
          zoom: analogProj.isPolar ? 5 : 11,
          zoomSnap: 0.1,
          zoomDelta: 0.5,
          zoomControl: false,
          attributionControl: false,
          minZoom: analogProj.isPolar ? 1 : 2,
          maxZoom: analogProj.isPolar ? 10 : 17,
        })
      : null;

    const tOverlays = tMap ? L.layerGroup().addTo(tMap) : null;
    const aOverlays = aMap ? L.layerGroup().addTo(aMap) : null;

    targetMapRef.current = tMap;
    analogMapRef.current = aMap;
    targetOverlayGroupRef.current = tOverlays;
    analogOverlayGroupRef.current = aOverlays;

    const syncMove = (
      source: L.Map,
      dest: L.Map | null,
      srcSite: SiteRecord,
      dstSite: SiteRecord,
      srcIsTarget: boolean
    ) => {
      const s = useWorkspaceStore.getState();
      const curA = s.sites.find((x) => x.id === s.activeAnalogId);
      if (curA) refreshScaleAndDebug(aMap, curA);

      if (!dest || syncGuardRef.current || !s.syncViews) return;
      syncGuardRef.current = true;

      const srcProj = selectSiteProjection(srcSite.body, srcSite.lat);
      const dstProj = selectSiteProjection(dstSite.body, dstSite.lat);
      const c = source.getCenter();

      let uv: { u: number; v: number };
      if (srcProj.isPolar) {
        uv = {
          u: Math.max(0.02, Math.min(0.98, (c.lng + POLAR_ROI_HALF_KM) / (POLAR_ROI_HALF_KM * 2))),
          v: Math.max(0.02, Math.min(0.98, (POLAR_ROI_HALF_KM - c.lat) / (POLAR_ROI_HALF_KM * 2))),
        };
      } else {
        uv = latLonToUV(get20KmRoiBounds(srcSite), c.lat, c.lng);
      }

      const deltaZoom =
        source.getZoom() -
        (srcIsTarget ? baseScaleRef.current.targetZoom : baseScaleRef.current.analogZoom);
      const nextZoom =
        (srcIsTarget ? baseScaleRef.current.analogZoom : baseScaleRef.current.targetZoom) + deltaZoom;

      if (dstProj.isPolar) {
        const yKm = (0.5 - uv.v) * (POLAR_ROI_HALF_KM * 2);
        const xKm = (uv.u - 0.5) * (POLAR_ROI_HALF_KM * 2);
        dest.setView([yKm, xKm], nextZoom, { animate: false });
      } else {
        const [dstLat, dstLon] = uvToLatLon(get20KmRoiBounds(dstSite), uv.u, uv.v);
        dest.setView([dstLat, dstLon], nextZoom, { animate: false });
      }

      if (curA) refreshScaleAndDebug(aMap, curA);
      requestAnimationFrame(() => {
        syncGuardRef.current = false;
      });
    };

    const handleMapClick = (side: 'target' | 'analog', e: L.LeafletMouseEvent) => {
      const s = useWorkspaceStore.getState();
      if (!s.mapPick.active) return;
      const clickedSite =
        side === 'target'
          ? s.sites.find((x) => x.id === s.activeTargetId)
          : s.sites.find((x) => x.id === s.activeAnalogId);
      const body = s.mapPick.body || clickedSite?.body || (side === 'target' ? 'MARS' : 'EARTH');
      const clickedProj = clickedSite ? selectSiteProjection(clickedSite.body, clickedSite.lat) : null;
      if (clickedSite && clickedProj?.isPolar && clickedProj.supported) {
        const c = projectGeoToMeters(clickedProj.id, clickedSite.lat, clickedSite.lon, 'imagery');
        const geo = unprojectMetersToGeo(
          clickedProj.id,
          c.x + e.latlng.lng * 1000,
          c.y + e.latlng.lat * 1000,
          'imagery'
        );
        completeMapPick(geo.lat, geo.lon, 10, body);
      } else {
        completeMapPick(e.latlng.lat, e.latlng.lng, 10, body);
      }
    };

    const emitTelemetry = (side: 'target' | 'analog', site: SiteRecord, e: L.LeafletMouseEvent) => {
      let elevM: number | null = null;
      let slopeDeg: number | null = null;
      let lat = e.latlng.lat;
      let lon = e.latlng.lng;

      const proj = selectSiteProjection(site.body, site.lat);
      if (proj.isPolar && proj.supported) {
        const xKm = e.latlng.lng;
        const yKm = e.latlng.lat;
        const c = projectGeoToMeters(proj.id, site.lat, site.lon, 'imagery');
        const geo = unprojectMetersToGeo(proj.id, c.x + xKm * 1000, c.y + yKm * 1000, 'imagery');
        lat = geo.lat;
        lon = geo.lon;
        if (site.demGrid) {
          const span = site.radiusKm;
          const u = (xKm + span) / (2 * span);
          const v = (span - yKm) / (2 * span);
          const sampled = sampleElevationAtUVStrict(site.demGrid, u, v);
          if (sampled !== null) {
            elevM = Math.round(sampled);
            slopeDeg = sampleSlopeAspectAtUV(site.demGrid, u, v).slopeDeg;
          }
        }
      } else if (site.demGrid) {
        const uv = latLonToUV(site.demGrid.bounds, lat, lon);
        const sampled = sampleElevationAtUVStrict(site.demGrid, uv.u, uv.v);
        if (sampled !== null) {
          elevM = Math.round(sampled);
          slopeDeg = sampleSlopeAspectAtUV(site.demGrid, uv.u, uv.v).slopeDeg;
        }
      }

      setCursorTelemetry({
        side,
        lat: Number(lat.toFixed(3)),
        lon: Number(lon.toFixed(3)),
        elevM,
        slopeDeg,
      });
    };

    if (tMap) {
      tMap.on('click', (e: L.LeafletMouseEvent) => handleMapClick('target', e));
      tMap.on('move', () => {
        const s = useWorkspaceStore.getState();
        const curT = s.sites.find((x) => x.id === s.activeTargetId);
        const curA = s.sites.find((x) => x.id === s.activeAnalogId);
        if (curT && curA) syncMove(tMap, aMap, curT, curA, true);
      });
      tMap.on('mousemove', (e: L.LeafletMouseEvent) => {
        const s = useWorkspaceStore.getState();
        const curT = s.sites.find((x) => x.id === s.activeTargetId);
        if (curT) emitTelemetry('target', curT, e);
      });
    }

    if (aMap) {
      aMap.on('click', (e: L.LeafletMouseEvent) => handleMapClick('analog', e));
      aMap.on('move', () => {
        const s = useWorkspaceStore.getState();
        const curT = s.sites.find((x) => x.id === s.activeTargetId);
        const curA = s.sites.find((x) => x.id === s.activeAnalogId);
        if (curT && curA) syncMove(aMap, tMap, curA, curT, false);
      });
      aMap.on('mousemove', (e: L.LeafletMouseEvent) => {
        const s = useWorkspaceStore.getState();
        const curA = s.sites.find((x) => x.id === s.activeAnalogId);
        if (curA) emitTelemetry('analog', curA, e);
      });
    }

    // ResizeObserver watches BOTH map containers directly so drawer/tab/viewport changes always invalidate Leaflet
    let rafId = 0;
    const resizeObserver = new ResizeObserver(() => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        tMap?.invalidateSize({ animate: false });
        aMap?.invalidateSize({ animate: false });
        const tEl = targetContainerRef.current;
        const aEl = analogContainerRef.current;
        if (tEl && aEl) {
          const curW = Math.round(Math.min(tEl.clientWidth, aEl.clientWidth));
          const curH = Math.round(Math.min(tEl.clientHeight, aEl.clientHeight));
          if (
            curW >= 80 &&
            curH >= 80 &&
            (Math.abs(curW - lastFittedSizeRef.current.w) > 18 ||
              Math.abs(curH - lastFittedSizeRef.current.h) > 18)
          ) {
            fitEqualScaleRoi();
          } else {
            const s = useWorkspaceStore.getState();
            const curA = s.sites.find((x) => x.id === s.activeAnalogId);
            if (curA) refreshScaleAndDebug(aMap, curA);
          }
        }
      });
    });

    resizeObserver.observe(targetContainerRef.current);
    resizeObserver.observe(analogContainerRef.current);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver.disconnect();
      tMap?.remove();
      aMap?.remove();
      targetMapRef.current = null;
      analogMapRef.current = null;
      targetOverlayGroupRef.current = null;
      analogOverlayGroupRef.current = null;
      targetLayersRef.current = [];
      analogLayersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetProj?.id, targetProj?.supported, analogProj?.id, analogProj?.supported]);

  // Refit both panes when site pair changes or Recenter is pressed
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      fitEqualScaleRoi();
    });
    return () => cancelAnimationFrame(id);
  }, [
    target?.id,
    analog?.id,
    targetProj?.id,
    analogProj?.id,
    recenterNonce,
    fitEqualScaleRoi,
  ]);

  // Invalidate Leaflet when returning from hidden tabs (3D, Spectral, Matrix) or toggling swipeMode
  useEffect(() => {
    if (!visible) return;
    const id = requestAnimationFrame(() => {
      targetMapRef.current?.invalidateSize({ animate: false });
      analogMapRef.current?.invalidateSize({ animate: false });
      fitEqualScaleRoi();
    });
    return () => cancelAnimationFrame(id);
  }, [visible, swipeMode, fitEqualScaleRoi]);

  // Unified left rail Zoom +/- actions
  useEffect(() => {
    if (mapZoomCommand.nonce === prevZoomNonceRef.current) return;
    prevZoomNonceRef.current = mapZoomCommand.nonce;
    const tMap = targetMapRef.current;
    const aMap = analogMapRef.current;
    const delta = mapZoomCommand.delta * 0.6;
    if (tMap) tMap.setZoom(tMap.getZoom() + delta, { animate: true });
    if (aMap && !useWorkspaceStore.getState().syncViews) {
      aMap.setZoom(aMap.getZoom() + delta, { animate: true });
    }
  }, [mapZoomCommand]);

  // Update imagery + Hillshade (multiply 0.55) + Elevation overlay (OFF by default, <=0.35 opacity)
  useEffect(() => {
    const tMap = targetMapRef.current;
    const aMap = analogMapRef.current;
    if (!target || !analog || !targetProj || !analogProj) return;

    if (tMap) {
      for (const l of targetLayersRef.current) tMap.removeLayer(l);
      targetLayersRef.current = [];
    }
    if (aMap) {
      for (const l of analogLayersRef.current) aMap.removeLayer(l);
      analogLayersRef.current = [];
    }
    setTargetImageryError(null);
    setAnalogImageryError(null);

    const mountSiteLayers = (
      map: L.Map | null,
      site: SiteRecord,
      projInfo: SiteProjectionInfo,
      stats: { pct: { p2M: number; p98M: number }; deg: { isDegenerate: boolean } } | null,
      storeList: L.Layer[],
      onImgErr: (err: string | null) => void,
      onZoomCov: (ok: boolean) => void
    ) => {
      if (!map || !projInfo.supported) return;

      if (projInfo.isPolar) {
        const imgUrl = getImageryUrlForSite(site, site.bounds, projInfo);
        const polarImg = L.imageOverlay(
          imgUrl,
          [
            [-POLAR_WIDE_HALF_KM, -POLAR_WIDE_HALF_KM],
            [POLAR_WIDE_HALF_KM, POLAR_WIDE_HALF_KM],
          ],
          { opacity: 1.0, crossOrigin: 'anonymous' }
        );
        polarImg.on('load', () => {
          const check = checkLoadedImageOverlay(polarImg.getElement());
          if (!check.valid) {
            onImgErr(check.reason ?? 'Surface imagery unavailable');
            map.removeLayer(polarImg);
          }
        });
        polarImg.on('error', () => onImgErr('Surface imagery unavailable'));
        polarImg.addTo(map);
        storeList.push(polarImg);
      } else if (site.body === 'EARTH') {
        const esri = L.tileLayer(
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
          { opacity: 1.0, maxZoom: 17, maxNativeZoom: 17 }
        );
        esri.on('tileerror', () => onImgErr('Surface imagery unavailable'));
        esri.addTo(map);
        storeList.push(esri);
      } else {
        const backdropUrl =
          site.body === 'MARS'
            ? 'https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-mars-basemap-v0-2/all/{z}/{x}/{y}.png'
            : 'https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-moon-basemap-v0-1/all/{z}/{x}/{y}.png';
        const backdrop = L.tileLayer(backdropUrl, {
          opacity: 1.0,
          maxZoom: 16,
          maxNativeZoom: 7,
        });
        backdrop.addTo(map);
        storeList.push(backdrop);

        const wideBounds = getWideImageryBounds(site);
        const imgUrl = getImageryUrlForSite(site, wideBounds, projInfo);
        const trekOverlay = L.imageOverlay(
          imgUrl,
          [
            [wideBounds.minLat, wideBounds.minLon],
            [wideBounds.maxLat, wideBounds.maxLon],
          ],
          { opacity: 1.0, crossOrigin: 'anonymous' }
        );
        trekOverlay.on('load', () => {
          const check = checkLoadedImageOverlay(trekOverlay.getElement());
          if (!check.valid) {
            onImgErr(check.reason ?? 'Surface imagery unavailable');
            map.removeLayer(trekOverlay);
          }
        });
        trekOverlay.on('error', () => onImgErr('Surface imagery unavailable'));
        trekOverlay.addTo(map);
        storeList.push(trekOverlay);
      }

      if (!site.demGrid || !stats || stats.deg.isDegenerate) {
        return;
      }

      if (hillshadeEnabled) {
        const hs = createBilinearDemLayer({
          site,
          mode: 'hillshade',
          colormap,
          zFactor: hillshadeZFactor,
          sunAzimuthDeg,
          p2M: stats.pct.p2M,
          p98M: stats.pct.p98M,
          polarSimpleKmHalfSpan: projInfo.isPolar ? site.radiusKm : undefined,
          onZoomCoverageChange: onZoomCov,
        });
        if (hs) {
          hs.setOpacity(0.55);
          hs.addTo(map);
          const container = hs.getContainer();
          if (container) {
            container.style.mixBlendMode = 'multiply';
          }
          storeList.push(hs);
        }
      }

      if (elevationOverlayEnabled) {
        const elev = createBilinearDemLayer({
          site,
          mode: 'elevation',
          colormap,
          zFactor: hillshadeZFactor,
          sunAzimuthDeg,
          p2M: stats.pct.p2M,
          p98M: stats.pct.p98M,
          polarSimpleKmHalfSpan: projInfo.isPolar ? site.radiusKm : undefined,
          onZoomCoverageChange: onZoomCov,
        });
        if (elev) {
          elev.setOpacity(Math.min(0.35, Math.max(0.1, elevationOverlayOpacity)));
          elev.addTo(map);
          storeList.push(elev);
        }
      }
    };

    mountSiteLayers(
      tMap,
      target,
      targetProj,
      targetStats,
      targetLayersRef.current,
      setTargetImageryError,
      setTargetZoomCoverage
    );
    mountSiteLayers(
      aMap,
      analog,
      analogProj,
      analogStats,
      analogLayersRef.current,
      setAnalogImageryError,
      setAnalogZoomCoverage
    );
  }, [
    target,
    analog,
    targetProj,
    analogProj,
    targetStats,
    analogStats,
    hillshadeEnabled,
    hillshadeZFactor,
    elevationOverlayEnabled,
    elevationOverlayOpacity,
    sunAzimuthDeg,
    colormap,
  ]);

  // Crisp vector overlays: 0.5-opacity outer darkening mask around 20x20 km ROI + A-A' transect + optional graticule
  useEffect(() => {
    if (!target || !analog || !targetProj || !analogProj) return;

    const renderOverlays = (
      site: SiteRecord,
      group: L.LayerGroup | null,
      isTarget: boolean,
      projInfo: SiteProjectionInfo
    ) => {
      if (!group || !projInfo.supported) return;
      group.clearLayers();

      const polarSimple = projInfo.isPolar;
      const roi = get20KmRoiBounds(site);
      const outerRing: L.LatLngExpression[] = polarSimple
        ? [
            [-400, -400],
            [-400, 400],
            [400, 400],
            [400, -400],
          ]
        : [
            [-89.99, -360],
            [-89.99, 360],
            [89.99, 360],
            [89.99, -360],
          ];

      const holeRing: L.LatLngExpression[] = polarSimple
        ? [
            [-POLAR_ROI_HALF_KM, -POLAR_ROI_HALF_KM],
            [POLAR_ROI_HALF_KM, -POLAR_ROI_HALF_KM],
            [POLAR_ROI_HALF_KM, POLAR_ROI_HALF_KM],
            [-POLAR_ROI_HALF_KM, POLAR_ROI_HALF_KM],
          ]
        : [
            [roi.minLat, roi.minLon],
            [roi.maxLat, roi.minLon],
            [roi.maxLat, roi.maxLon],
            [roi.minLat, roi.maxLon],
          ];

      // Dim region outside 20x20 km ROI square while leaving the ROI interior bright and crisp
      L.polygon([outerRing, holeRing], {
        stroke: false,
        fillColor: '#090B0E',
        fillOpacity: 0.5,
        interactive: false,
      }).addTo(group);

      const roiRectBounds: L.LatLngBoundsExpression = polarSimple
        ? [
            [-POLAR_ROI_HALF_KM, -POLAR_ROI_HALF_KM],
            [POLAR_ROI_HALF_KM, POLAR_ROI_HALF_KM],
          ]
        : [
            [roi.minLat, roi.minLon],
            [roi.maxLat, roi.maxLon],
          ];

      L.rectangle(roiRectBounds, {
        color: isTarget
          ? site.body === 'MOON'
            ? 'rgba(169, 180, 191, 0.72)'
            : 'rgba(224, 138, 91, 0.72)'
          : 'rgba(143, 168, 134, 0.72)',
        weight: 1.3,
        dashArray: '4 4',
        fillOpacity: 0,
        interactive: false,
      }).addTo(group);

      const toMapCoords = (u: number, v: number): [number, number] => {
        if (polarSimple) {
          return [(0.5 - v) * (POLAR_ROI_HALF_KM * 2), (u - 0.5) * (POLAR_ROI_HALF_KM * 2)];
        }
        return uvToLatLon(roi, u, v);
      };

      const fromMapCoords = (lat: number, lng: number): { u: number; v: number } => {
        if (polarSimple) {
          return {
            u: Math.max(0.02, Math.min(0.98, (lng + POLAR_ROI_HALF_KM) / (POLAR_ROI_HALF_KM * 2))),
            v: Math.max(0.02, Math.min(0.98, (POLAR_ROI_HALF_KM - lat) / (POLAR_ROI_HALF_KM * 2))),
          };
        }
        return latLonToUV(roi, lat, lng);
      };

      if (overlayFlags.graticule) {
        for (let i = 1; i <= 3; i++) {
          const frac = i / 4;
          L.polyline([toMapCoords(frac, 0), toMapCoords(frac, 1)], {
            color: 'rgba(255, 255, 255, 0.16)',
            weight: 1,
            dashArray: '3 5',
            interactive: false,
          }).addTo(group);
          L.polyline([toMapCoords(0, frac), toMapCoords(1, frac)], {
            color: 'rgba(255, 255, 255, 0.16)',
            weight: 1,
            dashArray: '3 5',
            interactive: false,
          }).addTo(group);
        }
      }

      const ptA = toMapCoords(transectA.u, transectA.v);
      const ptB = toMapCoords(transectB.u, transectB.v);

      L.polyline([ptA, ptB], {
        color: 'rgba(11, 13, 16, 0.65)',
        weight: 4.5,
        interactive: false,
      }).addTo(group);

      L.polyline([ptA, ptB], {
        color: '#F8FAFC',
        weight: 2,
        interactive: false,
      }).addTo(group);

      const makePinIcon = (label: string) =>
        L.divIcon({
          className: 'transect-pin-icon',
          html: `<div style="width:22px;height:22px;border-radius:9999px;background:rgba(16,18,23,0.92);border:1.5px solid #F8FAFC;color:#F8FAFC;font-family:JetBrains Mono,monospace;font-size:13px;font-weight:700;display:flex;align-items:center;justify-content:center;cursor:grab;box-shadow:0 2px 8px rgba(0,0,0,0.5);">${label}</div>`,
          iconSize: [22, 22],
          iconAnchor: [11, 11],
        });

      const markerA = L.marker(ptA, { draggable: true, icon: makePinIcon('A') }).addTo(group);
      markerA.on('drag', (ev) => {
        const ll = (ev.target as L.Marker).getLatLng();
        setTransectEndpoints(fromMapCoords(ll.lat, ll.lng), useWorkspaceStore.getState().transectB);
      });

      const markerB = L.marker(ptB, { draggable: true, icon: makePinIcon("A'") }).addTo(group);
      markerB.on('drag', (ev) => {
        const ll = (ev.target as L.Marker).getLatLng();
        setTransectEndpoints(useWorkspaceStore.getState().transectA, fromMapCoords(ll.lat, ll.lng));
      });
    };

    renderOverlays(target, targetOverlayGroupRef.current, true, targetProj);
    renderOverlays(analog, analogOverlayGroupRef.current, false, analogProj);
  }, [
    target,
    analog,
    targetProj,
    analogProj,
    overlayFlags.graticule,
    transectA,
    transectB,
    setTransectEndpoints,
  ]);

  useEffect(() => {
    if (!draggingDivider) return;
    const onMove = (e: PointerEvent) => {
      if (!splitStageRef.current) return;
      const rect = splitStageRef.current.getBoundingClientRect();
      setSwipeRatio((e.clientX - rect.left) / Math.max(1, rect.width));
    };
    const onUp = () => setDraggingDivider(false);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
  }, [draggingDivider, setSwipeRatio]);

  if (!target || !analog || !targetProj || !analogProj) return null;

  const colorbarGradient = Array.from({ length: 12 }, (_, i) => {
    const [r, g, b] = evaluateColormapRGB(colormap, i / 11);
    return `rgb(${r},${g},${b})`;
  }).join(', ');

  return (
    <section
      aria-label="Dual GIS planetary and analog map"
      className="relative w-full h-full bg-[#181B20] overflow-hidden flex flex-col min-h-0"
    >
      {mapPick.active && (
        <div className="fixed top-24 left-1/2 -translate-x-1/2 z-[900] rounded-xl bg-[#101217]/95 border border-white/25 px-4 py-2.5 flex items-center gap-3 shadow-xl font-mono text-[13px] text-[#F2F4F8]">
          <MapPin className="w-4 h-4 text-[#8FA886]" />
          <span>Click anywhere on either map to pick coordinates ({mapPick.body})</span>
          <button
            type="button"
            onClick={cancelMapPick}
            aria-label="Cancel map pick"
            className="p-1 rounded hover:bg-white/10 text-[#9AA3B2] hover:text-white cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div
        ref={splitStageRef}
        className={
          swipeMode
            ? 'relative flex-1 min-h-0 w-full overflow-hidden'
            : 'relative flex-1 min-h-0 w-full grid grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1'
        }
      >
        <div
          className={
            swipeMode
              ? 'absolute inset-0 w-full h-full'
              : 'relative w-full h-full min-h-0 overflow-hidden border-b lg:border-b-0 lg:border-r border-[#2C313A]'
          }
        >
          <div
            ref={targetContainerRef}
            className={`absolute inset-0 ${getBodyToneClass(target.body)}`}
            data-testid="target-map-canvas"
          />

          {!targetProj.supported && (
            <div
              data-testid="target-projection-unavailable"
              className="absolute inset-0 z-[480] bg-[#0B0D10]/95 flex items-center justify-center p-6 text-center"
            >
              <div className="rounded-xl bg-[#101217] border border-[#C8553D]/45 px-5 py-4 font-mono text-[14px] text-[#E08A5B] max-w-sm">
                Polar region, projection unavailable
              </div>
            </div>
          )}

          {/* Target projection badge */}
          <div
            data-testid="target-projection-badge"
            className="pointer-events-none absolute top-[154px] lg:top-[102px] left-4 z-[460] rounded-lg bg-[#101217]/84 border border-white/10 px-2.5 py-1 font-mono text-[13px] text-[#C7CEDB] shadow-md max-w-[270px] truncate"
          >
            {targetProj.label}
          </div>

          {target.demGrid?.source?.includes('Synthetic') && (
            <div className="pointer-events-none absolute top-[194px] lg:top-[140px] left-4 z-[460] rounded-lg bg-[#2A1F14]/95 border border-[#D9A441]/50 px-2.5 py-1 font-mono text-[12px] text-[#D9A441] shadow-md">
              Modeled data, not measured
            </div>
          )}

          {(target.demStatus === 'unavailable' || targetImageryError) && (
            <div className="absolute inset-0 z-[490] bg-[#15181C] flex flex-col items-center justify-center p-6 text-center font-mono">
              <p className="text-[15px] text-[#C7CEDB] mb-4">No surface data for this site</p>
              <button
                type="button"
                onClick={() => void enrichSiteById(target.id)}
                className="px-5 py-2 rounded-lg bg-[#2C313A] hover:bg-[#3E4450] text-white text-[13px] font-bold cursor-pointer transition-colors duration-150"
              >
                Retry
              </button>
            </div>
          )}

          {/* Target matched scalebar */}
          <div
            data-testid="target-scalebar"
            className="pointer-events-none absolute top-[154px] lg:top-[102px] right-4 z-[460] rounded-lg bg-[#101217]/84 border border-white/10 px-2.5 py-1 font-mono text-[13px] text-[#E2E6ED] tabular-nums flex items-center gap-2 shadow-md"
          >
            <span>20×20 km ROI</span>
            <span className="text-white/25">·</span>
            <div className="flex items-center gap-1.5">
              <div
                className="h-1.5 border-x border-b border-[#F2F4F8]"
                style={{ width: `${scaleBar.widthPx}px` }}
              />
              <span>{scaleBar.label}</span>
            </div>
          </div>
        </div>

        <div
          className={
            swipeMode
              ? 'absolute inset-0 w-full h-full'
              : 'relative w-full h-full min-h-0 overflow-hidden'
          }
          style={
            swipeMode ? { clipPath: `inset(0 0 0 ${(swipeRatio * 100).toFixed(2)}%)` } : undefined
          }
        >
          <div
            ref={analogContainerRef}
            className={`absolute inset-0 ${getBodyToneClass(analog.body)}`}
            data-testid="analog-map-canvas"
          />

          {!analogProj.supported && (
            <div
              data-testid="analog-projection-unavailable"
              className="absolute inset-0 z-[480] bg-[#0B0D10]/95 flex items-center justify-center p-6 text-center"
            >
              <div className="rounded-xl bg-[#101217] border border-[#C8553D]/45 px-5 py-4 font-mono text-[14px] text-[#E08A5B] max-w-sm">
                Polar region, projection unavailable
              </div>
            </div>
          )}

          {/* Analog projection badge */}
          <div
            data-testid="analog-projection-badge"
            className="pointer-events-none absolute top-3 lg:top-[102px] right-4 z-[460] rounded-lg bg-[#101217]/84 border border-white/10 px-2.5 py-1 font-mono text-[13px] text-[#C7CEDB] shadow-md max-w-[270px] truncate"
          >
            {analogProj.label}
          </div>

          {(analog.demStatus === 'unavailable' || analogImageryError) && (
            <div className="absolute inset-0 z-[490] bg-[#15181C] flex flex-col items-center justify-center p-6 text-center font-mono">
              <p className="text-[15px] text-[#C7CEDB] mb-4">No surface data for this site</p>
              <button
                type="button"
                onClick={() => void enrichSiteById(analog.id)}
                className="px-5 py-2 rounded-lg bg-[#2C313A] hover:bg-[#3E4450] text-white text-[13px] font-bold cursor-pointer transition-colors duration-150"
              >
                Retry
              </button>
            </div>
          )}

          {/* Analog matching scalebar (exact same km/px) */}
          <div
            data-testid="analog-scalebar"
            className="pointer-events-none absolute top-3 lg:top-[102px] left-16 lg:left-4 z-[460] rounded-lg bg-[#101217]/84 border border-white/10 px-2.5 py-1 font-mono text-[13px] text-[#E2E6ED] tabular-nums flex items-center gap-2 shadow-md"
          >
            <div className="flex items-center gap-1.5">
              <div
                className="h-1.5 border-x border-b border-[#F2F4F8]"
                style={{ width: `${scaleBar.widthPx}px` }}
              />
              <span>{scaleBar.label}</span>
            </div>
            <span className="text-white/25">·</span>
            <span>{syncViews ? 'Linked' : 'Unlocked'}</span>
          </div>
        </div>

        {swipeMode && (
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Drag map comparison divider"
            onPointerDown={() => setDraggingDivider(true)}
            style={{ left: `${swipeRatio * 100}%` }}
            className="absolute top-0 bottom-0 z-[500] -ml-0.5 w-0.5 bg-white/80 cursor-ew-resize flex items-center justify-center"
          >
            <div className="w-8 h-10 rounded-full bg-[#101217]/90 text-[#F2F4F8] shadow-lg flex items-center justify-center">
              <ArrowUpDown className="w-4 h-4 rotate-90" />
            </div>
          </div>
        )}
      </div>

      {/* Single shared bottom elevation colorbar when Elevation layer is ON */}
      {elevationOverlayEnabled && (targetStats || analogStats) && (
        <div
          data-testid="shared-elevation-colorbar"
          className={`pointer-events-none absolute ${
            elevationExpanded ? 'bottom-[372px]' : 'bottom-[122px]'
          } -translate-x-1/2 z-[540] rounded-xl bg-[#101217]/92 border border-white/12 px-4 py-2 shadow-xl font-mono text-[13px] text-[#E2E6ED] flex items-center gap-3 whitespace-nowrap transition-[left,bottom] duration-250 ease-out ${
            rightDrawer ? 'left-1/2 lg:left-[calc(50%-200px)]' : 'left-1/2'
          }`}
        >
          <span className="text-[#9AA3B2]">Low</span>
          <div
            className="w-32 h-2.5 rounded-full shrink-0"
            style={{ background: `linear-gradient(to right, ${colorbarGradient})` }}
          />
          <span className="text-[#9AA3B2]">High</span>
          <span className="text-white/25">|</span>
          <span className="tabular-nums">
            {targetStats
              ? `${formatSiteShortName(target)} ${Math.round(targetStats.pct.p2M)}…${Math.round(targetStats.pct.p98M)} m`
              : ''}
            {targetStats && analogStats ? ' · ' : ''}
            {analogStats
              ? `${formatSiteShortName(analog)} ${Math.round(analogStats.pct.p2M)}…${Math.round(analogStats.pct.p98M)} m`
              : ''}
          </span>
        </div>
      )}

      {/* Floating Elevation Profile INSIDE the map stage so expanding it never shrinks Leaflet containers */}
      <div
        className={`pointer-events-auto absolute bottom-[58px] z-[530] transition-[left,width,transform] duration-250 ease-out ${
          rightDrawer
            ? 'w-[min(600px,calc(100%-32px))] lg:w-[min(580px,calc(100%-460px))] left-1/2 -translate-x-1/2 lg:left-[calc(50%-200px)]'
            : 'w-[min(660px,calc(100%-32px))] left-1/2 -translate-x-1/2'
        }`}
      >
        <ElevationProfileChart />
      </div>

      {/* Developer diagnostics overlay — strictly hidden unless Shift+D is pressed */}
      {devDebugMode && debugDims && (
        <div
          data-testid="dev-diagnostics-hud"
          className="pointer-events-none absolute top-[194px] lg:top-[140px] left-16 z-[600] rounded-lg bg-[#101217]/95 border border-[#D9A441]/40 px-3 py-1.5 font-mono text-[13px] text-[#D9A441] shadow-lg"
        >
          {debugDims}
        </div>
      )}
    </section>
  );
};

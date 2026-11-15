import { fromArrayBuffer } from 'geotiff';
import type { BodyType, DemGridData, GeoBounds } from '../../types/site';
import {
  getCentered20KmGeoBounds,
  getMetricWindowBbox,
  localMetricOffsetToGeo,
  selectSiteProjection,
} from '../geo/polarProjection';
import { boundsToSpanKm } from '../terrain/terrainExtractor';

function isValidRasterValue(v: number, noDataVal?: number | null): boolean {
  if (!Number.isFinite(v)) return false;
  if (typeof noDataVal === 'number' && Math.abs(v - noDataVal) < 1e-3) return false;
  if (v <= -32760 || Math.abs(v) > 1e7) return false;
  return true;
}

/**
 * Resamples a raster into a targetSize x targetSize grid.
 * Preserves NoData / PSR voids cleanly as NaN ("no data") without cliff interpolation.
 */
function resampleRasterGrid(
  raw: ArrayLike<number>,
  srcW: number,
  srcH: number,
  targetSize: number,
  noDataVal?: number | null,
  coordMapper?: (gx: number, gy: number) => { fx: number; fy: number }
): number[] {
  const sampleStrict = (x: number, y: number): number | null => {
    if (x < 0 || x >= srcW || y < 0 || y >= srcH) return null;
    const v = Number(raw[y * srcW + x]);
    return isValidRasterValue(v, noDataVal) ? v : null;
  };

  const out = new Array<number>(targetSize * targetSize);
  for (let y = 0; y < targetSize; y++) {
    for (let x = 0; x < targetSize; x++) {
      const mapped = coordMapper
        ? coordMapper(x, y)
        : {
            fx: (x / Math.max(1, targetSize - 1)) * (srcW - 1),
            fy: (y / Math.max(1, targetSize - 1)) * (srcH - 1),
          };
      const { fx, fy } = mapped;
      if (!Number.isFinite(fx) || !Number.isFinite(fy) || fx < 0 || fx > srcW - 1 || fy < 0 || fy > srcH - 1) {
        out[y * targetSize + x] = Number.NaN;
        continue;
      }

      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = Math.min(srcW - 1, x0 + 1);
      const y1 = Math.min(srcH - 1, y0 + 1);
      const tx = fx - x0;
      const ty = fy - y0;

      const z00 = sampleStrict(x0, y0);
      const z10 = sampleStrict(x1, y0);
      const z01 = sampleStrict(x0, y1);
      const z11 = sampleStrict(x1, y1);

      if (z00 === null || z10 === null || z01 === null || z11 === null) {
        out[y * targetSize + x] = Number.NaN;
        continue;
      }

      const top = z00 * (1 - tx) + z10 * tx;
      const bot = z01 * (1 - tx) + z11 * tx;
      out[y * targetSize + x] = Number((top * (1 - ty) + bot * ty).toFixed(2));
    }
  }
  return out;
}

export async function parseGeoTiffBuffer(
  buffer: ArrayBuffer,
  body: BodyType,
  sourceLabel: string,
  fallbackBounds: GeoBounds,
  targetSize = 96,
  reprojectCenter?: { lat: number; lon: number; isNativePolarStereo?: boolean }
): Promise<DemGridData> {
  const tiff = await fromArrayBuffer(buffer);
  const image = await tiff.getImage();
  const width = image.getWidth();
  const height = image.getHeight();
  if (width < 3 || height < 3) {
    throw new Error(`GeoTIFF raster dimensions (${width}x${height}) are too small.`);
  }

  const rasters = await image.readRasters();
  const band0 = rasters[0] as ArrayLike<number>;
  if (!band0 || band0.length === 0) {
    throw new Error('GeoTIFF contains no raster bands.');
  }

  let bounds = fallbackBounds;
  try {
    const bbox = image.getBoundingBox();
    if (
      Array.isArray(bbox) &&
      bbox.length === 4 &&
      bbox.every(Number.isFinite) &&
      bbox[0] >= -180 &&
      bbox[2] <= 360 &&
      bbox[1] >= -90 &&
      bbox[3] <= 90 &&
      Math.abs(bbox[2] - bbox[0]) > 1e-5
    ) {
      bounds = {
        minLon: bbox[0] > 180 ? bbox[0] - 360 : bbox[0],
        minLat: bbox[1],
        maxLon: bbox[2] > 180 ? bbox[2] - 360 : bbox[2],
        maxLat: bbox[3],
      };
    }
  } catch {
    // Non-geographic or projected GeoTIFF keeps user-provided bounds
  }

  const noDataVal = image.getGDALNoData();
  const gridDim = Math.min(128, Math.max(24, Math.min(targetSize, Math.max(width, height))));

  let elevations: number[];
  let resolutionMPerPx: number;

  if (reprojectCenter?.isNativePolarStereo) {
    // Already requested natively in isotropic 20x20 km Polar Stereographic meters
    elevations = resampleRasterGrid(band0, width, height, gridDim, noDataVal);
    resolutionMPerPx = Math.max(1, Math.round(20000 / gridDim));
  } else if (reprojectCenter) {
    // Reproject geographic GeoTIFF into an isotropic 20x20 km local tangent metric grid centered at site
    const lonSpan = Math.max(1e-6, bounds.maxLon - bounds.minLon);
    const latSpan = Math.max(1e-6, bounds.maxLat - bounds.minLat);
    elevations = resampleRasterGrid(band0, width, height, gridDim, noDataVal, (gx, gy) => {
      const eastM = -10000 + (gx / Math.max(1, gridDim - 1)) * 20000;
      const northM = 10000 - (gy / Math.max(1, gridDim - 1)) * 20000;
      const geo = localMetricOffsetToGeo(body, reprojectCenter.lat, reprojectCenter.lon, eastM, northM, 'dem');
      const fx = ((geo.lon - bounds.minLon) / lonSpan) * (width - 1);
      const fy = ((bounds.maxLat - geo.lat) / latSpan) * (height - 1);
      return { fx, fy };
    });
    resolutionMPerPx = Math.max(1, Math.round(20000 / gridDim));
  } else {
    elevations = resampleRasterGrid(band0, width, height, gridDim, noDataVal);
    const latCenter = (bounds.minLat + bounds.maxLat) / 2;
    const spanKm = boundsToSpanKm(bounds, latCenter, body);
    resolutionMPerPx = Math.max(1, Math.round((spanKm * 1000) / gridDim));
  }

  return {
    width: gridDim,
    height: gridDim,
    elevations,
    bounds,
    resolutionMPerPx,
    source: sourceLabel,
    fetchedAtIso: new Date().toISOString(),
    cached: false,
  };
}

export async function fetchPlanetaryTrekDem(
  body: 'MARS' | 'MOON',
  bounds: GeoBounds,
  gridSize = 96,
  siteCenter?: { lat: number; lon: number; radiusKm: number }
): Promise<DemGridData> {
  const centerLat = siteCenter?.lat ?? (bounds.minLat + bounds.maxLat) / 2;
  const centerLon = siteCenter?.lon ?? (bounds.minLon + bounds.maxLon) / 2;
  const projInfo = selectSiteProjection(body, centerLat);
  const metricBounds = getCentered20KmGeoBounds(body, centerLat, centerLon, 10);

  let url: string;
  let isNativePolarStereo = false;

  if (projInfo.isPolar && projInfo.supported) {
    // Query centered 20x20 km Polar Stereographic metric window directly
    const mb = getMetricWindowBbox(body, centerLat, centerLon, 10, 'dem');
    const proj = mb.pole === 'south' ? 'stereo_south' : 'stereo_north';
    const mbbox = `${mb.minX},${mb.minY},${mb.maxX},${mb.maxY}`;
    url = `/api/gis/dem?body=${body}&proj=${proj}&mbbox=${encodeURIComponent(mbbox)}&size=${gridSize}`;
    isNativePolarStereo = true;
  } else {
    // Request slightly padded geographic bbox so 20x20 km metric reprojection samples interior pixels cleanly
    const padLat = (metricBounds.maxLat - metricBounds.minLat) * 0.12;
    const padLon = (metricBounds.maxLon - metricBounds.minLon) * 0.12;
    const reqMinLon = metricBounds.minLon - padLon;
    const reqMinLat = Math.max(-89.9, metricBounds.minLat - padLat);
    const reqMaxLon = metricBounds.maxLon + padLon;
    const reqMaxLat = Math.min(89.9, metricBounds.maxLat + padLat);
    const bboxParam = `${reqMinLon.toFixed(5)},${reqMinLat.toFixed(5)},${reqMaxLon.toFixed(5)},${reqMaxLat.toFixed(5)}`;
    url = `/api/gis/dem?body=${body}&bbox=${encodeURIComponent(bboxParam)}&size=${gridSize}`;
  }

  const res = await fetch(url, { signal: AbortSignal.timeout(14000) });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`NASA Trek ${body} DEM error (${res.status}): ${errText.slice(0, 120)}`);
  }
  const sourceHeader =
    res.headers.get('X-Dem-Source') ||
    (body === 'MARS' ? 'NASA Trek MOLA' : 'NASA Trek LRO LOLA');
  const buffer = await res.arrayBuffer();
  const parsed = await parseGeoTiffBuffer(buffer, body, sourceHeader, metricBounds, gridSize, {
    lat: centerLat,
    lon: centerLon,
    isNativePolarStereo,
  });

  return {
    ...parsed,
    bounds: metricBounds,
    resolutionMPerPx: Math.max(1, Math.round(20000 / gridSize)),
  };
}

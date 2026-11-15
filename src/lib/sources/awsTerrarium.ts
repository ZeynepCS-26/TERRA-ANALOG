import type { DemGridData, GeoBounds } from '../../types/site';
import { getCentered20KmGeoBounds, localMetricOffsetToGeo } from '../geo/polarProjection';
import { decodeTerrariumPixel } from '../terrain/terrainExtractor';

function lonToTileX(lon: number, zoom: number): number {
  const n = 2 ** zoom;
  return Math.floor(((lon + 180) / 360) * n);
}

function latToTileY(lat: number, zoom: number): number {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clampedLat * Math.PI) / 180;
  const n = 2 ** zoom;
  return Math.floor(
    ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n
  );
}

function lonToPixelInTileSpace(lon: number, zoom: number): number {
  return ((lon + 180) / 360) * 2 ** zoom * 256;
}

function latToPixelInTileSpace(lat: number, zoom: number): number {
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, lat));
  const rad = (clampedLat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** zoom * 256;
}

async function loadImagePixels(url: string): Promise<ImageData> {
  const res = await fetch(url, { mode: 'cors', signal: AbortSignal.timeout(9000) });
  if (!res.ok) {
    throw new Error(`AWS Terrain tile HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Failed to create 2D canvas context for Terrarium decoding.');
  }
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}

/**
 * Fetches AWS Terrarium PNG tiles and reprojects onto a centered 20x20 km isotropic metric window
 * (EPSG:3031/3413 via proj4 in polar latitudes, local tangent meters elsewhere) so slopes have zero Mercator distortion.
 */
export async function fetchAwsTerrariumDem(
  bounds: GeoBounds,
  latCenter: number,
  gridSize = 96,
  lonCenter?: number
): Promise<DemGridData> {
  const cLon = lonCenter ?? (bounds.minLon + bounds.maxLon) / 2;
  const absLat = Math.abs(latCenter);
  if (absLat > 85.0) {
    throw new Error('Polar region >85° outside Web Mercator Terrarium DEM coverage.');
  }

  const metricBounds = getCentered20KmGeoBounds('EARTH', latCenter, cLon, 10);
  const zoom = absLat > 72 ? 9 : 11;

  const minTileX = lonToTileX(metricBounds.minLon, zoom);
  const maxTileX = lonToTileX(metricBounds.maxLon, zoom);
  const minTileY = latToTileY(metricBounds.maxLat, zoom);
  const maxTileY = latToTileY(metricBounds.minLat, zoom);

  const nTiles = 2 ** zoom;
  const tilePixels = new Map<string, ImageData>();

  const tileFetches: Array<Promise<void>> = [];
  for (let ty = minTileY; ty <= maxTileY; ty++) {
    for (let tx = minTileX; tx <= maxTileX; tx++) {
      const wrappedX = ((tx % nTiles) + nTiles) % nTiles;
      if (ty < 0 || ty >= nTiles) continue;
      const key = `${wrappedX}:${ty}`;
      const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${zoom}/${wrappedX}/${ty}.png`;
      tileFetches.push(
        loadImagePixels(url).then((img) => {
          tilePixels.set(key, img);
        })
      );
    }
  }

  if (tileFetches.length === 0) {
    throw new Error('Selected latitude is outside Web Mercator Terrarium tile bounds.');
  }

  await Promise.all(tileFetches);

  const sampleGlobalPixel = (gxPx: number, gyPx: number): number | null => {
    if (gyPx < 0 || gyPx >= nTiles * 256) return null;
    const tileY = Math.floor(gyPx / 256);
    const tileX = ((Math.floor(gxPx / 256) % nTiles) + nTiles) % nTiles;
    const img = tilePixels.get(`${tileX}:${tileY}`);
    if (!img) return null;
    const localX = ((gxPx % 256) + 256) % 256;
    const localY = gyPx - tileY * 256;
    const off = (localY * img.width + localX) * 4;
    if (img.data[off + 3] === 0) return null;
    return decodeTerrariumPixel(img.data[off], img.data[off + 1], img.data[off + 2]);
  };

  const elevations = new Array<number>(gridSize * gridSize);
  for (let gy = 0; gy < gridSize; gy++) {
    const northM = 10000 - (gy / Math.max(1, gridSize - 1)) * 20000;
    for (let gx = 0; gx < gridSize; gx++) {
      const eastM = -10000 + (gx / Math.max(1, gridSize - 1)) * 20000;
      const geo = localMetricOffsetToGeo('EARTH', latCenter, cLon, eastM, northM, 'dem');
      if (Math.abs(geo.lat) > 85.05) {
        elevations[gy * gridSize + gx] = Number.NaN;
        continue;
      }

      const fx = lonToPixelInTileSpace(geo.lon, zoom);
      const fy = latToPixelInTileSpace(geo.lat, zoom);
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      const tx = fx - x0;
      const ty = fy - y0;

      const z00 = sampleGlobalPixel(x0, y0);
      const z10 = sampleGlobalPixel(x1, y0);
      const z01 = sampleGlobalPixel(x0, y1);
      const z11 = sampleGlobalPixel(x1, y1);

      if (z00 === null || z10 === null || z01 === null || z11 === null) {
        elevations[gy * gridSize + gx] = Number.NaN;
        continue;
      }

      const top = z00 * (1 - tx) + z10 * tx;
      const bot = z01 * (1 - tx) + z11 * tx;
      const z = top * (1 - ty) + bot * ty;
      elevations[gy * gridSize + gx] = Number(z.toFixed(2));
    }
  }

  return {
    width: gridSize,
    height: gridSize,
    elevations,
    bounds: metricBounds,
    resolutionMPerPx: Math.max(10, Math.round(20000 / gridSize)),
    source: `AWS Terrain Tiles z${zoom}`,
    fetchedAtIso: new Date().toISOString(),
    cached: false,
  };
}

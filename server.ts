import 'dotenv/config';
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const isProduction = process.env.NODE_ENV === 'production';

interface DossierGeneratePayload {
  targetName: string;
  targetBody: string;
  targetCoords: string;
  targetDemSource: string;
  targetLithology: string;
  analogName: string;
  analogCountry: string;
  analogCoords: string;
  analogLithology: string;
  similarityScorePct: number;
  rmseM: number;
  pearsonR: number;
  missionProgram: string;
  missionObjectives: string;
  mobilityConstraint: string;
  sciencePriorities: string;
}

interface ImageAnalyzePayload {
  imageBase64: string;
  mimeType: string;
  bodyHint?: string;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY is not configured in the server environment.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function probeUrl(url: string, timeoutMs = 4500): Promise<{ ok: boolean; status: number }> {
  try {
    const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  }
}

function parseAndValidateBbox(bboxRaw: string): [number, number, number, number] | null {
  const parts = bboxRaw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (
    minLon >= maxLon ||
    minLat >= maxLat ||
    minLon < -180 ||
    maxLon > 360 ||
    minLat < -90 ||
    maxLat > 90 ||
    maxLon - minLon > 35 ||
    maxLat - minLat > 35
  ) {
    return null;
  }
  return [minLon, minLat, maxLon, maxLat];
}

function parseAndValidateMeterBbox(raw: string): [number, number, number, number] | null {
  const parts = raw.split(',').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [xmin, ymin, xmax, ymax] = parts;
  if (
    xmin >= xmax ||
    ymin >= ymax ||
    xmin < -5000000 ||
    xmax > 5000000 ||
    ymin < -5000000 ||
    ymax > 5000000 ||
    xmax - xmin > 500000 ||
    ymax - ymin > 500000
  ) {
    return null;
  }
  return [xmin, ymin, xmax, ymax];
}

const app = express();
app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});
app.use(express.json({ limit: '16mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      timestampUtc: new Date().toISOString(),
    });
  });

  app.get('/api/sources/status', async (_req, res) => {
    const checkedAtIso = new Date().toISOString();
    const [aws, trekMars, trekMoon, usgsMarsGeo, macrostrat, nasaPower, openMeteo] =
      await Promise.all([
        probeUrl('https://s3.amazonaws.com/elevation-tiles-prod/terrarium/10/595/394.png'),
        probeUrl(
          'https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer?f=json'
        ),
        probeUrl(
          'https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer?f=json'
        ),
        probeUrl(
          'https://astrogeology.usgs.gov/pygeoapi/collections/mars/sim3292_global_geologic_map/units/items?limit=1&f=json'
        ),
        probeUrl('https://macrostrat.org/api/v2/geologic_units/map?lat=37.55&lng=29.68'),
        probeUrl(
          'https://power.larc.nasa.gov/api/temporal/climatology/point?parameters=T2M&community=RE&longitude=29.68&latitude=37.55&format=JSON'
        ),
        probeUrl(
          'https://archive-api.open-meteo.com/v1/archive?latitude=37.55&longitude=29.68&start_date=2024-01-01&end_date=2024-01-05&daily=temperature_2m_mean&timezone=UTC'
        ),
      ]);

    res.json({
      checkedAtIso,
      sources: [
        {
          id: 'aws_terrarium',
          label: 'AWS Terrain Tiles (Earth DEM)',
          status: aws.ok ? 'available' : 'unavailable',
          detail: aws.ok ? 'Direct CORS PNG Terrarium' : `HTTP ${aws.status || 'timeout'}`,
          checkedAtIso,
        },
        {
          id: 'nasa_trek_mola',
          label: 'NASA Trek HRSC+MOLA (Mars DEM)',
          status: trekMars.ok ? 'proxied' : 'unavailable',
          detail: trekMars.ok ? 'ArcGIS ImageServer GeoTIFF (/api/gis/dem)' : `HTTP ${trekMars.status || 'timeout'}`,
          checkedAtIso,
        },
        {
          id: 'nasa_trek_lola',
          label: 'NASA Trek LOLA (Moon DEM)',
          status: trekMoon.ok ? 'proxied' : 'unavailable',
          detail: trekMoon.ok ? 'ArcGIS ImageServer GeoTIFF (/api/gis/dem)' : `HTTP ${trekMoon.status || 'timeout'}`,
          checkedAtIso,
        },
        {
          id: 'usgs_sim3292',
          label: 'USGS Astrogeology Mars Geology',
          status: usgsMarsGeo.ok ? 'available' : 'unavailable',
          detail: usgsMarsGeo.ok ? 'OGC API Features SIM 3292' : `HTTP ${usgsMarsGeo.status || 'timeout'}`,
          checkedAtIso,
        },
        {
          id: 'macrostrat',
          label: 'Macrostrat Earth Geology',
          status: macrostrat.ok ? 'available' : 'unavailable',
          detail: macrostrat.ok ? 'Direct CORS v2 geologic_units' : `HTTP ${macrostrat.status || 'timeout'}`,
          checkedAtIso,
        },
        {
          id: 'nasa_power',
          label: 'NASA POWER Climate',
          status: nasaPower.ok ? 'available' : 'unavailable',
          detail: nasaPower.ok ? 'Direct CORS Climatology API' : `HTTP ${nasaPower.status || 'timeout'}`,
          checkedAtIso,
        },
        {
          id: 'open_meteo',
          label: 'Open-Meteo Archive & Geocode',
          status: openMeteo.ok ? 'available' : 'unavailable',
          detail: openMeteo.ok ? 'Direct CORS Archive JSON' : `HTTP ${openMeteo.status || 'timeout'}`,
          checkedAtIso,
        },
        {
          id: 'gemini_vision',
          label: 'Gemini Multimodal Recon',
          status: process.env.GEMINI_API_KEY ? 'proxied' : 'unavailable',
          detail: process.env.GEMINI_API_KEY
            ? 'Server-side /api/analyze-image ready'
            : 'GEMINI_API_KEY not configured',
          checkedAtIso,
        },
      ],
    });
  });

  app.get('/api/gis/dem', async (req, res) => {
    try {
      const body = String(req.query.body || '').toUpperCase();
      const proj = String(req.query.proj || '').toLowerCase();
      const mbbox = parseAndValidateMeterBbox(String(req.query.mbbox || ''));
      const bbox = parseAndValidateBbox(String(req.query.bbox || ''));
      const rawSize = Number(req.query.size || 96);
      const size = Number.isFinite(rawSize) ? Math.min(128, Math.max(24, Math.round(rawSize))) : 96;

      if (body === 'MOON' && (proj === 'stereo_south' || proj === 'stereo_north') && mbbox) {
        const [xmin, ymin, xmax, ymax] = mbbox;
        const service =
          proj === 'stereo_south' ? 'LRO_LOLA_DEM_SPole75_30mp_v04' : 'LRO_LOLA_DEM_NPole75_30mp_v04';
        const label =
          proj === 'stereo_south'
            ? 'NASA Trek LRO LOLA South Pole Stereo (30 m/px)'
            : 'NASA Trek LRO LOLA North Pole Stereo (30 m/px)';
        const exportUrl = `https://trek.nasa.gov/moon/trekarcgis/rest/services/${service}/ImageServer/exportImage?bbox=${xmin},${ymin},${xmax},${ymax}&size=${size},${size}&format=tiff&pixelType=F32&f=image`;
        const upstream = await fetch(exportUrl, { signal: AbortSignal.timeout(12000) });
        if (!upstream.ok) {
          res.status(upstream.status).json({ error: `NASA Trek returned HTTP ${upstream.status}` });
          return;
        }
        const ct = upstream.headers.get('content-type') || '';
        if (!ct.includes('tiff') && !ct.includes('octet-stream')) {
          res.status(502).json({ error: 'NASA Trek returned non-GeoTIFF payload' });
          return;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', 'image/tiff');
        res.setHeader('X-Dem-Source', label);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buf);
        return;
      }

      if (body === 'MARS' && (proj === 'stereo_south' || proj === 'stereo_north') && mbbox) {
        const [xmin, ymin, xmax, ymax] = mbbox;
        const service =
          proj === 'stereo_south'
            ? 'mola128_mola64_merge_90Nto90S_SimpleC_clon0_SP'
            : 'mola128_mola64_merge_90Nto90S_SimpleC_clon0_NP';
        const label =
          proj === 'stereo_south'
            ? 'NASA Trek MOLA South Pole Stereo (39 m/px)'
            : 'NASA Trek MOLA North Pole Stereo (39 m/px)';
        const exportUrl = `https://trek.nasa.gov/mars/trekarcgis/rest/services/${service}/ImageServer/exportImage?bbox=${xmin},${ymin},${xmax},${ymax}&size=${size},${size}&format=tiff&pixelType=F32&f=image`;
        const upstream = await fetch(exportUrl, { signal: AbortSignal.timeout(12000) });
        if (!upstream.ok) {
          res.status(upstream.status).json({ error: `NASA Trek returned HTTP ${upstream.status}` });
          return;
        }
        const ct = upstream.headers.get('content-type') || '';
        if (!ct.includes('tiff') && !ct.includes('octet-stream')) {
          res.status(502).json({ error: 'NASA Trek returned non-GeoTIFF payload' });
          return;
        }
        const buf = Buffer.from(await upstream.arrayBuffer());
        res.setHeader('Content-Type', 'image/tiff');
        res.setHeader('X-Dem-Source', label);
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(buf);
        return;
      }

      if (!bbox) {
        res.status(400).json({ error: 'Invalid bbox parameter. Expected minLon,minLat,maxLon,maxLat' });
        return;
      }

      const [minLon, minLat, maxLon, maxLat] = bbox;
      const candidates: Array<{ url: string; label: string }> = [];

      if (body === 'MARS') {
        candidates.push(
          {
            url: 'https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_MOLA_blend200ppx_HRSC_DEM_clon0dd_200mpp_lzw/ImageServer',
            label: 'NASA Trek HRSC+MOLA (200 m/px blend)',
          },
          {
            url: 'https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer',
            label: 'NASA Trek MOLA (463 m/px global blend)',
          }
        );
      } else if (body === 'MOON') {
        if (maxLat <= -75) {
          candidates.push({
            url: 'https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_SPole75_30mp_v04_EQ/ImageServer',
            label: 'NASA Trek LRO LOLA South Pole (30 m/px)',
          });
        } else if (minLat >= 75) {
          candidates.push({
            url: 'https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_NPole75_30mp_v04_EQ/ImageServer',
            label: 'NASA Trek LRO LOLA North Pole (30 m/px)',
          });
        }
        candidates.push({
          url: 'https://trek.nasa.gov/moon/trekarcgis/rest/services/LRO_LOLA_DEM_Global_256ppd_v06/ImageServer',
          label: 'NASA Trek LRO LOLA (256 ppd global)',
        });
      } else {
        res.status(400).json({ error: 'DEM proxy supports MARS or MOON bodies.' });
        return;
      }

      let lastError = 'DEM endpoint unavailable';
      for (const candidate of candidates) {
        try {
          const exportUrl = `${candidate.url}/exportImage?bbox=${minLon},${minLat},${maxLon},${maxLat}&bboxSR=4326&size=${size},${size}&format=tiff&pixelType=F32&f=image`;
          const upstream = await fetch(exportUrl, { signal: AbortSignal.timeout(12000) });
          if (!upstream.ok) {
            lastError = `NASA Trek returned HTTP ${upstream.status}`;
            continue;
          }
          const ct = upstream.headers.get('content-type') || '';
          if (!ct.includes('tiff') && !ct.includes('octet-stream')) {
            lastError = 'NASA Trek returned non-GeoTIFF payload';
            continue;
          }
          const buf = Buffer.from(await upstream.arrayBuffer());
          res.setHeader('Content-Type', 'image/tiff');
          res.setHeader('X-Dem-Source', candidate.label);
          res.setHeader('Cache-Control', 'public, max-age=86400');
          res.send(buf);
          return;
        } catch (err) {
          lastError = err instanceof Error ? err.message : 'Upstream fetch error';
        }
      }

      res.status(502).json({ error: lastError });
    } catch {
      res.status(502).json({ error: 'Failed to proxy NASA Trek DEM' });
    }
  });

  app.get('/api/gis/imagery', async (req, res) => {
    try {
      const body = String(req.query.body || '').toUpperCase();
      const proj = String(req.query.proj || '').toLowerCase();
      const mbbox = parseAndValidateMeterBbox(String(req.query.mbbox || ''));
      const bbox = parseAndValidateBbox(String(req.query.bbox || ''));
      const rawSize = Number(req.query.size || 1024);
      const size = Number.isFinite(rawSize) ? Math.min(2048, Math.max(256, Math.round(rawSize))) : 1024;
      const requestedSr = String(req.query.sr || '3857') === '4326' ? '4326' : '3857';

      let exportUrl = '';
      let sourceLabel = '';

      if (body === 'MOON' && (proj === 'stereo_south' || proj === 'stereo_north') && mbbox) {
        const [xmin, ymin, xmax, ymax] = mbbox;
        const service =
          proj === 'stereo_south' ? 'LRO_WAC_Mosaic_SPole60_100m_v02' : 'LRO_WAC_Mosaic_NPole60_100m_v02';
        exportUrl = `https://trek.nasa.gov/moon/trekarcgis/rest/services/${service}/ImageServer/exportImage?bbox=${xmin},${ymin},${xmax},${ymax}&size=${size},${size}&format=png&f=image`;
        sourceLabel = 'NASA Trek LRO WAC Polar Stereographic (100 m)';
      } else if (body === 'MARS' && (proj === 'stereo_south' || proj === 'stereo_north') && mbbox) {
        const [xmin, ymin, xmax, ymax] = mbbox;
        const service =
          proj === 'stereo_south'
            ? 'Mars_Viking_MDIM21_ClrMosaic_global_232m_sp'
            : 'Mars_Viking_MDIM21_ClrMosaic_global_232m_np';
        exportUrl = `https://trek.nasa.gov/mars/trekarcgis/rest/services/${service}/ImageServer/exportImage?bbox=${xmin},${ymin},${xmax},${ymax}&size=${size},${size}&format=png&f=image`;
        sourceLabel = 'NASA Trek Viking Polar Stereographic (232 m)';
      } else if (body === 'EARTH' && (proj === 'epsg3031' || proj === 'epsg3413') && mbbox) {
        const [xmin, ymin, xmax, ymax] = mbbox;
        const sr = proj === 'epsg3031' ? '3031' : '3413';
        exportUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${xmin},${ymin},${xmax},${ymax}&bboxSR=${sr}&imageSR=${sr}&size=${size},${size}&format=png&f=image`;
        sourceLabel = `Esri World Imagery (EPSG:${sr})`;
      } else {
        if (!bbox) {
          res.status(400).json({ error: 'Invalid bbox parameter. Expected minLon,minLat,maxLon,maxLat' });
          return;
        }

        const [minLon, minLat, maxLon, maxLat] = bbox;
        const safeSr = minLat < -82 || maxLat > 82 ? '4326' : requestedSr;

        if (body === 'MARS') {
          exportUrl = `https://trek.nasa.gov/mars/trekarcgis/rest/services/Mars_Viking_MDIM21_ClrMosaic_global_232m/ImageServer/exportImage?bbox=${minLon},${minLat},${maxLon},${maxLat}&bboxSR=4326&imageSR=${safeSr}&size=${size},${size}&format=png&f=image`;
          sourceLabel = 'NASA Trek Viking MDIM 2.1 (232 m/px)';
        } else if (body === 'MOON') {
          const service =
            maxLat <= -60
              ? 'LRO_WAC_Mosaic_SPole60_100m_v02'
              : minLat >= 60
                ? 'LRO_WAC_Mosaic_NPole60_100m_v02'
                : 'LRO_WAC_Mosaic_Global_303ppd_v02';
          exportUrl = `https://trek.nasa.gov/moon/trekarcgis/rest/services/${service}/ImageServer/exportImage?bbox=${minLon},${minLat},${maxLon},${maxLat}&bboxSR=4326&imageSR=${safeSr}&size=${size},${size}&format=png&f=image`;
          sourceLabel =
            service === 'LRO_WAC_Mosaic_Global_303ppd_v02'
              ? 'NASA Trek LRO WAC Global Mosaic (100 m)'
              : 'NASA Trek LRO WAC Polar Mosaic (100 m)';
        } else if (body === 'EARTH') {
          exportUrl = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${minLon},${minLat},${maxLon},${maxLat}&bboxSR=4326&imageSR=${safeSr}&size=${size},${size}&format=png&f=image`;
          sourceLabel = 'Esri World Imagery';
        } else {
          res.status(400).json({ error: 'Imagery proxy supports MARS, MOON, or EARTH.' });
          return;
        }
      }

      const upstream = await fetch(exportUrl, { signal: AbortSignal.timeout(14000) });
      if (!upstream.ok) {
        res.status(upstream.status).json({ error: `Imagery service returned HTTP ${upstream.status}` });
        return;
      }

      const ct = upstream.headers.get('content-type') || '';
      if (!ct.includes('image/')) {
        res.status(502).json({ error: 'Imagery upstream returned non-image response' });
        return;
      }

      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader('Content-Type', ct.split(';')[0] || 'image/png');
      res.setHeader('X-Imagery-Source', sourceLabel);
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cache-Control', 'public, max-age=86400');
      res.send(buf);
    } catch {
      res.status(502).json({ error: 'Surface imagery unavailable' });
    }
  });

  app.get('/api/gis/nomenclature', async (req, res) => {
    try {
      const q = String(req.query.q || '').trim();
      const body = String(req.query.body || 'ALL').toUpperCase();
      if (q.length < 2) {
        res.json({ results: [] });
        return;
      }

      interface NomItem {
        id: string;
        name: string;
        body: 'MARS' | 'MOON' | 'EARTH';
        featureType: string;
        lat: number;
        lon: number;
        source: string;
      }

      const parsePoint = (shape?: string): { lat: number; lon: number } | null => {
        if (!shape) return null;
        const m = shape.match(/POINT\s*\(\s*([-+]?\d*\.?\d+)\s+([-+]?\d*\.?\d+)\s*\)/i);
        if (!m) return null;
        const lon = Number(m[1]);
        const lat = Number(m[2]);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return { lat, lon };
      };

      const tasks: Array<Promise<NomItem[]>> = [];

      if (body === 'ALL' || body === 'MARS') {
        tasks.push(
          (async () => {
            const url = `https://trek.nasa.gov/mars/TrekServices/ws/index/eq/searchItems?key=${encodeURIComponent(
              q
            )}&facetKeys=itemType&facetValues=nomenclature&rows=8`;
            const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
            if (!r.ok) return [];
            const data = (await r.json()) as {
              response?: {
                docs?: Array<{
                  item_DBID?: string;
                  title?: string;
                  productLabel?: string;
                  productCat2?: string;
                  shape?: string;
                }>;
              };
            };
            const out: NomItem[] = [];
            for (const d of data.response?.docs ?? []) {
              const pt = parsePoint(d.shape);
              if (!pt) continue;
              out.push({
                id: `mars-${d.item_DBID ?? d.title}`,
                name: d.title || d.productLabel || q,
                body: 'MARS',
                featureType: d.productCat2 || 'Planetary feature',
                lat: pt.lat,
                lon: pt.lon > 180 ? pt.lon - 360 : pt.lon,
                source: 'USGS Gazetteer / NASA Trek',
              });
            }
            return out;
          })().catch(() => [])
        );
      }

      if (body === 'ALL' || body === 'MOON') {
        tasks.push(
          (async () => {
            const url = `https://trek.nasa.gov/moon/TrekServices/ws/index/eq/searchItems?key=${encodeURIComponent(
              q
            )}&facetKeys=itemType&facetValues=nomenclature&rows=8`;
            const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
            if (!r.ok) return [];
            const data = (await r.json()) as {
              response?: {
                docs?: Array<{
                  item_DBID?: string;
                  title?: string;
                  productLabel?: string;
                  productType?: string;
                  shape?: string;
                }>;
              };
            };
            const out: NomItem[] = [];
            for (const d of data.response?.docs ?? []) {
              const pt = parsePoint(d.shape);
              if (!pt) continue;
              out.push({
                id: `moon-${d.item_DBID ?? d.title}`,
                name: d.title || d.productLabel || q,
                body: 'MOON',
                featureType: d.productType || 'Lunar feature',
                lat: pt.lat,
                lon: pt.lon > 180 ? pt.lon - 360 : pt.lon,
                source: 'USGS Gazetteer / NASA Trek',
              });
            }
            return out;
          })().catch(() => [])
        );
      }

      if (body === 'ALL' || body === 'EARTH') {
        tasks.push(
          (async () => {
            const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
              q
            )}&count=6&language=en&format=json`;
            const r = await fetch(url, { signal: AbortSignal.timeout(7000) });
            if (!r.ok) return [];
            const data = (await r.json()) as {
              results?: Array<{
                id: number;
                name: string;
                country?: string;
                feature_code?: string;
                latitude: number;
                longitude: number;
              }>;
            };
            return (data.results ?? []).map((item) => ({
              id: `earth-${item.id}`,
              name: item.country ? `${item.name}, ${item.country}` : item.name,
              body: 'EARTH' as const,
              featureType: item.feature_code || 'Terrestrial location',
              lat: item.latitude,
              lon: item.longitude,
              source: 'Open-Meteo / GeoNames',
            }));
          })().catch(() => [])
        );
      }

      const nested = await Promise.all(tasks);
      res.json({ results: nested.flat().slice(0, 15) });
    } catch (err) {
      res.status(502).json({
        results: [],
        error: err instanceof Error ? err.message : 'Nomenclature lookup failed',
      });
    }
  });

  app.post('/api/analyze-image', async (req, res) => {
    try {
      const payload = req.body as Partial<ImageAnalyzePayload>;
      if (!payload.imageBase64 || !payload.mimeType) {
        res.status(400).json({ error: 'Missing imageBase64 or mimeType.' });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(503).json({
          error:
            'GEMINI_API_KEY is not configured on the server. Add it in Settings > Secrets to analyze surface imagery.',
        });
        return;
      }

      const ai = getGeminiClient();
      const base64Clean = payload.imageBase64.replace(/^data:image\/[a-zA-Z+.-]+;base64,/, '');

      const prompt = [
        `Analyze this planetary or terrestrial surface image (${payload.bodyHint || 'UNKNOWN BODY'}) for terrain analog matching.`,
        `Identify the dominant geomorphology (choose or describe clearly: e.g., impact crater, river delta, basaltic lava flow, dune field, glacial valley, evaporite playa, canyon escarpment).`,
        `Estimate surface texture, probable lithology/geologic unit, approximate mean slope (degrees 0-45), and approximate local relief (meters).`,
        `Be conservative and honest about uncertainty in confidencePct (0-100).`,
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              {
                inlineData: {
                  mimeType: payload.mimeType,
                  data: base64Clean,
                },
              },
            ],
          },
        ],
        config: {
          systemInstruction:
            'You are a planetary geomorphologist estimating terrain properties from a single uncalibrated image. Never claim exact orbital telemetry precision.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              morphology: {
                type: Type.STRING,
                description: 'Dominant landform type (e.g. crater, delta, lava flow, dune field, glacial valley).',
              },
              surfaceTexture: {
                type: Type.STRING,
                description: 'Brief description of roughness, boulder cover, dust, or regolith texture.',
              },
              probableGeology: {
                type: Type.STRING,
                description: 'Probable rock/sediment type (e.g. tholeiitic basalt, lacustrine carbonate, sulfate evaporite).',
              },
              estimatedMeanSlopeDeg: {
                type: Type.NUMBER,
                description: 'Estimated mean terrain slope in degrees (0 to 45).',
              },
              estimatedReliefM: {
                type: Type.NUMBER,
                description: 'Estimated local elevation relief in meters across the visible scene.',
              },
              confidencePct: {
                type: Type.NUMBER,
                description: 'Confidence score 0-100 reflecting visual ambiguity without scale bar.',
              },
              notes: {
                type: Type.STRING,
                description: 'One-sentence geomorphological rationale and caveats.',
              },
            },
            required: [
              'morphology',
              'surfaceTexture',
              'probableGeology',
              'estimatedMeanSlopeDeg',
              'estimatedReliefM',
              'confidencePct',
              'notes',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Empty response from Gemini multimodal analyzer.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({
        ...parsed,
        sourceTag: 'estimated from image',
        analyzedAtIso: new Date().toISOString(),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Image analysis failed.';
      console.error('[POST /api/analyze-image]', msg);
      res.status(500).json({ error: msg });
    }
  });

  app.post('/api/dossier/generate', async (req, res) => {
    try {
      const payload = req.body as Partial<DossierGeneratePayload>;
      if (!payload || !payload.targetName || !payload.analogName) {
        res.status(400).json({
          error: 'Missing required targetName or analogName fields for dossier generation.',
        });
        return;
      }

      if (!process.env.GEMINI_API_KEY) {
        res.status(503).json({
          error:
            'GEMINI_API_KEY is not configured in the server environment. Configure it in Settings > Secrets to enable automated Technical Memorandum drafting.',
        });
        return;
      }

      const ai = getGeminiClient();

      const prompt = [
        `Draft structured sections for a NASA-style Field Suitability Dossier (Technical Memorandum) pairing a planetary landing/traverse target with a terrestrial field analog.`,
        `Target Site: ${payload.targetName} (${payload.targetBody ?? 'PLANETARY'}) at ${payload.targetCoords ?? 'N/A'} | DEM: ${payload.targetDemSource ?? 'Unavailable'} | Lithology: ${payload.targetLithology ?? 'Unavailable'}`,
        `Earth Analog: ${payload.analogName} (${payload.analogCountry ?? ''}) at ${payload.analogCoords ?? 'N/A'} | Lithology: ${payload.analogLithology ?? 'Unavailable'}`,
        `Quantitative Parity: Weighted Similarity ${Number(payload.similarityScorePct ?? 0).toFixed(1)}% | Transect RMSE ${Number(payload.rmseM ?? 0).toFixed(1)} m | Pearson r = ${Number(payload.pearsonR ?? 0).toFixed(3)}`,
        `Mission Program: ${payload.missionProgram ?? 'Planetary Surface Analog Campaign'}`,
        `Mission Objectives: ${payload.missionObjectives || 'Validate rover trafficability, sampling tools, and spectral calibration.'}`,
        `Mobility & Hazard Constraints: ${payload.mobilityConstraint || 'Slope stability, regolith traction, thermal cycling.'}`,
        `Science Priorities: ${payload.sciencePriorities || 'Mineralogical parity and biosignature/volatile sampling.'}`,
      ].join('\n');

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction:
            'You are a NASA planetary geology and surface operations mission systems engineer writing a concise, rigorous Technical Memorandum. Cite only metrics provided in the prompt, never invent papers or DOIs, avoid hype, and keep each section 70-120 words.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              executiveSummary: { type: Type.STRING },
              siteRationale: { type: Type.STRING },
              terrainHazardAssessment: { type: Type.STRING },
              instrumentTestPlan: { type: Type.STRING },
              operationalRecommendation: { type: Type.STRING },
            },
            required: [
              'executiveSummary',
              'siteRationale',
              'terrainHazardAssessment',
              'instrumentTestPlan',
              'operationalRecommendation',
            ],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        res.status(502).json({ error: 'Empty response received from Gemini generation service.' });
        return;
      }

      const parsed = JSON.parse(rawText);
      res.json({
        generatedAtUtc: new Date().toISOString(),
        model: 'gemini-4-hydrogen',
        sections: parsed,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error generating dossier content.';
      console.error('[POST /api/dossier/generate]', message);
      res.status(500).json({ error: message });
    }
  });

  if (!isProduction) {
    import('vite').then(async ({ createServer: createViteServer }) => {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    });
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      const indexFile = path.join(distDir, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        res.status(404).send('Production build not found. Run npm run build first.');
      }
    });
  }

  if (!process.env.VERCEL) {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`TERRA-ANALOG server listening on http://0.0.0.0:${PORT}`);
    });
  }

export default app;

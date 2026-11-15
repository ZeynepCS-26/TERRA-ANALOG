import assert from 'node:assert/strict';
import test from 'node:test';
import {
  formatConsistentScorePct,
  formatSiteCleanFullName,
} from '../formatSite';
import type { SiteRecord } from '../../types/site';
import {
  classifyScoreConfidence,
  computeEqualScaleZoom,
  computeNiceScaleBar,
  getPolarMeterBbox,
  isPolarMoonSite,
  latLonToPolarMeters,
  metersPerPxAtZoom,
  polarMetersToLatLon,
  summarizeMatchDrivers,
  validateImagePixelBuffer,
} from './dualMapMath';
import type { ParameterEvaluation } from '../similarity/similarityEngine';

test('latLonToPolarMeters and polarMetersToLatLon round-trip near South Pole (Shackleton)', () => {
  const pt = latLonToPolarMeters(-89.65, 12.5, 'MOON');
  assert.equal(pt.pole, 'south');
  assert.ok(Math.hypot(pt.x, pt.y) > 9500 && Math.hypot(pt.x, pt.y) < 12000);
  const back = polarMetersToLatLon(pt.x, pt.y, pt.pole, 'MOON');
  assert.ok(Math.abs(back.lat - -89.65) < 1e-4);
  assert.ok(Math.abs(back.lon - 12.5) < 1e-3);

  const bbox = getPolarMeterBbox(-89.65, 0, 10, 'MOON');
  assert.equal(bbox.maxX - bbox.minX, 20000);
  assert.equal(bbox.maxY - bbox.minY, 20000);
  assert.equal(isPolarMoonSite('MOON', -89.65), true);
  assert.equal(isPolarMoonSite('MARS', -89.65), false);
});

test('computeEqualScaleZoom produces identical physical meters/px across Mars and Earth with >=70% ROI fill', () => {
  const marsFit = computeEqualScaleZoom({
    body: 'MARS',
    lat: 18.38,
    roiSpanKm: 20,
    paneWidthPx: 680,
    paneHeightPx: 720,
    paddingFraction: 0.08,
  });
  const earthFit = computeEqualScaleZoom({
    body: 'EARTH',
    lat: 37.55,
    roiSpanKm: 20,
    paneWidthPx: 680,
    paneHeightPx: 720,
    paddingFraction: 0.08,
  });

  const marsMPerPx = metersPerPxAtZoom('MARS', 18.38, marsFit.zoom);
  const earthMPerPx = metersPerPxAtZoom('EARTH', 37.55, earthFit.zoom);
  assert.ok(Math.abs(marsMPerPx - earthMPerPx) / earthMPerPx < 0.005);

  const roiSpanPx = 20000 / marsMPerPx;
  const fillFraction = roiSpanPx / 680;
  assert.ok(fillFraction >= 0.7 && fillFraction <= 0.9);
});

test('computeNiceScaleBar picks clean km steps matching viewport scale', () => {
  const bar = computeNiceScaleBar(50, 80); // 4 km ~ 80px -> picks 5 km
  assert.equal(bar.km, 5);
  assert.equal(bar.label, '5 km');
  assert.ok(bar.widthPx >= 36 && bar.widthPx <= 132);
});

test('formatSiteCleanFullName strips parenthetical sub-labels while formatConsistentScorePct keeps 1 decimal', () => {
  const site = {
    id: 'dry_valleys',
    name: 'McMurdo Dry Valleys (Beacon Valley), Antarctica',
    body: 'EARTH',
    country: 'Antarctica',
    lat: -77.83,
    lon: 160.65,
    radiusKm: 10,
    spanDeg: 0.18,
    bounds: { minLat: -77.9, maxLat: -77.7, minLon: 160.5, maxLon: 160.8 },
    ingestMethod: 'catalog',
    notes: '',
    createdAtIso: '',
    updatedAtIso: '',
    demStatus: 'idle',
    demError: null,
    demGrid: null,
    features: null,
    climate: null,
    geology: null,
    geminiEstimate: null,
    crewOverrides: null,
  } as SiteRecord;

  assert.equal(formatSiteCleanFullName(site), 'McMurdo Dry Valleys, Antarctica');
  assert.equal(formatConsistentScorePct(62), '62.0%');
  assert.equal(formatConsistentScorePct(47.64), '47.6%');
});

test('classifyScoreConfidence and summarizeMatchDrivers classify thresholds and strongest/weakest parameters', () => {
  const low = classifyScoreConfidence(62.4, 6, 7);
  assert.equal(low.label, 'Low match');
  assert.equal(low.isLow, true);
  assert.equal(low.paramSummary, '6 of 7 parameters');

  const mod = classifyScoreConfidence(78.0, 7, 7);
  assert.equal(mod.label, 'Moderate');
  assert.equal(mod.isLow, false);

  const strong = classifyScoreConfidence(91.2, 7, 7);
  assert.equal(strong.label, 'Strong');

  const insuff = classifyScoreConfidence(null, 2, 7, 'INSUFFICIENT-DATA');
  assert.equal(insuff.label, 'Insufficient data');
  assert.equal(insuff.isLow, true);

  const params: ParameterEvaluation[] = [
    {
      key: 'slope',
      label: 'Slope distribution',
      available: true,
      scorePct: 92,
      rawWeightPct: 20,
      effectiveWeightPct: 25,
      tag: 'measured',
      targetValueLabel: '8°',
      analogValueLabel: '8.4°',
      targetSource: 'DEM',
      analogSource: 'DEM',
    },
    {
      key: 'relief',
      label: 'Elevation relief',
      available: true,
      scorePct: 86,
      rawWeightPct: 15,
      effectiveWeightPct: 25,
      tag: 'measured',
      targetValueLabel: '800 m',
      analogValueLabel: '760 m',
      targetSource: 'DEM',
      analogSource: 'DEM',
    },
    {
      key: 'thermal',
      label: 'Thermal envelope',
      available: true,
      scorePct: 31,
      rawWeightPct: 15,
      effectiveWeightPct: 25,
      tag: 'measured',
      targetValueLabel: '-60°C',
      analogValueLabel: '15°C',
      targetSource: 'MCD',
      analogSource: 'POWER',
    },
  ];

  const drivers = summarizeMatchDrivers(params);
  assert.equal(drivers.line, 'Strong: slope, relief · Weak: temperature');
});

test('validateImagePixelBuffer rejects flat/blank and 1D-streaked tiles while accepting 2D mosaics', () => {
  const w = 16;
  const h = 16;
  const flat = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    flat[i * 4] = 80;
    flat[i * 4 + 1] = 80;
    flat[i * 4 + 2] = 80;
    flat[i * 4 + 3] = 255;
  }
  assert.equal(validateImagePixelBuffer(flat, w, h).valid, false);

  const streaked1D = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const val = (y * 16) % 255;
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      streaked1D[idx] = val;
      streaked1D[idx + 1] = val;
      streaked1D[idx + 2] = val;
      streaked1D[idx + 3] = 255;
    }
  }
  assert.equal(validateImagePixelBuffer(streaked1D, w, h).valid, false);

  const valid2D = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const val = (x * 9 + y * 7) % 255;
      valid2D[idx] = val;
      valid2D[idx + 1] = val;
      valid2D[idx + 2] = val;
      valid2D[idx + 3] = 255;
    }
  }
  assert.equal(validateImagePixelBuffer(valid2D, w, h).valid, true);
});

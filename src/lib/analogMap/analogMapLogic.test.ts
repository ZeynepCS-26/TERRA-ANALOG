import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmptySiteRecord, EARTH_ANALOG_CATALOG, INITIAL_TARGET_SEEDS } from '../../data/candidates';
import type { SiteRecord } from '../../types/site';
import {
  clampTooltipPosition,
  computeBubbleRadius,
  getBestTargetForAnalog,
  getNextAnalogId,
  getOrderedAnalogIds,
} from './analogMapLogic';

test('getBestTargetForAnalog returns null score when features are uncomputed, and ranks cleanly once extracted', () => {
  const targets: SiteRecord[] = INITIAL_TARGET_SEEDS.map((t) =>
    buildEmptySiteRecord({
      id: t.id,
      name: t.name,
      body: t.body,
      lat: t.lat,
      lon: t.lon,
      radiusKm: t.radiusKm,
      ingestMethod: 'seed',
    })
  );
  const salda = buildEmptySiteRecord({
    id: 'salda_lake',
    name: 'Salda Lake, Turkey',
    body: 'EARTH',
    lat: 37.55,
    lon: 29.68,
    radiusKm: 10,
    ingestMethod: 'catalog',
  });

  const uncomputed = getBestTargetForAnalog(salda, targets);
  assert.equal(uncomputed.scorePct, null);

  targets[0].features = {
    minElevM: -2600,
    maxElevM: -1900,
    meanElevM: -2300,
    reliefM: 700,
    slopeMeanDeg: 11,
    slopeMedianDeg: 10,
    slopeP95Deg: 20,
    slopeMaxDeg: 25,
    slopeHistogram: [20, 35, 25, 10, 5, 3, 2, 0],
    elevationStdDevM: 120,
    triMeanM: 15,
    aspectHistogram: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5],
    basinRatioPct: 30,
    provenance: { source: 'MOLA', tag: 'measured', resolutionMPerPx: 463 },
  };
  salda.features = {
    minElevM: 1140,
    maxElevM: 1840,
    meanElevM: 1400,
    reliefM: 700,
    slopeMeanDeg: 11.2,
    slopeMedianDeg: 10,
    slopeP95Deg: 20,
    slopeMaxDeg: 25,
    slopeHistogram: [20, 34, 26, 10, 5, 3, 2, 0],
    elevationStdDevM: 122,
    triMeanM: 15.1,
    aspectHistogram: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5],
    basinRatioPct: 31,
    provenance: { source: 'AWS Terrain', tag: 'measured', resolutionMPerPx: 150 },
  };

  const matched = getBestTargetForAnalog(salda, targets);
  assert.equal(matched.bestTarget.id, 'jezero');
  assert.ok(matched.scorePct !== null && matched.scorePct > 90);
});

test('computeBubbleRadius scales monotonically and handles null scores cleanly', () => {
  assert.equal(computeBubbleRadius(null, 55, 98, 7, 21), 7);
  const small = computeBubbleRadius(65, 55, 98, 7, 21);
  const large = computeBubbleRadius(96.4, 55, 98, 7, 21);
  assert.ok(large > small);
  assert.ok(small >= 7 && large <= 21);
});

test('getOrderedAnalogIds sorts West-to-East and wraps cleanly with Arrow navigation', () => {
  const analogs = EARTH_ANALOG_CATALOG.slice(0, 8).map((c) =>
    buildEmptySiteRecord({
      id: c.id,
      name: c.name,
      body: 'EARTH',
      lat: c.lat,
      lon: c.lon,
      radiusKm: c.radiusKm,
      ingestMethod: 'catalog',
    })
  );
  const ordered = getOrderedAnalogIds(analogs);
  assert.equal(ordered.length, 8);
  assert.equal(ordered[0], 'mauna_kea'); // -155.47 deg W
  assert.equal(getNextAnalogId(ordered, null, 1), ordered[0]);
  assert.equal(getNextAnalogId(ordered, ordered[0], -1), ordered[ordered.length - 1]);
  assert.equal(getNextAnalogId(ordered, ordered[ordered.length - 1], 1), ordered[0]);
});

test('clampTooltipPosition prevents clipping past right or bottom viewport boundaries', () => {
  const nearRight = clampTooltipPosition(1410, 450, 1440, 900, 290, 68, 18);
  assert.ok(nearRight.left + 290 <= 1440 - 16);
  const nearBottom = clampTooltipPosition(400, 890, 1440, 900, 290, 68, 18);
  assert.ok(nearBottom.top + 68 <= 900 - 16);
});

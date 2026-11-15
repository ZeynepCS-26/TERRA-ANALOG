import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmptySiteRecord } from '../../data/candidates';
import { DEFAULT_SIMILARITY_WEIGHTS, DEFAULT_TELEMETRY_FILTERS } from '../../types/site';
import { parseProjectBundle, serializeProjectBundle } from './projectExport';

test('serializeProjectBundle and parseProjectBundle round-trip sites and notes cleanly', () => {
  const siteA = buildEmptySiteRecord({
    id: 'jezero',
    name: 'Jezero Crater, Mars',
    body: 'MARS',
    lat: 18.38,
    lon: 77.58,
    radiusKm: 12,
    ingestMethod: 'seed',
    notes: 'Field priority sector',
  });
  const siteB = buildEmptySiteRecord({
    id: 'salda_lake',
    name: 'Salda Lake, Turkey',
    body: 'EARTH',
    lat: 37.55,
    lon: 29.68,
    radiusKm: 10,
    ingestMethod: 'catalog',
  });

  const json = serializeProjectBundle({
    sites: [siteA, siteB],
    activeTargetId: 'jezero',
    activeAnalogId: 'salda_lake',
    weights: DEFAULT_SIMILARITY_WEIGHTS,
    filters: DEFAULT_TELEMETRY_FILTERS,
  });

  const restored = parseProjectBundle(json);
  assert.equal(restored.sites.length, 2);
  assert.equal(restored.sites[0].notes, 'Field priority sector');
  assert.equal(restored.activeTargetId, 'jezero');
  assert.equal(restored.activeAnalogId, 'salda_lake');
});

test('parseProjectBundle rejects malformed schema cleanly', () => {
  assert.throws(() => parseProjectBundle('{"schemaVersion":"bad"}'), /Unsupported project schema/);
});

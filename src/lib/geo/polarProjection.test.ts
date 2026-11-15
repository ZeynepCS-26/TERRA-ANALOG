import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getCentered20KmGeoBounds,
  getMetricWindowBbox,
  localMetricOffsetToGeo,
  projectGeoToMeters,
  selectSiteProjection,
  unprojectMetersToGeo,
} from './polarProjection';

test('selectSiteProjection auto-switches all bodies >80° to Polar Stereographic and keeps <=80° on Web Mercator', () => {
  const moonSouth = selectSiteProjection('MOON', -89.65);
  assert.equal(moonSouth.isPolar, true);
  assert.equal(moonSouth.supported, true);
  assert.equal(moonSouth.id, 'MOON_SPOLE');
  assert.equal(moonSouth.label, 'Polar stereographic, Moon 2000');

  const marsSouth = selectSiteProjection('MARS', -85.2);
  assert.equal(marsSouth.isPolar, true);
  assert.equal(marsSouth.supported, true);
  assert.equal(marsSouth.id, 'MARS_SPOLE');
  assert.equal(marsSouth.label, 'Polar stereographic, Mars 2000');

  const earthAntarctic = selectSiteProjection('EARTH', -82.5);
  assert.equal(earthAntarctic.isPolar, true);
  assert.equal(earthAntarctic.supported, true);
  assert.equal(earthAntarctic.id, 'EPSG:3031');
  assert.equal(earthAntarctic.label, 'Polar stereographic, EPSG:3031');

  const earthArctic = selectSiteProjection('EARTH', 81.4);
  assert.equal(earthArctic.isPolar, true);
  assert.equal(earthArctic.supported, true);
  assert.equal(earthArctic.id, 'EPSG:3413');
  assert.equal(earthArctic.label, 'Polar stereographic, EPSG:3413');

  const midLat = selectSiteProjection('MARS', 18.38);
  assert.equal(midLat.isPolar, false);
  assert.equal(midLat.supported, true);
  assert.equal(midLat.id, 'EPSG:3857');

  const invalid = selectSiteProjection('EARTH', -95);
  assert.equal(invalid.supported, false);
  assert.equal(invalid.id, 'UNSUPPORTED');
  assert.equal(invalid.label, 'Polar region, projection unavailable');
});

test('proj4 polar stereographic forward/inverse transforms round-trip accurately for Moon, Mars, EPSG:3031, EPSG:3413', () => {
  const cases = [
    { id: 'MOON_SPOLE' as const, lat: -89.65, lon: 12.5, variant: 'imagery' as const },
    { id: 'MARS_SPOLE' as const, lat: -85.0, lon: 45.0, variant: 'dem' as const },
    { id: 'EPSG:3031' as const, lat: -82.5, lon: 15.0, variant: 'imagery' as const },
    { id: 'EPSG:3413' as const, lat: 82.0, lon: -32.0, variant: 'imagery' as const },
  ];

  for (const c of cases) {
    const m = projectGeoToMeters(c.id, c.lat, c.lon, c.variant);
    assert.ok(Number.isFinite(m.x) && Number.isFinite(m.y));
    const back = unprojectMetersToGeo(c.id, m.x, m.y, c.variant);
    assert.ok(Math.abs(back.lat - c.lat) < 1e-4, `lat mismatch for ${c.id}: ${back.lat} vs ${c.lat}`);
    assert.ok(Math.abs(back.lon - c.lon) < 1e-3, `lon mismatch for ${c.id}: ${back.lon} vs ${c.lon}`);
  }
});

test('getMetricWindowBbox produces centered 20x20 km square metric extents', () => {
  const win = getMetricWindowBbox('MOON', -89.65, 0, 10, 'dem');
  assert.equal(win.maxX - win.minX, 20000);
  assert.equal(win.maxY - win.minY, 20000);

  const offset = localMetricOffsetToGeo('EARTH', -82.5, 15.0, 5000, -5000, 'dem');
  assert.ok(offset.lat < -82.5 && offset.lon > 15.0);

  const bounds = getCentered20KmGeoBounds('MARS', -85.0, 45.0, 10);
  assert.ok(bounds.maxLat > -85.0 && bounds.minLat < -85.0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeHillshadeAtUV,
  computePercentilesP2P98,
  computeRealTransectProfile,
  decodeTerrariumPixel,
  detectDegenerateDem,
  extractTerrainFeatures,
  generateDemNormalMapRgba,
  sampleElevationAtUV,
  sampleElevationAtUVStrict,
} from './terrainExtractor';
import { parseScreenFromLocation, screenToHash } from '../routing/hashRoute';
import { evaluateColormapRGB } from '../elevation/colormaps';

test('decodeTerrariumPixel converts RGB to meters accurately', () => {
  assert.equal(decodeTerrariumPixel(128, 0, 0), 0);
  assert.equal(decodeTerrariumPixel(132, 116, 0), 1140);
});

test('extractTerrainFeatures computes flat plane zero slope and zero TRI', () => {
  const w = 10;
  const h = 10;
  const flat = new Array<number>(w * h).fill(500);
  const feats = extractTerrainFeatures(flat, w, h, 30, 'Test Flat DEM', '2026-01-01T00:00:00Z');
  assert.equal(feats.minElevM, 500);
  assert.equal(feats.maxElevM, 500);
  assert.equal(feats.reliefM, 0);
  assert.equal(feats.slopeMeanDeg, 0);
  assert.equal(feats.triMeanM, 0);
  assert.equal(feats.provenance.source, 'Test Flat DEM');
  assert.equal(feats.provenance.tag, 'measured');
});

test('extractTerrainFeatures computes exact ramp slope ~ 45 deg when dz/dx = 1', () => {
  const w = 12;
  const h = 12;
  const cellM = 10;
  const grid: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      grid.push(x * cellM);
    }
  }
  const feats = extractTerrainFeatures(grid, w, h, cellM, 'Ramp DEM', '2026-01-01T00:00:00Z');
  assert.ok(Math.abs(feats.slopeMeanDeg - 45) < 0.1, `Expected ~45 deg slope, got ${feats.slopeMeanDeg}`);
  assert.equal(feats.reliefM, 110);
  assert.ok(feats.triMeanM > 5, 'Expected positive TRI on sloped ramp');
  const histSum = feats.slopeHistogram.reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(histSum - 100) < 0.2);
});

test('sampleElevationAtUVStrict returns null outside [0, 1] and bilinearly interpolates inside', () => {
  const dem = {
    width: 4,
    height: 4,
    elevations: [
      0, 10, 20, 30,
      0, 10, 20, 30,
      0, 10, 20, 30,
      0, 10, 20, 30,
    ],
    bounds: { minLon: 0, maxLon: 1, minLat: 0, maxLat: 1 },
    resolutionMPerPx: 100,
    source: 'UnitGrid',
    fetchedAtIso: '2026-01-01T00:00:00Z',
  };
  assert.equal(sampleElevationAtUVStrict(dem, -0.05, 0.5), null);
  assert.equal(sampleElevationAtUVStrict(dem, 1.02, 0.5), null);
  assert.equal(sampleElevationAtUVStrict(dem, 0.5, 0.5), 15);
  assert.equal(sampleElevationAtUV(dem, 0.5, 0.5), 15);

  const missingTransect = computeRealTransectProfile(dem, null, 10, { u: 0, v: 0.5 }, { u: 1, v: 0.5 }, 5);
  assert.equal(missingTransect.targetAvailable, true);
  assert.equal(missingTransect.analogAvailable, false);
  assert.equal(missingTransect.rmseM, null);
  assert.equal(missingTransect.pearsonR, null);
});

test('computePercentilesP2P98 ignores extreme outliers and -32768 NoData sentinels', () => {
  const vals = [-32768, ...Array.from({ length: 100 }, (_, i) => i * 10), 999999];
  const stats = computePercentilesP2P98(vals);
  assert.equal(stats.minM, 0);
  assert.ok(stats.p2M >= 10 && stats.p2M <= 30);
  assert.ok(stats.p98M >= 970 && stats.p98M <= 990);
});

test('detectDegenerateDem flags flat and 1D-striped rasters while passing true 2D terrain', () => {
  const flat = new Array<number>(25).fill(100);
  assert.equal(detectDegenerateDem(flat, 5, 5).isDegenerate, true);

  const striped1D: number[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      striped1D.push(x * 50);
    }
  }
  assert.equal(detectDegenerateDem(striped1D, 5, 5).isDegenerate, true);

  const terrain2D: number[] = [];
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 5; x++) {
      terrain2D.push(x * 20 + y * 15);
    }
  }
  assert.equal(detectDegenerateDem(terrain2D, 5, 5).isDegenerate, false);
});

test('computeHillshadeAtUV and generateDemNormalMapRgba reflect directional sun slope illumination', () => {
  const w = 16;
  const h = 16;
  const elevations: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x - 8;
      const dy = y - 8;
      elevations.push(300 - (dx * dx + dy * dy) * 8);
    }
  }
  const dem = {
    width: w,
    height: h,
    elevations,
    bounds: { minLon: 0, maxLon: 1, minLat: 0, maxLat: 1 },
    resolutionMPerPx: 50,
    source: 'Mound',
    fetchedAtIso: '2026-01-01T00:00:00Z',
  };
  const nwSlopeShade = computeHillshadeAtUV(dem, 0.25, 0.25, 315, 35, 1.2);
  const seSlopeShade = computeHillshadeAtUV(dem, 0.75, 0.75, 315, 35, 1.2);
  assert.ok(nwSlopeShade > seSlopeShade, 'NW-facing slope under 315° sun must be brighter than SE slope');

  const normals = generateDemNormalMapRgba(dem, 1.2);
  assert.equal(normals.length, w * h * 4);
  assert.equal(normals[3], 255);
});

test('evaluateColormapRGB returns unidirectional cividis and muted viridis without rainbow jumps', () => {
  const c0 = evaluateColormapRGB('cividis', 0);
  const c1 = evaluateColormapRGB('cividis', 1);
  assert.ok(c1[0] > c0[0] && c1[1] > c0[1]);
  const v0 = evaluateColormapRGB('viridis', 0);
  const v1 = evaluateColormapRGB('viridis', 1);
  assert.ok(v1[1] > v0[1]);
});

test('hashRoute helpers parse #/landing, #/map, #/workspace, and ?autostart=1', () => {
  assert.equal(parseScreenFromLocation('#/map', ''), 'map');
  assert.equal(parseScreenFromLocation('#/workspace', ''), 'workspace');
  assert.equal(parseScreenFromLocation('', '?autostart=1'), 'workspace');
  assert.equal(parseScreenFromLocation('#/landing', ''), 'landing');
  assert.equal(screenToHash('map'), '#/map');
});

test('extractTerrainFeatures keeps NaN PSR gaps as no-data without cliff slopes and flags slope > 45 deg', () => {
  const w = 10;
  const h = 10;
  const cellM = 100;
  const gentleWithPsr: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= 4 && x <= 5 && y >= 4 && y <= 5) {
        gentleWithPsr.push(NaN);
      } else {
        gentleWithPsr.push(x * 10 + y * 5); // ~6.4 deg slope
      }
    }
  }
  const psrFeats = extractTerrainFeatures(gentleWithPsr, w, h, cellM, 'LOLA PSR', '2026-01-01T00:00:00Z');
  assert.equal(psrFeats.noDataCount, 4);
  assert.equal(psrFeats.slopeWarning, false);
  assert.equal(psrFeats.demQualityOk, true);
  assert.ok(psrFeats.slopeMaxDeg < 15, `Expected no cliff artifacts around NaN PSR cells, got ${psrFeats.slopeMaxDeg}`);

  const steepGrid: number[] = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      steepGrid.push(x * 200 + y * 50); // > 63 deg
    }
  }
  const steepFeats = extractTerrainFeatures(steepGrid, w, h, cellM, 'Bad Scale DEM', '2026-01-01T00:00:00Z');
  assert.equal(steepFeats.slopeWarning, true);
  assert.equal(steepFeats.demQualityOk, false);
  assert.ok(steepFeats.demQualityReason?.includes('Check DEM quality'));
});

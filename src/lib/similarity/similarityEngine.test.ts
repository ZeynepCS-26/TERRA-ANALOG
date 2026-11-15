import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEmptySiteRecord } from '../../data/candidates';
import { evaluateSiteSimilarity } from './similarityEngine';

test('evaluateSiteSimilarity never fabricates 100% when all parameters are missing', () => {
  const target = buildEmptySiteRecord({
    id: 't1',
    name: 'Test Crater, Mars',
    body: 'MARS',
    lat: 18,
    lon: 77,
    radiusKm: 10,
    ingestMethod: 'coords',
  });
  const analog = buildEmptySiteRecord({
    id: 'a1',
    name: 'Test Basin, Earth',
    body: 'EARTH',
    lat: 37,
    lon: 29,
    radiusKm: 10,
    ingestMethod: 'coords',
  });

  const res = evaluateSiteSimilarity(target, analog);
  assert.equal(res.scorePct, null);
  assert.equal(res.availableCount, 0);
  assert.equal(res.confidence, 'low');
  assert.equal(res.specStatus, 'INSUFFICIENT-DATA');
});

test('evaluateSiteSimilarity renormalizes weights over available parameters and applies crew-reported priority', () => {
  const target = buildEmptySiteRecord({
    id: 't2',
    name: 'Jezero, Mars',
    body: 'MARS',
    lat: 18.38,
    lon: 77.58,
    radiusKm: 12,
    ingestMethod: 'seed',
  });
  target.features = {
    minElevM: -2700,
    maxElevM: -2000,
    meanElevM: -2450,
    reliefM: 700,
    slopeMeanDeg: 11.5,
    slopeMedianDeg: 10.2,
    slopeP95Deg: 24.0,
    slopeMaxDeg: 29.0,
    slopeHistogram: [20, 30, 25, 15, 6, 3, 1, 0],
    elevationStdDevM: 140,
    triMeanM: 18,
    aspectHistogram: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5],
    basinRatioPct: 32,
    provenance: { source: 'NASA Trek MOLA', tag: 'measured', resolutionMPerPx: 463 },
  };
  target.climate = {
    tempMinC: -90,
    tempMaxC: 15,
    tempMeanC: -37,
    humidityMeanPct: 0.03,
    precipAnnualMm: 0,
    aridityScore: 100,
    provenance: { source: 'MCD Table', tag: 'measured' },
  };

  const analog = buildEmptySiteRecord({
    id: 'a2',
    name: 'Salda, Turkey',
    body: 'EARTH',
    lat: 37.55,
    lon: 29.68,
    radiusKm: 10,
    ingestMethod: 'catalog',
  });
  analog.features = {
    minElevM: 1140,
    maxElevM: 1810,
    meanElevM: 1380,
    reliefM: 670,
    slopeMeanDeg: 11.8,
    slopeMedianDeg: 10.4,
    slopeP95Deg: 23.0,
    slopeMaxDeg: 27.0,
    slopeHistogram: [19, 31, 24, 15, 7, 3, 1, 0],
    elevationStdDevM: 135,
    triMeanM: 17.5,
    aspectHistogram: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5],
    basinRatioPct: 34,
    provenance: { source: 'AWS Terrain Tiles', tag: 'measured', resolutionMPerPx: 150 },
  };
  // Deliberately omit analog climate/geology initially -> only 4 DEM params available
  const partialRes = evaluateSiteSimilarity(target, analog);
  assert.equal(partialRes.availableCount, 4);
  assert.ok(partialRes.scorePct !== null && partialRes.scorePct > 90);
  const weightSum = partialRes.parameters.reduce((s, p) => s + p.effectiveWeightPct, 0);
  assert.ok(Math.abs(weightSum - 100) < 0.5, `Expected weights to sum to 100, got ${weightSum}`);

  // Crew override supersedes fetched slope
  analog.crewOverrides = {
    meanSlopeDeg: 28,
    updatedAtIso: '2026-01-01T00:00:00Z',
  };
  const crewRes = evaluateSiteSimilarity(target, analog);
  const slopeParam = crewRes.parameters.find((p) => p.key === 'slope');
  assert.equal(slopeParam?.tag, 'crew-reported');
  assert.ok((crewRes.scorePct ?? 0) < (partialRes.scorePct ?? 0));
});

test('Gemini image estimates are tagged estimated and weighted lower than measured DEM', () => {
  const target = buildEmptySiteRecord({
    id: 'img-target',
    name: 'Image Recon Site',
    body: 'MARS',
    lat: 0,
    lon: 0,
    radiusKm: 10,
    ingestMethod: 'image_upload',
  });
  target.geminiEstimate = {
    morphology: 'crater',
    surfaceTexture: 'rocky basaltic regolith',
    probableGeology: 'basalt',
    estimatedMeanSlopeDeg: 14,
    estimatedReliefM: 500,
    confidencePct: 72,
    notes: 'Estimated from uploaded frame.',
    analyzedAtIso: '2026-01-01T00:00:00Z',
  };
  target.climate = {
    tempMinC: -80,
    tempMaxC: 10,
    tempMeanC: -35,
    humidityMeanPct: 0.03,
    precipAnnualMm: 0,
    aridityScore: 100,
    provenance: { source: 'MCD Table', tag: 'measured' },
  };

  const analog = buildEmptySiteRecord({
    id: 'earth-meas',
    name: 'Measured Site',
    body: 'EARTH',
    lat: 35,
    lon: 30,
    radiusKm: 10,
    ingestMethod: 'catalog',
  });
  analog.features = {
    minElevM: 100,
    maxElevM: 600,
    meanElevM: 300,
    reliefM: 500,
    slopeMeanDeg: 14,
    slopeMedianDeg: 13,
    slopeP95Deg: 22,
    slopeMaxDeg: 26,
    slopeHistogram: [10, 20, 40, 20, 10, 0, 0, 0],
    elevationStdDevM: 100,
    triMeanM: 14,
    aspectHistogram: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5],
    basinRatioPct: 28,
    provenance: { source: 'AWS Terrain Tiles', tag: 'measured', resolutionMPerPx: 150 },
  };
  analog.climate = {
    tempMinC: -5,
    tempMaxC: 30,
    tempMeanC: 12,
    humidityMeanPct: 40,
    precipAnnualMm: 220,
    aridityScore: 70,
    provenance: { source: 'NASA POWER', tag: 'measured' },
  };
  analog.geology = {
    lithology: 'basalt',
    basalticIndexPct: 83,
    provenance: { source: 'Macrostrat', tag: 'measured' },
  };

  const res = evaluateSiteSimilarity(target, analog);
  const slopeParam = res.parameters.find((p) => p.key === 'slope');
  const thermalParam = res.parameters.find((p) => p.key === 'thermal');
  assert.equal(slopeParam?.tag, 'estimated');
  assert.equal(thermalParam?.tag, 'measured');
  assert.ok(
    (slopeParam?.effectiveWeightPct ?? 100) < (thermalParam?.effectiveWeightPct ?? 0) * 1.1,
    'Estimated slope weight should be attenuated relative to measured thermal weight'
  );
  assert.equal(res.confidence, 'low');
});

test('evaluateSiteSimilarity blocks scoring and returns INSUFFICIENT-DATA when DEM quality fails or slope > 45 deg', () => {
  const target = buildEmptySiteRecord({
    id: 'bad-dem-target',
    name: 'Broken Polar Site',
    body: 'MOON',
    lat: -89.9,
    lon: 0,
    radiusKm: 10,
    ingestMethod: 'coords',
  });
  target.features = {
    minElevM: -3000,
    maxElevM: 1000,
    meanElevM: -1500,
    reliefM: 4000,
    slopeMeanDeg: 65.7,
    slopeMedianDeg: 64.0,
    slopeP95Deg: 74.0,
    slopeMaxDeg: 81.0,
    slopeHistogram: [0, 0, 0, 0, 0, 0, 0, 100],
    elevationStdDevM: 800,
    triMeanM: 350,
    aspectHistogram: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5],
    basinRatioPct: 50,
    slopeWarning: true,
    demQualityOk: false,
    demQualityReason: 'Check DEM quality (slope > 45°)',
    provenance: { source: 'Distorted DEM', tag: 'measured', resolutionMPerPx: 200 },
  };

  const analog = buildEmptySiteRecord({
    id: 'good-analog',
    name: 'Haughton Crater',
    body: 'EARTH',
    lat: 75.38,
    lon: -89.68,
    radiusKm: 10,
    ingestMethod: 'catalog',
  });
  analog.features = {
    minElevM: 50,
    maxElevM: 320,
    meanElevM: 180,
    reliefM: 270,
    slopeMeanDeg: 6.5,
    slopeMedianDeg: 5.2,
    slopeP95Deg: 18.0,
    slopeMaxDeg: 24.0,
    slopeHistogram: [40, 35, 15, 8, 2, 0, 0, 0],
    elevationStdDevM: 55,
    triMeanM: 9.2,
    aspectHistogram: [12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5, 12.5],
    basinRatioPct: 24,
    slopeWarning: false,
    demQualityOk: true,
    provenance: { source: 'AWS Terrarium', tag: 'measured', resolutionMPerPx: 150 },
  };
  analog.climate = {
    tempMinC: -38,
    tempMaxC: 8,
    tempMeanC: -16,
    humidityMeanPct: 68,
    precipAnnualMm: 140,
    aridityScore: 62,
    provenance: { source: 'NASA POWER', tag: 'measured' },
  };
  target.climate = {
    tempMinC: -220,
    tempMaxC: -120,
    tempMeanC: -170,
    humidityMeanPct: 0,
    precipAnnualMm: 0,
    aridityScore: 100,
    provenance: { source: 'Diviner', tag: 'measured' },
  };

  const res = evaluateSiteSimilarity(target, analog);
  assert.equal(res.scorePct, null);
  assert.equal(res.specStatus, 'INSUFFICIENT-DATA');
  assert.ok(res.specReason.includes('Check DEM quality'));
});

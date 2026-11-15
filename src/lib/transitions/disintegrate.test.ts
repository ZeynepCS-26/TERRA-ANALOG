import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DISINTEGRATE_CONFIG,
  buildDisintegrateGrid,
  computeCellDissolveProgress,
  computeCoverCrop,
  getDisintegrateDurationMs,
} from './disintegrate';

test('DISINTEGRATE_CONFIG matches exact required parameters', () => {
  assert.deepEqual(DISINTEGRATE_CONFIG, {
    speed: 40,
    cellSize: 12,
    scatter: 140,
    edge: 0.45,
  });
  const duration = getDisintegrateDurationMs(DISINTEGRATE_CONFIG);
  assert.ok(duration >= 600 && duration <= 900);
});

test('buildDisintegrateGrid covers entire viewport with deterministic 12px cells', () => {
  const cells = buildDisintegrateGrid(120, 60, DISINTEGRATE_CONFIG, 42);
  assert.equal(cells.length, 10 * 5);
  assert.equal(cells[0].x, 0);
  assert.equal(cells[0].y, 0);
  assert.equal(cells[cells.length - 1].x, 108);
  assert.equal(cells[cells.length - 1].y, 48);
});

test('computeCellDissolveProgress sweeps left-to-right wave cleanly', () => {
  const leftCell = { normX: 0, jitter: 0 };
  const rightCell = { normX: 1, jitter: 0 };

  assert.equal(computeCellDissolveProgress(leftCell, 0), 0);
  assert.ok(computeCellDissolveProgress(leftCell, 0.3) > computeCellDissolveProgress(rightCell, 0.3));
  assert.equal(computeCellDissolveProgress(leftCell, 1), 1);
  assert.equal(computeCellDissolveProgress(rightCell, 1), 1);
});

test('computeCoverCrop maintains aspect ratio without distortion', () => {
  const wide = computeCoverCrop(1600, 900, 1000, 1000);
  assert.equal(wide.sh, 900);
  assert.equal(wide.sw, 900);
  assert.equal(wide.sx, 350);

  const tall = computeCoverCrop(800, 1200, 1600, 900);
  assert.equal(tall.sw, 800);
  assert.equal(tall.sh, 450);
  assert.equal(tall.sy, 375);
});

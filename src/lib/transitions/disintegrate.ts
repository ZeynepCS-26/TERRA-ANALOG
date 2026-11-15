import type { FallbackSurfaceKind } from '../../data/landingMedia';

export interface DisintegrateConfig {
  speed: number;
  cellSize: number;
  scatter: number;
  edge: number;
}

export const DISINTEGRATE_CONFIG: DisintegrateConfig = {
  speed: 40,
  cellSize: 12,
  scatter: 140,
  edge: 0.45,
};

export interface DisintegrateCell {
  col: number;
  row: number;
  x: number;
  y: number;
  w: number;
  h: number;
  normX: number;
  vx: number;
  vy: number;
  jitter: number;
}

/**
 * Deterministic PRNG (Mulberry32) so cell scatter trajectories remain reproducible.
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function getDisintegrateDurationMs(config: DisintegrateConfig = DISINTEGRATE_CONFIG): number {
  // speed = 40 maps cleanly to ~800ms inside the 600-900ms calm transition band
  const raw = Math.round((32000 / Math.max(10, config.speed)));
  return Math.max(600, Math.min(900, raw));
}

export function buildDisintegrateGrid(
  width: number,
  height: number,
  config: DisintegrateConfig = DISINTEGRATE_CONFIG,
  seed = 1337
): DisintegrateCell[] {
  const cell = Math.max(4, config.cellSize);
  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const rand = mulberry32(seed);
  const cells: DisintegrateCell[] = [];

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cell;
      const y = row * cell;
      const w = Math.min(cell, width - x);
      const h = Math.min(cell, height - y);
      const normX = cols > 1 ? col / (cols - 1) : 0;

      // Random radial + slight rightward drift scaled by scatter
      const angle = (rand() - 0.5) * Math.PI * 1.45;
      const speedMul = 0.45 + rand() * 0.75;
      const vx = Math.cos(angle) * config.scatter * speedMul + config.scatter * 0.28;
      const vy = Math.sin(angle) * config.scatter * speedMul;
      const jitter = (rand() - 0.5) * 0.14;

      cells.push({ col, row, x, y, w, h, normX, vx, vy, jitter });
    }
  }

  return cells;
}

/**
 * Evaluates a single cell's local dissolution progress [0..1] for global wave progress p [0..1].
 * Wave sweeps left-to-right across normX with band width controlled by config.edge.
 */
export function computeCellDissolveProgress(
  cell: Pick<DisintegrateCell, 'normX' | 'jitter'>,
  globalProgress: number,
  config: DisintegrateConfig = DISINTEGRATE_CONFIG
): number {
  const p = Math.max(0, Math.min(1, globalProgress));
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const band = Math.max(0.1, Math.min(0.9, config.edge));
  const maxTrigger = 1 - band;
  const triggerAt = Math.max(0, Math.min(maxTrigger, cell.normX * maxTrigger + cell.jitter * band * 0.35));
  const local = (p - triggerAt) / band;
  return Math.max(0, Math.min(1, local));
}

/**
 * Computes destination cover-crop rectangle so any image fills a viewport cleanly without stretching.
 */
export function computeCoverCrop(
  srcWidth: number,
  srcHeight: number,
  dstWidth: number,
  dstHeight: number
): { sx: number; sy: number; sw: number; sh: number } {
  if (srcWidth <= 0 || srcHeight <= 0 || dstWidth <= 0 || dstHeight <= 0) {
    return { sx: 0, sy: 0, sw: 1, sh: 1 };
  }
  const srcRatio = srcWidth / srcHeight;
  const dstRatio = dstWidth / dstHeight;

  if (srcRatio > dstRatio) {
    const sw = srcHeight * dstRatio;
    const sx = (srcWidth - sw) * 0.5;
    return { sx, sy: 0, sw, sh: srcHeight };
  }
  const sh = srcWidth / dstRatio;
  const sy = (srcHeight - sh) * 0.5;
  return { sx: 0, sy, sw: srcWidth, sh };
}

function hash2d(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return s - Math.floor(s);
}

function smoothNoise(x: number, y: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash2d(ix, iy);
  const b = hash2d(ix + 1, iy);
  const c = hash2d(ix, iy + 1);
  const d = hash2d(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number): number {
  let v = 0;
  let amp = 0.5;
  let freq = 1;
  for (let i = 0; i < 4; i++) {
    v += amp * smoothNoise(x * freq, y * freq);
    freq *= 2.05;
    amp *= 0.5;
  }
  return v;
}

/**
 * Renders a realistic procedural planetary surface (gradient + fBm noise + craters/globe shading)
 * onto an offscreen canvas as a zero-error fallback if a remote NASA image cannot be fetched.
 */
export function renderProceduralPlanetaryCanvas(
  kind: FallbackSurfaceKind,
  width: number,
  height: number
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  // Render at crisp half-resolution and upscale smoothly for fast first paint
  const cw = Math.max(320, Math.round(width * 0.5));
  const ch = Math.max(180, Math.round(height * 0.5));
  canvas.width = cw;
  canvas.height = ch;

  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const img = ctx.createImageData(cw, ch);
  const data = img.data;
  const isGlobe = kind === 'mars_globe' || kind === 'moon_globe';
  const isMoon = kind === 'moon_south_pole' || kind === 'moon_globe';

  const cx = cw * 0.5;
  const cy = ch * 0.48;
  const radius = Math.min(cw, ch) * 0.38;

  for (let py = 0; py < ch; py++) {
    const ny = py / ch;
    for (let px = 0; px < cw; px++) {
      const nx = px / cw;
      const idx = (py * cw + px) * 4;

      if (isGlobe) {
        const dx = px - cx;
        const dy = py - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) {
          const star = hash2d(px * 0.7, py * 0.7) > 0.997 ? 180 : 0;
          const bg = 8 + star * 0.45;
          data[idx] = bg;
          data[idx + 1] = bg + 2;
          data[idx + 2] = bg + 5;
          data[idx + 3] = 255;
          continue;
        }
        const z = Math.sqrt(Math.max(0, radius * radius - dist * dist));
        const sx = dx / radius;
        const sy = dy / radius;
        const sz = z / radius;
        const light = Math.max(0.08, sx * -0.45 + sy * -0.35 + sz * 0.82);
        const tex = fbm(nx * 9 + 1.4, ny * 9 + 2.8);
        const detail = fbm(nx * 24, ny * 24) * 0.35;
        const shade = light * (0.68 + (tex + detail) * 0.48);

        if (isMoon) {
          const base = 135 * shade + 24;
          data[idx] = Math.min(255, base);
          data[idx + 1] = Math.min(255, base + 4);
          data[idx + 2] = Math.min(255, base + 10);
        } else {
          data[idx] = Math.min(255, (165 + tex * 65) * light);
          data[idx + 1] = Math.min(255, (72 + tex * 38) * light);
          data[idx + 2] = Math.min(255, (46 + tex * 24) * light);
        }
        data[idx + 3] = 255;
        continue;
      }

      const n1 = fbm(nx * 6.5 + (kind === 'mars_valles' ? 4.2 : 1.1), ny * 6.5);
      const n2 = fbm(nx * 18.0, ny * 18.0);
      const ridge =
        kind === 'mars_valles'
          ? Math.abs(Math.sin((ny * 3.1 + n1 * 1.4) * Math.PI)) * 0.45
          : n1 * 0.72 + n2 * 0.28;
      const horizonShade = 0.42 + (1 - ny) * 0.48;

      if (isMoon) {
        const lum = (48 + ridge * 138) * horizonShade;
        data[idx] = Math.min(255, lum);
        data[idx + 1] = Math.min(255, lum + 5);
        data[idx + 2] = Math.min(255, lum + 11);
      } else {
        const val = (0.42 + ridge * 0.78) * horizonShade;
        data[idx] = Math.min(255, 178 * val + 18);
        data[idx + 1] = Math.min(255, 78 * val + 12);
        data[idx + 2] = Math.min(255, 48 * val + 10);
      }
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function drawCoverSource(
  ctx: CanvasRenderingContext2D,
  source: HTMLImageElement | HTMLCanvasElement,
  width: number,
  height: number,
  alpha = 1
): void {
  const sw = source instanceof HTMLImageElement ? source.naturalWidth || source.width : source.width;
  const sh = source instanceof HTMLImageElement ? source.naturalHeight || source.height : source.height;
  if (!sw || !sh) return;
  const crop = computeCoverCrop(sw, sh, width, height);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(source, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, width, height);
  ctx.restore();
}

export function renderDisintegrateFrame(
  ctx: CanvasRenderingContext2D,
  outgoing: HTMLImageElement | HTMLCanvasElement,
  incoming: HTMLImageElement | HTMLCanvasElement | null,
  cells: DisintegrateCell[],
  width: number,
  height: number,
  progress: number,
  config: DisintegrateConfig = DISINTEGRATE_CONFIG,
  transparentWhenNoIncoming = false
): void {
  ctx.clearRect(0, 0, width, height);

  // Draw incoming layer (or leave transparent to reveal underlying screen)
  if (incoming) {
    drawCoverSource(ctx, incoming, width, height, 1);
  } else if (!transparentWhenNoIncoming) {
    ctx.fillStyle = '#0B0D10';
    ctx.fillRect(0, 0, width, height);
  }

  const sw = outgoing instanceof HTMLImageElement ? outgoing.naturalWidth || outgoing.width : outgoing.width;
  const sh = outgoing instanceof HTMLImageElement ? outgoing.naturalHeight || outgoing.height : outgoing.height;
  if (!sw || !sh) return;

  const crop = computeCoverCrop(sw, sh, width, height);
  const scaleX = crop.sw / width;
  const scaleY = crop.sh / height;

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const local = computeCellDissolveProgress(cell, progress, config);
    if (local >= 1) continue;

    const ease = local * local;
    const dx = cell.x + cell.vx * ease;
    const dy = cell.y + cell.vy * ease;
    const alpha = 1 - local;
    const shrink = 1 - local * 0.25;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(
      outgoing,
      crop.sx + cell.x * scaleX,
      crop.sy + cell.y * scaleY,
      cell.w * scaleX,
      cell.h * scaleY,
      dx + (cell.w * (1 - shrink)) * 0.5,
      dy + (cell.h * (1 - shrink)) * 0.5,
      cell.w * shrink,
      cell.h * shrink
    );
    ctx.restore();
  }
}

export type ScientificColormap = 'cividis' | 'viridis';
export type MapLayerMode = 'relief' | 'hypsometric' | 'slope' | 'aspect' | 'mineralogy';

export interface TransectPoint {
  u: number;
  v: number;
}

/**
 * Perceptually uniform, unidirectional scientific colormaps only.
 * Rainbows, jet, turbo, and neon hues are strictly prohibited.
 */
export function evaluateColormapRGB(
  colormap: ScientificColormap | string,
  tInput: number
): [number, number, number] {
  const t = Math.max(0, Math.min(1, tInput));
  const stops: Record<ScientificColormap, Array<[number, number, number]>> = {
    cividis: [
      [12, 34, 68],
      [48, 70, 102],
      [88, 97, 110],
      [136, 134, 110],
      [188, 174, 94],
      [236, 218, 108],
    ],
    viridis: [
      [54, 42, 72],
      [66, 76, 102],
      [78, 104, 94],
      [98, 128, 92],
      [143, 168, 134],
      [210, 182, 108],
    ],
  };

  const key: ScientificColormap = colormap === 'viridis' ? 'viridis' : 'cividis';
  const ramp = stops[key];
  const scaled = t * (ramp.length - 1);
  const idx = Math.min(ramp.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = ramp[idx];
  const c1 = ramp[idx + 1];
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

import { extractTerrainFeatures } from './terrainExtractor';

interface ExtractWorkerRequest {
  requestId: string;
  elevations: number[];
  width: number;
  height: number;
  resolutionMPerPx: number;
  source: string;
  fetchedAtIso: string;
  cached?: boolean;
}

self.onmessage = (event: MessageEvent<ExtractWorkerRequest>) => {
  const { requestId, elevations, width, height, resolutionMPerPx, source, fetchedAtIso, cached } =
    event.data;
  try {
    const features = extractTerrainFeatures(
      elevations,
      width,
      height,
      resolutionMPerPx,
      source,
      fetchedAtIso,
      Boolean(cached)
    );
    self.postMessage({ requestId, ok: true, features });
  } catch (err) {
    self.postMessage({
      requestId,
      ok: false,
      error: err instanceof Error ? err.message : 'Terrain worker extraction failed.',
    });
  }
};

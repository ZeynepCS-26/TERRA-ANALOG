import type { DemGridData, TerrainFeatures } from '../../types/site';
import { extractTerrainFeatures } from './terrainExtractor';

let workerInstance: Worker | null = null;
const pending = new Map<
  string,
  { resolve: (f: TerrainFeatures) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker | null {
  if (typeof window === 'undefined' || typeof Worker === 'undefined') return null;
  if (!workerInstance) {
    workerInstance = new Worker(new URL('./terrain.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerInstance.onmessage = (e: MessageEvent<{ requestId: string; ok: boolean; features?: TerrainFeatures; error?: string }>) => {
      const entry = pending.get(e.data.requestId);
      if (!entry) return;
      pending.delete(e.data.requestId);
      if (e.data.ok && e.data.features) {
        entry.resolve(e.data.features);
      } else {
        entry.reject(new Error(e.data.error || 'Terrain extraction worker error'));
      }
    };
    workerInstance.onerror = (err) => {
      for (const [, entry] of pending) {
        entry.reject(new Error(err.message || 'Terrain worker crashed'));
      }
      pending.clear();
      workerInstance = null;
    };
  }
  return workerInstance;
}

export async function runTerrainExtractionWorker(dem: DemGridData): Promise<TerrainFeatures> {
  const worker = getWorker();
  if (!worker) {
    return extractTerrainFeatures(
      dem.elevations,
      dem.width,
      dem.height,
      dem.resolutionMPerPx,
      dem.source,
      dem.fetchedAtIso,
      Boolean(dem.cached)
    );
  }

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return new Promise<TerrainFeatures>((resolve, reject) => {
    pending.set(requestId, { resolve, reject });
    worker.postMessage({
      requestId,
      elevations: dem.elevations,
      width: dem.width,
      height: dem.height,
      resolutionMPerPx: dem.resolutionMPerPx,
      source: dem.source,
      fetchedAtIso: dem.fetchedAtIso,
      cached: dem.cached,
    });
  });
}

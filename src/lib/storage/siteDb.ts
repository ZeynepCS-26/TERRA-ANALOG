import type { DemGridData, SiteRecord } from '../../types/site';

const DB_NAME = 'terra-analog-db';
const DB_VERSION = 1;
const STORE_SITES = 'sites';
const STORE_DEM_CACHE = 'dem_cache';

function openDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_SITES)) {
          db.createObjectStore(STORE_SITES, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_DEM_CACHE)) {
          db.createObjectStore(STORE_DEM_CACHE, { keyPath: 'cacheKey' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function loadAllSitesFromDb(): Promise<SiteRecord[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_SITES, 'readonly');
    const store = tx.objectStore(STORE_SITES);
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result as SiteRecord[]) ?? []);
    req.onerror = () => resolve([]);
  });
}

export async function saveSiteToDb(site: SiteRecord): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_SITES, 'readwrite');
    tx.objectStore(STORE_SITES).put(site);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function saveSitesBulkToDb(sites: SiteRecord[]): Promise<void> {
  const db = await openDb();
  if (!db || sites.length === 0) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_SITES, 'readwrite');
    const store = tx.objectStore(STORE_SITES);
    for (const s of sites) {
      store.put(s);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export async function deleteSiteFromDb(id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_SITES, 'readwrite');
    tx.objectStore(STORE_SITES).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export function buildDemCacheKey(site: Pick<SiteRecord, 'body' | 'lat' | 'lon' | 'radiusKm'>): string {
  return `v4-metric20km:${site.body}:${site.lat.toFixed(3)}:${site.lon.toFixed(3)}:${site.radiusKm.toFixed(1)}`;
}

export async function loadCachedDemGrid(cacheKey: string): Promise<DemGridData | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_DEM_CACHE, 'readonly');
    const req = tx.objectStore(STORE_DEM_CACHE).get(cacheKey);
    req.onsuccess = () => {
      const rec = req.result as { cacheKey: string; grid: DemGridData } | undefined;
      resolve(rec ? { ...rec.grid, cached: true } : null);
    };
    req.onerror = () => resolve(null);
  });
}

export async function saveCachedDemGrid(cacheKey: string, grid: DemGridData): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const tx = db.transaction(STORE_DEM_CACHE, 'readwrite');
    tx.objectStore(STORE_DEM_CACHE).put({ cacheKey, grid });
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

import proj4 from 'proj4';
import type { BodyType, GeoBounds } from '../../types/site';

export type ProjectionId =
  | 'EPSG:3857'
  | 'EPSG:3031'
  | 'EPSG:3413'
  | 'MOON_SPOLE'
  | 'MOON_NPOLE'
  | 'MARS_SPOLE'
  | 'MARS_NPOLE'
  | 'UNSUPPORTED';

export interface SiteProjectionInfo {
  id: ProjectionId;
  pole: 'south' | 'north' | null;
  isPolar: boolean;
  supported: boolean;
  label: string;
  proj4Def: string;
  reason?: string;
}

const WGS84_LONLAT = '+proj=longlat +datum=WGS84 +no_defs';
const MOON_LONLAT = '+proj=longlat +R=1737400 +no_defs';
const MARS_VIKING_LONLAT = '+proj=longlat +R=3376200 +no_defs';
const MARS_MOLA_LONLAT = '+proj=longlat +R=3396190 +no_defs';

const PROJ_DEFS: Record<Exclude<ProjectionId, 'UNSUPPORTED'>, string> = {
  'EPSG:3857':
    '+proj=merc +a=6378137 +b=6378137 +lat_ts=0 +lon_0=0 +x_0=0 +y_0=0 +k=1 +units=m +nadgrids=@null +wktext +no_defs',
  'EPSG:3031':
    '+proj=stere +lat_0=-90 +lat_ts=-71 +lon_0=0 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
  'EPSG:3413':
    '+proj=stere +lat_0=90 +lat_ts=70 +lon_0=-45 +x_0=0 +y_0=0 +datum=WGS84 +units=m +no_defs',
  MOON_SPOLE:
    '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs',
  MOON_NPOLE:
    '+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +x_0=0 +y_0=0 +R=1737400 +units=m +no_defs',
  MARS_SPOLE:
    '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=3376200 +units=m +no_defs',
  MARS_NPOLE:
    '+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +x_0=0 +y_0=0 +R=3376200 +units=m +no_defs',
};

const MARS_MOLA_SPOLE =
  '+proj=stere +lat_0=-90 +lat_ts=-90 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs';
const MARS_MOLA_NPOLE =
  '+proj=stere +lat_0=90 +lat_ts=90 +lon_0=0 +x_0=0 +y_0=0 +R=3396190 +units=m +no_defs';

/**
 * Automatically selects Polar Stereographic when |lat| > 80°, keeping Web Mercator in mid-latitudes.
 * Flags unsupported polar coordinates cleanly rather than distorting tiles.
 */
export function selectSiteProjection(body: BodyType, lat: number): SiteProjectionInfo {
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    return {
      id: 'UNSUPPORTED',
      pole: null,
      isPolar: true,
      supported: false,
      label: 'Polar region, projection unavailable',
      proj4Def: '',
      reason: 'Invalid latitude outside [-90, 90].',
    };
  }

  if (Math.abs(lat) <= 80) {
    return {
      id: 'EPSG:3857',
      pole: null,
      isPolar: false,
      supported: true,
      label: 'Web Mercator · EPSG:3857',
      proj4Def: PROJ_DEFS['EPSG:3857'],
    };
  }

  const pole: 'south' | 'north' = lat < 0 ? 'south' : 'north';

  if (body === 'MOON') {
    const id = pole === 'south' ? 'MOON_SPOLE' : 'MOON_NPOLE';
    return {
      id,
      pole,
      isPolar: true,
      supported: true,
      label: 'Polar stereographic, Moon 2000',
      proj4Def: PROJ_DEFS[id],
    };
  }

  if (body === 'MARS') {
    const id = pole === 'south' ? 'MARS_SPOLE' : 'MARS_NPOLE';
    return {
      id,
      pole,
      isPolar: true,
      supported: true,
      label: 'Polar stereographic, Mars 2000',
      proj4Def: PROJ_DEFS[id],
    };
  }

  if (body === 'EARTH') {
    const id = pole === 'south' ? 'EPSG:3031' : 'EPSG:3413';
    return {
      id,
      pole,
      isPolar: true,
      supported: true,
      label: `Polar stereographic, ${id}`,
      proj4Def: PROJ_DEFS[id],
    };
  }

  return {
    id: 'UNSUPPORTED',
    pole,
    isPolar: true,
    supported: false,
    label: 'Polar region, projection unavailable',
    proj4Def: '',
    reason: `No polar stereographic projection defined for body ${String(body)}.`,
  };
}

function getLonLatDef(id: ProjectionId, variant: 'imagery' | 'dem' = 'imagery'): string {
  if (id === 'MOON_SPOLE' || id === 'MOON_NPOLE') return MOON_LONLAT;
  if (id === 'MARS_SPOLE' || id === 'MARS_NPOLE') {
    return variant === 'dem' ? MARS_MOLA_LONLAT : MARS_VIKING_LONLAT;
  }
  return WGS84_LONLAT;
}

function getProjDef(id: Exclude<ProjectionId, 'UNSUPPORTED'>, variant: 'imagery' | 'dem' = 'imagery'): string {
  if (variant === 'dem' && id === 'MARS_SPOLE') return MARS_MOLA_SPOLE;
  if (variant === 'dem' && id === 'MARS_NPOLE') return MARS_MOLA_NPOLE;
  return PROJ_DEFS[id];
}

export function projectGeoToMeters(
  projId: ProjectionId,
  lat: number,
  lon: number,
  variant: 'imagery' | 'dem' = 'imagery'
): { x: number; y: number } {
  if (projId === 'UNSUPPORTED') {
    throw new Error('Polar region, projection unavailable');
  }
  const lonLat = getLonLatDef(projId, variant);
  const dst = getProjDef(projId, variant);
  const [x, y] = proj4(lonLat, dst, [lon, lat]);
  return { x, y };
}

export function unprojectMetersToGeo(
  projId: ProjectionId,
  x: number,
  y: number,
  variant: 'imagery' | 'dem' = 'imagery'
): { lat: number; lon: number } {
  if (projId === 'UNSUPPORTED') {
    throw new Error('Polar region, projection unavailable');
  }
  const lonLat = getLonLatDef(projId, variant);
  const src = getProjDef(projId, variant);
  const [lon, lat] = proj4(src, lonLat, [x, y]);
  return { lat, lon };
}

export interface MetricWindowBbox {
  projId: Exclude<ProjectionId, 'UNSUPPORTED'>;
  pole: 'south' | 'north' | null;
  cx: number;
  cy: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function getMetricWindowBbox(
  body: BodyType,
  lat: number,
  lon: number,
  halfSpanKm: number,
  variant: 'imagery' | 'dem' = 'imagery'
): MetricWindowBbox {
  const info = selectSiteProjection(body, lat);
  if (!info.supported || info.id === 'UNSUPPORTED') {
    throw new Error('Polar region, projection unavailable');
  }
  const center = projectGeoToMeters(info.id, lat, lon, variant);
  const halfM = Math.max(500, halfSpanKm * 1000);
  return {
    projId: info.id,
    pole: info.pole,
    cx: center.x,
    cy: center.y,
    minX: Math.round(center.x - halfM),
    minY: Math.round(center.y - halfM),
    maxX: Math.round(center.x + halfM),
    maxY: Math.round(center.y + halfM),
  };
}

/**
 * Generates geographic bounds enclosing a centered 20x20 km (or custom) polar/local metric window.
 */
export function getCentered20KmGeoBounds(body: BodyType, lat: number, lon: number, halfKm = 10): GeoBounds {
  const info = selectSiteProjection(body, lat);
  if (info.isPolar && info.supported && info.id !== 'UNSUPPORTED') {
    const win = getMetricWindowBbox(body, lat, lon, halfKm, 'dem');
    const corners = [
      unprojectMetersToGeo(info.id, win.minX, win.minY, 'dem'),
      unprojectMetersToGeo(info.id, win.maxX, win.minY, 'dem'),
      unprojectMetersToGeo(info.id, win.minX, win.maxY, 'dem'),
      unprojectMetersToGeo(info.id, win.maxX, win.maxY, 'dem'),
    ];
    return {
      minLat: Math.min(...corners.map((c) => c.lat)),
      maxLat: Math.max(...corners.map((c) => c.lat)),
      minLon: Math.min(...corners.map((c) => c.lon)),
      maxLon: Math.max(...corners.map((c) => c.lon)),
    };
  }
  const rKm = body === 'MOON' ? 1737.4 : body === 'MARS' ? 3389.5 : 6371.0;
  const dLat = (halfKm / rKm) * (180 / Math.PI);
  const cosLat = Math.max(0.15, Math.cos((lat * Math.PI) / 180));
  const dLon = dLat / cosLat;
  return {
    minLat: Math.max(-89.95, lat - dLat),
    maxLat: Math.min(89.95, lat + dLat),
    minLon: lon - dLon,
    maxLon: lon + dLon,
  };
}

/**
 * Converts a local tangent plane metric offset (eastM, northM) at any latitude to (lat, lon)
 * using proj4 when polar, or exact local sphere meters at mid-latitudes.
 */
export function localMetricOffsetToGeo(
  body: BodyType,
  centerLat: number,
  centerLon: number,
  eastM: number,
  northM: number,
  variant: 'imagery' | 'dem' = 'dem'
): { lat: number; lon: number } {
  const info = selectSiteProjection(body, centerLat);
  if (info.isPolar && info.supported && info.id !== 'UNSUPPORTED') {
    const c = projectGeoToMeters(info.id, centerLat, centerLon, variant);
    return unprojectMetersToGeo(info.id, c.x + eastM, c.y + northM, variant);
  }
  const rM = body === 'MOON' ? 1737400 : body === 'MARS' ? 3389500 : 6371000;
  const lat = centerLat + (northM / rM) * (180 / Math.PI);
  const cosLat = Math.max(0.12, Math.cos((centerLat * Math.PI) / 180));
  const lon = centerLon + (eastM / (rM * cosLat)) * (180 / Math.PI);
  return { lat, lon };
}

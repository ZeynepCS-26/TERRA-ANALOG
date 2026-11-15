import type { SiteRecord } from '../types/site';
import type { SpecStatus } from './similarity/similarityEngine';

export function formatSiteFullName(site: SiteRecord): string {
  if (site.body === 'EARTH') {
    if (site.country && !site.name.toLowerCase().includes(site.country.toLowerCase())) {
      return `${site.name}, ${site.country}`;
    }
    return site.name;
  }
  const bodyLabel = site.body === 'MOON' ? 'Moon' : 'Mars';
  if (site.name.toLowerCase().includes(bodyLabel.toLowerCase())) {
    return site.name;
  }
  return `${site.name}, ${bodyLabel}`;
}

export function formatSiteCleanFullName(site: SiteRecord): string {
  const baseName = site.name.replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (site.body === 'EARTH') {
    if (site.country && !baseName.toLowerCase().includes(site.country.toLowerCase())) {
      return `${baseName}, ${site.country}`;
    }
    return baseName;
  }
  const bodyLabel = site.body === 'MOON' ? 'Moon' : 'Mars';
  if (baseName.toLowerCase().includes(bodyLabel.toLowerCase())) {
    return baseName;
  }
  return `${baseName}, ${bodyLabel}`;
}

export function formatConsistentScorePct(scorePct: number | null | undefined): string {
  if (scorePct === null || scorePct === undefined || !Number.isFinite(scorePct)) {
    return '—';
  }
  return `${scorePct.toFixed(1)}%`;
}

export function formatSiteShortName(site: SiteRecord): string {
  return site.name.split(',')[0].split('(')[0].trim();
}

export function formatCoordLabel(lat: number, lon: number): string {
  const latStr = `${Math.abs(lat).toFixed(2)}°${lat >= 0 ? 'N' : 'S'}`;
  const lonStr = `${Math.abs(lon).toFixed(2)}°${lon >= 0 ? 'E' : 'W'}`;
  return `${latStr}, ${lonStr}`;
}

export function formatSpecStatus(status: SpecStatus): string {
  switch (status) {
    case 'IN-SPEC':
      return 'Within limits';
    case 'MARGINAL':
      return 'Near limit';
    case 'OUT-OF-SPEC':
      return 'Exceeds limit';
    case 'INSUFFICIENT-DATA':
      return 'Insufficient data';
  }
}

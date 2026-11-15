export type ScreenRoute = 'landing' | 'map' | 'workspace';

export function parseScreenFromLocation(
  hash: string,
  search: string
): ScreenRoute {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`);
  const autostart = params.get('autostart') === '1';
  const screenParam = params.get('screen');
  const targetParam = params.get('target');
  const pageParam = params.get('page');

  if (autostart || targetParam || pageParam === 'dossier' || screenParam === 'workspace') {
    return 'workspace';
  }
  if (screenParam === 'map' || screenParam === 'analog-map') {
    return 'map';
  }

  const normalizedHash = hash.replace(/^#\/?/, '').trim().toLowerCase();
  if (normalizedHash === 'workspace') return 'workspace';
  if (normalizedHash === 'map' || normalizedHash === 'analog-map') return 'map';
  if (normalizedHash === 'landing') return 'landing';

  return 'landing';
}

export function screenToHash(screen: ScreenRoute): string {
  return `#/${screen}`;
}

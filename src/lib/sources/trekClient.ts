export type TrekErrorType = 'CORS' | 'HTTP_404' | 'TIMEOUT' | 'TAINTED_CANVAS' | 'UNKNOWN';

export interface TrekFetchResult {
  ok: boolean;
  blob?: Blob;
  errorType?: TrekErrorType;
  errorMessage?: string;
  sourceLabel?: string;
}

export async function fetchTrekResourceWithRetry(
  url: string,
  timeoutMs = 8000,
  retries = 1
): Promise<TrekFetchResult> {
  let lastErrorType: TrekErrorType = 'UNKNOWN';
  let lastMessage = '';

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(url, {
        signal: controller.signal,
        credentials: 'omit',
      });
      window.clearTimeout(timer);

      if (res.ok) {
        const blob = await res.blob();
        return { ok: true, blob };
      }

      if (res.status === 404 || res.status === 400) {
        lastErrorType = 'HTTP_404';
        lastMessage = `HTTP ${res.status}`;
        break; // Don't retry client errors
      }

      lastErrorType = 'UNKNOWN';
      lastMessage = `HTTP ${res.status}`;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        lastErrorType = 'TIMEOUT';
        lastMessage = 'Request timed out (8s)';
      } else {
        lastErrorType = 'CORS';
        lastMessage = err instanceof Error ? err.message : 'Network / CORS error';
      }
    }
  }

  return {
    ok: false,
    errorType: lastErrorType,
    errorMessage: lastMessage,
  };
}

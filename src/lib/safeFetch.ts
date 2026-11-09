/**
 * AnchorTransport TMS - Safe JSON & Safe Fetch Utilities
 * Protects against "JSON.parse: unexpected end of data at line 1 column 1"
 * when responses are empty, aborted, or HTML error pages.
 */

/**
 * Safely parse a string into JSON with strict string validation.
 * Never throws "unexpected end of data".
 */
export function safeJsonParse<T = any>(raw: unknown, fallback: T | null = null): T | null {
  if (typeof raw !== 'string') return fallback;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'undefined' || trimmed === 'null') {
    return fallback;
  }
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    return fallback;
  }
}

/**
 * Safely read and parse a Fetch Response as JSON.
 * Protects against 204 No Content, empty bodies, and dev server proxies.
 */
export async function parseResponseJson<T = any>(
  res: Response,
  fallback: T | null = null
): Promise<T | null> {
  try {
    const text = await res.text();
    if (!text || !text.trim()) {
      return fallback;
    }
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/**
 * Perform a fetch request and return safely parsed JSON.
 */
export async function safeFetch<T = any>(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(input, init);
    const data = await parseResponseJson<T>(res);
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: !res.ok ? ((data as any)?.error || `Request failed with status ${res.status}`) : undefined,
    };
  } catch (err: any) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: err.message || 'Network request failed',
    };
  }
}

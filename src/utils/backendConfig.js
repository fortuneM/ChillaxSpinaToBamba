const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};

const RAW_BACKEND_URL =
  ENV.VITE_BACKEND_URL ||
  ENV.VITE_API_URL ||
  ENV.VITE_SOCKET_URL ||
  '';

/**
 * Normalizes an explicit backend origin (for split Vercel + Render deployments)
 * while defaulting to same-origin when hosted directly on Render or Vite dev proxy.
 */
export function resolveBackendBaseUrl(rawUrl = RAW_BACKEND_URL) {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  if (!/^https?:\/\//i.test(trimmed)) return '';
  return trimmed.replace(/\/+$/, '');
}

export function getSocketUrl() {
  const base = resolveBackendBaseUrl();
  if (base) return base;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/**
 * Routes relative `/api/...` fetch calls to the configured Render backend URL
 * when deployed separately (e.g. Vercel frontend + VITE_BACKEND_URL).
 */
export function installApiFetchInterceptor() {
  if (typeof window === 'undefined' || window.__chillaxSpinFetchPatched) return;
  const base = resolveBackendBaseUrl();
  if (!base) return;

  const originalFetch = window.fetch.bind(window);
  window.fetch = function chillaxSpinFetch(input, init) {
    if (typeof input === 'string' && input.startsWith('/api')) {
      return originalFetch(`${base}${input}`, init);
    }
    if (input instanceof Request) {
      const originPrefix = window.location.origin;
      if (input.url.startsWith(`${originPrefix}/api`)) {
        const suffix = input.url.slice(originPrefix.length);
        return originalFetch(new Request(`${base}${suffix}`, input), init);
      }
      if (input.url.startsWith('/api')) {
        return originalFetch(new Request(`${base}${input.url}`, input), init);
      }
    }
    return originalFetch(input, init);
  };
  window.__chillaxSpinFetchPatched = true;
}

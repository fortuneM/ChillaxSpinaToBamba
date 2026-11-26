export const RENDER_BACKEND_URL = 'https://chillaxspinatobamba.onrender.com';

const ENV = (typeof import.meta !== 'undefined' && import.meta.env) || {};

const RAW_BACKEND_URL =
  ENV.VITE_BACKEND_URL ||
  ENV.VITE_API_URL ||
  ENV.VITE_SOCKET_URL ||
  '';

function isRemoteFrontendHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host) return false;
  if (host.includes('vercel.app')) return true;
  return !host.includes('onrender.com') && host !== 'localhost' && host !== '127.0.0.1';
}

/**
 * Resolves the backend origin:
 * - Explicit VITE_BACKEND_URL / VITE_API_URL / VITE_SOCKET_URL if set
 * - RENDER_BACKEND_URL automatically when running on Vercel or remote domains
 * - Empty string (same-origin) when running locally (Vite proxy) or directly on Render
 */
export function resolveBackendBaseUrl(
  rawUrl = RAW_BACKEND_URL,
  hostname = (typeof window !== 'undefined' ? window.location.hostname : '')
) {
  const trimmed = String(rawUrl || '').trim();
  if (trimmed) {
    if (!/^https?:\/\//i.test(trimmed)) return '';
    return trimmed.replace(/\/+$/, '');
  }
  return isRemoteFrontendHost(hostname) ? RENDER_BACKEND_URL : '';
}

export function getSocketUrl() {
  const base = resolveBackendBaseUrl();
  if (base) return base;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/**
 * Routes relative `/api/...` fetch calls directly to Render when served from Vercel
 * (bypassing Vercel proxy timeouts & pre-warming Render on load).
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

  // Wake Render free/sleep instances immediately so login/TV pairing doesn't time out
  try {
    originalFetch(`${base}/api/health`).catch(() => {});
  } catch {}
}

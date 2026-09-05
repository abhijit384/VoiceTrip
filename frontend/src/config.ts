// Centralized API and WebSocket Host Configuration
// Supports production deployment via VITE_API_BASE_URL and preserves local development fallback.

export const getApiBase = (): string => {
  // 1. Explicit environment variable (Production / Vercel deployment)
  const envApiUrl = import.meta.env.VITE_API_BASE_URL;
  if (envApiUrl && typeof envApiUrl === 'string' && envApiUrl.trim() !== '') {
    return envApiUrl.trim().replace(/\/+$/, '');
  }

  // 2. Local development fallback matching current hostname (127.0.0.1 vs localhost)
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') {
      return `http://${host}:8000`;
    }
  }

  // 3. Universal default fallback for local dev
  return 'http://127.0.0.1:8000';
};

export const getWsBase = (): string => {
  const apiBase = getApiBase();

  // Convert HTTP(S) protocol to WS(S)
  if (apiBase.startsWith('https://')) {
    return apiBase.replace(/^https:\/\//, 'wss://');
  }
  if (apiBase.startsWith('http://')) {
    return apiBase.replace(/^http:\/\//, 'ws://');
  }

  // Fallback for protocol-relative or edge cases
  if (typeof window !== 'undefined' && window.location.protocol === 'https:') {
    return `wss://${apiBase.replace(/^wss?:\/\//, '')}`;
  }
  return `ws://${apiBase.replace(/^wss?:\/\//, '')}`;
};

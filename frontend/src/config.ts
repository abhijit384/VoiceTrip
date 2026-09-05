// Centralized API and WebSocket Host Configuration
// Dynamically matches the browser's current hostname (127.0.0.1 vs localhost)
// to prevent CORS origin mismatches and IPv6/IPv4 fetch failures on Windows.

export const getApiBase = (): string => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '127.0.0.1';
    return `http://${host}:8000`;
  }
  return 'http://127.0.0.1:8000';
};

export const getWsBase = (): string => {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname || '127.0.0.1';
    return `ws://${host}:8000`;
  }
  return 'ws://127.0.0.1:8000';
};

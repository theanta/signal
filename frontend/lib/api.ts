import axios, { type AxiosRequestConfig } from 'axios';

// Module-level token store — written by AuthContext, read by interceptors.
// Keeps axios decoupled from React context without a circular import.
let _token: string | null = null;
let _refreshFn: (() => Promise<string | null>) | null = null;
// Singleton promise: if multiple 401s arrive simultaneously, only one refresh
// call is made. Without this, parallel 401s each trigger token rotation and
// all but the first get an already-invalidated token, causing a spurious logout.
let _refreshInFlight: Promise<string | null> | null = null;

export const tokenStore = {
  setToken: (t: string | null) => { _token = t; },
  getToken: () => _token,
  setRefreshFn: (fn: () => Promise<string | null>) => { _refreshFn = fn; },
  refresh: (): Promise<string | null> => {
    if (!_refreshInFlight) {
      _refreshInFlight = (_refreshFn?.() ?? Promise.resolve(null)).finally(() => {
        _refreshInFlight = null;
      });
    }
    return _refreshInFlight;
  },
};

export const api = axios.create({
  baseURL: '/api',
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach Bearer token to every request
api.interceptors.request.use(config => {
  if (_token) config.headers['Authorization'] = `Bearer ${_token}`;
  return config;
});

// On 401: try one silent refresh, retry the original request, then redirect
api.interceptors.response.use(
  res => res,
  async err => {
    const original = err.config as AxiosRequestConfig & { _retry?: boolean };
    const isAuthRoute = original.url?.startsWith('/auth');

    if (err?.response?.status === 401 && !original._retry && !isAuthRoute) {
      original._retry = true;
      const newToken = await tokenStore.refresh();
      if (newToken) {
        (original.headers as Record<string, string>)['Authorization'] = `Bearer ${newToken}`;
        return api(original);
      }
      if (typeof window !== 'undefined') window.location.href = '/login';
    }

    console.error('[API Error]', err?.response?.data || err.message);
    return Promise.reject(err);
  },
);

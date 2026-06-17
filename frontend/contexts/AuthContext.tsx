'use client';

import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { tokenStore } from '@/lib/api';
import type { AuthUser } from '../../shared/types';

// Refresh 1 minute before the 15m access token expires
const REFRESH_INTERVAL_MS = 14 * 60 * 1000;

interface AuthContextValue {
  user: AuthUser | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshAccessToken: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshAccessToken = useCallback(async (): Promise<string | null> => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include', // sends httpOnly refresh token cookie
      });
      if (!res.ok) {
        setUser(null);
        tokenStore.setToken(null);
        return null;
      }
      const { data } = await res.json();
      setUser(data.user);
      tokenStore.setToken(data.accessToken);
      return data.accessToken;
    } catch {
      setUser(null);
      tokenStore.setToken(null);
      return null;
    }
  }, []);

  // Restore session from cookie on mount, then keep it alive with a silent interval
  useEffect(() => {
    tokenStore.setRefreshFn(refreshAccessToken);
    refreshAccessToken().finally(() => setIsLoading(false));
    intervalRef.current = setInterval(refreshAccessToken, REFRESH_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshAccessToken]);

  const login = async (email: string, password: string): Promise<void> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error ?? 'Login failed');
    }
    const { data } = await res.json();
    setUser(data.user);
    tokenStore.setToken(data.accessToken);
  };

  const logout = async (): Promise<void> => {
    await fetch('/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {}); // best-effort
    setUser(null);
    tokenStore.setToken(null);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isAuthenticated: !!user, login, logout, refreshAccessToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

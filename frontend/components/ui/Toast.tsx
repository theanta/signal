'use client';

import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { CheckCircle, XCircle, X, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

type ToastType = 'info' | 'success' | 'error';

interface Toast {
  id: string;
  type: ToastType;
  message: string;
  persistent?: boolean;
}

interface ToastContextValue {
  addToast: (toast: Omit<Toast, 'id'>) => string;
  updateToast: (id: string, updates: Partial<Omit<Toast, 'id'>>) => void;
  removeToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 4500;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const scheduleRemove = useCallback((id: string) => {
    const existing = timers.current.get(id);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => removeToast(id), AUTO_DISMISS_MS);
    timers.current.set(id, timer);
  }, [removeToast]);

  const addToast = useCallback((toast: Omit<Toast, 'id'>): string => {
    const id = Math.random().toString(36).slice(2, 9);
    setToasts(prev => [...prev, { ...toast, id }]);
    if (!toast.persistent) scheduleRemove(id);
    return id;
  }, [scheduleRemove]);

  const updateToast = useCallback((id: string, updates: Partial<Omit<Toast, 'id'>>) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, ...updates } : t));
    if (updates.persistent === false) scheduleRemove(id);
  }, [scheduleRemove]);

  // Clean up all timers on unmount
  useEffect(() => {
    const map = timers.current;
    return () => { map.forEach(clearTimeout); };
  }, []);

  return (
    <ToastContext.Provider value={{ addToast, updateToast, removeToast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

function ToastContainer({ toasts, onRemove }: { toasts: Toast[]; onRemove: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map(toast => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
      ))}
    </div>
  );
}

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: string) => void }) {
  const accentClass = {
    info: 'border-l-info',
    success: 'border-l-success',
    error: 'border-l-error',
  }[toast.type];

  const icon = {
    info: <RefreshCw className="w-4 h-4 text-info animate-spin flex-shrink-0" />,
    success: <CheckCircle className="w-4 h-4 text-success flex-shrink-0" />,
    error: <XCircle className="w-4 h-4 text-error flex-shrink-0" />,
  }[toast.type];

  return (
    <div
      className={cn(
        'pointer-events-auto flex items-center gap-3 pl-3 pr-2 py-3',
        'bg-canvas border border-hairline border-l-2 rounded-xl shadow-lg',
        'min-w-[260px] max-w-sm text-sm text-ink',
        'toast-enter',
        accentClass,
      )}
    >
      {icon}
      <span className="flex-1 leading-snug">{toast.message}</span>
      <button
        onClick={() => onRemove(toast.id)}
        className="p-0.5 text-muted hover:text-ink transition-colors flex-shrink-0"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

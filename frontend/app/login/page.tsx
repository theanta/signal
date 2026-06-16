'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Radar, AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      await login(email, password);
      router.push('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-surface-soft px-4">
      <div className="w-full max-w-sm">

        {/* Logo */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-9 h-9 bg-ink rounded-lg flex items-center justify-center flex-shrink-0">
            <Radar className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink tracking-wide">Lead Radar</div>
            <div className="text-[10px] text-muted font-medium tracking-widest uppercase">ANTA</div>
          </div>
        </div>

        <h1 className="text-title-sm text-ink mb-1">Welcome back</h1>
        <p className="text-sm text-muted mb-7">Sign in to your workspace</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-ink mb-1.5" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-canvas border border-hairline rounded-md text-ink placeholder:text-muted focus:outline-none focus:border-ink transition-colors"
              placeholder="you@anta.dev"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-ink mb-1.5" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 text-sm bg-canvas border border-hairline rounded-md text-ink placeholder:text-muted focus:outline-none focus:border-ink transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-canvas border border-sig-coral/30 rounded-md">
              <AlertCircle className="w-4 h-4 text-sig-coral flex-shrink-0" />
              <span className="text-sm text-sig-coral">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 bg-ink text-white text-sm font-medium rounded-md hover:bg-ink-active transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSubmitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-8 text-xs text-muted text-center">
          Detroit, MI · ANTA Software
        </p>
      </div>
    </div>
  );
}

'use client';

import { useState, FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Radar, AlertCircle, Zap, Target, Brain } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

const FEATURES = [
  { icon: Zap,    text: 'AI-powered hiring signal detection' },
  { icon: Target, text: 'Automated SMB lead scoring & qualification' },
  { icon: Brain,  text: 'Personalized outreach generated in seconds' },
];

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
    <div className="min-h-screen w-full flex">

      {/* ── Left panel — dark brand ── */}
      <div className="hidden lg:flex flex-col justify-between w-[480px] flex-shrink-0 bg-[#0f1117] px-12 py-10 relative overflow-hidden">

        {/* Background glow */}
        <div className="absolute -top-32 -left-32 w-96 h-96 rounded-full bg-brand/10 blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-64 h-64 rounded-full bg-brand/5 blur-2xl pointer-events-none" />

        {/* Logo */}
        <div className="flex items-center gap-3 relative">
          <div className="w-9 h-9 rounded-lg bg-brand flex items-center justify-center shadow-[0_0_16px_rgba(79,110,247,0.5)]">
            <Radar className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="text-base font-semibold text-white tracking-wide">Lead Radar</div>
            <div className="text-3xs text-white/40 font-medium tracking-[0.2em] uppercase">ANTA</div>
          </div>
        </div>

        {/* Hero copy */}
        <div className="relative space-y-8">
          <div className="space-y-3">
            <p className="text-2xs font-semibold text-brand tracking-[0.15em] uppercase">
              AI-Powered Lead Intelligence
            </p>
            <h2 className="text-[32px] font-semibold text-white leading-tight tracking-tight">
              Find the leads that&apos;re<br />
              ready to buy — before<br />
              your competitors do.
            </h2>
          </div>

          <ul className="space-y-4">
            {FEATURES.map(({ icon: Icon, text }) => (
              <li key={text} className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center flex-shrink-0">
                  <Icon className="w-3.5 h-3.5 text-brand" />
                </div>
                <span className="text-body-sm text-white/60 leading-snug">{text}</span>
              </li>
            ))}
          </ul>

        </div>

        {/* Footer */}
        <p className="text-2xs text-white/25 relative">
          Detroit, MI · ANTA Software
        </p>
      </div>

      {/* ── Right panel — form ── */}
      <div className="flex-1 flex items-center justify-center bg-neutral-50 px-6 py-10">
        <div className="w-full max-w-[360px]">

          {/* Mobile logo */}
          <div className="flex lg:hidden items-center gap-3 mb-8">
            <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center">
              <Radar className="w-4 h-4 text-white" />
            </div>
            <span className="text-base font-semibold text-ink">Lead Radar</span>
          </div>

          <div className="mb-8">
            <h1 className="text-title-xl font-semibold text-ink tracking-tight">Welcome back</h1>
            <p className="text-body-sm text-neutral-400 mt-1">Sign in to your workspace</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-neutral-600" htmlFor="email">
                Email address
              </label>
              <input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@anta.dev"
                className="w-full h-10 px-3.5 text-body-sm bg-white border border-neutral-200 rounded-lg text-ink placeholder:text-neutral-300 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[12px] font-medium text-neutral-600" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full h-10 px-3.5 text-body-sm bg-white border border-neutral-200 rounded-lg text-ink placeholder:text-neutral-300 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/10 transition-all"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2.5 px-3.5 py-2.5 bg-rose-50 border border-rose-200 rounded-lg">
                <AlertCircle className="w-4 h-4 text-rose-500 flex-shrink-0" />
                <span className="text-[13px] text-rose-600">{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full h-10 px-4 bg-brand text-white text-body-sm font-medium rounded-lg hover:bg-brand/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_1px_4px_rgba(79,110,247,0.3)] mt-2"
            >
              {isSubmitting ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="mt-10 text-[11.5px] text-neutral-300 text-center">
            Internal tool · ANTA Software
          </p>
        </div>
      </div>
    </div>
  );
}

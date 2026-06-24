'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ChevronRight, Search, Bell, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { CommandPalette } from './CommandPalette';

interface Breadcrumb {
  label: string;
  href?: string;
}

interface PageHeaderProps {
  title?: string;
  subtitle?: string;
  actions?: React.ReactNode;
  breadcrumbs?: Breadcrumb[];
  icon?: LucideIcon;
}

export default function PageHeader({ title, subtitle, actions, breadcrumbs, icon: Icon }: PageHeaderProps) {
  const [cmdOpen, setCmdOpen] = useState(false);

  return (
    <>
      <header
        className="flex items-center justify-between px-8 h-[60px] flex-shrink-0 border-b border-hairline bg-white"
      >
        {/* Left: icon + title/subtitle or breadcrumbs */}
        <div className="flex items-center gap-3 min-w-0">
          {Icon && (
            <div className="w-8 h-8 rounded-lg bg-brand-50 border border-brand-100 flex items-center justify-center flex-shrink-0">
              <Icon className="w-[15px] h-[15px] text-brand-500" />
            </div>
          )}
          <div className="min-w-0">
            {breadcrumbs && breadcrumbs.length > 0 && (
              <nav className="flex items-center gap-1">
                {breadcrumbs.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    {i > 0 && <ChevronRight className="w-3 h-3 text-neutral-300" />}
                    {crumb.href ? (
                      <Link
                        href={crumb.href}
                        className="text-body-sm text-neutral-400 hover:text-ink transition-colors"
                      >
                        {crumb.label}
                      </Link>
                    ) : (
                      <span className="text-body-sm font-medium text-ink">{crumb.label}</span>
                    )}
                  </span>
                ))}
              </nav>
            )}
            {!breadcrumbs?.length && title && (
              <div className="flex items-baseline gap-2.5">
                <h1 className="text-base font-semibold text-ink leading-tight tracking-[-0.01em]">
                  {title}
                </h1>
                {subtitle && (
                  <span className="text-xs text-neutral-400 truncate hidden sm:block">{subtitle}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: page actions + search + bell */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-4">
          {actions && <div className="flex items-center gap-2">{actions}</div>}

          {actions && <div className="w-px h-5 bg-neutral-200 mx-1" />}

          <button
            onClick={() => setCmdOpen(true)}
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium',
              'text-neutral-400 bg-neutral-50 border border-neutral-200',
              'hover:bg-neutral-100 hover:text-neutral-600 transition-colors',
            )}
          >
            <Search className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Search</span>
            <kbd className="hidden sm:inline-flex items-center gap-0.5 ml-1 text-2xs text-neutral-400">
              <span className="font-sans">⌘</span>K
            </kbd>
          </button>

          <button className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors">
            <Bell className="w-4 h-4" />
          </button>
        </div>
      </header>

      <CommandPalette open={cmdOpen} onOpenChange={setCmdOpen} />
    </>
  );
}

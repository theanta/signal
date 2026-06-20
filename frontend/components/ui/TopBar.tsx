'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Search, Bell, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Crumb {
  label: string;
  href:  string;
}

function useBreadcrumbs(): Crumb[] {
  const pathname = usePathname() ?? '';

  if (pathname === '/dashboard')  return [{ label: 'Dashboard',      href: '/dashboard' }];
  if (pathname === '/leads/new')  return [{ label: 'Leads', href: '/leads' }, { label: 'New Lead', href: '/leads/new' }];
  if (pathname.startsWith('/leads/') && pathname !== '/leads/')
    return [{ label: 'Leads', href: '/leads' }, { label: 'Lead Detail', href: pathname }];
  if (pathname.startsWith('/leads'))   return [{ label: 'Leads',          href: '/leads' }];
  if (pathname.startsWith('/outreach'))return [{ label: 'Outreach Queue', href: '/outreach' }];
  if (pathname.startsWith('/signals')) return [{ label: 'Signals',        href: '/signals' }];
  if (pathname.startsWith('/settings'))return [{ label: 'Settings',       href: '/settings' }];

  return [];
}

interface TopBarProps {
  onSearchClick?: () => void;
}

export default function TopBar({ onSearchClick }: TopBarProps) {
  const crumbs = useBreadcrumbs();

  return (
    <header className="h-[44px] flex-shrink-0 flex items-center justify-between px-6 bg-white border-b border-hairline z-10">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-[13px]">
        {crumbs.map((crumb, i) => (
          <span key={crumb.href} className="flex items-center gap-1.5">
            {i > 0 && <ChevronRight className="w-3.5 h-3.5 text-neutral-300 flex-shrink-0" />}
            {i === crumbs.length - 1 ? (
              <span className="font-medium text-ink">{crumb.label}</span>
            ) : (
              <Link
                href={crumb.href}
                className="text-neutral-400 hover:text-ink transition-colors"
              >
                {crumb.label}
              </Link>
            )}
          </span>
        ))}
      </nav>

      {/* Right actions */}
      <div className="flex items-center gap-1">
        {/* ⌘K trigger — wired to command palette in Step 3 */}
        <button
          onClick={onSearchClick}
          className={cn(
            'flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-medium',
            'text-neutral-400 bg-neutral-50 border border-neutral-200',
            'hover:bg-neutral-100 hover:text-neutral-600 transition-colors',
          )}
        >
          <Search className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Search</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 ml-1 text-[11px] text-neutral-400">
            <span className="font-sans">⌘</span>K
          </kbd>
        </button>

        {/* Notification bell (placeholder) */}
        <button className="w-8 h-8 flex items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-600 transition-colors">
          <Bell className="w-4 h-4" />
        </button>
      </div>
    </header>
  );
}

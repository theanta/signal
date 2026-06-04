'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Send,
  Zap,
  Settings,
  Radar,
} from 'lucide-react';
import { clsx } from 'clsx';

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/leads', icon: Users, label: 'Leads' },
  { href: '/outreach', icon: Send, label: 'Outreach Queue' },
  { href: '/signals', icon: Zap, label: 'Signals' },
  { href: '/settings', icon: Settings, label: 'Settings' },
];

export default function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-canvas border-r border-hairline h-screen">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-hairline">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 bg-ink rounded-lg flex items-center justify-center">
            <Radar className="w-4 h-4 text-white" />
          </div>
          <div>
            <div className="text-sm font-semibold text-ink tracking-wide">Lead Radar</div>
            <div className="text-[10px] text-muted font-medium tracking-widest uppercase">ANTA</div>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {NAV_ITEMS.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors duration-100',
                isActive
                  ? 'bg-ink text-white'
                  : 'text-body hover:bg-surface-soft hover:text-ink'
              )}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{label}</span>
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="px-5 py-4 border-t border-hairline">
        <div className="text-xs text-muted">Detroit, MI · ANTA Software</div>
      </div>
    </aside>
  );
}

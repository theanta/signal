'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  Send,
  Zap,
  Settings,
  Radar,
  LogOut,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/contexts/AuthContext';

const MAIN_NAV = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard' },
  { href: '/leads',     icon: Users,           label: 'Leads' },
  { href: '/outreach',  icon: Send,            label: 'Outreach' },
  { href: '/signals',   icon: Zap,             label: 'Signals' },
];

function getInitials(name: string) {
  return name
    .split(' ')
    .map(w => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

export default function Sidebar() {
  const pathname  = usePathname();
  const router    = useRouter();
  const { user, logout } = useAuth();

  const [collapsed, setCollapsed] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Read persisted state after mount to avoid SSR mismatch
  useEffect(() => {
    setMounted(true);
    setCollapsed(localStorage.getItem('sidebar-collapsed') === 'true');
  }, []);

  function toggleCollapse() {
    const next = !collapsed;
    setCollapsed(next);
    localStorage.setItem('sidebar-collapsed', String(next));
  }

  const handleLogout = async () => {
    await logout();
    router.push('/login');
  };

  function isActive(href: string) {
    if (href === '/dashboard') return pathname === href;
    return pathname === href || pathname.startsWith(href + '/');
  }

  // Prevent width flash before localStorage is read
  const width = !mounted ? 'w-[220px]' : collapsed ? 'w-[60px]' : 'w-[220px]';

  return (
    <aside
      className={cn(
        'sidebar-scroll flex-shrink-0 flex flex-col h-screen overflow-y-auto overflow-x-hidden',
        'bg-[#0f1117] border-r border-[rgba(255,255,255,0.06)]',
        'transition-[width] duration-200 ease-in-out',
        width,
      )}
    >
      {/* ── Logo ── */}
      <div className={cn(
        'flex items-center border-b border-[rgba(255,255,255,0.06)]',
        'h-[56px] flex-shrink-0',
        collapsed ? 'justify-center px-0' : 'px-4 gap-3',
      )}>
        <div className="w-8 h-8 rounded-lg bg-brand/20 flex items-center justify-center flex-shrink-0 shadow-sidebar-glow">
          <Radar className="w-4 h-4 text-brand-400" />
        </div>

        {!collapsed && (
          <div className="min-w-0">
            <div className="text-body-sm font-semibold text-white leading-tight tracking-wide truncate">
              Lead Radar
            </div>
            <div className="text-3xs font-semibold text-brand-400 tracking-[0.18em] uppercase leading-tight">
              ANTA
            </div>
          </div>
        )}
      </div>

      {/* ── Main nav ── */}
      <nav className={cn('flex-1 py-3 space-y-0.5', collapsed ? 'px-2' : 'px-3')}>
        {MAIN_NAV.map(({ href, icon: Icon, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'sidebar-item',
                collapsed && 'justify-center px-0 w-full',
                active && 'active',
              )}
            >
              <Icon className="w-[17px] h-[17px] flex-shrink-0" />
              {!collapsed && <span className="truncate">{label}</span>}
            </Link>
          );
        })}

        {/* Divider */}
        <div className="my-2 border-t border-[rgba(255,255,255,0.06)]" />

        {/* Settings */}
        <Link
          href="/settings"
          title={collapsed ? 'Settings' : undefined}
          className={cn(
            'sidebar-item',
            collapsed && 'justify-center px-0 w-full',
            isActive('/settings') && 'active',
          )}
        >
          <Settings className="w-[17px] h-[17px] flex-shrink-0" />
          {!collapsed && <span className="truncate">Settings</span>}
        </Link>
      </nav>

      {/* ── Collapse toggle ── */}
      <div className={cn(
        'flex-shrink-0 border-t border-[rgba(255,255,255,0.06)] py-2',
        collapsed ? 'px-2' : 'px-3',
      )}>
        <button
          onClick={toggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className={cn(
            'sidebar-item w-full text-[#5a6270] hover:text-[#a0a8b4]',
            collapsed && 'justify-center px-0',
          )}
        >
          {collapsed
            ? <ChevronRight className="w-4 h-4" />
            : <>
                <ChevronLeft className="w-4 h-4" />
                <span className="text-xs">Collapse</span>
              </>
          }
        </button>
      </div>

      {/* ── User footer ── */}
      <div className={cn(
        'flex-shrink-0 border-t border-[rgba(255,255,255,0.06)] py-3',
        collapsed ? 'px-2' : 'px-3',
      )}>
        {user && (
          <div
            className={cn(
              'flex items-center mb-1',
              collapsed ? 'justify-center' : 'gap-2.5 px-2 py-1.5 mb-2',
            )}
            title={collapsed ? `${user.name}\n${user.email}` : undefined}
          >
            {/* Avatar */}
            <div className="w-7 h-7 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center flex-shrink-0">
              <span className="text-3xs font-semibold text-brand-400 leading-none">
                {getInitials(user.name || user.email || 'U')}
              </span>
            </div>

            {!collapsed && (
              <div className="min-w-0">
                <div className="text-xs font-medium text-white truncate leading-tight">
                  {user.name}
                </div>
                <div className="text-[11px] text-[#5a6270] truncate leading-tight">
                  {user.email}
                </div>
              </div>
            )}
          </div>
        )}

        <button
          onClick={handleLogout}
          title={collapsed ? 'Sign out' : undefined}
          className={cn(
            'sidebar-item w-full text-[#5a6270] hover:text-[#a0a8b4]',
            collapsed && 'justify-center px-0',
          )}
        >
          <LogOut className="w-[15px] h-[15px] flex-shrink-0" />
          {!collapsed && <span className="text-xs">Sign out</span>}
        </button>
      </div>
    </aside>
  );
}

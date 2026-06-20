'use client';

import { useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Command } from 'cmdk';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Users, Send, Zap, Settings,
  Plus, RefreshCw, Brain, Search, ArrowRight,
  X, Building2,
} from 'lucide-react';
import { fetchLeads } from '@/services/leads';
import { api } from '@/lib/api';
import { toast } from '@/lib/toast';
import { cn, scoreTier } from '@/lib/utils';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard',      value: 'dashboard' },
  { href: '/leads',     icon: Users,           label: 'Leads',          value: 'leads' },
  { href: '/outreach',  icon: Send,            label: 'Outreach Queue', value: 'outreach queue' },
  { href: '/signals',   icon: Zap,             label: 'Signals',        value: 'signals' },
  { href: '/settings',  icon: Settings,        label: 'Settings',       value: 'settings' },
];

const SCORE_STYLES = {
  hot:  'bg-emerald-50 text-emerald-700',
  warm: 'bg-amber-50 text-amber-700',
  cold: 'bg-neutral-100 text-neutral-500',
};

const itemCn = cn(
  'flex items-center gap-3 px-3 py-2.5 rounded-lg mx-1 my-0.5',
  'text-[13.5px] text-neutral-700 cursor-pointer select-none outline-none',
  'transition-colors duration-75',
  'data-[selected=true]:bg-brand-50 data-[selected=true]:text-brand-700',
  'hover:bg-neutral-50',
);

const groupHeadingCn = 'text-[10.5px] font-semibold text-neutral-400 uppercase tracking-[0.08em] px-4 pt-3 pb-1.5';

export function CommandPalette({ open, onOpenChange }: Props) {
  const router = useRouter();

  // ── Keyboard shortcut ──
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onOpenChange(!open);
    }
  }, [open, onOpenChange]);

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // ── Recent leads (only fetch when open) ──
  const { data: recentLeads = [] } = useQuery({
    queryKey: ['cmd-recent-leads'],
    queryFn: async () => {
      const result = await fetchLeads({ per_page: 5, sort_by: 'lead_score', sort_order: 'desc' });
      return result.data;
    },
    enabled: open,
    staleTime: 60_000,
  });

  // ── Helpers ──
  function navigate(href: string) {
    router.push(href);
    onOpenChange(false);
  }

  async function runJob(job: string, label: string) {
    onOpenChange(false);
    const id = toast.loading(`Triggering ${label}…`);
    try {
      await api.post(`/cron/run/${job}`);
      toast.dismiss(id);
      toast.success(`${label} triggered`, 'Check Signals for progress');
    } catch {
      toast.dismiss(id);
      toast.error(`Failed to trigger ${label}`);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        {/* Overlay */}
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-50',
            'bg-black/40 backdrop-blur-[3px]',
            'data-[state=open]:animate-fade-in',
            'data-[state=closed]:animate-fade-out',
          )}
        />

        {/* Panel */}
        <Dialog.Content
          aria-label="Command palette"
          className={cn(
            'fixed inset-0 z-50 flex items-start justify-center pt-[14vh]',
            'outline-none',
          )}
        >
          <Command
            className={cn(
              'w-[560px] bg-white rounded-2xl overflow-hidden',
              'border border-neutral-200/80',
              'shadow-[0_25px_50px_-12px_rgb(0_0_0/0.35),0_0_0_1px_rgb(0_0_0/0.06)]',
              'data-[state=open]:animate-scale-in',
            )}
          >
            {/* ── Search input ── */}
            <div className="flex items-center gap-3 px-4 border-b border-hairline h-[52px]">
              <Search className="w-4 h-4 text-neutral-400 flex-shrink-0" />
              <Command.Input
                autoFocus
                placeholder="Search leads, pages, actions…"
                className={cn(
                  'flex-1 bg-transparent text-[14px] text-ink',
                  'placeholder:text-neutral-400 outline-none',
                  'caret-brand',
                )}
              />
              <button
                onClick={() => onOpenChange(false)}
                className="flex items-center gap-1 text-[11px] text-neutral-400 hover:text-neutral-600 transition-colors"
              >
                <kbd className="px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 font-sans text-[10px]">
                  Esc
                </kbd>
              </button>
            </div>

            {/* ── List ── */}
            <Command.List className="max-h-[380px] overflow-y-auto pb-2">

              <Command.Empty className="py-12 text-center">
                <div className="flex flex-col items-center gap-2">
                  <Search className="w-8 h-8 text-neutral-200" />
                  <p className="text-[13px] text-neutral-400">No results found</p>
                </div>
              </Command.Empty>

              {/* ── Navigation ── */}
              <Command.Group>
                <div className={groupHeadingCn}>Navigation</div>
                {NAV_ITEMS.map(({ href, icon: Icon, label, value }) => (
                  <Command.Item
                    key={href}
                    value={value}
                    onSelect={() => navigate(href)}
                    className={itemCn}
                  >
                    <span className="w-7 h-7 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0">
                      <Icon className="w-3.5 h-3.5 text-neutral-500" />
                    </span>
                    <span className="flex-1">{label}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-neutral-300" />
                  </Command.Item>
                ))}
              </Command.Group>

              {/* ── Quick actions ── */}
              <Command.Group>
                <div className={groupHeadingCn}>Quick Actions</div>

                <Command.Item
                  value="add lead new lead"
                  onSelect={() => navigate('/leads/new')}
                  className={itemCn}
                >
                  <span className="w-7 h-7 rounded-md bg-brand-50 flex items-center justify-center flex-shrink-0">
                    <Plus className="w-3.5 h-3.5 text-brand-600" />
                  </span>
                  <span className="flex-1">Add Lead</span>
                  <kbd className="text-[10.5px] text-neutral-300 font-mono">↵</kbd>
                </Command.Item>

                <Command.Item
                  value="run scrape scraping linkedin"
                  onSelect={() => runJob('scrape', 'Daily Scrape')}
                  className={itemCn}
                >
                  <span className="w-7 h-7 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0">
                    <RefreshCw className="w-3.5 h-3.5 text-neutral-500" />
                  </span>
                  <span className="flex-1">Run Daily Scrape</span>
                </Command.Item>

                <Command.Item
                  value="analyze leads signal detection"
                  onSelect={() => runJob('analyze', 'Lead Analysis')}
                  className={itemCn}
                >
                  <span className="w-7 h-7 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0">
                    <Zap className="w-3.5 h-3.5 text-neutral-500" />
                  </span>
                  <span className="flex-1">Analyze New Leads</span>
                </Command.Item>

                <Command.Item
                  value="generate outreach cold email"
                  onSelect={() => runJob('outreach', 'Outreach Generation')}
                  className={itemCn}
                >
                  <span className="w-7 h-7 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0">
                    <Brain className="w-3.5 h-3.5 text-neutral-500" />
                  </span>
                  <span className="flex-1">Generate Outreach</span>
                </Command.Item>
              </Command.Group>

              {/* ── Recent / top leads ── */}
              {recentLeads.length > 0 && (
                <Command.Group>
                  <div className={groupHeadingCn}>Top Leads</div>
                  {recentLeads.map(lead => {
                    const tier = scoreTier(lead.lead_score ?? 0);
                    return (
                      <Command.Item
                        key={lead.id}
                        value={`${lead.company_name} ${lead.industry ?? ''} ${lead.location ?? ''}`}
                        onSelect={() => navigate(`/leads/${lead.id}`)}
                        className={itemCn}
                      >
                        <span className="w-7 h-7 rounded-md bg-neutral-100 flex items-center justify-center flex-shrink-0 text-neutral-400">
                          <Building2 className="w-3.5 h-3.5" />
                        </span>
                        <span className="flex-1 min-w-0">
                          <span className="block truncate font-medium">{lead.company_name}</span>
                          {(lead.location || lead.industry) && (
                            <span className="block text-[11.5px] text-neutral-400 truncate">
                              {[lead.industry, lead.location].filter(Boolean).join(' · ')}
                            </span>
                          )}
                        </span>
                        {lead.lead_score != null && (
                          <span className={cn(
                            'text-[11px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0',
                            SCORE_STYLES[tier],
                          )}>
                            {lead.lead_score}
                          </span>
                        )}
                      </Command.Item>
                    );
                  })}

                  <Command.Item
                    value="view all leads"
                    onSelect={() => navigate('/leads')}
                    className={cn(itemCn, 'text-neutral-400 text-[12.5px]')}
                  >
                    <span className="w-7 h-7" />
                    <span>View all leads →</span>
                  </Command.Item>
                </Command.Group>
              )}

            </Command.List>
          </Command>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

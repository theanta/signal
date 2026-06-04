'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchDashboardMetrics } from '@/services/metrics';
import { useScrapeJob } from '@/hooks/useScrapeJob';
import MetricCard from '@/components/dashboard/MetricCard';
import PipelineBar from '@/components/dashboard/PipelineBar';
import HotLeadsWidget from '@/components/dashboard/HotLeadsWidget';
import PageHeader from '@/components/ui/PageHeader';
import LoadingSpinner from '@/components/ui/LoadingSpinner';
import {
  Users, Flame, Send, MessageSquare,
  Calendar, Star, Plus, RefreshCw,
} from 'lucide-react';

export default function DashboardPage() {
  const { data: metrics, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-metrics'],
    queryFn: fetchDashboardMetrics,
    refetchInterval: 60_000,
  });

  const { trigger: handleScrape, running: scraping } = useScrapeJob(refetch);

  return (
    <div className="min-h-screen">
      <PageHeader
        title="Dashboard"
        subtitle="ANTA Lead Radar — AI-powered lead intelligence"
        actions={
          <button
            onClick={handleScrape}
            disabled={scraping}
            className="btn-primary gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
            {scraping ? 'Scraping...' : 'Run Scrape'}
          </button>
        }
      />

      <div className="p-8 space-y-6">
        {isLoading ? (
          <LoadingSpinner />
        ) : (
          <>
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Total Leads"
                value={metrics?.total_leads ?? 0}
                icon={Users}
                color="ink"
                sublabel={`${metrics?.new_today ?? 0} added today`}
              />
              <MetricCard
                label="Hot Leads"
                value={metrics?.hot_leads ?? 0}
                icon={Flame}
                color="coral"
                sublabel="Score ≥ 70"
              />
              <MetricCard
                label="Contacted"
                value={metrics?.contacted ?? 0}
                icon={Send}
                color="info"
              />
              <MetricCard
                label="Avg Score"
                value={metrics?.avg_score ?? 0}
                icon={Star}
                color="mustard"
                sublabel="Across all leads"
              />
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                label="Replies"
                value={metrics?.replied ?? 0}
                icon={MessageSquare}
                color="forest"
              />
              <MetricCard
                label="Meetings"
                value={metrics?.meetings ?? 0}
                icon={Calendar}
                color="info"
              />
              <MetricCard
                label="Clients"
                value={metrics?.clients ?? 0}
                icon={Star}
                color="forest"
                sublabel="Active clients"
              />
              <div className="card p-5 flex flex-col items-center justify-center gap-2 border-dashed cursor-pointer hover:bg-surface-soft transition-colors">
                <a href="/leads/new" className="flex flex-col items-center gap-2 text-center">
                  <Plus className="w-5 h-5 text-muted" />
                  <span className="text-sm text-muted">Add Lead Manually</span>
                </a>
              </div>
            </div>

            {/* Pipeline + Hot Leads */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <PipelineBar />
              <HotLeadsWidget />
            </div>

            {/* Quick Actions */}
            <div className="card p-5">
              <h3 className="text-sm font-medium text-ink mb-4">Quick Actions</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {[
                  { label: 'View All Leads', href: '/leads', icon: Users },
                  { label: 'Outreach Queue', href: '/outreach', icon: Send },
                  { label: 'Signal Logs', href: '/signals', icon: RefreshCw },
                  { label: 'Settings', href: '/settings', icon: Star },
                ].map(({ label, href, icon: Icon }) => (
                  <a
                    key={href}
                    href={href}
                    className="flex items-center gap-2.5 px-4 py-3 bg-surface-soft hover:bg-surface-strong rounded-md text-sm text-body transition-colors"
                  >
                    <Icon className="w-4 h-4 text-muted" />
                    {label}
                  </a>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

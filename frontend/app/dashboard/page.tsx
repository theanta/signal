'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchAllDashboard } from '@/services/metrics';
import { useScrapeJob } from '@/hooks/useScrapeJob';
import ScrapeProgressPanel from '@/components/scrape/ScrapeProgressPanel';
import MetricCard from '@/components/dashboard/MetricCard';
import PipelineBar from '@/components/dashboard/PipelineBar';
import HotLeadsWidget from '@/components/dashboard/HotLeadsWidget';
import ApplyWorthyJobsWidget from '@/components/dashboard/ApplyWorthyJobsWidget';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import AIInsightsPanel from '@/components/dashboard/AIInsightsPanel';
import PageHeader from '@/components/ui/PageHeader';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import { Users, Flame, Send, Star, RefreshCw, LayoutDashboard } from 'lucide-react';

export default function DashboardPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-all'],
    queryFn: fetchAllDashboard,
    refetchInterval: 60_000,
  });

  const { trigger: handleScrape, running: scraping, sources: scrapeSources } = useScrapeJob(refetch);
  const metrics = data?.metrics;

  return (
    <div className="min-h-screen animate-fade-in flex flex-col">
      <PageHeader
        title="Dashboard"
        subtitle="ANTA Lead Radar — AI-powered lead intelligence"
        icon={LayoutDashboard}
        actions={
          <div className="flex items-center gap-2.5">
            <span className="live-pill" title={scraping ? 'Radar scanning for signals' : 'Radar online'}>
              <span className="live-dot" />
              {scraping ? 'Scanning' : 'Radar live'}
            </span>
            <button onClick={handleScrape} disabled={scraping} className="btn-primary">
              <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
              {scraping ? 'Scraping…' : 'Run Scrape'}
            </button>
            <ScrapeProgressPanel running={scraping} sources={scrapeSources} />
          </div>
        }
      />

      {isLoading ? (
        <DashboardSkeleton />
      ) : (
        /* ── Split: left bento grid + right AI panel ── */
        <div className="ambient-signal flex gap-5 px-6 py-5 flex-1 min-h-0">

          {/* ── LEFT: Bento grid ── */}
          <div className="relative z-10 flex-1 min-w-0 space-y-4 overflow-y-auto">

            {/* Row 1: Primary KPIs */}
            <div className="stagger grid grid-cols-2 lg:grid-cols-4 gap-4">
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
                sublabel={`${metrics?.replied ?? 0} replied`}
              />
              <MetricCard
                label="Avg Score"
                value={metrics?.avg_score ?? 0}
                icon={Star}
                color="mustard"
                sublabel="Across all leads"
              />
            </div>

            {/* Row 2: Pipeline (3/5) + Hot Leads (2/5) */}
            <div className="grid grid-cols-5 gap-4">
              <div className="col-span-3">
                <PipelineBar pipeline={data?.pipeline} />
              </div>
              <div className="col-span-2">
                <HotLeadsWidget leads={data?.hotLeads} />
              </div>
            </div>

            {/* Row 3: Activity feed (3/5) + Apply-worthy jobs (2/5) */}
            <div className="grid grid-cols-5 gap-4">
              <div className="col-span-3">
                <ActivityFeed />
              </div>
              <div className="col-span-2">
                <ApplyWorthyJobsWidget />
              </div>
            </div>
          </div>

          {/* ── RIGHT: AI Intelligence Panel (sticky) ── */}
          <div className="relative z-10 w-[268px] flex-shrink-0">
            <div className="sticky top-5">
              <AIInsightsPanel
                metrics={metrics}
                pipeline={data?.pipeline}
                hotLeads={data?.hotLeads}
              />
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

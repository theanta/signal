'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchAllDashboard } from '@/services/metrics';
import { useScrapeJob } from '@/hooks/useScrapeJob';
import MetricCard from '@/components/dashboard/MetricCard';
import PipelineBar from '@/components/dashboard/PipelineBar';
import HotLeadsWidget from '@/components/dashboard/HotLeadsWidget';
import ActivityFeed from '@/components/dashboard/ActivityFeed';
import PageHeader from '@/components/ui/PageHeader';
import { DashboardSkeleton } from '@/components/ui/Skeleton';
import {
  Users, Flame, Send, MessageSquare,
  Calendar, Star, Plus, RefreshCw, LayoutDashboard,
} from 'lucide-react';
import Link from 'next/link';

export default function DashboardPage() {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['dashboard-all'],
    queryFn: fetchAllDashboard,
    refetchInterval: 60_000,
  });

  const { trigger: handleScrape, running: scraping } = useScrapeJob(refetch);
  const metrics = data?.metrics;

  return (
    <div className="min-h-screen animate-fade-in">
      <PageHeader
        title="Dashboard"
        subtitle="ANTA Lead Radar — AI-powered lead intelligence"
        icon={LayoutDashboard}
        actions={
          <button
            onClick={handleScrape}
            disabled={scraping}
            className="btn-primary"
          >
            <RefreshCw className={`w-4 h-4 ${scraping ? 'animate-spin' : ''}`} />
            {scraping ? 'Scraping…' : 'Run Scrape'}
          </button>
        }
      />

      {isLoading ? (
        <DashboardSkeleton />
      ) : (
        <div className="px-8 py-6 space-y-6">

          {/* ── Row 1: Primary metrics ── */}
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

          {/* ── Row 2: Secondary metrics ── */}
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
            {/* Add lead card */}
            <Link
              href="/leads/new"
              className="card p-5 flex flex-col items-center justify-center gap-2 border-dashed cursor-pointer hover:bg-neutral-50 hover:shadow-card-md transition-all text-center group"
            >
              <div className="w-8 h-8 rounded-full bg-neutral-100 flex items-center justify-center group-hover:bg-brand-50 transition-colors">
                <Plus className="w-4 h-4 text-neutral-400 group-hover:text-brand-500 transition-colors" />
              </div>
              <span className="text-[12.5px] text-neutral-400 group-hover:text-brand-600 font-medium transition-colors">
                Add Lead Manually
              </span>
            </Link>
          </div>

          {/* ── Row 3: Pipeline (3/5) + Hot Leads (2/5) ── */}
          <div className="grid grid-cols-5 gap-6">
            <div className="col-span-3">
              <PipelineBar pipeline={data?.pipeline} />
            </div>
            <div className="col-span-2">
              <HotLeadsWidget leads={data?.hotLeads} />
            </div>
          </div>

          {/* ── Row 4: Activity feed ── */}
          <ActivityFeed />

        </div>
      )}
    </div>
  );
}

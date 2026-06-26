'use client';

import { useQuery } from '@tanstack/react-query';
import { fetchPipeline } from '@/services/metrics';
import type { PipelineSummary } from '../../../shared/types';
import {
  ResponsiveContainer, BarChart, Bar,
  XAxis, YAxis, Tooltip,
} from 'recharts';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

const STATUS_ORDER = ['new', 'analyzed', 'contacted', 'replied', 'meeting', 'proposal', 'client'] as const;

const STAGE_CONFIG: Record<string, { label: string; color: string }> = {
  new:       { label: 'New',       color: '#3a4258' },
  analyzed:  { label: 'Analyzed',  color: '#4f6ef7' },
  contacted: { label: 'Contacted', color: '#6b82f8' },
  replied:   { label: 'Replied',   color: '#a78bfa' },
  meeting:   { label: 'Meeting',   color: '#fbbf24' },
  proposal:  { label: 'Proposal',  color: '#fb923c' },
  client:    { label: 'Client',    color: '#4ade80' },
};

interface Props {
  pipeline?: PipelineSummary[];
}

interface TooltipProps {
  active?: boolean;
  payload?: Array<{ value: number; payload: { label: string; avgScore: number } }>;
}

function CustomTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const { label, avgScore } = payload[0].payload;
  return (
    <div className="bg-canvas border border-hairline rounded-lg shadow-card-md px-3 py-2 text-[12px]">
      <p className="font-semibold text-ink">{label}</p>
      <p className="text-muted mt-0.5">
        {payload[0].value} lead{payload[0].value !== 1 ? 's' : ''}
      </p>
      {avgScore > 0 && (
        <p className="text-muted">Avg score: {avgScore.toFixed(0)}</p>
      )}
    </div>
  );
}

interface BarShapeProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  color?: string;
}

function ColoredBar({ x = 0, y = 0, width = 0, height = 0, color = '#3a4258' }: BarShapeProps) {
  if (width <= 0 || height <= 0) return <g />;
  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      fill={color}
      fillOpacity={0.9}
      rx={5}
      ry={5}
    />
  );
}

export default function PipelineBar({ pipeline: pipelineProp }: Props) {
  const { data: fetched = [] } = useQuery({
    queryKey: ['pipeline'],
    queryFn: fetchPipeline,
    enabled: pipelineProp === undefined,
  });

  const pipeline = (pipelineProp ?? fetched) as PipelineSummary[];
  const pipelineMap = Object.fromEntries(pipeline.map(p => [p.status, p]));

  const chartData = STATUS_ORDER.map(status => ({
    label:    STAGE_CONFIG[status].label,
    color:    STAGE_CONFIG[status].color,
    count:    pipelineMap[status]?.count     ?? 0,
    avgScore: pipelineMap[status]?.avg_score ?? 0,
  }));

  const total = chartData.reduce((sum, d) => sum + d.count, 0);

  return (
    <div className="card-bento p-5 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-[13.5px] font-semibold text-ink">Lead Pipeline</h3>
          <p className="text-[12px] text-muted mt-0.5">{total} total leads</p>
        </div>
        <Link
          href="/leads"
          className="flex items-center gap-1 text-[12px] text-brand-400 hover:text-brand-300 font-medium transition-colors"
        >
          View all <ArrowRight className="w-3 h-3" />
        </Link>
      </div>

      <div className="flex-1 min-h-[210px]">
        <ResponsiveContainer width="100%" height={210}>
          <BarChart
            data={chartData}
            layout="vertical"
            margin={{ top: 0, right: 16, left: 0, bottom: 0 }}
            barCategoryGap="28%"
          >
            <XAxis
              type="number"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 11, fill: '#5a6275' }}
              allowDecimals={false}
            />
            <YAxis
              type="category"
              dataKey="label"
              axisLine={false}
              tickLine={false}
              tick={{ fontSize: 12, fill: '#8b95a8', fontWeight: 500 }}
              width={68}
            />
            <Tooltip
              content={<CustomTooltip />}
              cursor={{ fill: 'rgba(255,255,255,0.03)', radius: 4 } as React.SVGProps<SVGRectElement>}
            />
            <Bar dataKey="count" minPointSize={3} shape={<ColoredBar />} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

import { LeadStatus, LeadSource } from '../types';

export function formatScore(score: number | undefined): string {
  if (score === undefined || score === null) return 'N/A';
  return `${score}/100`;
}

export function getScoreBand(score: number): 'hot' | 'warm' | 'cool' | 'cold' {
  if (score >= 75) return 'hot';
  if (score >= 55) return 'warm';
  if (score >= 35) return 'cool';
  return 'cold';
}

export function getScoreColor(score: number): string {
  const band = getScoreBand(score);
  return {
    hot: '#ef4444',
    warm: '#f97316',
    cool: '#3b82f6',
    cold: '#6b7280',
  }[band];
}

export function getStatusLabel(status: LeadStatus): string {
  const labels: Record<LeadStatus, string> = {
    new: 'New',
    analyzed: 'Analyzed',
    contacted: 'Contacted',
    replied: 'Replied',
    meeting: 'Meeting',
    proposal: 'Proposal',
    client: 'Client',
  };
  return labels[status] ?? status;
}

export function getStatusColor(status: LeadStatus): string {
  const colors: Record<LeadStatus, string> = {
    new: '#6b7280',
    analyzed: '#3b82f6',
    contacted: '#8b5cf6',
    replied: '#f59e0b',
    meeting: '#10b981',
    proposal: '#f97316',
    client: '#22c55e',
  };
  return colors[status] ?? '#6b7280';
}

export function getSourceLabel(source: LeadSource): string {
  const labels: Record<LeadSource, string> = {
    job_board: 'Job Board',
    local_business: 'Local Business',
    linkedin: 'LinkedIn',
    crunchbase: 'Crunchbase',
    manual: 'Manual',
    other: 'Other',
  };
  return labels[source] ?? source;
}

export function formatDate(dateStr: string | undefined): string {
  if (!dateStr) return 'N/A';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 3) + '...';
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function buildLinkedInUrl(companyName: string): string {
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return `https://www.linkedin.com/company/${slug}`;
}

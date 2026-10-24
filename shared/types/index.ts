// ============================================================
// ANTA Lead Radar - Shared Types
// ============================================================

export type LeadStatus =
  | 'new'
  | 'analyzed'
  | 'contacted'
  | 'replied'
  | 'meeting'
  | 'proposal'
  | 'client';

export type LeadSource =
  | 'job_board'
  | 'local_business'
  | 'linkedin'
  | 'crunchbase'
  | 'manual'
  | 'other';

export type LeadTab = 'all' | 'hiring' | 'discovery';

export const HIRING_SOURCES: LeadSource[] = ['linkedin', 'job_board'];
export const DISCOVERY_SOURCES: LeadSource[] = ['crunchbase', 'local_business'];

export type OutreachChannel = 'email' | 'linkedin' | 'phone' | 'other';
export type OutreachStatus = 'draft' | 'sent' | 'opened' | 'replied' | 'bounced';

// ---- Core Lead ----

export interface Lead {
  org_id: string;
  id: string;
  company_name: string;
  website?: string;
  linkedin_url?: string;
  location?: string;
  industry?: string;
  company_size?: string;
  description?: string;
  status: LeadStatus;
  source: LeadSource;
  source_url?: string;
  lead_score?: number;
  hiring_signal?: string;
  job_title?: string;
  contact_name?: string;
  contact_email?: string;
  contact_title?: string;
  contact_linkedin_url?: string;
  contact_email_confidence?: EmailConfidence;
  source_count?: number;
  contributing_sources?: string[];
  scraped_at?: string;
  analyzed_at?: string;
  contacted_at?: string;
  created_at: string;
  updated_at: string;
}

export interface LeadWithSignals extends Lead {
  signals?: LeadSignal[];
  score_detail?: LeadScore;
  outreach_messages?: OutreachMessage[];
}

// ---- Signal ----

export interface LeadSignal {
  org_id: string;
  id: string;
  lead_id: string;
  signal_type: string;
  signal_value?: string;
  confidence_score?: number;
  likely_pain_points?: string[];
  recommended_anta_service?: string;
  outreach_angle?: string;
  operational_maturity?: string;
  growth_indicators?: string[];
  digital_maturity_score?: number;
  tech_stack?: string[];
  tech_gaps?: string[];
  detected_at: string;
  created_at: string;
}

// ---- Score ----

export interface LeadScore {
  org_id: string;
  id: string;
  lead_id: string;
  overall_score: number;
  company_size_score?: number;
  hiring_urgency_score?: number;
  complexity_score?: number;
  digital_score?: number;
  scoring_rationale?: string;
  score_percentile?: number;
  scored_at: string;
  created_at: string;
}

// ---- Outreach ----

export interface OutreachMessage {
  org_id: string;
  id: string;
  lead_id: string;
  channel: OutreachChannel;
  subject?: string;
  body: string;
  tone?: string;
  generated_by?: string;
  model_version?: string;
  prompt_version?: string;
  is_selected?: boolean;
  personalization?: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface OutreachHistory {
  id: string;
  lead_id: string;
  message_id?: string;
  channel: OutreachChannel;
  status: OutreachStatus;
  sent_at?: string;
  opened_at?: string;
  replied_at?: string;
  reply_body?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

// ---- Scraping ----

export interface ScrapedLeadRaw {
  company_name: string;
  website?: string;
  location?: string;
  job_title?: string;
  hiring_signal?: string;
  source_url: string;
  source: LeadSource;
  scraped_at: string;
  description?: string;
  industry?: string;
  company_size?: string;
  source_count?: number;
  // Cached enrichment from a prior analysis — signal engine skips those calls when set
  cached_tech_stack?: string[];
  cached_tech_gaps?: string[];
  cached_contact?: LeadContact | null;
  cached_verified_website?: string;
}

export interface ScrapingLog {
  org_id: string;
  id: string;
  source: LeadSource;
  status: 'running' | 'finalizing' | 'completed' | 'failed' | 'partial';
  leads_found: number;
  leads_new: number;
  leads_updated: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  config?: Record<string, unknown>;
  created_at: string;
  job_id?: string;
}

// ---- Scrape job progress (SSE) ----

export interface ScrapeSourceState {
  status: 'pending' | 'completed' | 'failed';
  leads_found?: number;
  error?: string | null;
}

export type ScrapeStreamEvent =
  | { phase: 'snapshot'; sources: Record<string, ScrapeSourceState>; overall_status: string }
  | { phase: 'source'; source: string; status: 'completed' | 'failed'; leads_found: number; error: string | null }
  | { phase: 'complete'; status: 'completed' | 'failed'; results: number }
  | { phase: 'error'; message: string };

// ---- Signal Engine API ----

export interface SignalAnalysisRequest {
  lead: ScrapedLeadRaw;
}

// 'generic' — a shared inbox (info@ …) stored as contact_email when no personal
// address was found; kept distinct so refreshes can still upgrade to a real person.
export type EmailConfidence = 'verified' | 'pattern_inferred' | 'catch_all' | 'unknown' | 'generic';

export interface LeadContact {
  name: string;
  title: string;
  email: string;
  linkedin_url: string;
  // Generic inbox (info@ etc.) if that's all the company site exposes
  fallback_generic_email?: string;
  email_confidence: EmailConfidence;
}

export interface SignalAnalysisResult {
  lead_score: number;
  industry?: string;
  disqualified?: boolean;
  disqualify_reason?: string;
  likely_pain_points: string[];
  recommended_anta_service: string;
  outreach_angle: string;
  operational_maturity: string;
  growth_indicators: string[];
  digital_maturity_score: number;
  signal_type: string;
  confidence_score: number;
  scoring_breakdown: {
    company_size_score: number;
    hiring_urgency_score: number;
    complexity_score: number;
    digital_score: number;
  };
  scoring_rationale: string;
  // Enrichment
  tech_stack?: string[];
  tech_gaps?: string[];
  verified_website?: string;
  contact?: LeadContact | null;
}

// ---- Claude Outreach API ----

export interface OutreachGenerationRequest {
  lead: Lead;
  signals: SignalAnalysisResult;
  channel: OutreachChannel;
}

export interface OutreachGenerationResult {
  subject?: string;
  body: string;
  tone: string;
  personalization: Record<string, string>;
  model_version: string;
}

// ---- Dashboard Metrics ----

export interface DashboardMetrics {
  total_leads: number;
  hot_leads: number;
  contacted: number;
  replied: number;
  meetings: number;
  clients: number;
  new_today: number;
  avg_score: number;
}

export interface PipelineSummary {
  status: LeadStatus;
  count: number;
  avg_score: number;
  last_added: string;
}

// ---- API Response Wrappers ----

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  per_page: number;
  total_pages: number;
}

// ---- Platform Config ----

export interface PlatformConfig {
  agency_name: string;
  agency_location: string;
  agency_website: string;
  agency_tagline: string;
  services: string[];
  outreach_tone: string;
  cta_style: string;
  sign_off: string;
  target_locations: string[];
  target_company_sizes: string[];
  target_industries: string[];
  // Hiring roles that signal a need for the agency's services. Empty means
  // the engine's generic defaults.
  target_roles: string[];
  active_sources: string[];
  // How many new leads the 07:00 run analyzes for this org (1-100).
  daily_analysis_limit: number;
}

// What a tenant has before it fills in Settings. Deliberately no agency's
// identity or market: getConfig merges a tenant's saved row over this, and any
// key the tenant has not set must come out empty, not as ANTA's value. ANTA's
// own settings live in backend/scripts/anta-config.ts.
export const DEFAULT_PLATFORM_CONFIG: PlatformConfig = {
  agency_name: '',
  agency_location: '',
  agency_website: '',
  agency_tagline: '',
  services: [],
  outreach_tone: 'consultative and specific, not salesy',
  cta_style: '15-min call',
  sign_off: '',
  target_locations: [],
  target_company_sizes: ['11-50', '51-200', '201-500'],
  target_industries: [],
  target_roles: [],
  active_sources: ['linkedin', 'crunchbase', 'job_board', 'local_business'],
  daily_analysis_limit: 20,
};

// ---- Auth ----

export type UserRole = 'admin' | 'member';

export interface AuthUser {
  org_id: string;
  id: string;
  email: string;
  name: string;
  role: UserRole;
  last_login?: string;
  created_at: string;
}

export interface JwtPayload {
  sub: string;
  org_id: string;
  email: string;
  name: string;
  role: UserRole;
  iat?: number;
  exp?: number;
}

export interface LoginRequest {
  email: string;
  password: string;
}

export interface RegisterRequest {
  email: string;
  password: string;
  name: string;
  role?: UserRole;
}

export interface AuthResponse {
  user: AuthUser;
  accessToken: string;
}

// ---- Cron Job Logs ----

export interface CronJobLog {
  org_id: string;
  id: string;
  job_name: string;
  trigger_type: 'scheduled' | 'manual';
  status: 'running' | 'success' | 'failed';
  leads_processed?: number;
  error_message?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  created_at: string;
}

// ---- Filters ----

export interface LeadFilters {
  status?: LeadStatus;
  source?: LeadSource;
  sources?: LeadSource[];
  min_score?: number;
  industry?: string;
  location?: string;
  search?: string;
  page?: number;
  per_page?: number;
  sort_by?: 'lead_score' | 'created_at' | 'company_name';
  sort_order?: 'asc' | 'desc';
}

// ============================================================
// TENANCY
// ============================================================

/**
 * A branded organization id.
 *
 * A plain `orgId: string` parameter is satisfied by any string in scope —
 * a user id, a lead id, a route param — and the compiler is happy while the
 * query returns another tenant's rows. Only `asOrgId` produces an `OrgId`,
 * and only the auth middleware should call it.
 */
export type OrgId = string & { readonly __brand: 'OrgId' };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function asOrgId(value: string): OrgId {
  if (!UUID_RE.test(value)) {
    throw new Error(`Invalid OrgId: ${JSON.stringify(value)}`);
  }
  return value as OrgId;
}

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: 'active' | 'suspended';
  monthly_scrape_cap: number;
  created_at: string;
}

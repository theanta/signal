import axios from 'axios';
import type { ScrapedLeadRaw, SignalAnalysisResult } from '../../shared/types';
import { getConfig } from './configService';
import type { TenantContext } from './tenantContext';

const SIGNAL_ENGINE_URL = process.env.SIGNAL_ENGINE_URL ?? 'http://localhost:8001';

const ENGINE_API_KEY = process.env.ENGINE_API_KEY ?? '';

if (!ENGINE_API_KEY) {
  // Fail loudly at boot rather than with a 401 on the first scrape.
  throw new Error('ENGINE_API_KEY is not set — the backend cannot call the signal engine.');
}

const engineHeaders = { 'X-Engine-Key': ENGINE_API_KEY };

// The engine writes with the service-role key and requires an org_id on every
// mutating call. It always comes from ctx — never from req.body — because a
// client-supplied org id is not an authenticated one.

export async function analyzeLeadSignals(
  ctx: TenantContext, lead: ScrapedLeadRaw,
): Promise<SignalAnalysisResult> {
  const { data } = await axios.post<SignalAnalysisResult>(
    `${SIGNAL_ENGINE_URL}/analyze`,
    { lead, org_id: ctx.orgId },
    { timeout: 60_000, headers: engineHeaders },
  );
  return data;
}

export async function triggerScrape(
  ctx: TenantContext, sources: string[],
): Promise<{ job_id: string; status: string; sources: string[] }> {
  // Forward the saved platform config so scraper settings (target locations,
  // remote job roles/technologies/regions, etc.) actually take effect —
  // without this every scrape silently falls back to hardcoded defaults.
  const config = await getConfig(ctx);
  const { data } = await axios.post(
    `${SIGNAL_ENGINE_URL}/scrape`,
    { sources, config, org_id: ctx.orgId },
    { timeout: 10_000, headers: engineHeaders },
  );
  return data;
}

export async function getScrapeStatus(jobId: string): Promise<{ job_id: string; status: string; results?: number }> {
  const { data } = await axios.get(`${SIGNAL_ENGINE_URL}/scrape/${jobId}`, {
    timeout: 10_000,
    headers: engineHeaders,
  });
  return data;
}

/** Raw fetch (not axios) so the response body can be piped through as a live SSE stream. */
export function getScrapeStreamResponse(jobId: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${SIGNAL_ENGINE_URL}/scrape/${jobId}/stream`, {
    signal,
    headers: engineHeaders,
  });
}

/**
 * Raw fetch so the analysis SSE stream can be piped through as it arrives.
 * Lives here, not in the controller, so it carries the engine key like every
 * other engine call — the engine rejects any request without it.
 */
export function getAnalyzeStreamResponse(
  ctx: TenantContext, lead: ScrapedLeadRaw, signal: AbortSignal,
): Promise<Response> {
  return fetch(`${SIGNAL_ENGINE_URL}/analyze/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...engineHeaders },
    body: JSON.stringify({ lead, org_id: ctx.orgId }),
    signal,
  });
}

export async function healthCheck(): Promise<boolean> {
  try {
    const { data } = await axios.get(`${SIGNAL_ENGINE_URL}/health`, { timeout: 65_000 });
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

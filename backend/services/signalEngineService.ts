import axios from 'axios';
import type { ScrapedLeadRaw, SignalAnalysisResult } from '../../shared/types';
import { getConfig } from './configService';
import type { TenantContext } from './tenantContext';
import { ScrapeAlreadyRunningError, ScrapeRunNotFoundError } from './engineErrors';

export { ScrapeAlreadyRunningError, ScrapeRunNotFoundError };

const SIGNAL_ENGINE_URL = process.env.SIGNAL_ENGINE_URL ?? 'http://localhost:8001';

const ENGINE_API_KEY = process.env.ENGINE_API_KEY ?? '';

if (!ENGINE_API_KEY) {
  // Fail loudly at boot rather than with a 401 on the first scrape.
  throw new Error('ENGINE_API_KEY is not set — the backend cannot call the signal engine.');
}

const engineHeaders = { 'X-Engine-Key': ENGINE_API_KEY };

// The engine writes with the service-role key and requires an org_id on every
// call that touches tenant data, reads included. It always comes from ctx —
// never from req.body — because a client-supplied org id is not an
// authenticated one.

function engineStatus(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined;
}

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
  // industries, active sources) actually take effect — without this every
  // scrape silently falls back to hardcoded defaults.
  const config = await getConfig(ctx);
  try {
    const { data } = await axios.post(
      `${SIGNAL_ENGINE_URL}/scrape`,
      { sources, config, org_id: ctx.orgId },
      { timeout: 10_000, headers: engineHeaders },
    );
    return data;
  } catch (err) {
    if (engineStatus(err) === 409) throw new ScrapeAlreadyRunningError();
    throw err;
  }
}

export async function getScrapeStatus(
  ctx: TenantContext, jobId: string,
): Promise<{ job_id: string; status: string; results?: number }> {
  try {
    const { data } = await axios.get(`${SIGNAL_ENGINE_URL}/scrape/${encodeURIComponent(jobId)}`, {
      params: { org_id: ctx.orgId },
      timeout: 10_000,
      headers: engineHeaders,
    });
    return data;
  } catch (err) {
    // 404: no such run for this org. 422: not a UUID, so not a run either.
    const status = engineStatus(err);
    if (status === 404 || status === 422) throw new ScrapeRunNotFoundError();
    throw err;
  }
}

/** Raw fetch (not axios) so the response body can be piped through as a live SSE stream. */
export function getScrapeStreamResponse(
  ctx: TenantContext, jobId: string, signal: AbortSignal, lastEventId?: string,
): Promise<Response> {
  const query = new URLSearchParams({ org_id: ctx.orgId });
  // Last-Event-ID lets a reconnecting browser resume after the last event it
  // saw instead of replaying the run from the start.
  const headers: Record<string, string> = { ...engineHeaders };
  if (lastEventId) headers['Last-Event-ID'] = lastEventId;
  return fetch(`${SIGNAL_ENGINE_URL}/scrape/${encodeURIComponent(jobId)}/stream?${query}`, {
    signal,
    headers,
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

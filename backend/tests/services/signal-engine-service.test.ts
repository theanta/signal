import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import type { TenantContext } from '../../services/tenantContext';
import type { PlatformConfig, ScrapedLeadRaw } from '../../../shared/types';

const TENANT_CONFIG = { agency_name: 'Harbor Growth Partners', target_locations: ['Austin'] } as PlatformConfig;
vi.mock('../../services/configService', () => ({ getConfig: vi.fn(async () => TENANT_CONFIG) }));

// The engine client reads ENGINE_API_KEY at import, so set it first.
process.env.ENGINE_API_KEY = process.env.ENGINE_API_KEY || 'test-engine-key';

let engine: typeof import('../../services/signalEngineService');
const ctx = { orgId: '11111111-1111-1111-1111-111111111111' } as TenantContext;

beforeAll(async () => {
  engine = await import('../../services/signalEngineService');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function captureFetch() {
  const fetchMock = vi.fn(async () => new Response('data: {}\n\n'));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('getScrapeStreamResponse', () => {
  it('asks for the run within the caller’s org', async () => {
    const fetchMock = captureFetch();
    await engine.getScrapeStreamResponse(ctx, 'run-1', new AbortController().signal);
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/scrape\/run-1\/stream\?org_id=11111111-1111-1111-1111-111111111111$/);
  });

  it('forwards Last-Event-ID so a reconnect resumes instead of replaying', async () => {
    const fetchMock = captureFetch();
    await engine.getScrapeStreamResponse(ctx, 'run-1', new AbortController().signal, '42');
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>)['Last-Event-ID']).toBe('42');
    expect((init.headers as Record<string, string>)['X-Engine-Key']).toBeTruthy();
  });

  it('sends no Last-Event-ID on a first connection', async () => {
    const fetchMock = captureFetch();
    await engine.getScrapeStreamResponse(ctx, 'run-1', new AbortController().signal);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.headers as Record<string, string>).not.toHaveProperty('Last-Event-ID');
  });
});

describe('analysis calls carry the tenant’s config', () => {
  const lead = { company_name: 'Acme' } as ScrapedLeadRaw;

  it('analyzeLeadSignals sends config and org', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    await engine.analyzeLeadSignals(ctx, lead);
    expect(post.mock.calls[0][1]).toEqual({ lead, config: TENANT_CONFIG, org_id: ctx.orgId });
    post.mockRestore();
  });

  it('getAnalyzeStreamResponse sends config and org', async () => {
    const fetchMock = captureFetch();
    await engine.getAnalyzeStreamResponse(ctx, lead, new AbortController().signal);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ lead, config: TENANT_CONFIG, org_id: ctx.orgId });
  });
});

describe('triggerScrape', () => {
  it('never sends a paused source (Indeed, Crunchbase) to the engine', async () => {
    const post = vi.spyOn(axios, 'post').mockResolvedValue({ data: {} });
    await engine.triggerScrape(ctx, ['linkedin', 'job_board', 'crunchbase', 'local_business']);
    expect((post.mock.calls[0][1] as { sources: string[] }).sources).toEqual(['linkedin', 'local_business']);
    post.mockRestore();
  });
});

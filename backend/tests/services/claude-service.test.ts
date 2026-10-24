import { describe, expect, it, vi } from 'vitest';
import type { Lead, PlatformConfig, SignalAnalysisResult } from '../../../shared/types';
import type { TenantContext } from '../../services/tenantContext';

const prompts: string[] = [];
vi.mock('groq-sdk', () => ({
  default: class {
    chat = {
      completions: {
        create: async ({ messages }: { messages: { content: string }[] }) => {
          prompts.push(messages[0].content);
          return { choices: [{ message: { content: '{"subject":"s","body":"b"}' } }], usage: { total_tokens: 5 } };
        },
      },
    };
  },
}));

const TENANT_CONFIG: PlatformConfig = {
  agency_name: 'Harbor Growth Partners', agency_location: 'Austin, Texas', agency_website: '',
  agency_tagline: 'Paid social for local clinics', services: ['Paid Social Campaigns'],
  outreach_tone: 'warm', cta_style: '15-min call', sign_off: 'The Harbor Team',
  target_locations: ['Austin'], target_company_sizes: ['11-50'], target_industries: ['dental clinics'],
  target_roles: [], active_sources: [],
};
vi.mock('../../services/configService', () => ({ getConfig: vi.fn(async () => TENANT_CONFIG) }));
vi.mock('../../services/usageService', () => ({ recordUsage: vi.fn(async () => undefined) }));

describe('outreach prompts', () => {
  it('describe the tenant in its own words, never as a software consultancy', async () => {
    const { generateColdEmail } = await import('../../services/claudeService');
    await generateColdEmail({ orgId: 'o' } as TenantContext, { company_name: 'Acme Dental' } as Lead,
      { likely_pain_points: [], contact: null } as unknown as SignalAnalysisResult);
    const prompt = prompts.at(-1)!;
    expect(prompt).toContain('Harbor Growth Partners, based in Austin, Texas — Paid social for local clinics');
    expect(prompt).toContain('- Paid Social Campaigns');
    expect(prompt).toContain('industries: dental clinics');
    expect(prompt).not.toMatch(/software consultancy|ANTA|Detroit|manufacturers, logistics/);
  });
});

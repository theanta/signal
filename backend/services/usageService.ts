import type { TenantContext } from './tenantContext';

export type UsageProvider = 'apify' | 'serper' | 'groq' | 'millionverifier';

export interface UsageEvent {
  provider: UsageProvider;
  operation: string;
  units: number;
  costCents?: number;
}

/**
 * One usage_events row for a paid call made on the tenant's behalf, written
 * through the tenant's scoped client (RLS lets an org insert its own rows and
 * nothing else). Never throws: a failed usage write must not fail the outreach
 * generation that caused it.
 */
export async function recordUsage(tenant: TenantContext, event: UsageEvent): Promise<void> {
  try {
    const { error } = await tenant.db.from('usage_events').insert({
      org_id: tenant.orgId,
      provider: event.provider,
      operation: event.operation,
      units: Math.max(0, Math.round(event.units)),
      cost_cents: event.costCents ?? null,
    });
    if (error) console.error(`[usage] ${event.provider}:${event.operation} not recorded: ${error.message}`);
  } catch (err) {
    console.error(`[usage] ${event.provider}:${event.operation} not recorded:`, (err as Error).message);
  }
}

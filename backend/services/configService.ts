import type { PlatformConfig } from '../../shared/types';
import { DEFAULT_PLATFORM_CONFIG } from '../../shared/types';
import type { TenantContext } from './tenantContext';

/**
 * platform_config was a global singleton holding ANTA's own identity, and it
 * feeds both scraping targets and outreach copy. It is now one row per org,
 * keyed by the UNIQUE (org_id) constraint from the tenancy migration — so an
 * upsert is a single statement with no read-then-write race.
 */

export async function getConfig(ctx: TenantContext): Promise<PlatformConfig> {
  const { data, error } = await ctx.db
    .from('platform_config')
    .select('config')
    .eq('org_id', ctx.orgId)
    .maybeSingle();

  // A query error is not "no config". Returning defaults here would let
  // saveConfig merge an update onto ANTA's defaults and overwrite the tenant's
  // real row with them.
  if (error) throw new Error(`Config load failed: ${error.message}`);

  if (!data) {
    // A newly onboarded org may have no row yet. The neutral defaults keep
    // the app usable until create-org.ts or the settings page writes one.
    return { ...DEFAULT_PLATFORM_CONFIG };
  }

  const merged = { ...DEFAULT_PLATFORM_CONFIG, ...data.config } as PlatformConfig;
  merged.active_sources = [...new Set(merged.active_sources)];
  return merged;
}

export async function saveConfig(
  ctx: TenantContext,
  updates: Partial<PlatformConfig>,
): Promise<PlatformConfig> {
  const current = await getConfig(ctx);
  const merged = { ...current, ...updates };
  if (Array.isArray(merged.active_sources)) {
    merged.active_sources = [...new Set(merged.active_sources)];
  }

  const { error } = await ctx.db
    .from('platform_config')
    .upsert({ org_id: ctx.orgId, config: merged }, { onConflict: 'org_id' });

  if (error) throw new Error(`Config save failed: ${error.message}`);

  return merged;
}

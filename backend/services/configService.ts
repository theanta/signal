import { createClient } from '@supabase/supabase-js';
import type { PlatformConfig } from '../../shared/types';
import { DEFAULT_PLATFORM_CONFIG } from '../../shared/types';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

export async function getConfig(): Promise<PlatformConfig> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('platform_config')
    .select('config')
    .limit(1)
    .single();

  if (error || !data) {
    return { ...DEFAULT_PLATFORM_CONFIG };
  }

  const merged = { ...DEFAULT_PLATFORM_CONFIG, ...data.config } as PlatformConfig;
  merged.active_sources = [...new Set(merged.active_sources)];
  return merged;
}

export async function saveConfig(updates: Partial<PlatformConfig>): Promise<PlatformConfig> {
  const supabase = getSupabase();

  const current = await getConfig();
  const merged = { ...current, ...updates };
  if (Array.isArray(merged.active_sources)) {
    merged.active_sources = [...new Set(merged.active_sources)];
  }

  const { data: existing } = await supabase
    .from('platform_config')
    .select('id')
    .limit(1)
    .single();

  if (existing?.id) {
    const { error } = await supabase
      .from('platform_config')
      .update({ config: merged })
      .eq('id', existing.id);
    if (error) throw new Error(`Config update failed: ${error.message}`);
  } else {
    const { error } = await supabase
      .from('platform_config')
      .insert({ config: merged });
    if (error) throw new Error(`Config insert failed: ${error.message}`);
  }

  return merged;
}

import { api } from '@/lib/api';
import type { PlatformConfig } from '../../shared/types';

export async function fetchConfig(): Promise<PlatformConfig> {
  const { data } = await api.get('/config');
  return data.data;
}

export async function saveConfig(config: PlatformConfig): Promise<PlatformConfig> {
  const { data } = await api.put('/config', config);
  return data.data;
}

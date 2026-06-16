import axios from 'axios';
import type { ScrapedLeadRaw, SignalAnalysisResult } from '../../shared/types';

const SIGNAL_ENGINE_URL = process.env.SIGNAL_ENGINE_URL ?? 'http://localhost:8001';

export async function analyzeLeadSignals(lead: ScrapedLeadRaw): Promise<SignalAnalysisResult> {
  const { data } = await axios.post<SignalAnalysisResult>(
    `${SIGNAL_ENGINE_URL}/analyze`,
    { lead },
    { timeout: 30_000 },
  );
  return data;
}

export async function triggerScrape(sources: string[]): Promise<{ job_id: string; status: string }> {
  const { data } = await axios.post(
    `${SIGNAL_ENGINE_URL}/scrape`,
    { sources },
    { timeout: 10_000 },
  );
  return data;
}

export async function getScrapeStatus(jobId: string): Promise<{ job_id: string; status: string; results?: number }> {
  const { data } = await axios.get(`${SIGNAL_ENGINE_URL}/scrape/${jobId}`, { timeout: 10_000 });
  return data;
}

export async function healthCheck(): Promise<boolean> {
  try {
    const { data } = await axios.get(`${SIGNAL_ENGINE_URL}/health`, { timeout: 30_000 });
    return data?.status === 'ok';
  } catch {
    return false;
  }
}

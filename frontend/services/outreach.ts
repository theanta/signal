import { api } from '@/lib/api';
import type { OutreachMessage } from '../../shared/types';

export async function fetchOutreachQueue(): Promise<unknown[]> {
  const { data } = await api.get('/outreach/queue');
  return data.data;
}

export async function fetchOutreachMessages(leadId: string): Promise<OutreachMessage[]> {
  const { data } = await api.get(`/outreach/${leadId}/messages`);
  return data.data;
}

export async function generateFollowUp(leadId: string, originalMessage: string, daysSinceSent = 5): Promise<OutreachMessage> {
  const { data } = await api.post(`/outreach/${leadId}/followup`, {
    original_message: originalMessage,
    days_since_sent: daysSinceSent,
  });
  return data.data;
}

export async function logOutreach(payload: {
  lead_id: string;
  channel: string;
  status: string;
  message_id?: string;
}): Promise<void> {
  await api.post('/outreach/history', payload);
}

export async function triggerScrape(sources?: string[]): Promise<{ job_id: string }> {
  const { data } = await api.post('/signals/scrape', { sources });
  return data.data;
}

export async function getScrapeStatus(jobId: string): Promise<{ job_id: string; status: string; results?: number }> {
  const { data } = await api.get(`/signals/scrape/${jobId}`);
  return data.data;
}

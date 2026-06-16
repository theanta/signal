import Groq from 'groq-sdk';
import type { Lead, SignalAnalysisResult, OutreachChannel, PlatformConfig } from '../../shared/types';
import { DEFAULT_PLATFORM_CONFIG } from '../../shared/types';
import { getConfig } from './configService';

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });
const MODEL = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile';

function buildAgencyContext(config: PlatformConfig): string {
  const serviceList = config.services.map(s => `- ${s}`).join('\n');
  const locationList = config.target_locations.slice(0, 5).join(', ');
  return `
${config.agency_name} is a ${config.agency_location}-based software consultancy specializing in:
${serviceList}

${config.agency_name}'s ideal clients are businesses experiencing operational friction: companies still running on spreadsheets,
outdated systems, manual processes, or who are scaling fast and need software to match their growth.

Target audience: ${locationList} businesses, manufacturers, logistics companies,
healthcare operations, SaaS startups, and operationally inefficient businesses.
`;
}

async function loadConfig(): Promise<{ ctx: string; config: PlatformConfig }> {
  try {
    const config = await getConfig();
    return { ctx: buildAgencyContext(config), config };
  } catch {
    const config = { ...DEFAULT_PLATFORM_CONFIG };
    return { ctx: buildAgencyContext(config), config };
  }
}

async function callGroq(prompt: string, maxTokens: number): Promise<string> {
  const response = await client.chat.completions.create({
    model: MODEL,
    max_tokens: maxTokens,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.7,
    response_format: { type: 'json_object' },
  });
  return response.choices[0]?.message?.content ?? '';
}

function extractJson<T>(text: string, context: string): T {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Groq returned invalid JSON for ${context}`);
  return JSON.parse(match[0]) as T;
}

// ============================================================
// GENERATE COLD EMAIL
// ============================================================

export async function generateColdEmail(
  lead: Lead,
  signals: SignalAnalysisResult,
): Promise<{ subject: string; body: string }> {
  const { ctx, config } = await loadConfig();

  const contactLine = signals.contact?.name
    ? `- Contact: ${signals.contact.name}${signals.contact.title ? `, ${signals.contact.title}` : ''}`
    : '';
  const techLine = signals.tech_stack?.length
    ? `- Detected tech stack: ${signals.tech_stack.slice(0, 6).join(', ')}`
    : '';
  const gapsLine = signals.tech_gaps?.length
    ? `- Confirmed tech gaps: ${signals.tech_gaps.join(' | ')}`
    : '';
  const greeting = signals.contact?.name
    ? `Hi ${signals.contact.name.split(' ')[0]},`
    : 'Hi,';

  const prompt = `${ctx}

You are writing a cold outreach email on behalf of ${config.agency_name} to a prospect.

COMPANY DETAILS:
- Company: ${lead.company_name}
- Location: ${lead.location ?? 'Unknown'}
- Industry: ${lead.industry ?? 'Unknown'}
- Website: ${signals.verified_website ?? lead.website ?? 'N/A'}
- Hiring signal: ${lead.hiring_signal ?? 'N/A'}
- Job being hired for: ${lead.job_title ?? 'N/A'}
- Description: ${lead.description ?? 'N/A'}
${contactLine}
${techLine}
${gapsLine}

SIGNAL ANALYSIS:
- Lead score: ${signals.lead_score}/100
- Likely pain points: ${signals.likely_pain_points.join(', ')}
- Recommended service: ${signals.recommended_anta_service}
- Outreach angle: ${signals.outreach_angle}
- Operational maturity: ${signals.operational_maturity}

INSTRUCTIONS:
Write a short, highly personalized cold email. Requirements:
1. Start the body with: "${greeting}"
2. Subject line: specific, curiosity-driven, not clickbait (max 8 words)
3. Body: 3-4 short paragraphs, max 150 words total
4. Tone: ${config.outreach_tone}
5. If tech gaps are listed, reference at least one by name — this is observed fact, not assumption
6. Reference their specific situation (hiring signal, pain point)
7. One clear, low-friction CTA (${config.cta_style}, not a demo)
8. Sign off as "${config.sign_off}" from ${config.agency_location}

Respond ONLY with valid JSON in this exact format:
{
  "subject": "...",
  "body": "..."
}`;

  const text = await callGroq(prompt, 600);
  return extractJson<{ subject: string; body: string }>(text, 'cold email');
}

// ============================================================
// GENERATE LINKEDIN MESSAGE
// ============================================================

export async function generateLinkedInMessage(
  lead: Lead,
  signals: SignalAnalysisResult,
): Promise<{ body: string }> {
  const { ctx, config } = await loadConfig();

  const contactName = signals.contact?.name?.split(' ')[0];
  const techGap = signals.tech_gaps?.[0] ?? '';

  const prompt = `${ctx}

Write a LinkedIn connection request + message for a prospect.

COMPANY: ${lead.company_name} (${lead.location ?? ''}, ${lead.industry ?? ''})
${contactName ? `CONTACT NAME: ${contactName}` : ''}
HIRING SIGNAL: ${lead.hiring_signal ?? 'N/A'}
PAIN POINT: ${signals.likely_pain_points[0] ?? 'operational inefficiency'}
${techGap ? `CONFIRMED TECH GAP: ${techGap}` : ''}
RECOMMENDED SERVICE: ${signals.recommended_anta_service}
ANGLE: ${signals.outreach_angle}

REQUIREMENTS:
- Max 300 characters for the connection note
- ${contactName ? `Address them by first name: ${contactName}` : 'Use a natural greeting'}
- ${techGap ? 'Reference the confirmed tech gap — it shows you did your homework' : 'Reference their specific situation'}
- No generic templates, no buzzwords
- Tone: ${config.outreach_tone}

Respond ONLY with valid JSON:
{
  "body": "..."
}`;

  const text = await callGroq(prompt, 300);
  return extractJson<{ body: string }>(text, 'LinkedIn message');
}

// ============================================================
// GENERATE FOLLOW-UP
// ============================================================

export async function generateFollowUp(
  lead: Lead,
  originalMessage: string,
  daysSinceSent: number,
): Promise<{ subject: string; body: string }> {
  const { ctx, config } = await loadConfig();

  const prompt = `${ctx}

Write a follow-up email for a lead that hasn't responded.

COMPANY: ${lead.company_name}
ORIGINAL MESSAGE SENT: ${daysSinceSent} days ago
ORIGINAL MESSAGE:
${originalMessage}

REQUIREMENTS:
- Short (2-3 sentences max)
- Add new value or angle, don't just say "following up"
- Honest and direct
- Tone: ${config.outreach_tone}
- Different subject line

Respond ONLY with valid JSON:
{
  "subject": "...",
  "body": "..."
}`;

  const text = await callGroq(prompt, 300);
  return extractJson<{ subject: string; body: string }>(text, 'follow-up');
}

// ============================================================
// ANALYZE OPERATIONAL OPPORTUNITY
// ============================================================

export async function analyzeOpportunity(lead: Lead): Promise<{
  summary: string;
  pain_points: string[];
  recommended_service: string;
  opportunity_quality: 'high' | 'medium' | 'low';
  reasoning: string;
}> {
  const { ctx, config } = await loadConfig();

  const prompt = `${ctx}

Analyze this business as a potential ${config.agency_name} client opportunity.

COMPANY: ${lead.company_name}
LOCATION: ${lead.location ?? 'Unknown'}
INDUSTRY: ${lead.industry ?? 'Unknown'}
SIZE: ${lead.company_size ?? 'Unknown'}
DESCRIPTION: ${lead.description ?? 'N/A'}
HIRING SIGNAL: ${lead.hiring_signal ?? 'N/A'}
JOB BEING HIRED: ${lead.job_title ?? 'N/A'}
SOURCE: ${lead.source}

Analyze:
1. What operational pain points likely exist?
2. What ${config.agency_name} service would most help them?
3. Is this a high/medium/low quality opportunity?

Respond ONLY with valid JSON:
{
  "summary": "2-sentence summary of the opportunity",
  "pain_points": ["pain point 1", "pain point 2", "pain point 3"],
  "recommended_service": "the specific service",
  "opportunity_quality": "high|medium|low",
  "reasoning": "1-2 sentences explaining the quality rating"
}`;

  const text = await callGroq(prompt, 500);
  return extractJson<{
    summary: string;
    pain_points: string[];
    recommended_service: string;
    opportunity_quality: 'high' | 'medium' | 'low';
    reasoning: string;
  }>(text, 'opportunity analysis');
}

// ============================================================
// GENERATE OUTREACH (unified entry point)
// ============================================================

export async function generateOutreach(
  lead: Lead,
  signals: SignalAnalysisResult,
  channel: OutreachChannel,
): Promise<{ subject?: string; body: string; model_version: string }> {
  let result;

  if (channel === 'email') {
    result = await generateColdEmail(lead, signals);
  } else if (channel === 'linkedin') {
    const lr = await generateLinkedInMessage(lead, signals);
    result = { subject: undefined, body: lr.body };
  } else {
    result = await generateColdEmail(lead, signals);
  }

  return { ...result, model_version: MODEL };
}

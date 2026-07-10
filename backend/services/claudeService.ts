import Groq from 'groq-sdk';
import { z } from 'zod';
import type { Job, JobSignal, Lead, SignalAnalysisResult, OutreachChannel, PlatformConfig } from '../../shared/types';
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
// JOB INTEL — JD decode + resume playbook for agency applications
// ============================================================

const _HTML_TAG_RE = /<[^>]+>/g;

function jdToPlainText(raw: string, maxChars = 7000): string {
  const text = raw
    .replace(/<\/(p|div|li|h[1-6]|ul|ol|tr)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(_HTML_TAG_RE, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n[…description truncated]` : text;
}

// Groq output is untrusted — validate shape before it reaches the DB.
// JSON-mode models sometimes emit null where an array belongs, hence the catches.
const strArr = (max: number) => z.array(z.string()).max(max).nullish().catch([]).transform(v => v ?? []);

export const JobIntelSchema = z.object({
  summary: z.string(),
  seniority: z.enum(['junior', 'mid', 'senior', 'lead', 'unclear']).catch('unclear'),
  contract_type: z.enum(['full-time', 'contract', 'c2c', 'unclear']).catch('unclear'),
  contract_duration: z.string().nullish().catch(null),
  must_have_skills: strArr(15),
  nice_to_have_skills: strArr(15),
  ats_keywords: strArr(20),
  salary_parsed: z.object({
    min: z.number().nullish(),
    max: z.number().nullish(),
    currency: z.string().nullish(),
    period: z.enum(['hour', 'month', 'year']).nullish().catch(null),
    normalized_annual_usd: z.number().nullish(),
  }).nullish().catch(null),
  red_flags: strArr(8),
  timezone_note: z.string().nullish().catch(null),
  resume_playbook: z.object({
    headline: z.string().nullish().catch(null),
    lead_with: strArr(8),
    demote: strArr(8),
    keyword_checklist: strArr(15),
    framing_tips: strArr(6),
    sample_bullets: strArr(5),
    screening_risks: strArr(6),
  }),
});

export type JobIntelResult = z.infer<typeof JobIntelSchema> & { model_version: string };

export async function generateJobIntel(job: Job): Promise<JobIntelResult> {
  const { config } = await loadConfig();

  const agencyStack = config.remote_technologies.filter(Boolean);
  const agencyRoles = config.remote_job_roles.filter(Boolean);
  const description = job.description ? jdToPlainText(job.description) : 'N/A';

  const prompt = `You are a senior recruiting analyst at an offshore software staffing agency based in India.
The agency submits multiple candidate resumes to remote job postings daily. Your job: decode this posting
so the recruiter can (a) tailor resumes to pass ATS screening and (b) prep candidates for screening calls.
All candidates work from India (IST, UTC+5:30).

${agencyRoles.length ? `The agency typically staffs: ${agencyRoles.join(', ')}.` : ''}
${agencyStack.length ? `The agency's strongest technologies: ${agencyStack.join(', ')}.` : ''}

JOB POSTING:
- Title: ${job.job_title ?? 'Unknown'}
- Company: ${job.company_name}
- Location: ${job.location ?? 'Remote'}
- Employment type: ${job.employment_type ?? 'Not stated'}
- Salary text: ${job.salary_text ?? 'Not stated'}
- Tags: ${job.technologies?.join(', ') || 'None'}
- Description:
${description}

ANALYZE AND RESPOND. Rules:
1. "ats_keywords": the exact phrases from the posting an ATS will scan for, ranked by prominence/frequency.
   Use the posting's exact spelling ("React.js" vs "ReactJS" matters).
2. "must_have_skills" vs "nice_to_have_skills": split strictly by how the posting phrases requirements.
3. "salary_parsed": parse the salary text if present; normalize to annual USD (hourly × 2080, monthly × 12).
   null if no salary is stated — do not invent numbers.
4. "red_flags": anything that hurts an offshore agency submission — timezone demands, agency-hostile language,
   unrealistic skill grab-bags, signs of a ghost posting. Empty array if none.
5. "timezone_note": if the posting requires specific working hours, translate them to IST. null otherwise.
6. "resume_playbook": guidance for whoever tailors the resumes —
   - "headline": resume title matching this posting's role naming
   - "lead_with": skills to put first (prefer overlap between the posting and the agency's strengths)
   - "demote": skills a candidate might have that are irrelevant here
   - "keyword_checklist": exact keywords the resume must contain
   - "framing_tips": how to angle experience bullets for THIS posting's emphasis
   - "sample_bullets": 3-4 resume bullet patterns aligned to the top responsibilities (use X/Y placeholders for metrics)
   - "screening_risks": skills the client will likely test live — anything claimed on the resume must survive this
7. "summary": 2 sentences — what this role actually is and how strong a target it is for the agency.

Respond ONLY with valid JSON:
{
  "summary": "...",
  "seniority": "junior|mid|senior|lead|unclear",
  "contract_type": "full-time|contract|c2c|unclear",
  "contract_duration": "..." or null,
  "must_have_skills": ["..."],
  "nice_to_have_skills": ["..."],
  "ats_keywords": ["..."],
  "salary_parsed": { "min": 0, "max": 0, "currency": "USD", "period": "hour|month|year", "normalized_annual_usd": 0 } or null,
  "red_flags": ["..."],
  "timezone_note": "..." or null,
  "resume_playbook": {
    "headline": "...",
    "lead_with": ["..."],
    "demote": ["..."],
    "keyword_checklist": ["..."],
    "framing_tips": ["..."],
    "sample_bullets": ["..."],
    "screening_risks": ["..."]
  }
}`;

  const text = await callGroq(prompt, 2000);
  const parsed = JobIntelSchema.parse(extractJson<unknown>(text, 'job intel'));
  return { ...parsed, model_version: MODEL };
}

export function jobIntelToSignal(jobId: string, intel: JobIntelResult): Partial<JobSignal> {
  return {
    job_id: jobId,
    summary: intel.summary,
    seniority: intel.seniority,
    contract_type: intel.contract_type,
    contract_duration: intel.contract_duration ?? undefined,
    must_have_skills: intel.must_have_skills,
    nice_to_have_skills: intel.nice_to_have_skills,
    ats_keywords: intel.ats_keywords,
    salary_parsed: intel.salary_parsed
      ? {
          min: intel.salary_parsed.min ?? undefined,
          max: intel.salary_parsed.max ?? undefined,
          currency: intel.salary_parsed.currency ?? undefined,
          period: intel.salary_parsed.period ?? undefined,
          normalized_annual_usd: intel.salary_parsed.normalized_annual_usd ?? undefined,
        }
      : undefined,
    red_flags: intel.red_flags,
    timezone_note: intel.timezone_note ?? undefined,
    resume_playbook: {
      headline: intel.resume_playbook.headline ?? undefined,
      lead_with: intel.resume_playbook.lead_with,
      demote: intel.resume_playbook.demote,
      keyword_checklist: intel.resume_playbook.keyword_checklist,
      framing_tips: intel.resume_playbook.framing_tips,
      sample_bullets: intel.resume_playbook.sample_bullets,
      screening_risks: intel.resume_playbook.screening_risks,
    },
    model_version: intel.model_version,
  };
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

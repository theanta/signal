# ANTA Lead Radar

**AI-powered lead generation and outreach intelligence for ANTA — Detroit's software consultancy.**

Automatically discovers businesses likely to need software modernization, AI automation, and operational dashboards. Detects buying signals, scores leads, generates personalized outreach via Groq (Llama 3.3 70B), and manages the full lead workflow from discovery to proposal.

---

## Architecture

```
Next.js 14 Frontend (Vercel)
        ↓
Node.js / Express API (Render)
        ↓
Python FastAPI Signal Engine (Render)
        ↓
Groq AI — Llama 3.3 70B
        ↓
Supabase (PostgreSQL)
```

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 App Router, React, TailwindCSS, TypeScript |
| Backend API | Node.js, Express.js, TypeScript |
| Signal Engine | Python 3.11, FastAPI, BeautifulSoup |
| AI | Groq SDK — `llama-3.3-70b-versatile` |
| Database | Supabase (PostgreSQL) |
| Deployment | Vercel (FE) · Render (BE + Signal Engine) · Supabase (DB) |

---

## Project Structure

```
anta-lead-radar/
├── frontend/               # Next.js 14 App
│   ├── app/
│   │   ├── dashboard/      # Main dashboard
│   │   ├── leads/          # Leads table + lead detail
│   │   ├── outreach/       # Outreach queue
│   │   ├── signals/        # Scraping logs
│   │   └── settings/       # Config + manual triggers
│   ├── components/
│   │   ├── ui/             # Shared UI components
│   │   ├── dashboard/      # Dashboard widgets
│   │   ├── leads/          # Leads table + filters
│   │   └── outreach/       # Outreach cards
│   ├── services/           # API client functions
│   ├── hooks/              # useScrapeJob polling hook
│   └── lib/api.ts          # Axios instance
│
├── backend/                # Node.js + Express API
│   ├── api/server.ts       # Express app entry point
│   ├── routes/             # leads, outreach, signals, metrics, cron, config
│   ├── controllers/        # leadsController — business logic
│   └── services/
│       ├── claudeService.ts    # Groq LLM integration (email, LinkedIn, follow-up)
│       ├── configService.ts    # Platform config (agency name, services, tone)
│       ├── signalEngineService.ts  # Python microservice client
│       └── supabaseService.ts  # DB queries + views
│
├── signal-engine/          # Python FastAPI microservice
│   ├── main.py             # FastAPI app — /analyze, /scrape, /health
│   ├── scrapers/           # Wellfound, ProductHunt, JobBoards, DetroitBiz
│   ├── analyzers/          # Signal detection + pain point analysis
│   ├── classifiers/        # Industry classification
│   └── scoring/            # Lead scoring engine (0–100)
│
├── shared/
│   ├── types/index.ts      # Shared TypeScript types
│   └── utils/index.ts      # Shared utilities
│
└── supabase/
    └── schema.sql          # Full database schema + views
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- A Supabase project (free tier works)
- Groq API key (free — [console.groq.com](https://console.groq.com))

### 1. Clone & Install

```bash
git clone <repo-url> anta-lead-radar
cd anta-lead-radar

# Install all dependencies (Node + Python) in one command
npm run install:all
```

Or manually:

```bash
npm install
cd frontend && npm install && cd ..
cd backend && npm install && cd ..

cd signal-engine
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment

```bash
cp .env.example .env
cp frontend/.env.local.example frontend/.env.local
```

Fill in the required values — see [Environment Variables](#environment-variables) below.

### 3. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Paste and run the contents of `supabase/schema.sql`
4. Copy your **Project URL** and **service_role key** (Settings → API)

### 4. Run Locally

All three services in one command (uses `concurrently`):

```bash
npm run dev
```

Or start each in a separate terminal:

```bash
# Terminal 1 — Frontend
cd frontend && npm run dev
# → http://localhost:3000

# Terminal 2 — Backend API
cd backend && npm run dev
# → http://localhost:3001

# Terminal 3 — Signal Engine
cd signal-engine
source venv/bin/activate
uvicorn main:app --reload --port 8001
# → http://localhost:8001
```

Visit **http://localhost:3000** to open the dashboard.

---

## Daily Workflow

The platform runs automatically via cron (configured in `backend/routes/cron.ts`, all times in **America/Detroit** timezone):

```
6:00 AM  →  Daily Scrape        — Wellfound, Product Hunt, Job Boards, Detroit Biz
7:00 AM  →  Analyze New Leads   — Signal detection + scoring for all 'new' leads (batch of 20)
8:00 AM  →  Generate Outreach   — Groq generates cold emails for analyzed leads with score ≥ 65
```

Manual triggers via the **Settings page** or API:

```bash
curl -X POST http://localhost:3001/api/cron/run/scrape
curl -X POST http://localhost:3001/api/cron/run/analyze
curl -X POST http://localhost:3001/api/cron/run/outreach

# Check active jobs
curl http://localhost:3001/api/cron/status
```

---

## API Reference

### Health

| Method | Endpoint | Description |
|---|---|---|
| GET | `/health` | API health check |

### Leads

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/leads` | List leads (filter by status, score, source; paginate) |
| POST | `/api/leads` | Create manual lead |
| GET | `/api/leads/:id` | Get lead with signals + outreach |
| PATCH | `/api/leads/:id` | Update lead (status, notes, score, etc.) |
| POST | `/api/leads/:id/analyze` | Run signal analysis via Python engine |
| POST | `/api/leads/:id/outreach` | Generate outreach message with Groq |
| GET | `/api/leads/:id/analysis` | Get opportunity analysis for a lead |

### Outreach

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/outreach/queue` | Leads with score ≥ 50 + their messages (max 50) |
| GET | `/api/outreach/:leadId/messages` | All messages for a lead |
| POST | `/api/outreach/:leadId/followup` | Generate follow-up email |
| POST | `/api/outreach/history` | Log an outreach send event |

### Metrics

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/metrics/dashboard` | Dashboard stats (total, by status, avg score) |
| GET | `/api/metrics/pipeline` | Lead pipeline summary (Supabase view) |
| GET | `/api/metrics/hot-leads` | Top 10 hot leads |

### Signals

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/signals/health` | Signal engine connectivity check |
| POST | `/api/signals/scrape` | Trigger scraping job (body: `{ sources: [...] }`) |
| GET | `/api/signals/scrape/:jobId` | Check scrape job status |
| GET | `/api/signals/logs` | Scraping activity logs (`?limit=20`) |

### Config

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/config` | Get platform config (agency name, services, tone, etc.) |
| PUT | `/api/config` | Update platform config |

### Cron

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/cron/run/scrape` | Manually trigger daily scrape |
| POST | `/api/cron/run/analyze` | Manually trigger lead analysis batch |
| POST | `/api/cron/run/outreach` | Manually trigger outreach generation |
| GET | `/api/cron/status` | List active scheduled jobs |

### Signal Engine Direct (Python FastAPI — port 8001)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/analyze` | Analyze a raw lead (returns signals + score) |
| POST | `/scrape` | Trigger background scrape job |
| GET | `/scrape/:jobId` | Get scrape job status |
| GET | `/health` | Health check |

---

## Lead Scoring

Leads are scored 0–100 by the Python `LeadScorer` across four components:

| Component | Max Points | How it's measured |
|---|---|---|
| Company Size | 22 | 51–200 employees = peak score (22); 1–10 = 8 |
| Hiring Urgency | 25 | Regex patterns: ops coordinator, data entry, React dev, full-stack |
| Operational Complexity | 25 | Regex patterns: spreadsheets, legacy, manual, no CRM/ERP |
| Digital / Growth | 20 | Regex patterns: rapid growth, series funding, new launch |
| Target Location Bonus | +5 | Detroit, Michigan, and surrounding cities |

**Score bands:**
- Hot (75+) — Prioritize immediately
- Warm (55–74) — Queue for outreach
- Cool (35–54) — Monitor
- Cold (<35) — Low priority

Outreach auto-generation in the daily cron targets leads with `status = 'analyzed'` and `score ≥ 65`.

---

## Lead Statuses

```
new → analyzed → contacted → replied → meeting → proposal → client
```

---

## LLM Integration (Groq)

The `backend/services/claudeService.ts` wraps the **Groq SDK** (`llama-3.3-70b-versatile` by default, configurable via `GROQ_MODEL`). It generates three outreach types:

| Type | Entry point | Output |
|---|---|---|
| Cold Email | `generateColdEmail()` | `{ subject, body }` — ~150 words, 3-4 paragraphs |
| LinkedIn Message | `generateLinkedInMessage()` | `{ body }` — max 300 characters |
| Follow-up Email | `generateFollowUp()` | `{ subject, body }` — 2-3 sentences, new angle |
| Opportunity Analysis | `analyzeOpportunity()` | `{ summary, pain_points, recommended_service, opportunity_quality, reasoning }` |

All prompts are dynamically built from the platform config (agency name, services, tone, CTA style, sign-off) stored in Supabase and editable via `/api/config`. The model version is recorded with each saved outreach message.

---

## Scrapers

| Scraper | Source | Signal detected |
|---|---|---|
| `WellfoundScraper` | Wellfound | Funded startups hiring technical / ops roles |
| `ProductHuntScraper` | Product Hunt | New launches needing engineering support |
| `JobBoardScraper` | Indeed / job boards | Companies hiring ops, data entry, or devs |
| `DetroitBusinessScraper` | DBusiness, local directories | Fast-growing Michigan businesses |

> Scrapers include realistic mock data for development when live scraping is unavailable.

---

## Deployment

### Frontend → Vercel

```bash
cd frontend
npx vercel --prod
```

Set in Vercel dashboard:
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Backend → Render

1. Create a new Web Service
2. Build command: `cd backend && npm install && npm run build`
3. Start command: `cd backend && npm start`
4. Add all environment variables (see below)
5. Set `FRONTEND_URL` to your Vercel deployment URL (used for CORS)
6. Set `NODE_ENV=production`
7. **Set `SIGNAL_ENGINE_URL` to your Signal Engine Render URL** (e.g. `https://anta-signal-engine.onrender.com`) — without this, the backend tries `localhost:8001` and the UI always shows Offline

### Signal Engine → Render

1. Create a new Web Service (Python 3.11)
2. Build command: `cd signal-engine && pip install -r requirements.txt`
3. Start command: `cd signal-engine && uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
5. Copy the service's public URL and set it as `SIGNAL_ENGINE_URL` on the **backend** Render service

> **Render free tier:** services spin down after ~15 min idle. The first request can take 30–60s to wake the signal engine. The backend health check allows 30s in production; expect a brief Offline state on first load after idle.

---

## Environment Variables

Copy `.env.example` to `.env`. Required variables:

```bash
# Supabase
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Groq AI (free — https://console.groq.com)
GROQ_API_KEY=your-groq-api-key
GROQ_MODEL=llama-3.3-70b-versatile

# Backend
BACKEND_PORT=3001
BACKEND_URL=http://localhost:3001
NODE_ENV=development
JWT_SECRET=change-this-in-production
FRONTEND_URL=http://localhost:3000   # production: your Vercel URL

# Signal Engine
SIGNAL_ENGINE_PORT=8001
SIGNAL_ENGINE_URL=http://localhost:8001

# Frontend
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Cron schedules (cron syntax, America/Detroit timezone)
CRON_DAILY_SCRAPE=0 6 * * *
CRON_ANALYZE_LEADS=0 7 * * *
CRON_GENERATE_OUTREACH=0 8 * * *

# Rate limits
SCRAPER_DELAY_MS=1500
SCRAPER_MAX_RETRIES=3
```

---

## Built By

**ANTA** — Detroit, Michigan
Software consultancy specializing in AI automation, SaaS development, and operational software.

---

*ANTA Lead Radar MVP v1.0*

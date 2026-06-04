# ANTA Lead Radar

**AI-powered lead generation and outreach intelligence for ANTA — Detroit's software consultancy.**

Automatically discovers businesses likely to need software modernization, AI automation, and operational dashboards. Detects buying signals, scores leads, generates personalized outreach with Claude, and manages the full lead workflow.

---

## Architecture

```
Next.js 14 Frontend (Vercel)
        ↓
Node.js / Express API (Render/Railway)
        ↓
Python FastAPI Signal Engine (Render/Railway)
        ↓
Claude AI (Anthropic API)
        ↓
Supabase (PostgreSQL)
```

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | Next.js 14 App Router, React, TailwindCSS, TypeScript |
| Backend API | Node.js, Express.js, TypeScript |
| Signal Engine | Python, FastAPI, BeautifulSoup |
| AI | Claude API (Anthropic SDK) |
| Database | Supabase (PostgreSQL) |
| Deployment | Vercel (FE) · Render/Railway (BE) · Supabase (DB) |

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
│   │   └── leads/          # Leads table + filters
│   ├── services/           # API client functions
│   └── lib/                # Axios instance
│
├── backend/                # Node.js + Express API
│   ├── api/server.ts       # Express app entry point
│   ├── routes/             # leads, outreach, signals, metrics, cron
│   ├── controllers/        # Business logic
│   └── services/           # Supabase, Claude, SignalEngine
│
├── signal-engine/          # Python FastAPI microservice
│   ├── main.py             # FastAPI app + analyze + scrape endpoints
│   ├── scrapers/           # Wellfound, ProductHunt, JobBoards, DetroitBiz
│   ├── analyzers/          # Signal detection + pain point analysis
│   ├── classifiers/        # Industry classification
│   └── scoring/            # Lead scoring engine
│
├── shared/
│   ├── types/index.ts      # Shared TypeScript types
│   └── utils/index.ts      # Shared utilities
│
└── supabase/
    └── schema.sql          # Full database schema
```

---

## Quick Start

### Prerequisites

- Node.js 18+
- Python 3.11+
- A Supabase project (free tier works)
- Anthropic API key

### 1. Clone & Install

```bash
git clone <repo-url> anta-lead-radar
cd anta-lead-radar

# Install Node.js dependencies
npm install
cd frontend && npm install && cd ..
cd backend && npm install && cd ..

# Install Python dependencies
cd signal-engine
python -m venv venv
source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### 2. Configure Environment

```bash
# Root
cp .env.example .env

# Frontend
cp frontend/.env.local.example frontend/.env.local

# Signal Engine
cp signal-engine/.env.example signal-engine/.env
```

Fill in all required values (Supabase URL/keys, Anthropic API key).

### 3. Set Up Supabase

1. Create a new project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** in your Supabase dashboard
3. Paste and run the contents of `supabase/schema.sql`
4. Copy your **Project URL** and **service_role key** (Settings → API)

### 4. Run Locally

Open three terminals:

```bash
# Terminal 1: Frontend
cd frontend
npm run dev
# → http://localhost:3000

# Terminal 2: Backend API
cd backend
npm run dev
# → http://localhost:3001

# Terminal 3: Signal Engine
cd signal-engine
source venv/bin/activate
uvicorn main:app --reload --port 8001
# → http://localhost:8001
```

Visit **http://localhost:3000** to see the dashboard.

---

## Daily Workflow

The platform runs automatically via cron (configured in `/backend/routes/cron.ts`):

```
6:00 AM  →  Daily Scrape      (Wellfound, Product Hunt, Job Boards, Detroit)
7:00 AM  →  Analyze New Leads (Signal detection + scoring for all 'new' leads)
8:00 AM  →  Generate Outreach (Claude generates cold emails for top leads)
```

You can also trigger any job manually from the **Settings page** or via API:

```bash
curl -X POST http://localhost:3001/api/cron/run/scrape
curl -X POST http://localhost:3001/api/cron/run/analyze
curl -X POST http://localhost:3001/api/cron/run/outreach
```

---

## API Reference

### Leads

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/leads` | List leads (filter, sort, paginate) |
| POST | `/api/leads` | Create manual lead |
| GET | `/api/leads/:id` | Get lead with signals + outreach |
| PATCH | `/api/leads/:id` | Update lead (status, notes, etc.) |
| POST | `/api/leads/:id/analyze` | Run AI signal analysis |
| POST | `/api/leads/:id/outreach` | Generate outreach with Claude |
| GET | `/api/leads/:id/analysis` | Get Claude opportunity analysis |

### Metrics

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/metrics/dashboard` | Dashboard stats |
| GET | `/api/metrics/pipeline` | Lead pipeline summary |
| GET | `/api/metrics/hot-leads` | Leads with score ≥ 70 |

### Signal Engine

| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/signals/scrape` | Trigger scraping job |
| GET | `/api/signals/scrape/:jobId` | Check scrape job status |
| GET | `/api/signals/logs` | Scraping activity logs |
| GET | `/api/signals/health` | Signal engine health |

### Signal Engine Direct (Python FastAPI)

| Method | Endpoint | Description |
|---|---|---|
| POST | `/analyze` | Analyze a raw lead |
| POST | `/scrape` | Trigger background scrape |
| GET | `/scrape/:jobId` | Get scrape job status |
| GET | `/health` | Health check |

---

## Lead Scoring

Leads are scored 0–100 across four components:

| Component | Max Points | Signal |
|---|---|---|
| Company Size | 25 | 11-200 employees = optimal range |
| Hiring Urgency | 25 | Ops coordinator, data entry, React dev |
| Operational Complexity | 25 | Spreadsheets, legacy, manual processes |
| Digital Maturity Gap | 25 | Low digital maturity = high opportunity |
| Michigan/Detroit Bonus | +5 | ANTA's home market |

**Bands:**
- 🔴 Hot (75+) — Prioritize immediately
- 🟠 Warm (55–74) — Queue for outreach
- 🔵 Cool (35–54) — Monitor
- ⚪ Cold (<35) — Low priority

---

## Lead Statuses

```
new → analyzed → contacted → replied → meeting → proposal → client
```

---

## Claude Integration

Three outreach types are generated by Claude:

1. **Cold Email** — Personalized 150-word email with specific pain point + CTA
2. **LinkedIn Message** — 300-character connection note
3. **Follow-up** — Re-engagement email with new angle

All prompts are in `/backend/services/claudeService.ts`. Tone is: intelligent, consultative, concise, non-salesy, operationally focused.

---

## Scrapers

| Scraper | Source | Signal |
|---|---|---|
| `WellfoundScraper` | Wellfound | Funded startups hiring technical/ops roles |
| `ProductHuntScraper` | Product Hunt | New launches needing engineering support |
| `JobBoardScraper` | Indeed/job boards | Companies hiring ops/data entry/devs |
| `DetroitBusinessScraper` | DBusiness, local dirs | Fast-growing Michigan businesses |

> Scrapers include realistic mock data for development when live scraping is unavailable.

---

## Deployment

### Frontend → Vercel

```bash
cd frontend
npx vercel --prod
```

Set environment variables in Vercel dashboard:
- `NEXT_PUBLIC_BACKEND_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

### Backend → Render/Railway

1. Create a new Web Service
2. Set build command: `cd backend && npm install && npm run build`
3. Set start command: `cd backend && npm start`
4. Add all environment variables from `.env.example`

### Signal Engine → Render/Railway

1. Create a new Web Service (Python)
2. Set build command: `cd signal-engine && pip install -r requirements.txt`
3. Set start command: `cd signal-engine && uvicorn main:app --host 0.0.0.0 --port $PORT`
4. Add Supabase + Anthropic env vars

---

## Environment Variables

See `.env.example` for the full list. Required variables:

```bash
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
NEXT_PUBLIC_BACKEND_URL=
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

---

## Built By

**ANTA** — Detroit, Michigan  
Software consultancy specializing in AI automation, SaaS development, and operational software.

---

*ANTA Lead Radar MVP v1.0*

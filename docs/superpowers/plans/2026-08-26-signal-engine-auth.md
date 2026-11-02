# Signal Engine Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a shared-secret header on every mutating signal-engine route and close its wide-open CORS, so the service holding the Supabase service-role key can no longer be driven by anyone who finds its URL.

**Architecture:** A FastAPI dependency (`require_engine_key`) compares an `X-Engine-Key` request header against the `ENGINE_API_KEY` environment variable using a constant-time comparison, and is attached to every route except `/health`. The Express backend sends the same header from all four call sites in `signalEngineService.ts`. `CORSMiddleware` is removed outright — the engine is only ever called server-to-server by the backend, and the SSE stream reaches the browser proxied through Express.

**Tech Stack:** Python 3.11, FastAPI 0.115.0, pytest (added by this plan), Node 20 / Express 4, axios.

**Spec:** `docs/superpowers/specs/2026-08-26-multi-tenant-saas-design.md` (Section 2, "Prerequisite: authenticate the signal engine")

## Global Constraints

- `/health` stays unauthenticated. Render's platform health check cannot send custom headers, and `server.ts` depends on the engine's health endpoint.
- Secret comparison MUST be constant-time (`hmac.compare_digest`). A naive `==` leaks the key through timing.
- `ENGINE_API_KEY` is read from the environment. It is never logged, never returned in a response body, and never committed.
- The engine is server-to-server only. No browser calls it directly — verified: the sole frontend reference is a display label at `frontend/app/system/page.tsx:207`.
- Missing key and wrong key both return `401` with an identical body. Do not distinguish them.
- If `ENGINE_API_KEY` is unset in the engine's environment, the app must refuse to start rather than silently accept all requests.

---

## File Structure

| File | Responsibility |
|---|---|
| `signal-engine/auth.py` (create) | The `require_engine_key` dependency and startup validation. Sole owner of secret comparison. |
| `signal-engine/main.py` (modify) | Attach the dependency to routes; delete `CORSMiddleware`. |
| `signal-engine/tests/conftest.py` (create) | Sets dummy env before `main` is imported; exposes a `TestClient`. |
| `signal-engine/tests/test_auth.py` (create) | Auth behaviour suite. |
| `signal-engine/requirements.txt` (modify) | Add `pytest`. |
| `backend/services/signalEngineService.ts` (modify) | Send `X-Engine-Key` from all four call sites. |
| `.env.example` (modify) | Document `ENGINE_API_KEY`; remove the dead `APOLLO_API_KEY`; add the undocumented `MILLIONVERIFIER_API_KEY`. |

---

### Task 1: Auth dependency and test harness

This task establishes the first tests in the repository. `signal-engine/main.py`
imports scrapers at module scope, so `conftest.py` must populate the environment
before that import happens or collection fails.

**Files:**
- Create: `signal-engine/auth.py`
- Create: `signal-engine/tests/__init__.py` (empty)
- Create: `signal-engine/tests/conftest.py`
- Create: `signal-engine/tests/test_auth.py`
- Modify: `signal-engine/requirements.txt`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `require_engine_key(x_engine_key: str | None = Header(None)) -> None` — a FastAPI dependency raising `HTTPException(401)`. Also `ENGINE_KEY_HEADER = "X-Engine-Key"`.

- [ ] **Step 1: Add pytest to requirements**

Append to `signal-engine/requirements.txt`:

```
pytest==8.3.3
```

Then install:

```bash
cd signal-engine && ./venv/bin/pip install -r requirements.txt
```

- [ ] **Step 2: Create the test harness**

Create `signal-engine/tests/__init__.py` as an empty file.

Create `signal-engine/tests/conftest.py`:

```python
"""Test harness for the signal engine.

`main` reads configuration and constructs scrapers at import time, so every
environment variable it touches must exist before the import below runs.
"""
import os

os.environ.setdefault("ENGINE_API_KEY", "test-key-do-not-use-in-production")
os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("GROQ_API_KEY", "test-groq-key")
os.environ.setdefault("APIFY_API_TOKEN", "test-apify-token")
os.environ.setdefault("SERPER_API_KEY", "test-serper-key")

import pytest
from fastapi.testclient import TestClient

from main import app

VALID_KEY = os.environ["ENGINE_API_KEY"]


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)
```

- [ ] **Step 3: Write the failing test**

Create `signal-engine/tests/test_auth.py`:

```python
"""The engine holds the Supabase service-role key. Every mutating route must
prove the caller is our backend before it runs."""
from tests.conftest import VALID_KEY

ANALYZE_BODY = {"lead": {"company_name": "Acme", "website": "https://acme.test"}}


def test_analyze_without_key_is_rejected(client):
    r = client.post("/analyze", json=ANALYZE_BODY)
    assert r.status_code == 401


def test_analyze_with_wrong_key_is_rejected(client):
    r = client.post("/analyze", json=ANALYZE_BODY,
                    headers={"X-Engine-Key": "wrong-key"})
    assert r.status_code == 401


def test_missing_and_wrong_key_are_indistinguishable(client):
    missing = client.post("/analyze", json=ANALYZE_BODY)
    wrong = client.post("/analyze", json=ANALYZE_BODY,
                        headers={"X-Engine-Key": "wrong-key"})
    assert missing.status_code == wrong.status_code
    assert missing.json() == wrong.json()


def test_health_needs_no_key(client):
    r = client.get("/health")
    assert r.status_code == 200


def test_rejection_body_does_not_leak_the_key(client):
    r = client.post("/analyze", json=ANALYZE_BODY,
                    headers={"X-Engine-Key": "wrong-key"})
    assert VALID_KEY not in r.text
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `cd signal-engine && ./venv/bin/python -m pytest tests/test_auth.py -v`

Expected: the four rejection/indistinguishability tests FAIL (routes currently
return 200 or a validation error, never 401). `test_health_needs_no_key` passes
already — that is correct, it is a regression guard.

- [ ] **Step 5: Write the dependency**

Create `signal-engine/auth.py`:

```python
"""Shared-secret authentication for the signal engine.

The engine holds SUPABASE_SERVICE_ROLE_KEY and writes directly to the database,
so it must never accept an unauthenticated request. It is called only by the
Express backend, server-to-server.
"""
import hmac
import os

from fastapi import Header, HTTPException

ENGINE_KEY_HEADER = "X-Engine-Key"


def _expected_key() -> str:
    key = os.environ.get("ENGINE_API_KEY")
    if not key:
        # Fail closed. A missing secret must stop the process, never widen access.
        raise RuntimeError(
            "ENGINE_API_KEY is not set. The signal engine refuses to start "
            "without it — an unauthenticated engine exposes the Supabase "
            "service-role key to anyone who finds its URL."
        )
    return key


def require_engine_key(x_engine_key: str | None = Header(None)) -> None:
    """Reject any caller that cannot present the shared secret.

    A missing key and a wrong key return the same response, so the header's
    absence tells a prober nothing. compare_digest keeps the comparison
    constant-time so the secret cannot be recovered by timing.
    """
    expected = _expected_key()
    if x_engine_key is None or not hmac.compare_digest(x_engine_key, expected):
        raise HTTPException(status_code=401, detail="Unauthorized")


def verify_engine_key_configured() -> None:
    """Call at startup so misconfiguration surfaces on boot, not on first request."""
    _expected_key()
```

- [ ] **Step 6: Run the tests to verify they still fail**

Run: `cd signal-engine && ./venv/bin/python -m pytest tests/test_auth.py -v`

Expected: still FAIL. The dependency exists but no route uses it yet. This
confirms the tests are testing the routes, not the helper.

- [ ] **Step 7: Commit**

```bash
git add signal-engine/auth.py signal-engine/tests signal-engine/requirements.txt
git commit -m "test: add engine auth dependency and first pytest harness"
```

---

### Task 2: Enforce on every route and close CORS

**Files:**
- Modify: `signal-engine/main.py:92-103` (app construction and CORS)
- Modify: `signal-engine/main.py:173` (`/health`), `:368` (`/analyze`), `:378` (`/analyze/stream`), `:417` (`/scrape`), `:454` (`/scrape/{job_id}`), `:463` (`/scrape/{job_id}/stream`)
- Test: `signal-engine/tests/test_auth.py`

**Interfaces:**
- Consumes: `require_engine_key`, `verify_engine_key_configured`, `ENGINE_KEY_HEADER` from `signal-engine/auth.py` (Task 1).
- Produces: every engine route except `GET/HEAD /health` returns 401 without a valid `X-Engine-Key`.

- [ ] **Step 1: Extend the test to cover every protected route**

Append to `signal-engine/tests/test_auth.py`:

```python
import pytest

PROTECTED = [
    ("post", "/analyze", ANALYZE_BODY),
    ("post", "/analyze/stream", ANALYZE_BODY),
    ("post", "/scrape", {"sources": ["job_board"]}),
    ("get", "/scrape/00000000-0000-0000-0000-000000000000", None),
    ("get", "/scrape/00000000-0000-0000-0000-000000000000/stream", None),
]


@pytest.mark.parametrize("method,path,body", PROTECTED)
def test_every_mutating_route_requires_the_key(client, method, path, body):
    r = getattr(client, method)(path, **({"json": body} if body else {}))
    assert r.status_code == 401, f"{method.upper()} {path} is unauthenticated"


# Only the GET routes are exercised on the positive path. A valid key on
# POST /analyze or POST /scrape would run a real analysis against live Groq
# and Apify calls; the GET routes short-circuit on an unknown job id, so they
# prove the gate opens without doing any work.
POSITIVE_PATH = [
    ("get", "/scrape/00000000-0000-0000-0000-000000000000"),
    ("get", "/scrape/00000000-0000-0000-0000-000000000000/stream"),
]


@pytest.mark.parametrize("method,path", POSITIVE_PATH)
def test_valid_key_is_not_rejected(client, method, path):
    """A correct key must get past auth. Downstream returns 404 for the unknown
    job id — anything but 401 proves the gate opened."""
    r = getattr(client, method)(path, headers={"X-Engine-Key": VALID_KEY})
    assert r.status_code == 404


def test_cors_is_not_wide_open(client):
    r = client.get("/health", headers={"Origin": "https://evil.test"})
    assert r.headers.get("access-control-allow-origin") != "*"
```

- [ ] **Step 2: Run to verify failure**

Run: `cd signal-engine && ./venv/bin/python -m pytest tests/test_auth.py -v`

Expected: the parametrized `requires_the_key` cases FAIL with 200/404/422, and
`test_cors_is_not_wide_open` FAILS because the header is currently `*`.

- [ ] **Step 3: Attach the dependency and remove CORS**

In `signal-engine/main.py`, add to the import block near the other local imports
(after `from scrapers.lead_merger import merge_leads`):

```python
from auth import require_engine_key, verify_engine_key_configured
```

Replace the app construction and CORS block at lines 92-103 with:

```python
app = FastAPI(
    title="ANTA Lead Radar Signal Engine",
    description="Python signal detection and lead analysis microservice",
    version="1.0.0",
)

# No CORSMiddleware. This service is called server-to-server by the Express
# backend only; the browser reaches its SSE stream proxied through Express.
# A browser-facing CORS policy would only widen the attack surface.


@app.on_event("startup")
def _check_auth_configured() -> None:
    verify_engine_key_configured()
```

Then add `dependencies=[Depends(require_engine_key)]` to each protected route
decorator individually, leaving its function body untouched. These are five
separate decorators on five separate functions — do not stack them:

| Line | Before | After |
|---|---|---|
| 368 | `@app.post("/analyze")` | `@app.post("/analyze", dependencies=[Depends(require_engine_key)])` |
| 378 | `@app.post("/analyze/stream")` | `@app.post("/analyze/stream", dependencies=[Depends(require_engine_key)])` |
| 417 | `@app.post("/scrape")` | `@app.post("/scrape", dependencies=[Depends(require_engine_key)])` |
| 454 | `@app.get("/scrape/{job_id}")` | `@app.get("/scrape/{job_id}", dependencies=[Depends(require_engine_key)])` |
| 463 | `@app.get("/scrape/{job_id}/stream")` | `@app.get("/scrape/{job_id}/stream", dependencies=[Depends(require_engine_key)])` |

`@app.api_route("/health", ...)` at line 173 is deliberately left alone.

Add `Depends` to the existing FastAPI import at the top of `main.py`:

```python
from fastapi import FastAPI, BackgroundTasks, Depends, HTTPException
```

- [ ] **Step 4: Run to verify they pass**

Run: `cd signal-engine && ./venv/bin/python -m pytest tests/test_auth.py -v`

Expected: PASS, all cases.

- [ ] **Step 5: Verify the engine still boots**

Run: `cd signal-engine && ENGINE_API_KEY=local-dev-key ./venv/bin/uvicorn main:app --port 8001`

Expected: starts cleanly. Then in another shell:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8001/health          # 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST localhost:8001/analyze # 401
```

Then confirm it fails closed:

```bash
cd signal-engine && ./venv/bin/uvicorn main:app --port 8001
```

Expected: refuses to start with the `ENGINE_API_KEY is not set` RuntimeError.

- [ ] **Step 6: Commit**

```bash
git add signal-engine/main.py signal-engine/tests/test_auth.py
git commit -m "feat: require X-Engine-Key on all engine routes, remove open CORS"
```

---

### Task 3: Backend sends the header

All four call sites must be updated together — a missed one becomes a 401 in
production, and `getScrapeStreamResponse` is easy to overlook because it uses
`fetch` rather than axios.

**Files:**
- Modify: `backend/services/signalEngineService.ts` (all four call sites)

**Interfaces:**
- Consumes: `ENGINE_KEY_HEADER` contract (`X-Engine-Key`) from Task 2.
- Produces: no signature changes. Every outbound engine request carries the header.

- [ ] **Step 1: Add the shared header helper**

In `backend/services/signalEngineService.ts`, below the existing
`SIGNAL_ENGINE_URL` constant:

```ts
const ENGINE_API_KEY = process.env.ENGINE_API_KEY ?? '';

if (!ENGINE_API_KEY) {
  // Fail loudly at boot rather than with a 401 on the first scrape.
  throw new Error('ENGINE_API_KEY is not set — the backend cannot call the signal engine.');
}

const engineHeaders = { 'X-Engine-Key': ENGINE_API_KEY };
```

- [ ] **Step 2: Update all four call sites**

`analyzeLeadSignals`:

```ts
const { data } = await axios.post<SignalAnalysisResult>(
  `${SIGNAL_ENGINE_URL}/analyze`,
  { lead },
  { timeout: 60_000, headers: engineHeaders },
);
```

`triggerScrape`:

```ts
const { data } = await axios.post(
  `${SIGNAL_ENGINE_URL}/scrape`,
  { sources, config },
  { timeout: 10_000, headers: engineHeaders },
);
```

`getScrapeStatus`:

```ts
const { data } = await axios.get(`${SIGNAL_ENGINE_URL}/scrape/${jobId}`, {
  timeout: 10_000,
  headers: engineHeaders,
});
```

`getScrapeStreamResponse` — note this is `fetch`, not axios:

```ts
export function getScrapeStreamResponse(jobId: string, signal: AbortSignal): Promise<Response> {
  return fetch(`${SIGNAL_ENGINE_URL}/scrape/${jobId}/stream`, {
    signal,
    headers: engineHeaders,
  });
}
```

`healthCheck` is left unchanged — `/health` is unauthenticated by design.

- [ ] **Step 3: Verify it compiles**

Run: `cd backend && npm run build`

Expected: no TypeScript errors.

- [ ] **Step 4: Verify end to end**

With `ENGINE_API_KEY` set to the same value in both processes, run
`npm run dev` from the repo root, then trigger a scrape from the Settings page.

Expected: the scrape starts and streams progress as before. Then stop the
engine, restart it with a *different* `ENGINE_API_KEY`, and trigger again.

Expected: the request fails with 401 — proving the header is actually being
checked rather than merely sent.

- [ ] **Step 5: Commit**

```bash
git add backend/services/signalEngineService.ts
git commit -m "feat: authenticate backend requests to the signal engine"
```

---

### Task 4: Environment documentation

Folds in two stale-config bugs found during the code review of `b74cc84`, since
this task is already editing the same file.

**Files:**
- Modify: `.env.example`

**Interfaces:**
- Consumes: `ENGINE_API_KEY` from Tasks 2 and 3.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Update `.env.example`**

Add, near the other service keys:

```
# Shared secret between the Express backend and the Python signal engine.
# Must be identical in both processes. Generate with: openssl rand -hex 32
# The engine refuses to start without it.
ENGINE_API_KEY=

# Email verification for pattern-guessed contact addresses.
# Without it, pattern verification is silently skipped.
MILLIONVERIFIER_API_KEY=
```

Remove the `APOLLO_API_KEY` entry — Apollo enrichment was replaced by the SERP
lookup in `b74cc84` and nothing reads that variable any more.

- [ ] **Step 2: Verify no code still reads the removed variable**

Run: `grep -rn "APOLLO_API_KEY" --include='*.ts' --include='*.py' . | grep -v node_modules | grep -v venv`

Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: document ENGINE_API_KEY and MILLIONVERIFIER_API_KEY, drop dead APOLLO_API_KEY"
```

---

## Deployment note

`ENGINE_API_KEY` must be set on **both** Render services before this branch is
deployed, and they must match. Deploy order matters: set the variable on both,
deploy the engine first (it starts rejecting unauthenticated calls immediately),
then the backend. Deploying the backend first is harmless; deploying the engine
while the old backend is live causes every scrape to 401 until the backend
follows.

## Done when

- `cd signal-engine && ./venv/bin/python -m pytest tests/ -v` passes.
- `cd backend && npm run build` is clean.
- An unauthenticated `POST /analyze` against the running engine returns 401.
- `GET /health` returns 200 without a key.
- The engine refuses to boot with `ENGINE_API_KEY` unset.
- A scrape triggered from the UI completes normally.

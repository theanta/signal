# Beta and staging deploy runbook

Intentlark runs as two stacks, each with its own URL, database and git branch.
The frontends are on Vercel. Both backends and both engines share one
Oracle Cloud Always Free ARM server, for $0.

| | Beta (production) | Staging |
|---|---|---|
| App URL (Vercel) | `app.intentlark.theanta.com` | `staging.intentlark.theanta.com` |
| API URL (Oracle) | `api.intentlark.theanta.com` | `api.staging.intentlark.theanta.com` |
| Git branch | `main` | `staging` |
| Checkout on server | `~/signal-beta` | `~/signal-staging` |
| Backend / engine ports | 3001 / 8001 | 3002 / 8002 |
| Supabase project | `signal prod` | `anta-signal-test` |
| `CRON_ENABLED` | `true` | `false` (enforced by `deploy.sh`) |

Local development also uses `anta-signal-test` with `CRON_ENABLED=false`.
The automated backend tests use neither project, because they wipe the
schema first. Run them against a local Supabase (`supabase start`).

```
app.intentlark.theanta.com    (Vercel) ─/api rewrite─▶ api.intentlark.theanta.com    ─▶ Caddy ─▶ :3001 ─▶ engine :8001
staging.intentlark.theanta.com (Vercel) ─/api rewrite─▶ api.staging.intentlark.theanta.com ─▶ Caddy ─▶ :3002 ─▶ engine :8002
```

The frontend proxies `/api/*` to its backend (`next.config.js`), so users
only ever see the two app URLs, and login cookies stay first-party. The
engines are never exposed to the internet.

Files: `deploy/setup-server.sh` (once), `deploy/deploy.sh` (every deploy),
`deploy/ecosystem.config.js` (pm2), `deploy/Caddyfile`.

## Release flow

```
feature branch ──merge──▶ staging ──check on staging.intentlark.theanta.com──▶ merge to main ──▶ beta
```

Vercel deploys each frontend on push. The backends deploy when you run
`deploy.sh` on the server.

## Free tier limits that matter

- **Allowance:** 2 OCPUs and 12 GB RAM in total across Ampere A1 instances,
  200 GB block storage, 10 TB egress a month. Both stacks together peak at
  about 8 GB (each engine is capped at 3 GB, each backend restarts at 1 GB),
  so use the full **2 OCPU / 12 GB**. If you can only get 1 OCPU / 6 GB at
  first, run staging alone until you can resize.
- **Idle reclamation:** Oracle may reclaim an instance whose CPU, network and
  memory all stay under 20% (95th percentile) for 7 days. The Pay As You Go
  upgrade below exempts the account.
- **Capacity:** A1 creation often fails with "Out of host capacity".
- **Home region:** permanent. Always Free resources only exist there.
- **Vercel Hobby** is free but limited to non-commercial use. Paying beta
  customers mean moving to Pro ($20/month) at some point.

## 1. Oracle account (once)

- [ ] Upgrade to **Pay As You Go** (Billing → Upgrade and Manage Payment). It
      stays $0 inside the Always Free limits and exempts the account from
      idle reclamation.
- [ ] Billing → Budgets → a $1 budget with an alert at **$0.01**.
- [ ] Only create resources labelled "Always Free-eligible".

## 2. Create the server

- [ ] Compute → Instances → Create instance.
  - Image: **Canonical Ubuntu 24.04**.
  - Shape: Ampere → **VM.Standard.A1.Flex**, **2 OCPU / 12 GB** (or 1 / 6
    to start; resize later under Instance → Edit → Shape).
  - Networking: a new VCN with a public subnet; assign a public IPv4.
  - SSH: paste your public key (`~/.ssh/id_ed25519.pub`).
  - Boot volume: 100 GB (two engine images with Chromium).
- [ ] On "Out of host capacity", try each availability domain, then retry
      later. Mumbai has a single AD, so when the console keeps failing, let
      `deploy/launch-instance.sh` retry for you (below).

### Automatic retry with the OCI CLI

1. `brew install oci-cli`
2. Console → Profile → **Tokens and keys** (or User settings → API keys) →
   **Add API key** → **Generate API key pair** → **Download private key** →
   **Add**. Save the key as `~/.oci/oci_api_key.pem` and run
   `chmod 600 ~/.oci/oci_api_key.pem`.
3. Copy the **Configuration file preview** it shows into `~/.oci/config`,
   and set `key_file=~/.oci/oci_api_key.pem`. Check it with
   `oci iam region list`.
4. The network must exist: if the console attempt did not leave an
   `intentlark-subnet`, create it with Networking → Virtual cloud networks →
   **Start VCN Wizard** → "Create VCN with Internet Connectivity".
5. Run, and leave the laptop awake:

   ```bash
   caffeinate -i ./deploy/launch-instance.sh
   ```

   It asks for 1 OCPU / 6 GB on Ubuntu 24.04 with a public IP every two
   minutes, rotating fault domains, and stops once one server exists. It
   refuses shapes above the free allowance and stops on any error that is
   not a capacity error. Resize to 2 / 12 later under Instance → Edit →
   Shape.
- [ ] Subnet → Security List → Add Ingress Rules: source `0.0.0.0/0`, TCP,
      port `80`; repeat for `443`. Do **not** open 3001/3002/8001/8002.
- [ ] Networking → Reserved Public IPs: reserve one and attach it, so the IP
      survives the instance being recreated.

## 3. DNS

At your DNS provider for `theanta.com`:

- [ ] A record `api.intentlark` → the server's public IP
- [ ] A record `api.staging.intentlark` → the server's public IP
- [ ] `app.intentlark` and `staging.intentlark` are added in Vercel (step 7), which shows the
      CNAME records to create.

## 4. Supabase projects

- [ ] `signal prod`: build the schema and create the ANTA tenant. Pass the
      prod values on the command line, which take precedence over the local
      `.env`, so prod keys never land on your laptop:

  ```bash
  psql "<prod-db-connection-string>" -v ON_ERROR_STOP=1 -f supabase/schema.sql
  cd backend && SUPABASE_URL=<prod-url> SUPABASE_SERVICE_ROLE_KEY=<prod-service-key> \
    ADMIN_PASSWORD='<12+ chars>' npm run create-org -- \
    "ANTA" anta <your@email> "<Your Name>" "ANTA"
  ```

- [ ] `anta-signal-test` already has the schema and data. Nothing to do.

## 5. Code on the server

```bash
ssh ubuntu@<PUBLIC_IP>
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 && cat ~/.ssh/id_ed25519.pub
```

- [ ] Add that key at GitHub → theanta/signal → Settings → Deploy keys
      (read-only).

```bash
git clone -b main    git@github.com:theanta/signal.git ~/signal-beta
git clone -b staging git@github.com:theanta/signal.git ~/signal-staging
~/signal-staging/deploy/setup-server.sh api.intentlark.theanta.com api.staging.intentlark.theanta.com
```

Log out and back in afterwards, so the `docker` group applies.

## 6. Env files

Each checkout gets its own `.env` and `signal-engine/.env`. Start from your
local files:

```bash
scp .env                ubuntu@<PUBLIC_IP>:~/signal-staging/.env
scp signal-engine/.env  ubuntu@<PUBLIC_IP>:~/signal-staging/signal-engine/.env
scp .env                ubuntu@<PUBLIC_IP>:~/signal-beta/.env
scp signal-engine/.env  ubuntu@<PUBLIC_IP>:~/signal-beta/signal-engine/.env
```

Then edit them on the server. `deploy.sh` checks the starred values and
refuses to run if they are wrong.

| Variable | `~/signal-beta/.env` | `~/signal-staging/.env` |
|---|---|---|
| `BACKEND_PORT` * | `3001` | `3002` |
| `SIGNAL_ENGINE_URL` * | `http://127.0.0.1:8001` | `http://127.0.0.1:8002` |
| `CRON_ENABLED` * | `true` | `false` |
| `FRONTEND_URL` | `https://app.intentlark.theanta.com` | `https://staging.intentlark.theanta.com` |
| `APP_URL` | `https://app.intentlark.theanta.com` | `https://staging.intentlark.theanta.com` |
| `SUPABASE_*`, `NEXT_PUBLIC_SUPABASE_*` | `signal prod` values | `anta-signal-test` values (as local) |
| `ENGINE_API_KEY` * | new: `openssl rand -hex 32` | its own value |
| `JWT_SECRET` | new: `openssl rand -hex 32` | its own value |

In each `signal-engine/.env`: the same `ENGINE_API_KEY` as that stack's
`.env`, and that stack's `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`. Leave
`PORT` alone; the container always listens on 8001 inside.

Beta must not reuse any staging or local secret. A leaked staging key should
never open production.

## 7. Vercel (one project, two domains)

- [ ] Settings → Git: production branch `main`.
- [ ] Settings → Domains: add `app.intentlark.theanta.com` (production), and add
      `staging.intentlark.theanta.com` assigned to the git branch `staging`. Create the
      DNS records Vercel shows.
- [ ] Settings → Environment Variables:
  - `NEXT_PUBLIC_BACKEND_URL` = `https://api.intentlark.theanta.com`, scope
    **Production**
  - `NEXT_PUBLIC_BACKEND_URL` = `https://api.staging.intentlark.theanta.com`, scope
    **Preview**, branch `staging`
- [ ] Redeploy both. `NEXT_PUBLIC_*` values are baked in at build time.

## 8. First deploy

```bash
cd ~/signal-staging && ./deploy/deploy.sh staging --engine
cd ~/signal-beta    && ./deploy/deploy.sh beta --engine
```

The first engine build takes several minutes (Chromium). Each run waits for
its `/health` endpoints and fails loudly if either does not come up. Then:

- [ ] `curl https://api.staging.intentlark.theanta.com/health` and
      `curl https://api.intentlark.theanta.com/health` from your laptop
- [ ] Log in at `staging.intentlark.theanta.com` (your existing account) and at
      `app.intentlark.theanta.com` (the account from step 4), and run one manual scrape
      on each.

## Deploying updates

```bash
ssh ubuntu@<PUBLIC_IP> 'cd ~/signal-staging && ./deploy/deploy.sh staging'
ssh ubuntu@<PUBLIC_IP> 'cd ~/signal-beta && ./deploy/deploy.sh beta'
```

Each checkout pulls its own branch. The engine container is rebuilt only when
`signal-engine/` changed; pass `--engine` after editing `signal-engine/.env`.
A plain deploy picks up `.env` edits.

## Operating it

| Task | Command |
|---|---|
| Backend logs | `pm2 logs signal-beta-backend` / `signal-staging-backend` |
| Engine logs | `docker logs -f --tail 200 signal-beta-engine` / `signal-staging-engine` |
| Restart backend | `pm2 restart signal-beta-backend` |
| Restart engine | `docker restart signal-beta-engine` |
| Memory | `free -h` and `docker stats --no-stream` |
| Caddy / TLS | `sudo journalctl -u caddy -n 100` |

## Troubleshooting

- **The API URL doesn't answer from a browser, but `curl` on the server
  works:** a port is closed in one of the two firewalls. Check the security
  list and `sudo iptables -L INPUT -n --line-numbers` (80/443 must come
  before the REJECT rule).
- **Caddy has no certificate:** that domain's DNS does not point at the
  server yet, or port 80 is closed.
- **The app loads but every API call fails:** `NEXT_PUBLIC_BACKEND_URL` in
  that Vercel environment is wrong or was set after the last build. Fix it
  and redeploy.
- **Staging data shows up in beta, or the reverse:** a `.env` points at the
  wrong Supabase project. Compare `SUPABASE_URL` in both checkouts.
- **An engine exits during scrapes:** `docker logs signal-<stack>-engine`
  for Chromium crashes, and `free -h`. Resize to 2 OCPU / 12 GB.
- **The engine image fails to build:** the server is ARM64. Check the failing
  step; Playwright's Chromium supports Debian 12 on ARM64, which the
  `python:3.11-slim` base uses.

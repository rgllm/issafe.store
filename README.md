# IsSafe.store

## Intro

IsSafe.store helps people check an online store before paying. Paste a store URL to get a risk score, confidence rating, recommendation, and cited public evidence from the store site, domain registration data, public threat lists, and external reputation signals.

The result is a public-signal risk assessment. It does not guarantee merchant, purchase, or delivery safety.

## Tech Stack

- **App framework**: TanStack Start, TanStack Router, React 19, Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Runtime and deploy target**: Cloudflare Workers
- **Stateful orchestration**: Cloudflare Agents and Durable Objects (`StoreSafetyAgent`)
- **Persistence**: Cloudflare D1
- **AI summary generation**: Workers AI (`AI` binding)
- **Bot protection**: Cloudflare Turnstile
- **Rate limiting**: Cloudflare Workers rate limiting binding (`CHECK_RATE_LIMIT`)
- **External checks**: Tavily, Google Web Risk, URLhaus, OpenPhish, RDAP
- **Testing**: Vitest and Testing Library
- **Package manager**: Bun

## Quickstart

Prerequisites:

- Bun
- Cloudflare account
- Wrangler CLI authentication (`wrangler login`)

Install dependencies:

```bash
bun install
```

Run the app locally:

```bash
bun run dev
```

Local app URL:

```text
http://localhost:3000
```

Run tests:

```bash
bun run test
```

Build:

```bash
bun run build
```

Deploy:

```bash
bun run deploy
```

Cloudflare configuration lives in `wrangler.jsonc`. It defines the Worker entrypoint, Durable Object binding, D1 binding, Workers AI binding, rate limit, and public vars:

- `AI_MODEL`
- `CACHE_TTL_SECONDS`
- `CLOUDFLARE_URL_SCANNER_VISIBILITY` (default: `Unlisted`)
- `MAX_AI_CALLS_PER_DAY`
- `MAX_CHECKS_PER_DAY`
- `MAX_DOMAIN_CHECKS_PER_DAY`
- `MAX_TAVILY_CALLS_PER_DAY`
- `MAX_URL_SCANNER_SUBMISSIONS_PER_DAY`
- `TURNSTILE_REQUIRED` (default: `true`)
- `TURNSTILE_SITE_KEY`

Secrets are configured with Wrangler:

```bash
bunx wrangler secret put GOOGLE_WEB_RISK_API_KEY
bunx wrangler secret put URLHAUS_AUTH_KEY
bunx wrangler secret put TAVILY_API_KEY
bunx wrangler secret put CLOUDFLARE_ACCOUNT_ID
bunx wrangler secret put CLOUDFLARE_URL_SCANNER_API_TOKEN
bunx wrangler secret put TURNSTILE_SECRET_KEY
```

Launch safeguards:

- `POST /api/check` is protected by Turnstile, per-IP rate limiting, and D1-backed daily circuit breakers.
- `GET /api/check/:id` polling is protected by a separate per-IP/per-report rate limit.
- Workers AI, Tavily, and Cloudflare URL Scanner calls are capped by D1-backed daily provider limits.
- Cloudflare URL Scanner submissions are also capped to one submission per 10 seconds to respect scanner pacing.
- `/api/health` verifies required production bindings, vars, and secrets. It returns `503` until every launch-critical dependency is configured.
- Production Turnstile verification fails closed when `TURNSTILE_REQUIRED=true`; local development can still skip verification when Turnstile keys are missing.

Optional provider behavior:

- Missing `TAVILY_API_KEY` reduces external reputation evidence.
- Missing `URLHAUS_AUTH_KEY` skips URLhaus malware checks.
- Missing `GOOGLE_WEB_RISK_API_KEY` skips Google Web Risk checks.
- Missing `CLOUDFLARE_ACCOUNT_ID` or `CLOUDFLARE_URL_SCANNER_API_TOKEN` skips Cloudflare URL Scanner checks.
- OpenPhish and RDAP checks use public HTTPS sources and do not need API keys.

## Project Structure

```text
src/
  agents/
    store-safety-agent.ts   # Cloudflare Agent/Durable Object check lifecycle
  components/
    BrandLogo.tsx           # Brand mark
    Footer.tsx              # App footer
    Header.tsx              # App header
    ReportView.tsx          # Report presentation and status UI
    ThemeToggle.tsx         # Theme control
    TurnstileWidget.tsx     # Turnstile client widget
  lib/
    checks.ts               # Check start/read orchestration and cache keying
    http.ts                 # JSON/error response helpers
    reports-db.ts           # D1 report persistence
    research.ts             # Evidence collection pipeline
    scoring.ts              # Deterministic scoring and classification helpers
    turnstile.ts            # Turnstile verification
    url.ts                  # Store URL normalization and validation
  routes/
    __root.tsx              # Root layout
    about.tsx               # About page
    index.tsx               # Homepage and check form
    report.$id.tsx          # Report page with polling
    api/
      config.ts             # GET /api/config
      check.ts              # POST /api/check
      check.$id.ts          # GET /api/check/:id
  types/
    report.ts               # Report and evidence types
  router.tsx                # TanStack router setup
  routeTree.gen.ts          # Generated route tree
  server.ts                 # Worker fetch entrypoint and agent routing
  styles.css                # Global styles
migrations/
  0001_reports.sql          # D1 reports schema
public/
  favicon.ico
  logo.svg
  logo192.png
  logo512.png
  manifest.json
  robots.txt
  sitemap.xml
vite.config.ts             # Vite, TanStack Start, Tailwind, Cloudflare setup
wrangler.jsonc             # Cloudflare Worker, bindings, vars, observability
```

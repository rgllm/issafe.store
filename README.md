# IsSafe.store

IsSafe.store helps people check an online store before paying. Paste a store URL to get a risk score, confidence rating, recommendation, and cited public evidence from the store site, domain registration data, public threat lists, and external reputation signals.

The result is a public-signal risk assessment. It does not guarantee merchant, purchase, or delivery safety.

## Quickstart

Prerequisites: Bun, Cloudflare account, Wrangler CLI (`wrangler login`).

```bash
bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Tech Stack

- **App framework**: TanStack Start, TanStack Router, React 19, Vite
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **Runtime and deploy target**: Cloudflare Workers
- **Stateful orchestration**: Cloudflare Agents and Durable Objects
- **Persistence**: Cloudflare D1
- **AI summary generation**: Workers AI
- **External checks**: Tavily, Google Web Risk, URLhaus, OpenPhish, RDAP
- **Testing**: Vitest and Testing Library
- **Package manager**: Bun

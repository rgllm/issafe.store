import { createFileRoute } from '@tanstack/react-router'
import { env } from 'cloudflare:workers'
import { jsonResponse } from '../../lib/http'

type HealthCheck = {
  name: string
  ok: boolean
}

const REQUIRED_SECRET_NAMES = [
  'CLOUDFLARE_ACCOUNT_ID',
  'CLOUDFLARE_URL_SCANNER_API_TOKEN',
  'GOOGLE_WEB_RISK_API_KEY',
  'TAVILY_API_KEY',
  'TURNSTILE_SECRET_KEY',
  'URLHAUS_AUTH_KEY',
] as const

const REQUIRED_VAR_NAMES = [
  'AI_MODEL',
  'CACHE_TTL_SECONDS',
  'CLOUDFLARE_URL_SCANNER_VISIBILITY',
  'MAX_AI_CALLS_PER_DAY',
  'MAX_CHECKS_PER_DAY',
  'MAX_DOMAIN_CHECKS_PER_DAY',
  'MAX_TAVILY_CALLS_PER_DAY',
  'MAX_URL_SCANNER_SUBMISSIONS_PER_DAY',
  'TURNSTILE_REQUIRED',
  'TURNSTILE_SITE_KEY',
] as const

export const Route = createFileRoute('/api/health')({
  server: {
    handlers: {
      GET: async () => {
        const checks: HealthCheck[] = [
          { name: 'binding:AI', ok: Boolean(env.AI) },
          { name: 'binding:CHECK_RATE_LIMIT', ok: Boolean(env.CHECK_RATE_LIMIT) },
          { name: 'binding:DB', ok: Boolean(env.DB) },
          { name: 'binding:POLL_RATE_LIMIT', ok: Boolean(env.POLL_RATE_LIMIT) },
          { name: 'binding:StoreSafetyAgent', ok: Boolean(env.StoreSafetyAgent) },
          ...REQUIRED_SECRET_NAMES.map((name) => ({
            name: `secret:${name}`,
            ok: Boolean(env[name]?.trim()),
          })),
          ...REQUIRED_VAR_NAMES.map((name) => ({
            name: `var:${name}`,
            ok: Boolean(env[name]?.trim()),
          })),
        ]
        const ok = checks.every((check) => check.ok)

        return jsonResponse(
          {
            ok,
            checks,
          },
          { status: ok ? 200 : 503 },
        )
      },
    },
  },
})

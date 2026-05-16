import { getAgentByName } from 'agents'
import { createCheckId, normalizeStoreUrl } from './url'
import { getCachedReport } from './reports-db'
import {
  DAILY_WINDOW_SECONDS,
  LAUNCH_LIMIT_DEFAULTS,
  assertUsageLimits,
  getConfiguredLimit,
} from './usage-limits'
import type { StoreSafetyReport, StoreSafetyRequest } from '../types/report'
import type { StoreSafetyAgent } from '../agents/store-safety-agent'

const REPORT_CACHE_VERSION = 'coupon-sidebar-2026-05-11-v1'
const AGENT_ROUTING_RETRY = {
  maxAttempts: 3,
  baseDelayMs: 150,
  maxDelayMs: 1_000,
} as const
const AGENT_LOOKUP_OPTIONS = {
  routingRetry: AGENT_ROUTING_RETRY,
} as unknown as Parameters<typeof getAgentByName<Env, StoreSafetyAgent>>[2]

export type StartCheckInput = {
  url: string
}

export type StartCheckResult = {
  report: StoreSafetyReport
  cached: boolean
}

export async function startStoreCheck(
  input: StartCheckInput,
  env: Env,
): Promise<StartCheckResult> {
  const normalized = normalizeStoreUrl(input.url)
  const id = await createCheckId(`${REPORT_CACHE_VERSION}:${normalized.hostname}`)
  const cached = await getCachedReport(env.DB, id)

  if (cached) {
    return { report: cached, cached: true }
  }

  await assertUsageLimits(env.DB, [
    {
      scope: 'checks:global',
      windowSeconds: DAILY_WINDOW_SECONDS,
      limit: getConfiguredLimit(
        env.MAX_CHECKS_PER_DAY,
        LAUNCH_LIMIT_DEFAULTS.checksPerDay,
      ),
      message: 'Daily public check limit reached. Try again tomorrow.',
    },
    {
      scope: `checks:domain:${normalized.hostname}`,
      windowSeconds: DAILY_WINDOW_SECONDS,
      limit: getConfiguredLimit(
        env.MAX_DOMAIN_CHECKS_PER_DAY,
        LAUNCH_LIMIT_DEFAULTS.domainChecksPerDay,
      ),
      message:
        'Daily check limit reached for this store. Try again tomorrow or use the cached report.',
    },
  ])

  const request: StoreSafetyRequest = {
    ...normalized,
    id,
  }
  const agent = await getAgentByName<Env, StoreSafetyAgent>(
    env.StoreSafetyAgent,
    id,
    AGENT_LOOKUP_OPTIONS,
  )
  const report = await agent.startCheck(request)

  return { report, cached: false }
}

export async function getStoreCheck(id: string, env: Env) {
  const cached = await getCachedReport(env.DB, id)

  if (cached) {
    return { report: cached, cached: true }
  }

  const agent = await getAgentByName<Env, StoreSafetyAgent>(
    env.StoreSafetyAgent,
    id,
    AGENT_LOOKUP_OPTIONS,
  )
  const report = await agent.getCurrentReport()

  return report ? { report, cached: false } : null
}

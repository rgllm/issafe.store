import { getAgentByName } from 'agents'
import { createCheckId, normalizeStoreUrl } from './url'
import { getCachedReport } from './reports-db'
import type { StoreSafetyReport, StoreSafetyRequest } from '../types/report'
import type { StoreSafetyAgent } from '../agents/store-safety-agent'

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
  const id = await createCheckId(normalized.hostname)
  const cached = await getCachedReport(env.DB, id)

  if (cached) {
    return { report: cached, cached: true }
  }

  const request: StoreSafetyRequest = {
    ...normalized,
    id,
  }
  const agent = await getAgentByName<Env, StoreSafetyAgent>(env.StoreSafetyAgent, id)
  const report = await agent.startCheck(request)

  return { report, cached: false }
}

export async function getStoreCheck(id: string, env: Env) {
  const cached = await getCachedReport(env.DB, id)

  if (cached) {
    return { report: cached, cached: true }
  }

  const agent = await getAgentByName<Env, StoreSafetyAgent>(env.StoreSafetyAgent, id)
  const report = await agent.getCurrentReport()

  return report ? { report, cached: false } : null
}

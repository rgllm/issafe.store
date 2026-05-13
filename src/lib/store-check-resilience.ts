import type {
  Coupon,
  Evidence,
  StoreSafetyReport,
  StoreSafetyRequest,
} from '../types/report'
import type { RiskFactor, ScoreResult } from './scoring'

type ReportProgress = (
  status: StoreSafetyReport['status'],
  summary: string,
  progressStep: number,
) => void | Promise<void>

type MaybePromise<T> = T | Promise<T>

export type StoreResearchCheckpoint = {
  request: StoreSafetyRequest
  createdAt: string
  expiresAt: string
  siteEvidence?: Evidence[]
  rdapEvidence?: Evidence[]
  threatEvidence?: Evidence[]
  searchEvidence?: Evidence[]
  coupons?: Coupon[]
  classifiedFactors?: RiskFactor[]
  score?: ScoreResult
  summary?: string
}

export type StoreResearchSteps<EnvT> = {
  collectSiteEvidence: (normalizedUrl: string) => Promise<Evidence[]>
  collectRdapEvidence: (hostname: string) => Promise<Evidence[]>
  collectThreatListEvidence: (request: StoreSafetyRequest, env: EnvT) => Promise<Evidence[]>
  collectTavilyEvidence: (hostname: string, env: EnvT) => Promise<Evidence[]>
  collectTavilyCoupons: (hostname: string, env: EnvT) => Promise<Coupon[]>
  classifyEvidenceFactors: (
    request: StoreSafetyRequest,
    evidence: Evidence[],
    env: EnvT,
  ) => Promise<RiskFactor[]>
  scoreEvidence: (evidence: Evidence[], classifiedFactors: RiskFactor[]) => ScoreResult
  summarizeReport: (
    request: StoreSafetyRequest,
    evidence: Evidence[],
    score: ScoreResult,
    env: EnvT,
  ) => Promise<string>
  dedupeEvidence?: (evidence: Evidence[]) => Evidence[]
}

export type ResumeStoreResearchOptions<EnvT> = {
  request: StoreSafetyRequest
  env: EnvT
  ttlSeconds?: number
  checkpoint?: StoreResearchCheckpoint | null
  steps: StoreResearchSteps<EnvT>
  onCheckpoint?: (checkpoint: StoreResearchCheckpoint) => MaybePromise<void>
  onProgress?: ReportProgress
}

type ProgressState = {
  status: StoreSafetyReport['status']
  summary: string
  progressStep: number
}

const PROGRESS_BY_STEP = {
  site: {
    status: 'researching',
    summary: 'Checking the store site and public signals.',
    progressStep: 1,
  },
  rdap: {
    status: 'researching',
    summary: 'Checking domain registration data.',
    progressStep: 2,
  },
  threat: {
    status: 'researching',
    summary: 'Checking public threat-list signals.',
    progressStep: 3,
  },
  reputation: {
    status: 'researching',
    summary: 'Searching for external reputation signals.',
    progressStep: 4,
  },
  classify: {
    status: 'scoring',
    summary: 'Classifying evidence and calculating the risk score.',
    progressStep: 5,
  },
  summarize: {
    status: 'scoring',
    summary: 'Summarizing evidence and calculating the risk score.',
    progressStep: 6,
  },
} as const satisfies Record<string, ProgressState>

const RETRYABLE_STATUS_CODES = new Set([408, 409, 425, 429, 500, 502, 503, 504])
const RETRYABLE_ERROR_CODES = new Set([
  'aborted',
  'aborterror',
  'eai_again',
  'econnreset',
  'econnrefused',
  'enetdown',
  'enetreset',
  'enetunreach',
  'enotfound',
  'epipe',
  'etimedout',
  'timeouterror',
])
const RETRYABLE_MESSAGE_PATTERNS = [
  /(?:^|\b)fetch failed(?:\b|$)/,
  /(?:^|\b)network (?:error|failure|timeout|unreachable|reset)(?:\b|$)/,
  /(?:^|\b)connection reset(?: by peer)?(?:\b|$)/,
  /(?:^|\b)dns lookup failed(?:\b|$)/,
  /(?:^|\b)socket hang up(?:\b|$)/,
  /(?:^|\b)(?:request )?timed out(?:\b|$)/,
  /(?:^|\b)temporary(?:ly)? unavailable(?:\b|$)/,
  /(?:^|\b)overloaded(?:\b|$)/,
]

export async function resumeStoreResearch<EnvT>({
  request,
  env,
  ttlSeconds = 604_800,
  checkpoint,
  steps,
  onCheckpoint,
  onProgress,
}: ResumeStoreResearchOptions<EnvT>): Promise<StoreSafetyReport> {
  let current =
    checkpoint ??
    ({
      request,
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    } satisfies StoreResearchCheckpoint)

  if (!current.siteEvidence) {
    await publishProgress(PROGRESS_BY_STEP.site, onProgress)
    current = await saveCheckpoint(
      {
        ...current,
        siteEvidence: await steps.collectSiteEvidence(request.normalizedUrl),
      },
      onCheckpoint,
    )
  }

  if (!current.rdapEvidence) {
    await publishProgress(PROGRESS_BY_STEP.rdap, onProgress)
    current = await saveCheckpoint(
      {
        ...current,
        rdapEvidence: await steps.collectRdapEvidence(request.hostname),
      },
      onCheckpoint,
    )
  }

  if (!current.threatEvidence) {
    await publishProgress(PROGRESS_BY_STEP.threat, onProgress)
    current = await saveCheckpoint(
      {
        ...current,
        threatEvidence: await steps.collectThreatListEvidence(request, env),
      },
      onCheckpoint,
    )
  }

  if (!current.searchEvidence || !current.coupons) {
    await publishProgress(PROGRESS_BY_STEP.reputation, onProgress)
    const [searchEvidence, coupons] = await Promise.all([
      steps.collectTavilyEvidence(request.hostname, env),
      steps.collectTavilyCoupons(request.hostname, env),
    ])
    current = await saveCheckpoint(
      {
        ...current,
        searchEvidence,
        coupons,
      },
      onCheckpoint,
    )
  }

  const dedupeEvidence = steps.dedupeEvidence ?? ((evidence: Evidence[]) => evidence)
  const evidence = dedupeEvidence([
    ...(current.siteEvidence ?? []),
    ...(current.rdapEvidence ?? []),
    ...(current.threatEvidence ?? []),
    ...(current.searchEvidence ?? []),
  ])

  if (!current.classifiedFactors || !current.score) {
    await publishProgress(PROGRESS_BY_STEP.classify, onProgress)
    const classifiedFactors = await steps.classifyEvidenceFactors(request, evidence, env)
    current = await saveCheckpoint(
      {
        ...current,
        classifiedFactors,
        score: steps.scoreEvidence(evidence, classifiedFactors),
      },
      onCheckpoint,
    )
  }

  const scoredResult = current.score

  if (!scoredResult) {
    throw new Error('Store research scoring did not complete.')
  }

  if (!current.summary) {
    await publishProgress(PROGRESS_BY_STEP.summarize, onProgress)
    current = await saveCheckpoint(
      {
        ...current,
        summary: await steps.summarizeReport(request, evidence, scoredResult, env),
      },
      onCheckpoint,
    )
  }

  const finalScore = current.score
  const finalSummary = current.summary

  if (!finalScore || !finalSummary) {
    throw new Error('Store research summary did not complete.')
  }

  return {
    ...request,
    status: 'complete',
    score: finalScore.score,
    confidence: finalScore.confidence,
    recommendation: finalScore.recommendation,
    summary: finalSummary,
    evidence,
    coupons: current.coupons ?? [],
    createdAt: current.createdAt,
    expiresAt: current.expiresAt,
  }
}

export function getCheckpointProgress(checkpoint: StoreResearchCheckpoint): ProgressState {
  if (!checkpoint.siteEvidence) {
    return PROGRESS_BY_STEP.site
  }

  if (!checkpoint.rdapEvidence) {
    return PROGRESS_BY_STEP.rdap
  }

  if (!checkpoint.threatEvidence) {
    return PROGRESS_BY_STEP.threat
  }

  if (!checkpoint.searchEvidence || !checkpoint.coupons) {
    return PROGRESS_BY_STEP.reputation
  }

  if (!checkpoint.classifiedFactors || !checkpoint.score) {
    return PROGRESS_BY_STEP.classify
  }

  return PROGRESS_BY_STEP.summarize
}

export function isRetryableStoreCheckError(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false
  }

  const candidate = error as {
    code?: unknown
    cause?: unknown
    message?: unknown
    name?: unknown
    retryable?: unknown
    status?: unknown
  }

  if (candidate.retryable === true) {
    return true
  }

  if (typeof candidate.status === 'number' && RETRYABLE_STATUS_CODES.has(candidate.status)) {
    return true
  }

  const name = normalizeErrorText(candidate.name)
  const code = normalizeErrorText(candidate.code)
  const message = normalizeErrorText(candidate.message)

  if (RETRYABLE_ERROR_CODES.has(name) || RETRYABLE_ERROR_CODES.has(code)) {
    return true
  }

  if (RETRYABLE_MESSAGE_PATTERNS.some((pattern) => pattern.test(message))) {
    return true
  }

  return isRetryableStoreCheckError(candidate.cause)
}

async function saveCheckpoint(
  checkpoint: StoreResearchCheckpoint,
  onCheckpoint: ResumeStoreResearchOptions<unknown>['onCheckpoint'],
) {
  await onCheckpoint?.(checkpoint)

  return checkpoint
}

async function publishProgress(progress: ProgressState, onProgress?: ReportProgress) {
  await onProgress?.(progress.status, progress.summary, progress.progressStep)
}

function normalizeErrorText(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

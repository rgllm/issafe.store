import type { Evidence, StoreSafetyReport } from '../types/report'

export const MCP_DISCLAIMER =
  'Public-signal risk assessment only. Does not guarantee merchant, purchase, or delivery safety.'

export const SITE_URL = 'https://issafe.store'

const PROGRESS_STATUSES = new Set<StoreSafetyReport['status']>([
  'queued',
  'researching',
  'scoring',
])

const MAX_EVIDENCE = 5

export type CompactEvidence = {
  title: string
  sentiment: Evidence['sentiment']
  snippet: string
  url?: string
}

export type CompactMcpReport = {
  id: string
  hostname: string
  status: StoreSafetyReport['status']
  score: number
  confidence: number
  recommendation: StoreSafetyReport['recommendation']
  summary: string
  evidence: CompactEvidence[]
  reportUrl: string
  cached?: boolean
  progressStep?: number
  nextAction?: string
  disclaimer: string
}

export function isReportInProgress(status: StoreSafetyReport['status']) {
  return PROGRESS_STATUSES.has(status)
}

export function getReportUrl(id: string) {
  return `${SITE_URL}/report/${id}`
}

export function formatCompactMcpReport(
  report: StoreSafetyReport,
  options?: { cached?: boolean; nextAction?: string },
): CompactMcpReport {
  const evidence = selectTopEvidence(report.evidence).map((item) => ({
    title: item.title,
    sentiment: item.sentiment,
    snippet: truncate(item.snippet, 220),
    ...(item.url ? { url: item.url } : {}),
  }))

  const payload: CompactMcpReport = {
    id: report.id,
    hostname: report.hostname,
    status: report.status,
    score: report.score,
    confidence: report.confidence,
    recommendation: report.recommendation,
    summary: report.summary,
    evidence,
    reportUrl: getReportUrl(report.id),
    disclaimer: MCP_DISCLAIMER,
  }

  if (typeof options?.cached === 'boolean') {
    payload.cached = options.cached
  }

  if (typeof report.progressStep === 'number' && isReportInProgress(report.status)) {
    payload.progressStep = report.progressStep
  }

  if (options?.nextAction) {
    payload.nextAction = options.nextAction
  }

  return payload
}

export function mcpTextResult(payload: unknown, isError = false) {
  return {
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
    ...(isError ? { isError: true } : {}),
  }
}

function selectTopEvidence(evidence: Evidence[]) {
  return [...evidence]
    .sort((left, right) => {
      const sentimentRank = sentimentWeight(right.sentiment) - sentimentWeight(left.sentiment)
      if (sentimentRank !== 0) {
        return sentimentRank
      }

      return right.weight - left.weight
    })
    .slice(0, MAX_EVIDENCE)
}

function sentimentWeight(sentiment: Evidence['sentiment']) {
  if (sentiment === 'negative') {
    return 3
  }

  if (sentiment === 'positive') {
    return 2
  }

  return 1
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) {
    return value
  }

  return `${value.slice(0, maxLength - 1).trimEnd()}…`
}

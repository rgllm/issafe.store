import type { Evidence, Recommendation } from '../types/report'

const FACTOR_KEYS = [
  'threat_list',
  'domain_age',
  'site_integrity',
  'contact_identity',
  'policy_completeness',
  'independent_reputation',
  'commerce_intent',
] as const

const SEVERITY_RANK = {
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
} as const

export type RiskFactorKey = (typeof FACTOR_KEYS)[number]

export type RiskFactor = {
  key: RiskFactorKey
  sentiment: Evidence['sentiment']
  severity: keyof typeof SEVERITY_RANK
  confidence: number
  reason: string
  providerGap?: boolean
}

export type ScoreResult = {
  score: number
  confidence: number
  recommendation: Recommendation
}

type RecommendationContext = {
  categoryCount: number
  hasCriticalThreat: boolean
  highNegativeCount: number
  strongNegativeReputationCount: number
  hasIndependentReputation: boolean
}

export function dedupeEvidence(evidence: Evidence[]) {
  const seen = new Set<string>()
  const deduped: Evidence[] = []

  for (const item of evidence) {
    const key = `${item.sourceType}:${item.url ?? ''}:${item.title}:${item.snippet}`
      .toLowerCase()
      .replace(/\s+/g, ' ')

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push({
      ...item,
      weight: Math.max(1, Math.min(10, Math.round(item.weight))),
      snippet: item.snippet.slice(0, 420),
    })
  }

  return deduped.slice(0, 24)
}

export function scoreEvidence(
  evidence: Evidence[],
  classifiedFactors: RiskFactor[] = [],
): ScoreResult {
  const factors = buildRiskFactors(evidence, classifiedFactors)
  const categoryCount = countMeaningfulFactorCategories(factors)
  const providerGapCount = factors.filter((factor) => factor.providerGap).length
  const hasCriticalThreat = factors.some(
    (factor) =>
      factor.key === 'threat_list' &&
      factor.sentiment === 'negative' &&
      factor.severity === 'critical',
  )
  const highNegativeCount = factors.filter(
    (factor) =>
      factor.sentiment === 'negative' && SEVERITY_RANK[factor.severity] >= SEVERITY_RANK.high,
  ).length
  const strongNegativeReputationCount = factors.filter(
    (factor) =>
      factor.key === 'independent_reputation' &&
      factor.sentiment === 'negative' &&
      SEVERITY_RANK[factor.severity] >= SEVERITY_RANK.medium,
  ).length
  const hasIndependentReputation = factors.some(
    (factor) =>
      factor.key === 'independent_reputation' &&
      !factor.providerGap &&
      factor.sentiment !== 'neutral',
  )
  const { trustBonus, riskPenalty } = aggregateFactorImpacts(factors)
  const score = hasCriticalThreat
    ? Math.min(20, clamp(Math.round(50 + trustBonus - riskPenalty), 0, 100))
    : clamp(Math.round(50 + trustBonus - riskPenalty), 0, 100)
  const baseConfidence =
    18 +
    categoryCount * 9 +
    Math.min(24, evidence.length * 3) +
    Math.min(12, factors.length * 2) -
    providerGapCount * 6
  const confidence = hasCriticalThreat
    ? Math.max(80, clamp(Math.round(baseConfidence), 8, 96))
    : clamp(Math.round(baseConfidence), 8, 96)

  return {
    score,
    confidence,
    recommendation: getRecommendation(score, confidence, {
      categoryCount,
      hasCriticalThreat,
      highNegativeCount,
      strongNegativeReputationCount,
      hasIndependentReputation,
    }),
  }
}

export function getRecommendation(
  score: number,
  confidence: number,
  contextOrEvidenceCount: RecommendationContext | number,
): Recommendation {
  const context =
    typeof contextOrEvidenceCount === 'number'
      ? {
          categoryCount: contextOrEvidenceCount,
          hasCriticalThreat: false,
          highNegativeCount: 0,
          strongNegativeReputationCount: 0,
          hasIndependentReputation: true,
        }
      : contextOrEvidenceCount

  if (context.hasCriticalThreat) {
    return 'avoid'
  }

  if (confidence < 45 || context.categoryCount < 4) {
    return 'unknown'
  }

  if (score < 55 || context.strongNegativeReputationCount >= 2) {
    return 'avoid'
  }

  if (score >= 78 && context.highNegativeCount === 0 && context.hasIndependentReputation) {
    return 'likely-safe'
  }

  return 'caution'
}

export function buildRiskFactors(
  evidence: Evidence[],
  classifiedFactors: RiskFactor[] = [],
) {
  return [
    ...evidence.flatMap((item) => evidenceToFactors(item)),
    ...classifiedFactors.flatMap(normalizeRiskFactor),
  ]
}

function aggregateFactorImpacts(factors: RiskFactor[]) {
  const factorsByKey = new Map<RiskFactorKey, RiskFactor[]>()

  for (const factor of factors) {
    const existing = factorsByKey.get(factor.key) ?? []
    existing.push(factor)
    factorsByKey.set(factor.key, existing)
  }

  let trustBonus = 0
  let riskPenalty = 0

  for (const [key, keyFactors] of factorsByKey) {
    const negativeFactors = keyFactors.filter((factor) => factor.sentiment === 'negative')
    const positiveFactors = keyFactors.filter((factor) => factor.sentiment === 'positive')

    if (key === 'independent_reputation') {
      const negativeImpact = Math.min(
        35,
        negativeFactors.reduce((total, factor) => total + getNegativeImpact(factor), 0),
      )
      riskPenalty += negativeImpact
      trustBonus +=
        negativeImpact > 0
          ? Math.min(4, getStrongestImpact(positiveFactors, getPositiveImpact))
          : getStrongestImpact(positiveFactors, getPositiveImpact)
      continue
    }

    const negativeImpact = getStrongestImpact(negativeFactors, getNegativeImpact)
    riskPenalty += negativeImpact
    trustBonus +=
      negativeImpact > 0 ? 0 : getStrongestImpact(positiveFactors, getPositiveImpact)
  }

  return {
    trustBonus: Math.min(45, trustBonus),
    riskPenalty: Math.min(70, riskPenalty),
  }
}

function countMeaningfulFactorCategories(factors: RiskFactor[]) {
  const keys = new Set<RiskFactorKey>()

  for (const factor of factors) {
    if (!factor.providerGap) {
      keys.add(factor.key)
    }
  }

  return keys.size
}

function getStrongestImpact(
  factors: RiskFactor[],
  getImpact: (factor: RiskFactor) => number,
) {
  return factors.reduce((strongest, factor) => Math.max(strongest, getImpact(factor)), 0)
}

function getPositiveImpact(factor: RiskFactor) {
  if (factor.key === 'threat_list') {
    return 0
  }

  if (factor.key === 'domain_age') {
    return factor.severity === 'high' ? 14 : factor.severity === 'medium' ? 10 : 4
  }

  if (factor.key === 'site_integrity') {
    return factor.severity === 'high' ? 10 : factor.severity === 'medium' ? 8 : 3
  }

  if (factor.key === 'independent_reputation') {
    return factor.severity === 'high' ? 18 : factor.severity === 'medium' ? 16 : 8
  }

  if (factor.key === 'commerce_intent') {
    return 4
  }

  return factor.severity === 'high' ? 11 : factor.severity === 'medium' ? 9 : 5
}

function getNegativeImpact(factor: RiskFactor) {
  if (factor.severity === 'critical') {
    return factor.key === 'threat_list' ? 70 : 45
  }

  if (factor.key === 'threat_list') {
    return factor.severity === 'high' ? 45 : factor.severity === 'medium' ? 25 : 10
  }

  if (factor.key === 'domain_age') {
    return factor.severity === 'high' ? 24 : factor.severity === 'medium' ? 15 : 7
  }

  if (factor.key === 'site_integrity') {
    return factor.severity === 'high' ? 28 : factor.severity === 'medium' ? 15 : 6
  }

  if (factor.key === 'contact_identity') {
    return factor.severity === 'high' ? 14 : factor.severity === 'medium' ? 8 : 4
  }

  if (factor.key === 'policy_completeness') {
    return factor.severity === 'high' ? 16 : factor.severity === 'medium' ? 10 : 5
  }

  if (factor.key === 'independent_reputation') {
    return factor.severity === 'high' ? 25 : factor.severity === 'medium' ? 16 : 8
  }

  if (factor.key === 'commerce_intent') {
    return factor.severity === 'high' ? 18 : factor.severity === 'medium' ? 10 : 5
  }

  return factor.severity === 'high' ? 16 : factor.severity === 'medium' ? 8 : 4
}

function evidenceToFactors(item: Evidence): RiskFactor[] {
  const text = `${item.title} ${item.snippet} ${item.url ?? ''}`.toLowerCase()
  const factors: RiskFactor[] = []

  if (/urlhaus|phishtank|web risk|threat list|malware listing|phishing/i.test(text)) {
    factors.push(createThreatFactor(item, text))
  }

  if (item.sourceType === 'rdap' || /domain .*registered|domain older|registration/i.test(text)) {
    factors.push(createDomainFactor(item, text))
  }

  if (
    item.sourceType === 'technical' ||
    /https|homepage|could not be reached|responded with http|reachable/i.test(text)
  ) {
    factors.push(createSiteIntegrityFactor(item, text))
  }

  if (/contact|business|address|support|company|registered office|identity/i.test(text)) {
    factors.push(createContactFactor(item, text))
  }

  if (
    item.sourceType === 'store-site' &&
    /policy|return|refund|shipping|delivery|privacy|terms/i.test(text)
  ) {
    factors.push(createPolicyFactor(item, text))
  }

  if (
    item.sourceType === 'review' ||
    item.sourceType === 'search-result' ||
    /trustpilot|reddit|bbb|scamadviser|review|complaint|non-delivery|chargeback|counterfeit/i.test(
      text,
    )
  ) {
    factors.push(createReputationFactor(item, text))
  }

  if (/cart|checkout|shop now|add to cart|payment|commerce|storefront|sell products/i.test(text)) {
    factors.push(createCommerceFactor(item, text))
  }

  return factors
}

function createThreatFactor(item: Evidence, text: string): RiskFactor {
  const providerGap = /not configured|unavailable|failed|timeout|did not complete/.test(text)
  const isCleanResult = /no .*match|no .*listing|did not return|not found/.test(text)
  const isNegative =
    !isCleanResult &&
    (item.sentiment === 'negative' ||
      /match found|listing found|listed|malware listing found|phishing match|unsafe|threat found|verified phish/.test(
        text,
      ))

  return normalizeRiskFactor({
    key: 'threat_list',
    sentiment: isNegative ? 'negative' : 'neutral',
    severity: isNegative ? 'critical' : 'low',
    confidence: isNegative ? 95 : providerGap ? 20 : 60,
    providerGap,
    reason: item.title,
  })[0]
}

function createDomainFactor(item: Evidence, text: string): RiskFactor {
  if (/less than 30|under 30|about [0-2]?\d days/.test(text)) {
    return createFactor('domain_age', 'negative', 'high', 88, item.title)
  }

  if (/30.+90|less than 90|recently registered/.test(text)) {
    return createFactor('domain_age', 'negative', 'medium', 78, item.title)
  }

  if (/less than one year|less than 365|under one year/.test(text)) {
    return createFactor('domain_age', 'negative', 'low', 65, item.title)
  }

  if (/older than three years|more than three years|3\+ years|8\+ years/.test(text)) {
    return createFactor('domain_age', 'positive', 'high', 82, item.title)
  }

  if (/older than one year|more than one year|established domain/.test(text)) {
    return createFactor('domain_age', 'positive', 'medium', 74, item.title)
  }

  return createFactor('domain_age', item.sentiment, 'low', 45, item.title)
}

function createSiteIntegrityFactor(item: Evidence, text: string): RiskFactor {
  if (/plain http|no https/.test(text)) {
    return createFactor('site_integrity', 'negative', 'medium', 84, item.title)
  }

  if (/could not be reached|request failed|http 4|http 5/.test(text)) {
    return createFactor('site_integrity', 'negative', 'high', 84, item.title)
  }

  if (/https is enabled|homepage is reachable|responded with http 2/.test(text)) {
    return createFactor('site_integrity', 'positive', 'medium', 65, item.title)
  }

  return createFactor('site_integrity', item.sentiment, 'low', 42, item.title)
}

function createContactFactor(item: Evidence, text: string): RiskFactor {
  if (/limited contact|no clear email|no clear .*business|missing contact/.test(text)) {
    return createFactor('contact_identity', 'negative', 'medium', 76, item.title)
  }

  if (/visible contact|business details|business-identifying|registered office/.test(text)) {
    return createFactor('contact_identity', 'positive', 'medium', 76, item.title)
  }

  return createFactor('contact_identity', item.sentiment, 'low', 42, item.title)
}

function createPolicyFactor(item: Evidence, text: string): RiskFactor {
  if (/without clear policies|policy language was not found|missing .*polic/.test(text)) {
    return createFactor('policy_completeness', 'negative', 'high', 78, item.title)
  }

  if (/policy coverage|policy page found|policy links|return|refund|shipping|privacy|terms/.test(text)) {
    return createFactor('policy_completeness', 'positive', 'medium', 72, item.title)
  }

  return createFactor('policy_completeness', item.sentiment, 'low', 40, item.title)
}

function createReputationFactor(item: Evidence, text: string): RiskFactor {
  if (/non-delivery|never arrived|not delivered|chargeback|counterfeit|fraud|scam/.test(text)) {
    return createFactor('independent_reputation', 'negative', 'high', 84, item.title)
  }

  if (/complaint|refund issue|bad review|negative review/.test(text)) {
    return createFactor('independent_reputation', 'negative', 'medium', 72, item.title)
  }

  if (/verified|trusted|positive reviews|good review|official|customer service/.test(text)) {
    return createFactor('independent_reputation', 'positive', 'medium', 70, item.title)
  }

  const providerGap = /not configured|unavailable|failed|timeout|did not complete/.test(text)

  return normalizeRiskFactor({
    key: 'independent_reputation',
    sentiment: item.sentiment,
    severity: 'low',
    confidence: providerGap ? 20 : 45,
    providerGap,
    reason: item.title,
  })[0]
}

function createCommerceFactor(item: Evidence, text: string): RiskFactor {
  if (/shopping signals without clear policies|sell products.*not found/.test(text)) {
    return createFactor('commerce_intent', 'negative', 'medium', 72, item.title)
  }

  if (/cart|checkout|shop now|add to cart|payment|storefront shopping signals/.test(text)) {
    return createFactor('commerce_intent', 'neutral', 'low', 48, item.title)
  }

  return createFactor('commerce_intent', item.sentiment, 'low', 38, item.title)
}

function createFactor(
  key: RiskFactorKey,
  sentiment: Evidence['sentiment'],
  severity: RiskFactor['severity'],
  confidence: number,
  reason: string,
): RiskFactor {
  return {
    key,
    sentiment,
    severity,
    confidence: clamp(Math.round(confidence), 0, 100),
    reason,
  }
}

function normalizeRiskFactor(factor: RiskFactor): RiskFactor[] {
  if (!FACTOR_KEYS.includes(factor.key)) {
    return []
  }

  return [
    {
      key: factor.key,
      sentiment: isSentiment(factor.sentiment) ? factor.sentiment : 'neutral',
      severity: isSeverity(factor.severity) ? factor.severity : 'low',
      confidence: clamp(Math.round(Number(factor.confidence) || 0), 0, 100),
      reason: String(factor.reason ?? factor.key).slice(0, 180),
      providerGap: Boolean(factor.providerGap),
    },
  ]
}

function isSentiment(value: unknown): value is Evidence['sentiment'] {
  return value === 'positive' || value === 'neutral' || value === 'negative'
}

function isSeverity(value: unknown): value is RiskFactor['severity'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

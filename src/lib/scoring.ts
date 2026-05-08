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
type RiskSeverity = keyof typeof SEVERITY_RANK
type SeverityImpactMap = Record<RiskSeverity, number>

export type RiskFactor = {
  key: RiskFactorKey
  sentiment: Evidence['sentiment']
  severity: RiskSeverity
  confidence: number
  reason: string
  weight?: number
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
  highNonReputationNegativeCount: number
  highReputationNegativeCount: number
  strongNegativeReputationCount: number
  hasIndependentReputation: boolean
  sourceDiversity: number
}

const DEFAULT_FACTOR_WEIGHT = 5
export const RECOMMENDATION_POLICY = {
  avoidScoreThreshold: 50,
  likelySafeScoreThreshold: 50,
  likelySafeConfidenceThreshold: 65,
  safeScoreThreshold: 50,
  safeConfidenceThreshold: 90,
} as const

const IMPACT_WEIGHTS: Record<
  RiskFactorKey,
  {
    positive: SeverityImpactMap
    negative: SeverityImpactMap
  }
> = {
  threat_list: {
    positive: { low: 0, medium: 0, high: 0, critical: 0 },
    negative: { low: 10, medium: 25, high: 45, critical: 70 },
  },
  domain_age: {
    positive: { low: 4, medium: 10, high: 14, critical: 14 },
    negative: { low: 7, medium: 15, high: 24, critical: 45 },
  },
  site_integrity: {
    positive: { low: 3, medium: 8, high: 10, critical: 10 },
    negative: { low: 6, medium: 15, high: 28, critical: 45 },
  },
  contact_identity: {
    positive: { low: 5, medium: 9, high: 11, critical: 11 },
    negative: { low: 4, medium: 8, high: 14, critical: 45 },
  },
  policy_completeness: {
    positive: { low: 5, medium: 9, high: 11, critical: 11 },
    negative: { low: 5, medium: 10, high: 16, critical: 45 },
  },
  independent_reputation: {
    positive: { low: 8, medium: 16, high: 18, critical: 18 },
    negative: { low: 8, medium: 16, high: 25, critical: 45 },
  },
  commerce_intent: {
    positive: { low: 4, medium: 4, high: 4, critical: 4 },
    negative: { low: 5, medium: 10, high: 18, critical: 45 },
  },
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
  const sourceDiversity = countEvidenceSourceDiversity(evidence)
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
  const highNonReputationNegativeCount = factors.filter(
    (factor) =>
      factor.key !== 'independent_reputation' &&
      factor.sentiment === 'negative' &&
      SEVERITY_RANK[factor.severity] >= SEVERITY_RANK.high,
  ).length
  const highReputationNegativeCount = factors.filter(
    (factor) =>
      factor.key === 'independent_reputation' &&
      factor.sentiment === 'negative' &&
      SEVERITY_RANK[factor.severity] >= SEVERITY_RANK.high,
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
    providerGapCount * 6 +
    Math.min(8, sourceDiversity * 2)
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
      highNonReputationNegativeCount,
      highReputationNegativeCount,
      strongNegativeReputationCount,
      hasIndependentReputation,
      sourceDiversity,
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
          highNonReputationNegativeCount: 0,
          highReputationNegativeCount: 0,
          strongNegativeReputationCount: 0,
          hasIndependentReputation: true,
          sourceDiversity: 3,
        }
      : contextOrEvidenceCount

  if (context.hasCriticalThreat) {
    return 'avoid'
  }

  if (score < RECOMMENDATION_POLICY.avoidScoreThreshold) {
    return 'avoid'
  }

  if (
    score >= RECOMMENDATION_POLICY.safeScoreThreshold &&
    confidence >= RECOMMENDATION_POLICY.safeConfidenceThreshold
  ) {
    return 'safe'
  }

  if (
    score >= RECOMMENDATION_POLICY.likelySafeScoreThreshold &&
    confidence >= RECOMMENDATION_POLICY.likelySafeConfidenceThreshold
  ) {
    return 'likely-safe'
  }

  return 'unknown'
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
      const negativeImpact = getReputationNegativeImpact(negativeFactors)
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

function getReputationNegativeImpact(negativeFactors: RiskFactor[]) {
  if (negativeFactors.length === 0) {
    return 0
  }

  const concreteThreatFactors = negativeFactors.filter(isConcreteReputationThreatFactor)
  const serviceOrReviewFactors = negativeFactors.filter(
    (factor) => !concreteThreatFactors.includes(factor),
  )

  if (concreteThreatFactors.length > 0) {
    const concreteImpact = concreteThreatFactors.reduce(
      (total, factor) => total + getNegativeImpact(factor),
      0,
    )
    const reviewNoiseImpact = Math.min(6, serviceOrReviewFactors.length * 2)

    return Math.min(35, concreteImpact + reviewNoiseImpact)
  }

  const strongestReviewImpact = getStrongestImpact(serviceOrReviewFactors, getNegativeImpact)
  const repeatedReviewCount = Math.max(0, serviceOrReviewFactors.length - 1)
  const repeatedReviewImpact = Math.min(4, Math.ceil(Math.sqrt(repeatedReviewCount) * 2))

  return Math.min(18, strongestReviewImpact + repeatedReviewImpact)
}

function countEvidenceSourceDiversity(evidence: Evidence[]) {
  const sources = new Set<string>()

  for (const item of evidence) {
    const normalizedHost = normalizeEvidenceHost(item.url)
    sources.add(`${item.sourceType}:${normalizedHost}`)
  }

  return sources.size
}

function normalizeEvidenceHost(url?: string) {
  if (!url) {
    return 'unknown'
  }

  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return 'unknown'
  }
}

function isConcreteReputationThreatFactor(factor: RiskFactor) {
  return /non-delivery|never arrived|not delivered|chargeback|counterfeit|fraudulent|reported fraud|fraud reports|fraudulent charges|fake store|stole money|verified scam|confirmed scam/.test(
    factor.reason.toLowerCase(),
  )
}

function getPositiveImpact(factor: RiskFactor) {
  return getWeightedImpact(factor, IMPACT_WEIGHTS[factor.key].positive[factor.severity])
}

function getNegativeImpact(factor: RiskFactor) {
  return getWeightedImpact(factor, IMPACT_WEIGHTS[factor.key].negative[factor.severity])
}

function getWeightedImpact(factor: RiskFactor, baseImpact: number) {
  if (baseImpact === 0) {
    return 0
  }

  const weight = clamp(Math.round(factor.weight ?? DEFAULT_FACTOR_WEIGHT), 1, 10)
  const multiplier = 0.8 + ((weight - 1) / 9) * 0.4

  return Math.round(baseImpact * multiplier)
}

function evidenceToFactors(item: Evidence): RiskFactor[] {
  const text = `${item.title} ${item.snippet} ${item.url ?? ''}`.toLowerCase()
  const factors: RiskFactor[] = []

  if (/urlhaus|phishtank|web risk|threat list|malware listing|phishing/i.test(text)) {
    factors.push(createThreatFactor(item, text))
  }

  if (
    item.sourceType === 'rdap' ||
    item.sourceType === 'whois' ||
    /domain .*registered|domain older|registration/i.test(text)
  ) {
    factors.push(createDomainFactor(item, text))
  }

  if (
    (item.sourceType === 'technical' || item.sourceType === 'store-site') &&
    /https|homepage|could not be reached|responded with http|reachable/i.test(text)
  ) {
    factors.push(createSiteIntegrityFactor(item, text))
  }

  if (
    item.sourceType === 'store-site' &&
    /contact|business|address|support|company|registered office|identity/i.test(text)
  ) {
    factors.push(createContactFactor(item, text))
  }

  if (
    item.sourceType === 'store-site' &&
    /polic|\breturns?\b|refund|shipping|delivery|privacy|terms/i.test(text)
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

  if (
    item.sourceType === 'store-site' &&
    /cart|checkout|shop now|add to cart|payment|commerce|storefront|shopping signals|sell products/i.test(
      text,
    )
  ) {
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
    weight: item.weight,
    providerGap,
    reason: item.title,
  })[0]
}

function createDomainFactor(item: Evidence, text: string): RiskFactor {
  if (/less than 30|under 30|about [0-2]?\d days/.test(text)) {
    return createFactor('domain_age', 'negative', 'high', 88, item.title, item.weight)
  }

  if (/30.+90|less than 90|recently registered/.test(text)) {
    return createFactor('domain_age', 'negative', 'medium', 78, item.title, item.weight)
  }

  if (/less than one year|less than 365|under one year/.test(text)) {
    return createFactor('domain_age', 'negative', 'low', 65, item.title, item.weight)
  }

  if (/older than three years|more than three years|3\+ years|8\+ years/.test(text)) {
    return createFactor('domain_age', 'positive', 'high', 82, item.title, item.weight)
  }

  if (/older than one year|more than one year|established domain/.test(text)) {
    return createFactor('domain_age', 'positive', 'medium', 74, item.title, item.weight)
  }

  return createFactor('domain_age', item.sentiment, 'low', 45, item.title, item.weight)
}

function createSiteIntegrityFactor(item: Evidence, text: string): RiskFactor {
  if (/plain http|no https/.test(text)) {
    return createFactor('site_integrity', 'negative', 'medium', 84, item.title, item.weight)
  }

  if (/blocked automated check|automated checker|bot protection/.test(text)) {
    return createFactor('site_integrity', 'neutral', 'low', 50, item.title, item.weight)
  }

  if (/could not be reached|request failed|http 4|http 5/.test(text)) {
    return createFactor('site_integrity', 'negative', 'high', 84, item.title, item.weight)
  }

  if (/https is enabled|homepage is reachable|responded with http 2/.test(text)) {
    return createFactor('site_integrity', 'positive', 'medium', 65, item.title, item.weight)
  }

  return createFactor('site_integrity', item.sentiment, 'low', 42, item.title, item.weight)
}

function createContactFactor(item: Evidence, text: string): RiskFactor {
  if (/limited contact|no clear email|no clear .*business|missing contact/.test(text)) {
    return createFactor('contact_identity', 'negative', 'medium', 76, item.title, item.weight)
  }

  if (/visible contact|business details|business-identifying|registered office/.test(text)) {
    return createFactor('contact_identity', 'positive', 'medium', 76, item.title, item.weight)
  }

  return createFactor('contact_identity', item.sentiment, 'low', 42, item.title, item.weight)
}

function createPolicyFactor(item: Evidence, text: string): RiskFactor {
  if (/without clear policies|policy language was not found|missing .*polic/.test(text)) {
    return createFactor('policy_completeness', 'negative', 'high', 78, item.title, item.weight)
  }

  if (/policy coverage|policy page found|policy links|return|refund|shipping|privacy|terms/.test(text)) {
    return createFactor('policy_completeness', 'positive', 'medium', 72, item.title, item.weight)
  }

  return createFactor('policy_completeness', item.sentiment, 'low', 40, item.title, item.weight)
}

function createReputationFactor(item: Evidence, text: string): RiskFactor {
  const reason = `${item.title}: ${item.snippet}`.slice(0, 180)

  if (
    /non-delivery|never arrived|not delivered|chargeback|counterfeit|fraudulent|reported fraud|fraud reports|fraudulent charges|fake store|verified scam|confirmed scam/.test(
      text,
    ) &&
    !isAmbiguousScamQuestion(text)
  ) {
    return createFactor('independent_reputation', 'negative', 'high', 84, reason, item.weight)
  }

  if (
    /low rating|poor rating|dissatisfied|worst customer service|frustrating|slow|deceitful|disgraceful|harassment/.test(
      text,
    )
  ) {
    return createFactor('independent_reputation', 'negative', 'low', 68, reason, item.weight)
  }

  if (/complaint|refund issue|bad review|negative review/.test(text)) {
    return createFactor('independent_reputation', 'negative', 'medium', 72, reason, item.weight)
  }

  if (/verified|trusted|positive reviews|good review/.test(text)) {
    return createFactor('independent_reputation', 'positive', 'medium', 70, reason, item.weight)
  }

  const providerGap = /not configured|unavailable|failed|timeout|did not complete/.test(text)

  return normalizeRiskFactor({
    key: 'independent_reputation',
    sentiment: item.sentiment,
    severity: 'low',
    confidence: providerGap ? 20 : 45,
    weight: item.weight,
    providerGap,
    reason,
  })[0]
}

function createCommerceFactor(item: Evidence, text: string): RiskFactor {
  if (/shopping signals without clear policies|sell products.*not found/.test(text)) {
    return createFactor('commerce_intent', 'negative', 'medium', 72, item.title, item.weight)
  }

  if (/cart|checkout|shop now|add to cart|payment|storefront shopping signals/.test(text)) {
    return createFactor('commerce_intent', 'neutral', 'low', 48, item.title, item.weight)
  }

  return createFactor('commerce_intent', item.sentiment, 'low', 38, item.title, item.weight)
}

function isAmbiguousScamQuestion(text: string) {
  return (
    /\b(is|are|was|were)\b.{0,80}\b(legit|safe|scam|fraud|real|trustworthy)\b/.test(
      text,
    ) &&
    !/non-delivery|never arrived|not delivered|chargeback|counterfeit|fraudulent|reported fraud|fraud reports|fraudulent charges|fake store|verified scam|confirmed scam/.test(
      text,
    )
  )
}

function createFactor(
  key: RiskFactorKey,
  sentiment: Evidence['sentiment'],
  severity: RiskSeverity,
  confidence: number,
  reason: string,
  weight = DEFAULT_FACTOR_WEIGHT,
): RiskFactor {
  return {
    key,
    sentiment,
    severity,
    confidence: clamp(Math.round(confidence), 0, 100),
    weight: clamp(Math.round(weight), 1, 10),
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
      weight: clamp(Math.round(Number(factor.weight) || DEFAULT_FACTOR_WEIGHT), 1, 10),
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

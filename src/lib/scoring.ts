import type { Evidence, Recommendation } from '../types/report'

export type ScoreResult = {
  score: number
  confidence: number
  recommendation: Recommendation
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

  return deduped.slice(0, 18)
}

export function scoreEvidence(evidence: Evidence[]): ScoreResult {
  const positiveWeight = evidence
    .filter((item) => item.sentiment === 'positive')
    .reduce((total, item) => total + item.weight, 0)
  const negativeWeight = evidence
    .filter((item) => item.sentiment === 'negative')
    .reduce((total, item) => total + item.weight, 0)
  const neutralWeight = evidence
    .filter((item) => item.sentiment === 'neutral')
    .reduce((total, item) => total + item.weight, 0)

  const signalVolume = positiveWeight + negativeWeight + neutralWeight
  const score = clamp(Math.round(58 + positiveWeight * 3.2 - negativeWeight * 5.4), 0, 100)
  const confidence = clamp(Math.round(22 + evidence.length * 6 + signalVolume * 2.2), 8, 96)

  return {
    score,
    confidence,
    recommendation: getRecommendation(score, confidence, evidence.length),
  }
}

export function getRecommendation(
  score: number,
  confidence: number,
  evidenceCount: number,
): Recommendation {
  if (confidence < 42 || evidenceCount < 3) {
    return 'unknown'
  }

  if (score >= 80) {
    return 'likely-safe'
  }

  if (score >= 55) {
    return 'caution'
  }

  return 'avoid'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

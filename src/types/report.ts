export type Recommendation = 'likely-safe' | 'caution' | 'avoid' | 'unknown'

export type Evidence = {
  sourceType: 'store-site' | 'search-result' | 'review' | 'rdap' | 'technical'
  title: string
  url?: string
  snippet: string
  sentiment: 'positive' | 'neutral' | 'negative'
  weight: number
  observedAt: string
}

export type StoreSafetyReport = {
  id: string
  inputUrl: string
  normalizedUrl: string
  hostname: string
  status: 'queued' | 'researching' | 'scoring' | 'complete' | 'failed'
  score: number
  confidence: number
  recommendation: Recommendation
  summary: string
  evidence: Evidence[]
  createdAt: string
  expiresAt: string
}

export type StoreSafetyRequest = {
  id: string
  inputUrl: string
  normalizedUrl: string
  hostname: string
}

export type StoreSafetyState = {
  report: StoreSafetyReport | null
  updatedAt: string | null
}

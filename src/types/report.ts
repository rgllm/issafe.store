export type Recommendation = 'safe' | 'likely-safe' | 'avoid' | 'unknown'

export type Evidence = {
  sourceType: 'store-site' | 'search-result' | 'review' | 'rdap' | 'whois' | 'technical'
  title: string
  url?: string
  snippet: string
  sentiment: 'positive' | 'neutral' | 'negative'
  weight: number
  observedAt: string
}

export type Coupon = {
  title: string
  description: string
  code?: string
  url?: string
  source: string
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
  coupons: Coupon[]
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

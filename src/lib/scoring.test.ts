import { describe, expect, it } from 'vitest'
import { dedupeEvidence, scoreEvidence } from './scoring'
import type { Evidence } from '../types/report'

const observedAt = '2026-05-04T00:00:00.000Z'

const createEvidence = (overrides: Partial<Evidence>): Evidence => ({
  sourceType: 'review',
  title: 'Independent review',
  url: 'https://reviews.example/test',
  snippet: 'Review snippet',
  sentiment: 'neutral',
  weight: 2,
  observedAt,
  ...overrides,
})

const basicStoreSignals = [
  createEvidence({
    sourceType: 'technical',
    title: 'HTTPS is enabled',
    sentiment: 'positive',
    weight: 1,
  }),
  createEvidence({
    sourceType: 'store-site',
    title: 'Store homepage is reachable',
    snippet: 'The homepage responded with HTTP 200.',
    sentiment: 'positive',
    weight: 2,
  }),
]

describe('dedupeEvidence', () => {
  it('deduplicates identical evidence and clamps weight', () => {
    const longSnippet = 'A'.repeat(500)
    const evidence = dedupeEvidence([
      createEvidence({ title: 'Same', snippet: longSnippet, weight: 99 }),
      createEvidence({ title: 'Same', snippet: longSnippet, weight: 99 }),
    ])

    expect(evidence).toHaveLength(1)
    expect(evidence[0]?.weight).toBe(10)
    expect(evidence[0]?.snippet).toHaveLength(420)
  })
})

describe('scoreEvidence', () => {
  it('returns likely-safe for established stores with policies, contact, and reputation', () => {
    const result = scoreEvidence([
      ...basicStoreSignals,
      createEvidence({
        sourceType: 'store-site',
        title: 'Visible contact or business details',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Customer policy coverage found',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'rdap',
        title: 'Domain older than three years',
        sentiment: 'positive',
        weight: 7,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Positive reviews on independent platforms',
        snippet: 'Customers mention trusted service and positive reviews.',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'No URLhaus malware listing found',
        sentiment: 'neutral',
        weight: 1,
      }),
    ])

    expect(result.score).toBeGreaterThanOrEqual(78)
    expect(result.confidence).toBeGreaterThanOrEqual(68)
    expect(result.recommendation).toBe('likely-safe')
  })

  it('does not return likely-safe for HTTPS and reachability alone', () => {
    const result = scoreEvidence(basicStoreSignals)

    expect(result.score).toBeGreaterThan(50)
    expect(result.recommendation).toBe('unknown')
  })

  it('returns avoid for a new store with missing policies and contact details', () => {
    const result = scoreEvidence([
      ...basicStoreSignals,
      createEvidence({
        sourceType: 'store-site',
        title: 'Storefront shopping signals found',
        snippet: 'The site appears to present products and payment-related language.',
        sentiment: 'neutral',
        weight: 2,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Limited contact details on store pages',
        sentiment: 'negative',
        weight: 6,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Shopping signals without clear policies',
        sentiment: 'negative',
        weight: 7,
      }),
      createEvidence({
        sourceType: 'rdap',
        title: 'Domain registered less than 90 days ago',
        sentiment: 'negative',
        weight: 6,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'No URLhaus malware listing found',
        sentiment: 'neutral',
        weight: 1,
      }),
    ])

    expect(result.score).toBeLessThan(55)
    expect(result.recommendation).toBe('avoid')
  })

  it('forces avoid for a critical threat-list match', () => {
    const result = scoreEvidence([
      ...basicStoreSignals,
      createEvidence({
        sourceType: 'store-site',
        title: 'Visible contact or business details',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Customer policy coverage found',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'rdap',
        title: 'Domain older than three years',
        sentiment: 'positive',
        weight: 7,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'Google Web Risk threat match found',
        snippet: 'Google Web Risk matched this URL against: SOCIAL_ENGINEERING.',
        sentiment: 'negative',
        weight: 10,
      }),
    ])

    expect(result.score).toBeLessThanOrEqual(20)
    expect(result.confidence).toBeGreaterThanOrEqual(80)
    expect(result.recommendation).toBe('avoid')
  })

  it('lowers confidence for missing providers without penalizing score directly', () => {
    const evidence = [
      ...basicStoreSignals,
      createEvidence({
        sourceType: 'store-site',
        title: 'Visible contact or business details',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Customer policy coverage found',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'rdap',
        title: 'Domain older than three years',
        sentiment: 'positive',
        weight: 7,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Positive reviews on independent platforms',
        snippet: 'Customers mention trusted service and positive reviews.',
        sentiment: 'positive',
        weight: 5,
      }),
    ]
    const complete = scoreEvidence(evidence)
    const withMissingProviders = scoreEvidence([
      ...evidence,
      createEvidence({
        sourceType: 'technical',
        title: 'External search provider is not configured',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'Google Web Risk is not configured',
        sentiment: 'neutral',
        weight: 1,
      }),
    ])

    expect(withMissingProviders.score).toBe(complete.score)
    expect(withMissingProviders.confidence).toBeLessThan(complete.confidence)
  })

  it('returns caution for mixed positive and negative reputation evidence', () => {
    const result = scoreEvidence([
      ...basicStoreSignals,
      createEvidence({
        sourceType: 'store-site',
        title: 'Visible contact or business details',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Customer policy coverage found',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'rdap',
        title: 'Domain older than three years',
        sentiment: 'positive',
        weight: 7,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Positive reviews on independent platforms',
        snippet: 'Customers mention trusted service and positive reviews.',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Refund complaints on Reddit',
        snippet: 'Customers describe refund issues after non-delivery.',
        sentiment: 'negative',
        weight: 6,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'No URLhaus malware listing found',
        sentiment: 'neutral',
        weight: 1,
      }),
    ])

    expect(result.score).toBeGreaterThanOrEqual(55)
    expect(result.score).toBeLessThan(78)
    expect(result.recommendation).toBe('caution')
  })

  it('does not force avoid for established stores with mixed reputation snippets', () => {
    const result = scoreEvidence([
      ...basicStoreSignals,
      createEvidence({
        sourceType: 'store-site',
        title: 'Visible contact or business details',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Customer policy coverage found',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'rdap',
        title: 'Domain older than three years',
        sentiment: 'positive',
        weight: 7,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Positive reviews on independent platforms',
        snippet: 'Customers mention official stores, customer service, and positive reviews.',
        sentiment: 'positive',
        weight: 5,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Refund complaints on Reddit',
        snippet: 'Customers describe refund issues and complaints.',
        sentiment: 'negative',
        weight: 4,
      }),
      createEvidence({
        sourceType: 'search-result',
        title: 'Scam search result',
        snippet: 'A result discusses whether the official store is a scam.',
        sentiment: 'negative',
        weight: 4,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'No URLhaus malware listing found',
        sentiment: 'neutral',
        weight: 1,
      }),
    ])

    expect(result.score).toBeGreaterThanOrEqual(55)
    expect(result.score).toBeLessThan(78)
    expect(result.recommendation).toBe('caution')
  })

  it('returns caution for established brands with service-review noise and unavailable providers', () => {
    const result = scoreEvidence([
      createEvidence({
        sourceType: 'technical',
        title: 'HTTPS is enabled',
        snippet: 'The submitted store URL uses HTTPS.',
        sentiment: 'positive',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Store homepage blocked automated check',
        snippet:
          'The homepage returned HTTP 403 to the automated checker. This often reflects bot protection and is not treated as a direct store-risk signal.',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'rdap',
        title: 'Domain older than three years',
        snippet: 'RDAP registration date: 1997-05-29T04:00:00Z.',
        sentiment: 'positive',
        weight: 7,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'URLhaus malware check unavailable',
        snippet: 'The provider did not return a usable result, so this signal is not included in the score.',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'PhishTank phishing check unavailable',
        snippet: 'The provider did not return a usable result, so this signal is not included in the score.',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'Google Web Risk check unavailable',
        snippet: 'The provider did not return a usable result, so this signal is not included in the score.',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Zara Reviews | Read Customer Service Reviews of zara.com - Yelp',
        snippet:
          'Zara has an average rating of 1.9 from 9607 reviews. Most customers are generally dissatisfied. The official website is zara.com.',
        sentiment: 'negative',
        weight: 4,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Read Customer Service Reviews of www.zara.com - Trustpilot',
        snippet:
          'Consumers find customer service to be negative, with many reviewers reporting frustrating, slow support.',
        sentiment: 'negative',
        weight: 4,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Zara Online - www.zara.com - Review Centre',
        snippet: 'Worst customer service ever for a world wide company.',
        sentiment: 'negative',
        weight: 4,
      }),
      createEvidence({
        sourceType: 'search-result',
        title: 'Fast-Fashion Brand Zara Alleges Massive Scam',
        snippet:
          'Zara claims another owner purchased Zara clothing, removed labels, and copied photos.',
        sentiment: 'neutral',
        weight: 2,
      }),
    ])

    expect(result.score).toBeGreaterThanOrEqual(55)
    expect(result.recommendation).toBe('caution')
  })

  it('does not return avoid when homepage and RDAP checks are blocked but reviews are service complaints', () => {
    const result = scoreEvidence([
      createEvidence({
        sourceType: 'technical',
        title: 'HTTPS is enabled',
        snippet: 'The submitted store URL uses HTTPS.',
        sentiment: 'positive',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'store-site',
        title: 'Store homepage blocked automated check',
        snippet:
          'The homepage returned HTTP 403 to the automated checker. This often reflects bot protection and is not treated as a direct store-risk signal.',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'rdap',
        title: 'Domain registration lookup was inconclusive',
        snippet: 'RDAP returned HTTP 403.',
        sentiment: 'neutral',
        weight: 2,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'URLhaus malware check unavailable',
        snippet: 'The provider did not return a usable result, so this signal is not included in the score.',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'PhishTank phishing check unavailable',
        snippet: 'The provider did not return a usable result, so this signal is not included in the score.',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'technical',
        title: 'Google Web Risk check unavailable',
        snippet: 'The provider did not return a usable result, so this signal is not included in the score.',
        sentiment: 'neutral',
        weight: 1,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Zara Reviews | Read Customer Service Reviews of zara.com - Yelp',
        snippet:
          'Zara has an average rating of 1.9 from 9607 reviews. Most customers are generally dissatisfied.',
        sentiment: 'negative',
        weight: 4,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Read Customer Service Reviews of www.zara.com - Trustpilot',
        snippet:
          'Consumers find customer service to be negative, with many reviewers reporting frustrating, slow support.',
        sentiment: 'negative',
        weight: 4,
      }),
      createEvidence({
        sourceType: 'review',
        title: 'Zara Online - www.zara.com - Review Centre',
        snippet: 'Worst customer service ever for a world wide company.',
        sentiment: 'negative',
        weight: 4,
      }),
    ])

    expect(result.score).toBeGreaterThanOrEqual(40)
    expect(result.recommendation).toBe('caution')
  })
})

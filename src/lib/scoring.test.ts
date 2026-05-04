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
  it('returns likely-safe for strong positive evidence', () => {
    const result = scoreEvidence([
      createEvidence({ title: 'Established domain', sentiment: 'positive', weight: 4 }),
      createEvidence({ title: 'Reachable store', sentiment: 'positive', weight: 4 }),
      createEvidence({ title: 'Positive reviews', sentiment: 'positive', weight: 4 }),
    ])

    expect(result.score).toBeGreaterThanOrEqual(80)
    expect(result.recommendation).toBe('likely-safe')
  })

  it('returns caution for enough neutral mixed evidence', () => {
    const result = scoreEvidence([
      createEvidence({ title: 'Homepage reachable', sentiment: 'neutral', weight: 2 }),
      createEvidence({ title: 'RDAP found', sentiment: 'neutral', weight: 2 }),
      createEvidence({ title: 'Few search results', sentiment: 'neutral', weight: 2 }),
    ])

    expect(result.score).toBeGreaterThanOrEqual(55)
    expect(result.recommendation).toBe('caution')
  })

  it('returns avoid for strong negative evidence', () => {
    const result = scoreEvidence([
      createEvidence({ title: 'Scam complaints', sentiment: 'negative', weight: 6 }),
      createEvidence({ title: 'Refund issues', sentiment: 'negative', weight: 5 }),
      createEvidence({ title: 'No policies', sentiment: 'negative', weight: 5 }),
    ])

    expect(result.score).toBeLessThan(55)
    expect(result.recommendation).toBe('avoid')
  })

  it('returns unknown when confidence is too low', () => {
    const result = scoreEvidence([
      createEvidence({ title: 'HTTPS', sentiment: 'positive', weight: 3 }),
      createEvidence({ title: 'Homepage reachable', sentiment: 'positive', weight: 4 }),
    ])

    expect(result.recommendation).toBe('unknown')
  })
})

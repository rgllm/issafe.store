import { describe, expect, it, vi } from 'vitest'
import type { Evidence, StoreSafetyRequest } from '../types/report'
import type { RiskFactor, ScoreResult } from './scoring'
import {
  isRetryableStoreCheckError,
  resumeStoreResearch,
  type StoreResearchCheckpoint,
} from './store-check-resilience'

function createRequest(): StoreSafetyRequest {
  return {
    id: 'store-test',
    inputUrl: 'https://example.com',
    normalizedUrl: 'https://example.com/',
    hostname: 'example.com',
  }
}

function createEvidence(title: string, sentiment: Evidence['sentiment'] = 'neutral'): Evidence {
  return {
    sourceType: 'technical',
    title,
    snippet: title,
    sentiment,
    weight: 1,
    observedAt: '2026-05-13T00:00:00.000Z',
  }
}

describe('isRetryableStoreCheckError', () => {
  it('treats retryable transport and rate-limit failures as transient', () => {
    expect(isRetryableStoreCheckError({ retryable: true })).toBe(true)
    expect(isRetryableStoreCheckError(new DOMException('Request timed out', 'AbortError'))).toBe(true)
    expect(isRetryableStoreCheckError({ status: 429 })).toBe(true)
    expect(isRetryableStoreCheckError(new Error('network connection reset by peer'))).toBe(true)
  })

  it('does not retry ordinary application failures', () => {
    expect(isRetryableStoreCheckError(new Error('Unsupported URL format'))).toBe(false)
    expect(isRetryableStoreCheckError(new Error('Invalid timeout configuration'))).toBe(false)
    expect(isRetryableStoreCheckError(new Error('network reputation lookup key invalid'))).toBe(false)
    expect(isRetryableStoreCheckError({ status: 403 })).toBe(false)
    expect(isRetryableStoreCheckError(null)).toBe(false)
  })
})

describe('resumeStoreResearch', () => {
  it('resumes from a checkpoint without rerunning completed phases', async () => {
    const request = createRequest()
    const siteEvidence = [createEvidence('site complete', 'positive')]
    const rdapEvidence = [createEvidence('rdap complete', 'positive')]
    const threatEvidence = [createEvidence('threat complete', 'neutral')]
    const searchEvidence = [createEvidence('search complete', 'neutral')]
    const coupons = [
      {
        title: 'Coupon',
        description: 'Coupon',
        source: 'example.com',
        observedAt: '2026-05-13T00:00:00.000Z',
      },
    ]
    const classifiedFactors: RiskFactor[] = [
      {
        key: 'site_integrity',
        sentiment: 'positive',
        severity: 'medium',
        confidence: 80,
        reason: 'reachable site',
      },
    ]
    const score: ScoreResult = {
      score: 72,
      confidence: 84,
      recommendation: 'likely-safe',
    }

    const checkpoint: StoreResearchCheckpoint = {
      request,
      createdAt: '2026-05-13T00:00:00.000Z',
      expiresAt: '2026-05-20T00:00:00.000Z',
      siteEvidence,
      rdapEvidence,
    }

    const steps = {
      collectSiteEvidence: vi.fn().mockResolvedValue(siteEvidence),
      collectRdapEvidence: vi.fn().mockResolvedValue(rdapEvidence),
      collectThreatListEvidence: vi.fn().mockResolvedValue(threatEvidence),
      collectTavilyEvidence: vi.fn().mockResolvedValue(searchEvidence),
      collectTavilyCoupons: vi.fn().mockResolvedValue(coupons),
      classifyEvidenceFactors: vi.fn().mockResolvedValue(classifiedFactors),
      scoreEvidence: vi.fn().mockReturnValue(score),
      summarizeReport: vi.fn().mockResolvedValue('Finished summary'),
    }
    const onCheckpoint = vi.fn()
    const onProgress = vi.fn()

    const report = await resumeStoreResearch({
      request,
      env: {},
      checkpoint,
      steps,
      onCheckpoint,
      onProgress,
    })

    expect(steps.collectSiteEvidence).not.toHaveBeenCalled()
    expect(steps.collectRdapEvidence).not.toHaveBeenCalled()
    expect(steps.collectThreatListEvidence).toHaveBeenCalledOnce()
    expect(steps.collectTavilyEvidence).toHaveBeenCalledOnce()
    expect(steps.collectTavilyCoupons).toHaveBeenCalledOnce()
    expect(steps.classifyEvidenceFactors).toHaveBeenCalledOnce()
    expect(steps.summarizeReport).toHaveBeenCalledOnce()
    expect(onCheckpoint).toHaveBeenCalled()
    expect(onProgress).toHaveBeenCalledWith('researching', 'Checking public threat-list signals.', 3)
    expect(onProgress).toHaveBeenCalledWith('researching', 'Searching for external reputation signals.', 4)
    expect(onProgress).toHaveBeenCalledWith('scoring', 'Classifying evidence and calculating the risk score.', 5)
    expect(onProgress).toHaveBeenCalledWith('scoring', 'Summarizing evidence and calculating the risk score.', 6)
    expect(report).toEqual(
      expect.objectContaining({
        id: request.id,
        status: 'complete',
        score: 72,
        confidence: 84,
        recommendation: 'likely-safe',
        summary: 'Finished summary',
        coupons,
      }),
    )
  })

  it('keeps the latest successful checkpoint when a later phase fails', async () => {
    const request = createRequest()
    const siteEvidence = [createEvidence('site complete', 'positive')]
    const rdapEvidence = [createEvidence('rdap complete', 'positive')]
    const threatEvidence = [createEvidence('threat complete', 'neutral')]
    const steps = {
      collectSiteEvidence: vi.fn().mockResolvedValue(siteEvidence),
      collectRdapEvidence: vi.fn().mockResolvedValue(rdapEvidence),
      collectThreatListEvidence: vi.fn().mockResolvedValue(threatEvidence),
      collectTavilyEvidence: vi.fn().mockRejectedValue(new Error('fetch failed')),
      collectTavilyCoupons: vi.fn().mockResolvedValue([]),
      classifyEvidenceFactors: vi.fn(),
      scoreEvidence: vi.fn(),
      summarizeReport: vi.fn(),
    }
    const onCheckpoint = vi.fn()

    await expect(
      resumeStoreResearch({
        request,
        env: {},
        steps,
        onCheckpoint,
      }),
    ).rejects.toThrow('fetch failed')

    expect(onCheckpoint).toHaveBeenLastCalledWith(
      expect.objectContaining({
        request,
        siteEvidence,
        rdapEvidence,
        threatEvidence,
      }),
    )
  })
})

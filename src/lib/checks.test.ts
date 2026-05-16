import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAgentByNameMock,
  getCachedReportMock,
  normalizeStoreUrlMock,
  createCheckIdMock,
  assertUsageLimitsMock,
} = vi.hoisted(() => ({
  getAgentByNameMock: vi.fn(),
  getCachedReportMock: vi.fn(),
  normalizeStoreUrlMock: vi.fn(),
  createCheckIdMock: vi.fn(),
  assertUsageLimitsMock: vi.fn(),
}))

vi.mock('agents', () => ({
  getAgentByName: getAgentByNameMock,
}))

vi.mock('./reports-db', () => ({
  getCachedReport: getCachedReportMock,
}))

vi.mock('./usage-limits', async () => {
  const actual = await vi.importActual<typeof import('./usage-limits')>('./usage-limits')

  return {
    ...actual,
    assertUsageLimits: assertUsageLimitsMock,
  }
})

vi.mock('./url', () => ({
  createCheckId: createCheckIdMock,
  normalizeStoreUrl: normalizeStoreUrlMock,
}))

import { getStoreCheck, startStoreCheck } from './checks'

describe('agent lookup routing retries', () => {
  beforeEach(() => {
    getAgentByNameMock.mockReset()
    getCachedReportMock.mockReset()
    normalizeStoreUrlMock.mockReset()
    createCheckIdMock.mockReset()
    assertUsageLimitsMock.mockReset()
    assertUsageLimitsMock.mockResolvedValue(undefined)
  })

  it('uses routing retries when starting a new store check', async () => {
    const request = {
      inputUrl: 'https://example.com',
      normalizedUrl: 'https://example.com/',
      hostname: 'example.com',
    }
    const queuedReport = {
      ...request,
      id: 'store-id',
      status: 'queued',
      score: 0,
      confidence: 0,
      recommendation: 'unknown',
      summary: 'queued',
      evidence: [],
      coupons: [],
      createdAt: '2026-05-13T00:00:00.000Z',
      expiresAt: '2026-05-20T00:00:00.000Z',
    }

    normalizeStoreUrlMock.mockReturnValue(request)
    createCheckIdMock.mockResolvedValue('store-id')
    getCachedReportMock.mockResolvedValue(null)
    getAgentByNameMock.mockResolvedValue({
      startCheck: vi.fn().mockResolvedValue(queuedReport),
    })

    await startStoreCheck({ url: request.inputUrl }, { DB: {}, StoreSafetyAgent: {} } as Env)

    expect(getAgentByNameMock).toHaveBeenCalledWith(
      {},
      'store-id',
      {
        routingRetry: {
          maxAttempts: 3,
          baseDelayMs: 150,
          maxDelayMs: 1_000,
        },
      },
    )
    expect(assertUsageLimitsMock).toHaveBeenCalledWith(
      {},
      expect.arrayContaining([
        expect.objectContaining({ scope: 'checks:global' }),
        expect.objectContaining({ scope: 'checks:domain:example.com' }),
      ]),
    )
  })

  it('uses routing retries when polling an in-flight store check', async () => {
    getCachedReportMock.mockResolvedValue(null)
    getAgentByNameMock.mockResolvedValue({
      getCurrentReport: vi.fn().mockResolvedValue({
        id: 'store-id',
        inputUrl: 'https://example.com',
        normalizedUrl: 'https://example.com/',
        hostname: 'example.com',
        status: 'researching',
        progressStep: 3,
        score: 0,
        confidence: 0,
        recommendation: 'unknown',
        summary: 'working',
        evidence: [],
        coupons: [],
        createdAt: '2026-05-13T00:00:00.000Z',
        expiresAt: '2026-05-20T00:00:00.000Z',
      }),
    })

    await getStoreCheck('store-id', { DB: {}, StoreSafetyAgent: {} } as Env)

    expect(getAgentByNameMock).toHaveBeenCalledWith(
      {},
      'store-id',
      {
        routingRetry: {
          maxAttempts: 3,
          baseDelayMs: 150,
          maxDelayMs: 1_000,
        },
      },
    )
  })
})

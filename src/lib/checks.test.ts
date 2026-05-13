import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAgentByNameMock,
  getCachedReportMock,
  normalizeStoreUrlMock,
  createCheckIdMock,
} = vi.hoisted(() => ({
  getAgentByNameMock: vi.fn(),
  getCachedReportMock: vi.fn(),
  normalizeStoreUrlMock: vi.fn(),
  createCheckIdMock: vi.fn(),
}))

vi.mock('agents', () => ({
  getAgentByName: getAgentByNameMock,
}))

vi.mock('./reports-db', () => ({
  getCachedReport: getCachedReportMock,
}))

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

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTavilyQueries,
  classifyEvidenceFactors,
  collectPhishTankEvidence,
  collectTavilyEvidence,
  collectUrlhausEvidence,
  collectWebRiskEvidence,
  getCacheTtlSeconds,
} from './research'
import type { Evidence, StoreSafetyRequest } from '../types/report'

const observedAt = '2026-05-04T00:00:00.000Z'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function createRequest(): StoreSafetyRequest {
  return {
    id: 'store-test',
    inputUrl: 'example.com',
    normalizedUrl: 'https://example.com/',
    hostname: 'example.com',
  }
}

function createEvidence(overrides: Partial<Evidence>): Evidence {
  return {
    sourceType: 'technical',
    title: 'HTTPS is enabled',
    snippet: 'The submitted store URL uses HTTPS.',
    sentiment: 'positive',
    weight: 1,
    observedAt,
    ...overrides,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('getCacheTtlSeconds', () => {
  it('uses a 24 hour default for missing or invalid values', () => {
    expect(getCacheTtlSeconds({})).toBe(86_400)
    expect(getCacheTtlSeconds({ CACHE_TTL_SECONDS: '-1' })).toBe(86_400)
    expect(getCacheTtlSeconds({ CACHE_TTL_SECONDS: 'not-a-number' })).toBe(86_400)
  })

  it('uses a positive configured TTL', () => {
    expect(getCacheTtlSeconds({ CACHE_TTL_SECONDS: '3600' })).toBe(3600)
  })
})

describe('buildTavilyQueries', () => {
  it('builds reputation and domain-constrained queries for a hostname', () => {
    expect(buildTavilyQueries('example.com')).toEqual([
      { query: '"example.com" reviews' },
      { query: '"example.com" scam OR fraud OR complaints' },
      { query: '"example.com" Trustpilot OR Reddit OR BBB OR ScamAdviser' },
      {
        query: '"example.com"',
        includeDomains: ['trustpilot.com', 'reddit.com', 'bbb.org', 'scamadviser.com'],
      },
    ])
  })
})

describe('threat provider mapping', () => {
  it('maps URLhaus matches to critical negative evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/v1/url/')) {
          return Promise.resolve(
            jsonResponse({
              query_status: 'ok',
              url: 'https://example.com/',
              threat: 'malware_download',
            }),
          )
        }

        return Promise.resolve(jsonResponse({ query_status: 'no_results' }))
      }),
    )

    const evidence = await collectUrlhausEvidence('https://example.com/', 'example.com')

    expect(evidence[0]?.title).toBe('URLhaus malware listing found')
    expect(evidence[0]?.sentiment).toBe('negative')
    expect(evidence[0]?.weight).toBe(10)
  })

  it('maps URLhaus no-match responses to neutral evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ query_status: 'no_results' }))),
    )

    const evidence = await collectUrlhausEvidence('https://example.com/', 'example.com')

    expect(evidence[0]?.title).toBe('No URLhaus malware listing found')
    expect(evidence[0]?.sentiment).toBe('neutral')
  })

  it('maps verified PhishTank matches to negative evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            results: {
              in_database: true,
              valid: true,
              verified: true,
              phish_id: 123,
            },
          }),
        ),
      ),
    )

    const evidence = await collectPhishTankEvidence('https://example.com/')

    expect(evidence[0]?.title).toBe('PhishTank verified phishing match found')
    expect(evidence[0]?.sentiment).toBe('negative')
  })

  it('maps clean PhishTank responses to neutral evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            results: {
              in_database: false,
              valid: false,
              verified: false,
            },
          }),
        ),
      ),
    )

    const evidence = await collectPhishTankEvidence('https://example.com/')

    expect(evidence[0]?.title).toBe('No PhishTank phishing record found')
    expect(evidence[0]?.sentiment).toBe('neutral')
  })

  it('maps Google Web Risk matches and empty responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          threat: {
            threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING'],
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({}))
    vi.stubGlobal('fetch', fetchMock)

    const match = await collectWebRiskEvidence('https://example.com/', {
      GOOGLE_WEB_RISK_API_KEY: 'test-key',
    })
    const clean = await collectWebRiskEvidence('https://example.com/', {
      GOOGLE_WEB_RISK_API_KEY: 'test-key',
    })

    expect(match[0]?.title).toBe('Google Web Risk threat match found')
    expect(match[0]?.sentiment).toBe('negative')
    expect(clean[0]?.title).toBe('No Google Web Risk threat match found')
    expect(clean[0]?.sentiment).toBe('neutral')
  })
})

describe('Tavily evidence mapping', () => {
  it('discards low-relevance Tavily results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            results: [
              {
                title: 'Low relevance scam result',
                content: 'This result should be ignored.',
                score: 0.49,
              },
              {
                title: 'Trusted independent reviews',
                content: 'Customers mention trusted service and positive reviews.',
                score: 0.7,
              },
            ],
          }),
        ),
      ),
    )

    const evidence = await collectTavilyEvidence('example.com', {
      TAVILY_API_KEY: 'test-key',
    })

    expect(evidence).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ title: 'Low relevance scam result' })]),
    )
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Trusted independent reviews',
          sentiment: 'positive',
        }),
      ]),
    )
  })
})

describe('AI factor classification', () => {
  it('falls back safely when Workers AI returns invalid JSON', async () => {
    const request = createRequest()
    const ai = {
      run: vi.fn().mockResolvedValue({ response: 'not json' }),
    } as unknown as Ai

    await expect(
      classifyEvidenceFactors(request, [createEvidence({})], { AI: ai }),
    ).resolves.toEqual([])
  })
})

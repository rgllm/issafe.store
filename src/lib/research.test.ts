import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTavilyQueries,
  classifyEvidenceFactors,
  collectPhishTankEvidence,
  collectRdapEvidence,
  collectSiteEvidence,
  collectTavilyEvidence,
  collectUrlhausEvidence,
  collectWebRiskEvidence,
  getCacheTtlSeconds,
  tavilyResultToEvidence,
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
  it('uses a 7 day default for missing or invalid values', () => {
    expect(getCacheTtlSeconds({})).toBe(604_800)
    expect(getCacheTtlSeconds({ CACHE_TTL_SECONDS: '-1' })).toBe(604_800)
    expect(getCacheTtlSeconds({ CACHE_TTL_SECONDS: 'not-a-number' })).toBe(604_800)
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

describe('site evidence collection', () => {
  it('treats homepage 403 as automated access blocking, not direct store risk', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          new Response('<html>Blocked</html>', {
            status: 403,
            headers: { 'content-type': 'text/html' },
          }),
        ),
      ),
    )

    const evidence = await collectSiteEvidence('https://www.zara.com/')

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Store homepage blocked automated check',
          sentiment: 'neutral',
          weight: 1,
        }),
      ]),
    )
    expect(evidence).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Store homepage could not be reached',
          sentiment: 'negative',
        }),
      ]),
    )
  })
})

describe('RDAP evidence collection', () => {
  it('looks up the registrable domain for www hosts', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          registered: true,
          created: '2000-01-01T00:00:00Z',
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectRdapEvidence('www.zara.com', {
      WHOISJSON_API_TOKEN: 'test-token',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://whoisjson.com/api/v1/whois/?domain=zara.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'TOKEN=test-token',
        }),
      }),
    )
    expect(evidence[0]).toEqual(
      expect.objectContaining({
        title: 'Domain older than three years',
        sentiment: 'positive',
        sourceType: 'whois',
        url: 'https://whoisjson.com/api/v1/whois/?domain=zara.com',
      }),
    )
  })

  it('accepts a copied TOKEN-prefixed WhoisJSON secret value', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          registered: true,
          age: { days: 1200 },
        }),
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    await collectRdapEvidence('example.com', {
      WHOISJSON_API_TOKEN: 'TOKEN=test-token',
    })

    expect(fetchMock).toHaveBeenCalledWith(
      'https://whoisjson.com/api/v1/whois/?domain=example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'TOKEN=test-token',
        }),
      }),
    )
  })

  it('returns neutral evidence when the WhoisJSON token is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectRdapEvidence('example.com')

    expect(fetchMock).not.toHaveBeenCalled()
    expect(evidence[0]).toEqual(
      expect.objectContaining({
        title: 'Domain registration lookup was skipped',
        sentiment: 'neutral',
        sourceType: 'whois',
      }),
    )
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
  it('does not treat scam-question results as strong negative evidence', () => {
    const evidence = tavilyResultToEvidence(
      {
        title: 'Is zara.com legit or a scam?',
        content: 'We review whether zara.com is safe, trustworthy, and legitimate.',
        url: 'https://example.com/zara-review',
        score: 0.8,
      },
      observedAt,
    )

    expect(evidence.sentiment).toBe('neutral')
    expect(evidence.weight).toBe(2)
  })

  it('keeps concrete severe reputation claims as negative evidence', () => {
    const evidence = tavilyResultToEvidence(
      {
        title: 'Customer reports about example.com',
        content: 'Customers report non-delivery, chargebacks, and counterfeit products.',
        url: 'https://example.com/reports',
        score: 0.8,
      },
      observedAt,
    )

    expect(evidence.sentiment).toBe('negative')
    expect(evidence.weight).toBe(7)
  })

  it('treats low ratings and customer-service complaints as negative experience evidence', () => {
    const evidence = tavilyResultToEvidence(
      {
        title: 'Zara Reviews | Read Customer Service Reviews of zara.com - Yelp',
        content:
          'Zara has an average rating of 1.9 from 9607 reviews. Most customers are generally dissatisfied. The official website is zara.com.',
        url: 'https://www.yelp.com/biz/zara',
        score: 0.8,
      },
      observedAt,
    )

    expect(evidence.sentiment).toBe('negative')
    expect(evidence.weight).toBe(1)
  })

  it('does not treat official website mentions as positive reputation by themselves', () => {
    const evidence = tavilyResultToEvidence(
      {
        title: 'Zara official website',
        content: 'The official website is zara.com.',
        url: 'https://example.com/zara',
        score: 0.8,
      },
      observedAt,
    )

    expect(evidence.sentiment).toBe('neutral')
    expect(evidence.weight).toBe(2)
  })

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
          weight: 2,
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

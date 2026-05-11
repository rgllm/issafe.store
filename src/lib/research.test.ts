import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildTavilyQueries,
  classifyEvidenceFactors,
  clearRdapBootstrapCacheForTests,
  collectOpenPhishEvidence,
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
const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json',
    },
  })
}

function textResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain',
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

function rdapBootstrapResponse(tld: string, baseUrl: string) {
  return {
    services: [[[tld], [baseUrl]]],
  }
}

function rdapDomainResponse(eventDate: string, eventAction = 'registration') {
  return {
    objectClassName: 'domain',
    events: [
      {
        eventAction,
        eventDate,
      },
    ],
  }
}

afterEach(() => {
  clearRdapBootstrapCacheForTests()
  vi.useRealTimers()
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
  it('looks up the registrable domain for www hosts through IANA bootstrap', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === RDAP_BOOTSTRAP_URL) {
        return Promise.resolve(
          jsonResponse(rdapBootstrapResponse('com', 'https://rdap.example/')),
        )
      }

      if (input === 'https://rdap.example/domain/zara.com') {
        return Promise.resolve(jsonResponse(rdapDomainResponse('2000-01-01T00:00:00Z')))
      }

      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectRdapEvidence('www.zara.com')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://rdap.example/domain/zara.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/rdap+json, application/json',
        }),
      }),
    )
    expect(evidence[0]).toEqual(
      expect.objectContaining({
        title: 'Domain older than three years',
        sentiment: 'positive',
        sourceType: 'rdap',
        url: 'https://rdap.example/domain/zara.com',
        snippet: 'RDAP registration date: 2000-01-01T00:00:00Z.',
      }),
    )
  })

  it('normalizes subdomains to the registrable domain for public suffixes', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === RDAP_BOOTSTRAP_URL) {
        return Promise.resolve(
          jsonResponse(rdapBootstrapResponse('uk', 'https://rdap.uk.example/')),
        )
      }

      if (input === 'https://rdap.uk.example/domain/example.co.uk') {
        return Promise.resolve(jsonResponse(rdapDomainResponse('2000-01-01T00:00:00Z')))
      }

      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('fetch', fetchMock)

    await collectRdapEvidence('checkout.shop.example.co.uk')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://rdap.uk.example/domain/example.co.uk',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/rdap+json, application/json',
        }),
      }),
    )
  })

  it('preserves the recent-domain scoring thresholds', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-04T00:00:00Z'))

    const fetchMock = vi.fn((input: string) => {
      if (input === RDAP_BOOTSTRAP_URL) {
        return Promise.resolve(
          jsonResponse(rdapBootstrapResponse('com', 'https://rdap.example/')),
        )
      }

      if (input === 'https://rdap.example/domain/example.com') {
        return Promise.resolve(jsonResponse(rdapDomainResponse('2026-03-10T00:00:00Z')))
      }

      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectRdapEvidence('example.com')

    expect(evidence[0]).toEqual(
      expect.objectContaining({
        title: 'Domain registered less than 90 days ago',
        sentiment: 'negative',
        sourceType: 'rdap',
      }),
    )
  })

  it('returns negative evidence for RDAP 404 domain responses', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === RDAP_BOOTSTRAP_URL) {
        return Promise.resolve(
          jsonResponse(rdapBootstrapResponse('com', 'https://rdap.example/')),
        )
      }

      if (input === 'https://rdap.example/domain/example.com') {
        return Promise.resolve(jsonResponse({}, 404))
      }

      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectRdapEvidence('example.com')

    expect(evidence[0]).toEqual(
      expect.objectContaining({
        title: 'Domain does not appear to be registered',
        sentiment: 'negative',
        sourceType: 'rdap',
      }),
    )
    expect(fetchMock).not.toHaveBeenCalledWith(
      'https://rdap.org/domain/example.com',
      expect.anything(),
    )
  })

  it('falls back to rdap.org when IANA bootstrap fails', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === RDAP_BOOTSTRAP_URL) {
        return Promise.resolve(jsonResponse({}, 500))
      }

      if (input === 'https://rdap.org/domain/example.com') {
        return Promise.resolve(jsonResponse(rdapDomainResponse('2000-01-01T00:00:00Z')))
      }

      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectRdapEvidence('example.com')

    expect(fetchMock).toHaveBeenCalledWith(
      'https://rdap.org/domain/example.com',
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: 'application/rdap+json, application/json',
        }),
      }),
    )
    expect(evidence[0]).toEqual(
      expect.objectContaining({
        title: 'Domain older than three years',
        sentiment: 'positive',
        sourceType: 'rdap',
        url: 'https://rdap.org/domain/example.com',
      }),
    )
  })

  it('returns neutral evidence when RDAP records omit registration events', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === RDAP_BOOTSTRAP_URL) {
        return Promise.resolve(
          jsonResponse(rdapBootstrapResponse('com', 'https://rdap.example/')),
        )
      }

      if (
        input === 'https://rdap.example/domain/example.com' ||
        input === 'https://rdap.org/domain/example.com'
      ) {
        return Promise.resolve(
          jsonResponse(rdapDomainResponse('2030-01-01T00:00:00Z', 'expiration')),
        )
      }

      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectRdapEvidence('example.com')

    expect(evidence[0]).toEqual(
      expect.objectContaining({
        title: 'RDAP record found without registration age',
        sentiment: 'neutral',
        sourceType: 'rdap',
      }),
    )
  })

  it('returns neutral evidence when RDAP is rate limited', async () => {
    const fetchMock = vi.fn((input: string) => {
      if (input === RDAP_BOOTSTRAP_URL) {
        return Promise.resolve(
          jsonResponse(rdapBootstrapResponse('com', 'https://rdap.example/')),
        )
      }

      if (
        input === 'https://rdap.example/domain/example.com' ||
        input === 'https://rdap.org/domain/example.com'
      ) {
        return Promise.resolve(jsonResponse({}, 429))
      }

      return Promise.resolve(jsonResponse({}, 500))
    })
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectRdapEvidence('example.com')

    expect(evidence[0]).toEqual(
      expect.objectContaining({
        title: 'Domain registration lookup was inconclusive',
        snippet: 'RDAP returned HTTP 429.',
        sentiment: 'neutral',
        sourceType: 'rdap',
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

    const evidence = await collectUrlhausEvidence('https://example.com/', 'example.com', {
      URLHAUS_AUTH_KEY: 'test-key',
    })

    expect(evidence[0]?.title).toBe('URLhaus malware listing found')
    expect(evidence[0]?.sentiment).toBe('negative')
    expect(evidence[0]?.weight).toBe(10)
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({
          'Auth-Key': 'test-key',
        }),
      }),
    )
  })

  it('maps URLhaus no-match responses to neutral evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(jsonResponse({ query_status: 'no_results' }))),
    )

    const evidence = await collectUrlhausEvidence('https://example.com/', 'example.com', {
      URLHAUS_AUTH_KEY: 'test-key',
    })

    expect(evidence[0]?.title).toBe('No URLhaus malware listing found')
    expect(evidence[0]?.sentiment).toBe('neutral')
  })

  it('skips URLhaus when the auth key is missing', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const evidence = await collectUrlhausEvidence('https://example.com/', 'example.com')

    expect(evidence[0]?.title).toBe('URLhaus malware check is not configured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('maps OpenPhish feed hostname matches to negative evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          textResponse('https://evil.example.org/other\nhttps://example.com/phish\n'),
        ),
      ),
    )

    const evidence = await collectOpenPhishEvidence('https://example.com/', 'example.com')

    expect(evidence[0]?.title).toBe('OpenPhish feed match found')
    expect(evidence[0]?.sentiment).toBe('negative')
    expect(evidence[0]?.snippet).toContain('https://example.com/phish')
    expect(String(vi.mocked(fetch).mock.calls[0]?.[0])).toContain('openphish/public_feed')
  })

  it('treats www host and apex host as the same for OpenPhish', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(textResponse('http://example.com/login\n'))),
    )

    const evidence = await collectOpenPhishEvidence('https://www.example.com/', 'www.example.com')

    expect(evidence[0]?.title).toBe('OpenPhish feed match found')
    expect(evidence[0]?.sentiment).toBe('negative')
  })

  it('maps clean OpenPhish feeds to neutral evidence', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(textResponse('https://totally-other.test/path\n'))),
    )

    const evidence = await collectOpenPhishEvidence('https://example.com/', 'example.com')

    expect(evidence[0]?.title).toBe('No OpenPhish feed match found')
    expect(evidence[0]?.sentiment).toBe('neutral')
  })

  it('maps failed OpenPhish feed fetches to neutral unavailable evidence', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(textResponse('bad', 500))))

    const evidence = await collectOpenPhishEvidence('https://example.com/', 'example.com')

    expect(evidence[0]?.title).toBe('OpenPhish feed check unavailable')
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
    expect(clean[0]?.sentiment).toBe('positive')
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
                content: 'Customers mention trusted service and positive reviews for example.com.',
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

  it('keeps Tavily review results for the exact searched domain', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            results: [
              {
                title: 'Zara Portugal customer reviews',
                content: 'Read Customer Service Reviews of zara.pt.',
                url: 'https://www.trustpilot.com/review/zara.pt',
                score: 0.8,
              },
            ],
          }),
        ),
      ),
    )

    const evidence = await collectTavilyEvidence('zara.pt', {
      TAVILY_API_KEY: 'test-key',
    })

    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Zara Portugal customer reviews',
          url: 'https://www.trustpilot.com/review/zara.pt',
        }),
      ]),
    )
  })

  it.each([
    {
      hostname: 'zara.pt',
      title: 'Zara Spain customer reviews',
      content: 'Read Customer Service Reviews of zara.es.',
      url: 'https://www.trustpilot.com/review/zara.es',
    },
    {
      hostname: 'zara.pt',
      title: 'Zara customer reviews',
      content: 'Read Customer Service Reviews of zara.com.',
      url: 'https://www.trustpilot.com/review/zara.com',
    },
    {
      hostname: 'zara.pt',
      title: 'Zara Portugal customer reviews',
      content: 'Read Customer Service Reviews of www.zara.pt.',
      url: 'https://www.trustpilot.com/review/www.zara.pt',
    },
    {
      hostname: 'www.zara.pt',
      title: 'Zara Portugal customer reviews',
      content: 'Read Customer Service Reviews of zara.pt.',
      url: 'https://www.trustpilot.com/review/zara.pt',
    },
    {
      hostname: 'zara.pt',
      title: 'Not Zara customer reviews',
      content: 'Read Customer Service Reviews of notzara.pt and zara.pt.example.com.',
      url: 'https://www.trustpilot.com/review/zara.pt.example.com',
    },
  ])('rejects Tavily results that do not match the literal searched domain: $url', async (result) => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          jsonResponse({
            results: [
              {
                title: result.title,
                content: result.content,
                url: result.url,
                score: 0.8,
              },
            ],
          }),
        ),
      ),
    )

    const evidence = await collectTavilyEvidence(result.hostname, {
      TAVILY_API_KEY: 'test-key',
    })

    expect(evidence).toEqual([
      expect.objectContaining({
        title: 'External reputation search returned no usable results',
        sourceType: 'technical',
      }),
    ])
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

import { dedupeEvidence, scoreEvidence } from './scoring'
import type { RiskFactor, RiskFactorKey } from './scoring'
import type { Evidence, StoreSafetyReport, StoreSafetyRequest } from '../types/report'

type ResearchEnv = {
  AI?: Ai
  AI_MODEL?: string
  CACHE_TTL_SECONDS?: string
  GOOGLE_WEB_RISK_API_KEY?: string
  PHISHTANK_APP_KEY?: string
  TAVILY_API_KEY?: string
  URLHAUS_AUTH_KEY?: string
  WHOISJSON_API_TOKEN?: string
}

type TavilyQuery = {
  query: string
  includeDomains?: string[]
}

type TavilyResult = {
  title?: string
  url?: string
  content?: string
  score?: number
}

type TavilyResponse = {
  results?: TavilyResult[]
}

type WorkersAiTextResponse = {
  response?: string
  text?: string
  choices?: Array<{ message?: { content?: string }; text?: string }>
}

type UrlhausResponse = {
  query_status?: string
  url?: string
  url_status?: string
  threat?: string
  tags?: string[]
  urls?: Array<{
    url?: string
    url_status?: string
    threat?: string
    tags?: string[]
  }>
}

type PhishTankResponse = {
  results?: {
    in_database?: boolean
    valid?: boolean | string
    verified?: boolean | string
    phish_id?: string | number
  }
}

type WebRiskResponse = {
  threat?: {
    threatTypes?: string[]
    expireTime?: string
  }
}

type PolicyPage = {
  url: string
  html: string
  title: string | null
}

const RISK_FACTOR_KEYS: RiskFactorKey[] = [
  'threat_list',
  'domain_age',
  'site_integrity',
  'contact_identity',
  'policy_completeness',
  'independent_reputation',
  'commerce_intent',
]

const POLICY_LINK_PATTERNS = [
  'contact',
  'about',
  'return',
  'refund',
  'shipping',
  'delivery',
  'terms',
  'privacy',
]

const STRONG_NEGATIVE_TERMS = [
  'non-delivery',
  'never arrived',
  'not delivered',
  'not received',
  'no refund',
  'chargeback',
  'counterfeit',
  'fraudulent',
  'reported fraud',
  'fraud reports',
  'fraudulent charges',
  'fake store',
  'stole money',
  'verified scam',
  'confirmed scam',
]

const NEGATIVE_TERMS = [
  'complaint',
  'complaints',
  'bad reviews',
  'negative reviews',
  'low rating',
  'poor rating',
  'dissatisfied',
  'worst customer service',
  'frustrating',
  'deceitful',
  'disgraceful',
  'harassment',
  'refund issue',
  'refund issues',
  'refund complaints',
]

const POSITIVE_TERMS = [
  'verified',
  'trusted',
  'positive reviews',
  'good reviews',
  'return policy',
]

const WEB_RISK_THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'SOCIAL_ENGINEERING_EXTENDED_COVERAGE',
]

const PHISHTANK_USER_AGENT = 'phishtank/issafe-store'

export const DEFAULT_CACHE_TTL_SECONDS = 604_800

export async function runStoreResearch(
  request: StoreSafetyRequest,
  env: ResearchEnv,
  reportProgress?: (status: StoreSafetyReport['status'], summary: string) => void,
): Promise<StoreSafetyReport> {
  const createdAt = new Date().toISOString()
  const expiresAt = new Date(
    Date.now() + getCacheTtlSeconds(env) * 1000,
  ).toISOString()

  reportProgress?.('researching', 'Checking the store site and public signals.')

  const siteEvidence = await collectSiteEvidence(request.normalizedUrl)
  reportProgress?.('researching', 'Checking domain registration data.')

  const rdapEvidence = await collectRdapEvidence(request.hostname, env)
  reportProgress?.('researching', 'Checking public threat-list signals.')

  const threatEvidence = await collectThreatListEvidence(request, env)
  reportProgress?.('researching', 'Searching for external reputation signals.')

  const searchEvidence = await collectTavilyEvidence(request.hostname, env)
  const evidence = dedupeEvidence([
    ...siteEvidence,
    ...rdapEvidence,
    ...threatEvidence,
    ...searchEvidence,
  ])

  reportProgress?.('scoring', 'Classifying evidence and calculating the risk score.')

  const classifiedFactors = await classifyEvidenceFactors(request, evidence, env)
  const score = scoreEvidence(evidence, classifiedFactors)

  reportProgress?.('scoring', 'Summarizing evidence and calculating the risk score.')

  const summary = await summarizeReport(request, evidence, score, env)

  return {
    ...request,
    status: 'complete',
    score: score.score,
    confidence: score.confidence,
    recommendation: score.recommendation,
    summary,
    evidence,
    createdAt,
    expiresAt,
  }
}

export function getCacheTtlSeconds(env: Pick<ResearchEnv, 'CACHE_TTL_SECONDS'>) {
  const parsed = Number(env.CACHE_TTL_SECONDS)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CACHE_TTL_SECONDS
  }

  return parsed
}

export async function collectSiteEvidence(normalizedUrl: string): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()
  const evidence: Evidence[] = []
  const homepage = new URL(normalizedUrl)

  if (homepage.protocol === 'https:') {
    evidence.push({
      sourceType: 'technical',
      title: 'HTTPS is enabled',
      url: homepage.toString(),
      snippet: 'The submitted store URL uses HTTPS.',
      sentiment: 'positive',
      weight: 1,
      observedAt,
    })
  } else {
    evidence.push({
      sourceType: 'technical',
      title: 'No HTTPS on submitted URL',
      url: homepage.toString(),
      snippet: 'The submitted URL uses plain HTTP, which is risky for shopping.',
      sentiment: 'negative',
      weight: 7,
      observedAt,
    })
  }

  const home = await fetchPage(homepage.toString())

  if (!home.ok) {
    if (isAutomatedAccessBlocked(home.status)) {
      return [
        ...evidence,
        {
          sourceType: 'store-site',
          title: 'Store homepage blocked automated check',
          url: homepage.toString(),
          snippet: `The homepage returned HTTP ${home.status} to the automated checker. This often reflects bot protection and is not treated as a direct store-risk signal.`,
          sentiment: 'neutral',
          weight: 1,
          observedAt,
        },
      ]
    }

    return [
      ...evidence,
      {
        sourceType: 'store-site',
        title: 'Store homepage could not be reached',
        url: homepage.toString(),
        snippet: home.error ?? `HTTP status ${home.status ?? 'unknown'}`,
        sentiment: 'negative',
        weight: 8,
        observedAt,
      },
    ]
  }

  evidence.push({
    sourceType: 'store-site',
    title: 'Store homepage is reachable',
    url: homepage.toString(),
    snippet: `The homepage responded with HTTP ${home.status}.`,
    sentiment: 'positive',
    weight: 2,
    observedAt,
  })

  const homepageText = htmlToText(home.html)
  const links = extractPolicyLinks(home.html, homepage)
  const policyPages = await collectPolicyPages(links.slice(0, 5), observedAt)
  const policyText = policyPages.map((page) => htmlToText(page.html)).join(' ')
  const combinedText = `${homepageText} ${policyText}`
  const hasContact = hasContactDetails(combinedText)
  const policyCoverage = countPolicyTypes(combinedText, links)
  const hasCommerceIntent = /(cart|checkout|shop now|add to cart|payment|buy now|sale|product)/i.test(
    homepageText,
  )

  if (hasCommerceIntent) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Storefront shopping signals found',
      url: homepage.toString(),
      snippet: 'The site appears to present products, purchase flows, or payment-related language.',
      sentiment: 'neutral',
      weight: 2,
      observedAt,
    })
  }

  if (hasContact) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Visible contact or business details',
      url: homepage.toString(),
      snippet: 'The checked pages include contact or business-identifying language.',
      sentiment: 'positive',
      weight: 5,
      observedAt,
    })
  } else if (hasCommerceIntent) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Limited contact details on store pages',
      url: homepage.toString(),
      snippet: 'No clear email, phone, support, contact, address, or business identity signal was found.',
      sentiment: 'negative',
      weight: 6,
      observedAt,
    })
  }

  if (policyCoverage >= 2 || links.length >= 2) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Customer policy coverage found',
      url: homepage.toString(),
      snippet: 'The checked pages reference multiple customer policy areas such as returns, shipping, privacy, or terms.',
      sentiment: 'positive',
      weight: 5,
      observedAt,
    })
  } else if (policyCoverage === 1 || links.length === 1) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Limited customer policy coverage found',
      url: homepage.toString(),
      snippet: 'The checked pages reference at least one customer policy area, but coverage appears limited.',
      sentiment: 'positive',
      weight: 3,
      observedAt,
    })
  } else if (hasCommerceIntent) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Shopping signals without clear policies',
      url: homepage.toString(),
      snippet: 'The site appears to sell products, but clear customer-policy language was not found.',
      sentiment: 'negative',
      weight: 7,
      observedAt,
    })
  }

  return [
    ...evidence,
    ...policyPages.map(
      (page): Evidence => ({
        sourceType: 'store-site',
        title: `Customer policy page found: ${new URL(page.url).pathname}`,
        url: page.url,
        snippet: page.title ?? 'A linked customer policy page responded successfully.',
        sentiment: 'positive',
        weight: 2,
        observedAt,
      }),
    ),
  ]
}

export async function collectRdapEvidence(
  hostname: string,
  env: Pick<ResearchEnv, 'WHOISJSON_API_TOKEN'> = {},
): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()
  const apiToken = normalizeWhoisJsonApiToken(env.WHOISJSON_API_TOKEN)
  const lookupDomain = getWhoisLookupDomain(hostname)
  const lookupUrl = `https://whoisjson.com/api/v1/whois/?domain=${encodeURIComponent(lookupDomain)}`

  if (!apiToken) {
    return [
      {
        sourceType: 'whois',
        title: 'Domain registration lookup was skipped',
        url: 'https://whoisjson.com/api/v1/whois',
        snippet: 'Set WHOISJSON_API_TOKEN to include WhoisJSON domain registration checks.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  }

  try {
    const response = await fetchWithTimeout(lookupUrl, 4500, {
      headers: {
        Accept: 'application/json',
        Authorization: `TOKEN=${apiToken}`,
      },
    })

    if (!response.ok) {
      return [
        {
          sourceType: 'whois',
          title: 'Domain registration lookup was inconclusive',
          url: lookupUrl,
          snippet: `WhoisJSON returned HTTP ${response.status}.`,
          sentiment: 'neutral',
          weight: 2,
          observedAt,
        },
      ]
    }

    const data = (await response.json()) as {
      registered?: boolean
      created?: string
      age?: {
        days?: number
      }
    }

    if (data.registered === false) {
      return [
        {
          sourceType: 'whois',
          title: 'Domain does not appear to be registered',
          url: lookupUrl,
          snippet: 'WhoisJSON reports this domain is not currently registered.',
          sentiment: 'negative',
          weight: 8,
          observedAt,
        },
      ]
    }

    const registeredAt = data.created
    const domainAgeDays = Number.isFinite(data.age?.days)
      ? data.age?.days ?? null
      : registeredAt
        ? Math.floor((Date.now() - new Date(registeredAt).getTime()) / 86_400_000)
        : null

    if (domainAgeDays === null) {
      return [
        {
          sourceType: 'whois',
          title: 'WHOIS record found without registration age',
          url: lookupUrl,
          snippet: 'WhoisJSON returned a public domain record, but no registration date was available.',
          sentiment: 'neutral',
          weight: 2,
          observedAt,
        },
      ]
    }

    if (domainAgeDays < 30) {
      return [
        {
          sourceType: 'whois',
          title: 'Domain registered less than 30 days ago',
          url: lookupUrl,
          snippet: `WhoisJSON indicates this domain was registered about ${domainAgeDays} days ago.`,
          sentiment: 'negative',
          weight: 8,
          observedAt,
        },
      ]
    }

    if (domainAgeDays < 90) {
      return [
        {
          sourceType: 'whois',
          title: 'Domain registered less than 90 days ago',
          url: lookupUrl,
          snippet: `WhoisJSON indicates this domain was registered about ${domainAgeDays} days ago.`,
          sentiment: 'negative',
          weight: 6,
          observedAt,
        },
      ]
    }

    if (domainAgeDays < 365) {
      return [
        {
          sourceType: 'whois',
          title: 'Domain registered less than one year ago',
          url: lookupUrl,
          snippet: `WhoisJSON indicates this domain was registered about ${domainAgeDays} days ago.`,
          sentiment: 'negative',
          weight: 3,
          observedAt,
        },
      ]
    }

    if (domainAgeDays > 1095) {
      return [
        {
          sourceType: 'whois',
          title: 'Domain older than three years',
          url: lookupUrl,
          snippet: registeredAt
            ? `WhoisJSON registration date: ${registeredAt}.`
            : `WhoisJSON reports this domain is about ${domainAgeDays} days old.`,
          sentiment: 'positive',
          weight: 7,
          observedAt,
        },
      ]
    }

    return [
      {
        sourceType: 'whois',
        title: 'Domain older than one year',
        url: lookupUrl,
        snippet: registeredAt
          ? `WhoisJSON registration date: ${registeredAt}.`
          : `WhoisJSON reports this domain is about ${domainAgeDays} days old.`,
        sentiment: 'positive',
        weight: 4,
        observedAt,
      },
    ]
  } catch {
    return [
      {
        sourceType: 'whois',
        title: 'Domain registration lookup failed',
        url: lookupUrl,
        snippet: 'The WhoisJSON lookup did not complete before the timeout.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  }
}

function isAutomatedAccessBlocked(status: number | undefined) {
  return status === 401 || status === 403 || status === 429
}

function getWhoisLookupDomain(hostname: string) {
  return hostname.startsWith('www.') ? hostname.slice(4) : hostname
}

function normalizeWhoisJsonApiToken(token: string | undefined) {
  return token?.trim().replace(/^token=/i, '').trim()
}

export async function collectThreatListEvidence(
  request: StoreSafetyRequest,
  env: Pick<
    ResearchEnv,
    'GOOGLE_WEB_RISK_API_KEY' | 'PHISHTANK_APP_KEY' | 'URLHAUS_AUTH_KEY'
  >,
): Promise<Evidence[]> {
  const results = await Promise.allSettled([
    collectUrlhausEvidence(request.normalizedUrl, request.hostname, env),
    collectPhishTankEvidence(request.normalizedUrl, env),
    collectWebRiskEvidence(request.normalizedUrl, env),
  ])

  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}

export async function collectUrlhausEvidence(
  normalizedUrl: string,
  hostname: string,
  env: Pick<ResearchEnv, 'URLHAUS_AUTH_KEY'> = {},
): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()
  const authKey = env.URLHAUS_AUTH_KEY?.trim()

  if (!authKey) {
    return [
      {
        sourceType: 'technical',
        title: 'URLhaus malware check is not configured',
        snippet: 'Set URLHAUS_AUTH_KEY to include URLhaus malware URL checks.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  }

  try {
    const [urlResult, hostResult] = await Promise.allSettled([
      queryUrlhaus('url', { url: normalizedUrl }, authKey),
      queryUrlhaus('host', { host: hostname }, authKey),
    ])
    const matchedUrl =
      urlResult.status === 'fulfilled' && urlhausHasMatch(urlResult.value)
        ? urlResult.value
        : null
    const matchedHost =
      hostResult.status === 'fulfilled' && urlhausHasMatch(hostResult.value)
        ? hostResult.value
        : null

    if (matchedUrl || matchedHost) {
      const match = matchedUrl ?? matchedHost
      const matchedRecord = match?.urls?.[0]
      const threat = match?.threat ?? matchedRecord?.threat ?? 'malware URL listing'

      return [
        {
          sourceType: 'technical',
          title: matchedUrl
            ? 'URLhaus malware listing found'
            : 'URLhaus host malware listings found',
          url: 'https://urlhaus.abuse.ch/',
          snippet: `URLhaus returned an active match for ${matchedUrl ? normalizedUrl : hostname}: ${threat}.`,
          sentiment: 'negative',
          weight: matchedUrl ? 10 : 9,
          observedAt,
        },
      ]
    }

    if (urlResult.status === 'rejected' && hostResult.status === 'rejected') {
      return [
        providerUnavailableEvidence(
          'URLhaus malware check unavailable',
          observedAt,
          describeProviderError(urlResult.reason),
        ),
      ]
    }

    return [
      {
        sourceType: 'technical',
        title: 'No URLhaus malware listing found',
        url: 'https://urlhaus.abuse.ch/',
        snippet: 'URLhaus did not return a malware URL match for the submitted store.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  } catch (error) {
    return [
      providerUnavailableEvidence(
        'URLhaus malware check unavailable',
        observedAt,
        describeProviderError(error),
      ),
    ]
  }
}

export async function collectPhishTankEvidence(
  normalizedUrl: string,
  env: Pick<ResearchEnv, 'PHISHTANK_APP_KEY'> = {},
): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()
  const body = new URLSearchParams({
    url: normalizedUrl,
    format: 'json',
  })

  if (env.PHISHTANK_APP_KEY?.trim()) {
    body.set('app_key', env.PHISHTANK_APP_KEY.trim())
  }

  try {
    const response = await fetchWithTimeout('https://checkurl.phishtank.com/checkurl/', 6500, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'user-agent': PHISHTANK_USER_AGENT,
      },
      body,
    })

    if (!response.ok) {
      return [
        providerUnavailableEvidence(
          'PhishTank phishing check unavailable',
          observedAt,
          describeHttpProviderStatus('PhishTank', response.status),
        ),
      ]
    }

    const result = (await response.json()) as PhishTankResponse
    const details = result.results
    const isValid = details?.valid !== false && details?.valid !== 'n'
    const isVerified = details?.verified === true || details?.verified === 'y'

    if (details?.in_database && isVerified && isValid) {
      return [
        {
          sourceType: 'technical',
          title: 'PhishTank verified phishing match found',
          url: 'https://phishtank.org/',
          snippet: `PhishTank has a verified phishing record for this URL${details.phish_id ? ` (ID ${details.phish_id})` : ''}.`,
          sentiment: 'negative',
          weight: 10,
          observedAt,
        },
      ]
    }

    if (details?.in_database && isValid) {
      return [
        {
          sourceType: 'technical',
          title: 'PhishTank unverified phishing record found',
          url: 'https://phishtank.org/',
          snippet: 'PhishTank has an unverified record for this URL.',
          sentiment: 'negative',
          weight: 8,
          observedAt,
        },
      ]
    }

    return [
      {
        sourceType: 'technical',
        title: 'No PhishTank phishing record found',
        url: 'https://phishtank.org/',
        snippet: 'PhishTank did not return a phishing database match for this URL.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  } catch (error) {
    return [
      providerUnavailableEvidence(
        'PhishTank phishing check unavailable',
        observedAt,
        describeProviderError(error),
      ),
    ]
  }
}

export async function collectWebRiskEvidence(
  normalizedUrl: string,
  env: Pick<ResearchEnv, 'GOOGLE_WEB_RISK_API_KEY'>,
): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()

  if (!env.GOOGLE_WEB_RISK_API_KEY) {
    return [
      {
        sourceType: 'technical',
        title: 'Google Web Risk is not configured',
        snippet: 'Set GOOGLE_WEB_RISK_API_KEY to include Google Web Risk threat-list checks.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  }

  try {
    const params = new URLSearchParams({
      uri: normalizedUrl,
      key: env.GOOGLE_WEB_RISK_API_KEY,
    })

    for (const threatType of WEB_RISK_THREAT_TYPES) {
      params.append('threatTypes', threatType)
    }

    const response = await fetchWithTimeout(
      `https://webrisk.googleapis.com/v1/uris:search?${params.toString()}`,
      6500,
    )

    if (!response.ok) {
      return [
        providerUnavailableEvidence(
          'Google Web Risk check unavailable',
          observedAt,
          describeHttpProviderStatus('Google Web Risk', response.status),
        ),
      ]
    }

    const result = (await response.json()) as WebRiskResponse
    const threatTypes = result.threat?.threatTypes ?? []

    if (threatTypes.length > 0) {
      return [
        {
          sourceType: 'technical',
          title: 'Google Web Risk threat match found',
          url: 'https://cloud.google.com/web-risk',
          snippet: `Google Web Risk matched this URL against: ${threatTypes.join(', ')}.`,
          sentiment: 'negative',
          weight: 10,
          observedAt,
        },
      ]
    }

    return [
      {
        sourceType: 'technical',
        title: 'No Google Web Risk threat match found',
        url: 'https://cloud.google.com/web-risk',
        snippet: 'Google Web Risk returned no threat-list match for this URL.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  } catch (error) {
    return [
      providerUnavailableEvidence(
        'Google Web Risk check unavailable',
        observedAt,
        describeProviderError(error),
      ),
    ]
  }
}

export async function collectTavilyEvidence(
  hostname: string,
  env: Pick<ResearchEnv, 'TAVILY_API_KEY'>,
): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()

  if (!env.TAVILY_API_KEY) {
    return [
      {
        sourceType: 'technical',
        title: 'External search provider is not configured',
        snippet: 'Set TAVILY_API_KEY as a Worker secret to include external web reputation signals.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  }

  const queries = buildTavilyQueries(hostname)
  const responses = await Promise.allSettled(
    queries.map((query) => searchTavily(query, env.TAVILY_API_KEY ?? '')),
  )
  const evidence = responses.flatMap((response) => {
    if (response.status === 'rejected') {
      return []
    }

    return (response.value.results ?? [])
      .filter((result) => typeof result.score !== 'number' || result.score >= 0.5)
      .slice(0, 4)
      .map((result) => tavilyResultToEvidence(result, observedAt))
  })

  if (evidence.length === 0) {
    return [providerUnavailableEvidence('External reputation search returned no usable results', observedAt)]
  }

  return evidence
}

export function buildTavilyQueries(hostname: string): TavilyQuery[] {
  return [
    { query: `"${hostname}" reviews` },
    { query: `"${hostname}" scam OR fraud OR complaints` },
    { query: `"${hostname}" Trustpilot OR Reddit OR BBB OR ScamAdviser` },
    {
      query: `"${hostname}"`,
      includeDomains: ['trustpilot.com', 'reddit.com', 'bbb.org', 'scamadviser.com'],
    },
  ]
}

export async function classifyEvidenceFactors(
  request: StoreSafetyRequest,
  evidence: Evidence[],
  env: Pick<ResearchEnv, 'AI' | 'AI_MODEL'>,
): Promise<RiskFactor[]> {
  if (!env.AI || evidence.length === 0) {
    return []
  }

  const prompt = [
    'Classify public store-safety evidence into fixed risk factors.',
    'Return strict JSON only, with shape: {"factors":[{"key":"threat_list|domain_age|site_integrity|contact_identity|policy_completeness|independent_reputation|commerce_intent","sentiment":"positive|neutral|negative","severity":"low|medium|high|critical","confidence":0-100,"reason":"short reason"}]}.',
    'Do not include a score or recommendation.',
    'Do not treat repeated search snippets as independent proof of risk.',
    'Treat SEO-style questions such as "is this store legit/scam/safe" as neutral unless the evidence asserts concrete fraud, non-delivery, counterfeit goods, chargebacks, phishing, malware, or a verified scam.',
    'Generic complaints, refund friction, bad reviews, low ratings, and customer-service complaints are weak shopper-experience context, not primary safety evidence.',
    'Classify ordinary review negativity as independent_reputation low only; use medium/high only for concrete fraud, non-delivery, counterfeit goods, chargebacks, phishing, malware, or verified scam evidence.',
    'Mentions that a submitted domain is the official website are identity context only, not a positive reputation signal by themselves.',
    `Store: ${request.hostname}`,
    'Evidence:',
    ...evidence.slice(0, 14).map((item) => `- [${item.sourceType}/${item.sentiment}/${item.weight}] ${item.title}: ${item.snippet}`),
  ].join('\n')

  try {
    const response = (await env.AI.run(env.AI_MODEL ?? '@cf/zai-org/glm-4.7-flash', {
      messages: [
        {
          role: 'system',
          content:
            'You classify evidence for deterministic store-safety scoring. Return valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    })) as WorkersAiTextResponse
    const text = extractAiText(response)
    const parsed = parseJsonObject(text) as { factors?: unknown[] } | null

    if (!parsed || !Array.isArray(parsed.factors)) {
      return []
    }

    return parsed.factors.flatMap(parseRiskFactor)
  } catch {
    return []
  }
}

async function searchTavily(query: TavilyQuery, apiKey: string): Promise<TavilyResponse> {
  const response = await fetchWithTimeout('https://api.tavily.com/search', 8000, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query: query.query,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      max_results: 5,
      ...(query.includeDomains ? { include_domains: query.includeDomains } : {}),
    }),
  })

  if (!response.ok) {
    throw new Error(`Tavily search failed with HTTP ${response.status}`)
  }

  return (await response.json()) as TavilyResponse
}

export function tavilyResultToEvidence(result: TavilyResult, observedAt: string): Evidence {
  const title = result.title ?? 'Search result'
  const snippet = result.content ?? result.url ?? 'External search result.'
  const haystack = `${title} ${snippet} ${result.url ?? ''}`.toLowerCase()
  const hasScamQuestion = isScamQuestionResult(haystack)
  const hasStrongNegativeTerm = STRONG_NEGATIVE_TERMS.some((term) => haystack.includes(term))
  const hasNegativeTerm =
    !hasScamQuestion &&
    !hasStrongNegativeTerm &&
    NEGATIVE_TERMS.some((term) => haystack.includes(term))
  const hasPositiveTerm = POSITIVE_TERMS.some((term) => haystack.includes(term))
  const sourceType = /trustpilot|reviews?|reddit|complaints?|bbb|scamadviser/i.test(haystack)
    ? 'review'
    : 'search-result'

  return {
    sourceType,
    title,
    url: result.url,
    snippet,
    sentiment: hasStrongNegativeTerm || hasNegativeTerm ? 'negative' : hasPositiveTerm ? 'positive' : 'neutral',
    weight: hasStrongNegativeTerm ? 7 : hasNegativeTerm ? 1 : hasPositiveTerm ? 2 : 2,
    observedAt,
  }
}

function isScamQuestionResult(text: string) {
  return /\b(is|are|was|were)\b.{0,80}\b(legit|safe|scam|fraud|real|trustworthy)\b/.test(
    text,
  )
}

async function summarizeReport(
  request: StoreSafetyRequest,
  evidence: Evidence[],
  score: { score: number; confidence: number; recommendation: string },
  env: ResearchEnv,
) {
  const fallback = buildFallbackSummary(request.hostname, score.recommendation)

  if (!env.AI) {
    return fallback
  }

  const prompt = [
    `Store: ${request.hostname}`,
    `Score: ${score.score}/100`,
    `Confidence: ${score.confidence}/100`,
    `Recommendation: ${score.recommendation}`,
    'Evidence:',
    ...evidence.slice(0, 10).map((item) => `- ${item.title}: ${item.snippet}`),
    'Write one concise consumer-facing paragraph. Do not claim certainty. Mention that the result is based on public signals.',
  ].join('\n')

  try {
    const response = (await env.AI.run(env.AI_MODEL ?? '@cf/zai-org/glm-4.7-flash', {
      messages: [
        {
          role: 'system',
          content:
            'You summarize store-safety evidence for online shoppers. Be practical, cautious, and concise.',
        },
        { role: 'user', content: prompt },
      ],
    })) as WorkersAiTextResponse

    return extractAiText(response) ?? fallback
  } catch {
    return fallback
  }
}

function buildFallbackSummary(hostname: string, recommendation: string) {
  if (recommendation === 'likely-safe') {
    return `${hostname} shows enough positive public signals for a lower-risk result, but still verify payment protection, return terms, and the exact seller before buying.`
  }

  if (recommendation === 'avoid') {
    return `${hostname} shows public signals that make it higher risk. Treat this as a strong warning and avoid buying unless you can independently verify the seller.`
  }

  if (recommendation === 'unknown') {
    return `${hostname} does not have enough reliable public evidence for a confident answer. Use caution and verify contact, policies, reviews, and secure payment options before buying.`
  }

  return `${hostname} has mixed public signals. Use caution, check independent reviews, and prefer payment methods with buyer protection.`
}

async function collectPolicyPages(urls: string[], observedAt: string): Promise<PolicyPage[]> {
  const pages = await Promise.all(
    urls.map(async (url) => {
      const page = await fetchPage(url)

      if (!page.ok) {
        return null
      }

      return {
        url,
        html: page.html,
        title: extractTitle(page.html),
      }
    }),
  )

  return pages.filter((page): page is PolicyPage => Boolean(page))
}

async function queryUrlhaus(path: 'host' | 'url', body: Record<string, string>, authKey: string) {
  const response = await fetchWithTimeout(`https://urlhaus-api.abuse.ch/v1/${path}/`, 6500, {
    method: 'POST',
    headers: {
      'Auth-Key': authKey,
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent':
        'IsSafeStoreBot/1.0 (+https://issafe.store; store safety public signal checker)',
    },
    body: new URLSearchParams(body),
  })

  if (!response.ok) {
    throw new Error(`URLhaus check failed with HTTP ${response.status}`)
  }

  return (await response.json()) as UrlhausResponse
}

function urlhausHasMatch(response: UrlhausResponse) {
  if (response.query_status !== 'ok') {
    return false
  }

  if (response.url || response.url_status || response.threat) {
    return true
  }

  return Boolean(response.urls?.length)
}

function providerUnavailableEvidence(title: string, observedAt: string, reason?: string): Evidence {
  return {
    sourceType: 'technical',
    title,
    snippet: reason
      ? `${reason} This signal is not included in the score.`
      : 'The provider did not return a usable result, so this signal is not included in the score.',
    sentiment: 'neutral',
    weight: 1,
    observedAt,
  }
}

function describeProviderError(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message
  }

  return 'The provider did not return a usable result.'
}

function describeHttpProviderStatus(provider: string, status: number) {
  if (provider === 'Google Web Risk' && (status === 401 || status === 403)) {
    return `${provider} returned HTTP ${status}. Confirm the API key is valid, Web Risk is enabled for the Google Cloud project, and API key restrictions allow webrisk.googleapis.com.`
  }

  if (provider === 'PhishTank' && status === 509) {
    return `${provider} returned HTTP 509. Set PHISHTANK_APP_KEY or wait for the rate-limit window to reset.`
  }

  if (status === 401 || status === 403) {
    return `${provider} returned HTTP ${status}. Confirm the provider credentials and key restrictions.`
  }

  if (status === 429) {
    return `${provider} returned HTTP 429. The provider rate limit was reached.`
  }

  return `${provider} returned HTTP ${status}.`
}

async function fetchPage(url: string) {
  try {
    const response = await fetchWithTimeout(url, 7000, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'user-agent':
          'IsSafeStoreBot/1.0 (+https://issafe.store; store safety public signal checker)',
      },
      redirect: 'follow',
    })
    const contentType = response.headers.get('content-type') ?? ''
    const html = contentType.includes('text/html') ? await response.text() : ''

    return {
      ok: response.ok && html.length > 0,
      status: response.status,
      html,
      error: response.ok ? undefined : `HTTP ${response.status}`,
    }
  } catch (error) {
    return {
      ok: false,
      status: undefined,
      html: '',
      error: error instanceof Error ? error.message : 'Request failed',
    }
  }
}

function fetchWithTimeout(url: string, timeoutMs: number, init?: RequestInit) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort('Request timed out'), timeoutMs)

  return fetch(url, {
    ...init,
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout))
}

function extractPolicyLinks(html: string, baseUrl: URL) {
  const links = new Set<string>()
  const anchorPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis

  for (const match of html.matchAll(anchorPattern)) {
    const href = match[1]
    const label = htmlToText(match[2] ?? '').toLowerCase()
    const haystack = `${href} ${label}`.toLowerCase()

    if (!href || !POLICY_LINK_PATTERNS.some((pattern) => haystack.includes(pattern))) {
      continue
    }

    try {
      const url = new URL(href, baseUrl)

      if (url.hostname === baseUrl.hostname && url.protocol.startsWith('http')) {
        url.hash = ''
        links.add(url.toString())
      }
    } catch {
      continue
    }
  }

  return [...links]
}

function extractTitle(html: string) {
  return html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/\s+/g, ' ').trim() ?? null
}

function htmlToText(html: string) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

function hasContactDetails(text: string) {
  return (
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text) ||
    /\+?\d[\d\s().-]{7,}\d/.test(text) ||
    /(registered office|business address|company number|vat|tax id|support|contact us|customer service)/i.test(
      text,
    )
  )
}

function countPolicyTypes(text: string, links: string[]) {
  const haystack = `${text} ${links.join(' ')}`.toLowerCase()
  const types = [
    /return|refund/,
    /shipping|delivery/,
    /privacy/,
    /terms|conditions/,
  ]

  return types.filter((pattern) => pattern.test(haystack)).length
}

function extractAiText(response: WorkersAiTextResponse) {
  return (
    response.response ??
    response.text ??
    response.choices?.[0]?.message?.content ??
    response.choices?.[0]?.text ??
    null
  )
}

function parseJsonObject(text: string | null) {
  if (!text) {
    return null
  }

  const trimmed = text.trim()
  const withoutFence = trimmed
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()
  const jsonStart = withoutFence.indexOf('{')
  const jsonEnd = withoutFence.lastIndexOf('}')

  if (jsonStart === -1 || jsonEnd === -1 || jsonEnd < jsonStart) {
    return null
  }

  try {
    return JSON.parse(withoutFence.slice(jsonStart, jsonEnd + 1)) as unknown
  } catch {
    return null
  }
}

function parseRiskFactor(value: unknown): RiskFactor[] {
  if (!value || typeof value !== 'object') {
    return []
  }

  const factor = value as Partial<RiskFactor>

  if (!isRiskFactorKey(factor.key)) {
    return []
  }

  return [
    {
      key: factor.key,
      sentiment: isSentiment(factor.sentiment) ? factor.sentiment : 'neutral',
      severity: isSeverity(factor.severity) ? factor.severity : 'low',
      confidence: clamp(Math.round(Number(factor.confidence) || 0), 0, 100),
      reason: String(factor.reason ?? factor.key).slice(0, 180),
    },
  ]
}

function isRiskFactorKey(value: unknown): value is RiskFactorKey {
  return typeof value === 'string' && RISK_FACTOR_KEYS.includes(value as RiskFactorKey)
}

function isSentiment(value: unknown): value is Evidence['sentiment'] {
  return value === 'positive' || value === 'neutral' || value === 'negative'
}

function isSeverity(value: unknown): value is RiskFactor['severity'] {
  return value === 'low' || value === 'medium' || value === 'high' || value === 'critical'
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

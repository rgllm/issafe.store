import { dedupeEvidence, scoreEvidence } from './scoring'
import type { Evidence, StoreSafetyReport, StoreSafetyRequest } from '../types/report'

type ResearchEnv = {
  AI?: Ai
  AI_MODEL?: string
  CACHE_TTL_SECONDS?: string
  TAVILY_API_KEY?: string
}

type TavilyResult = {
  title?: string
  url?: string
  content?: string
}

type TavilyResponse = {
  results?: TavilyResult[]
}

type WorkersAiTextResponse = {
  response?: string
  text?: string
  choices?: Array<{ message?: { content?: string }; text?: string }>
}

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

const NEGATIVE_TERMS = [
  'scam',
  'fraud',
  'fake',
  'complaint',
  'complaints',
  'refund issue',
  'chargeback',
  'never arrived',
  'not delivered',
  'counterfeit',
  'trustpilot',
  'reddit',
]

const POSITIVE_TERMS = [
  'verified',
  'official',
  'trusted',
  'positive reviews',
  'customer service',
  'return policy',
]

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

  const rdapEvidence = await collectRdapEvidence(request.hostname)
  reportProgress?.('researching', 'Searching for external reputation signals.')

  const searchEvidence = await collectTavilyEvidence(request.hostname, env)
  const evidence = dedupeEvidence([...siteEvidence, ...rdapEvidence, ...searchEvidence])
  const score = scoreEvidence(evidence)

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
    return 86_400
  }

  return parsed
}

async function collectSiteEvidence(normalizedUrl: string): Promise<Evidence[]> {
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
      weight: 3,
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
    weight: 4,
    observedAt,
  })

  const text = htmlToText(home.html)
  const links = extractPolicyLinks(home.html, homepage)
  const hasEmail = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(text)
  const hasPolicyTerms = /(return|refund|shipping|delivery|privacy|terms)/i.test(text)
  const hasBusinessDetails = /(company|address|registered|business|contact|support)/i.test(text)
  const hasCheckoutSignal = /(cart|checkout|shop now|add to cart|payment)/i.test(text)

  if (hasEmail || hasBusinessDetails) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Visible contact or business details',
      url: homepage.toString(),
      snippet: 'The homepage includes contact or business-identifying language.',
      sentiment: 'positive',
      weight: 5,
      observedAt,
    })
  } else {
    evidence.push({
      sourceType: 'store-site',
      title: 'Limited contact details on homepage',
      url: homepage.toString(),
      snippet: 'No clear email, support, contact, or business identity signal was found on the homepage.',
      sentiment: 'negative',
      weight: 5,
      observedAt,
    })
  }

  if (hasPolicyTerms || links.length > 0) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Policy links or policy language found',
      url: homepage.toString(),
      snippet: 'The homepage appears to reference customer policies such as returns, shipping, privacy, or terms.',
      sentiment: 'positive',
      weight: 4,
      observedAt,
    })
  } else if (hasCheckoutSignal) {
    evidence.push({
      sourceType: 'store-site',
      title: 'Shopping signals without clear policies',
      url: homepage.toString(),
      snippet: 'The site appears to sell products, but clear customer-policy language was not found on the homepage.',
      sentiment: 'negative',
      weight: 6,
      observedAt,
    })
  }

  const policyPages: Array<Evidence | null> = await Promise.all(
    links.slice(0, 5).map(async (url) => {
      const page = await fetchPage(url)

      if (!page.ok) {
        return null
      }

      return {
        sourceType: 'store-site',
        title: `Customer policy page found: ${new URL(url).pathname}`,
        url,
        snippet: extractTitle(page.html) ?? 'A linked customer policy page responded successfully.',
        sentiment: 'positive',
        weight: 3,
        observedAt,
      } satisfies Evidence
    }),
  )

  return [...evidence, ...policyPages.filter((item): item is Evidence => Boolean(item))]
}

async function collectRdapEvidence(hostname: string): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()

  try {
    const response = await fetchWithTimeout(`https://rdap.org/domain/${hostname}`, 4500)

    if (!response.ok) {
      return [
        {
          sourceType: 'rdap',
          title: 'Domain registration lookup was inconclusive',
          url: `https://rdap.org/domain/${hostname}`,
          snippet: `RDAP returned HTTP ${response.status}.`,
          sentiment: 'neutral',
          weight: 2,
          observedAt,
        },
      ]
    }

    const data = (await response.json()) as {
      events?: Array<{ eventAction?: string; eventDate?: string }>
      registrar?: string
    }
    const registration = data.events?.find((event) =>
      /registration|registered/i.test(event.eventAction ?? ''),
    )
    const registeredAt = registration?.eventDate
    const domainAgeDays = registeredAt
      ? Math.floor((Date.now() - new Date(registeredAt).getTime()) / 86_400_000)
      : null

    if (domainAgeDays !== null && domainAgeDays < 90) {
      return [
        {
          sourceType: 'rdap',
          title: 'Domain appears recently registered',
          url: `https://rdap.org/domain/${hostname}`,
          snippet: `RDAP indicates this domain was registered about ${domainAgeDays} days ago.`,
          sentiment: 'negative',
          weight: 6,
          observedAt,
        },
      ]
    }

    return [
      {
        sourceType: 'rdap',
        title: registeredAt ? 'Domain registration data found' : 'RDAP record found',
        url: `https://rdap.org/domain/${hostname}`,
        snippet: registeredAt
          ? `RDAP registration date: ${registeredAt}.`
          : 'RDAP returned a public domain record.',
        sentiment: domainAgeDays !== null && domainAgeDays > 365 ? 'positive' : 'neutral',
        weight: domainAgeDays !== null && domainAgeDays > 365 ? 4 : 2,
        observedAt,
      },
    ]
  } catch {
    return [
      {
        sourceType: 'rdap',
        title: 'Domain registration lookup failed',
        url: `https://rdap.org/domain/${hostname}`,
        snippet: 'The RDAP lookup did not complete before the timeout.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  }
}

async function collectTavilyEvidence(
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

  return responses.flatMap((response) => {
    if (response.status === 'rejected') {
      return []
    }

    return (response.value.results ?? []).slice(0, 4).map((result) =>
      tavilyResultToEvidence(result, observedAt),
    )
  })
}

export function buildTavilyQueries(hostname: string) {
  return [
    `"${hostname}" reviews`,
    `"${hostname}" scam OR fraud OR complaints`,
    `"${hostname}" Trustpilot Reddit refund`,
  ]
}

async function searchTavily(query: string, apiKey: string): Promise<TavilyResponse> {
  const response = await fetchWithTimeout('https://api.tavily.com/search', 8000, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      query,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
      include_images: false,
      max_results: 5,
    }),
  })

  if (!response.ok) {
    throw new Error(`Tavily search failed with HTTP ${response.status}`)
  }

  return (await response.json()) as TavilyResponse
}

function tavilyResultToEvidence(result: TavilyResult, observedAt: string): Evidence {
  const title = result.title ?? 'Search result'
  const snippet = result.content ?? result.url ?? 'External search result.'
  const haystack = `${title} ${snippet}`.toLowerCase()
  const hasNegativeTerm = NEGATIVE_TERMS.some((term) => haystack.includes(term))
  const hasPositiveTerm = POSITIVE_TERMS.some((term) => haystack.includes(term))
  const sourceType = /trustpilot|reviews?|reddit|complaints?/i.test(haystack)
    ? 'review'
    : 'search-result'

  return {
    sourceType,
    title,
    url: result.url,
    snippet,
    sentiment: hasNegativeTerm ? 'negative' : hasPositiveTerm ? 'positive' : 'neutral',
    weight: hasNegativeTerm ? 5 : hasPositiveTerm ? 3 : 2,
    observedAt,
  }
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

    return (
      response.response ??
      response.text ??
      response.choices?.[0]?.message?.content ??
      response.choices?.[0]?.text ??
      fallback
    )
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
  return html.match(/<title[^>]*>(.*?)<\/title>/is)?.[1]?.replace(/\s+/g, ' ').trim()
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

import { getDomain } from 'tldts'
import { dedupeEvidence, scoreEvidence } from './scoring'
import {
  resumeStoreResearch,
  type StoreResearchCheckpoint,
} from './store-check-resilience'
import type { RiskFactor, RiskFactorKey } from './scoring'
import type {
  Coupon,
  Evidence,
  StoreSafetyReport,
  StoreSafetyRequest,
} from '../types/report'

type ResearchEnv = {
  AI?: Ai
  AI_MODEL?: string
  CACHE_TTL_SECONDS?: string
  CLOUDFLARE_ACCOUNT_ID?: string
  CLOUDFLARE_URL_SCANNER_API_TOKEN?: string
  CLOUDFLARE_URL_SCANNER_VISIBILITY?: string
  GOOGLE_WEB_RISK_API_KEY?: string
  TAVILY_API_KEY?: string
  URLHAUS_AUTH_KEY?: string
}

export type { StoreResearchCheckpoint } from './store-check-resilience'

export type ResearchProgressReporter = (
  status: StoreSafetyReport['status'],
  summary: string,
  progressStep: number,
) => void | Promise<void>

type RunStoreResearchOptions = {
  checkpoint?: StoreResearchCheckpoint | null
  onCheckpoint?: (checkpoint: StoreResearchCheckpoint) => void | Promise<void>
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

/** Matches `GoogleCloudWebriskV1SearchUrisResponse` from Web Risk API v1 discovery. */
type WebRiskSearchUrisResponse = {
  threat?: WebRiskSearchUrisThreatUri
}

/** Matches `GoogleCloudWebriskV1SearchUrisResponseThreatUri`. */
type WebRiskSearchUrisThreatUri = {
  /** Threat lists this URI matched; omit or empty when not on a requested list. */
  threatTypes?: string[]
  /** RFC3339 — do not cache past this time (per API). */
  expireTime?: string
}

type CloudflareUrlScannerScanRequest = {
  success?: boolean
  result?: {
    uuid?: string
  }
  errors?: Array<{ message?: string }>
}

type CloudflareUrlScannerResultResponse = {
  success?: boolean
  result?: {
    task?: {
      url?: string
      visibility?: string
      screenshotURL?: string
      scanURL?: string
      status?: string
    }
    page?: {
      url?: string
      finalURL?: string
      domain?: string
      asnname?: string
      asn?: string | number
      ip?: string
      country?: string
    }
    verdicts?: {
      overall?: {
        malicious?: boolean
        categories?: string[]
      }
      phishing?: string[]
    }
    meta?: {
      processors?: {
        tech?: string[]
      }
    }
  }
  errors?: Array<{ message?: string }>
}

type PolicyPage = {
  url: string
  html: string
  title: string | null
}

type RdapBootstrap = {
  services?: Array<[string[], string[]]>
}

type RdapDomainResponse = {
  objectClassName?: string
  events?: Array<{
    eventAction?: string
    eventDate?: string
  }>
}

type RdapFetchResult =
  | {
      status: 'found'
      url: string
      data: RdapDomainResponse
    }
  | {
      status: 'not-found'
      url: string
      httpStatus: number
    }
  | {
      status: 'inconclusive'
      url: string
      httpStatus?: number
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

const COUPON_TERMS = [
  'coupon',
  'promo',
  'promotion',
  'discount',
  'voucher',
  'offer',
  'deal',
  'sale',
]

/** `threatTypes` query values for `uris:search` (excludes THREAT_TYPE_UNSPECIFIED per API semantics). */
const WEB_RISK_THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'SOCIAL_ENGINEERING_EXTENDED_COVERAGE',
] as const

/** Labels aligned with discovery `enumDescriptions` for `uris:search` threatTypes. */
const WEB_RISK_THREAT_TYPE_LABELS: Record<string, string> = {
  MALWARE: 'malware (any platform)',
  SOCIAL_ENGINEERING: 'social engineering / phishing (any platform)',
  UNWANTED_SOFTWARE: 'unwanted software (any platform)',
  SOCIAL_ENGINEERING_EXTENDED_COVERAGE:
    'social engineering / phishing (extended coverage list)',
}

const OPENPHISH_FEED_URL =
  'https://raw.githubusercontent.com/openphish/public_feed/refs/heads/main/feed.txt'
const RDAP_BOOTSTRAP_URL = 'https://data.iana.org/rdap/dns.json'
const RDAP_FALLBACK_BASE_URL = 'https://rdap.org/'
const RDAP_FETCH_TIMEOUT_MS = 4500
const CLOUDFLARE_URL_SCANNER_BASE_URL =
  'https://api.cloudflare.com/client/v4/accounts'
const CLOUDFLARE_URL_SCANNER_RESULTS_DOCS_URL =
  'https://developers.cloudflare.com/radar/investigate/url-scanner/'
const CLOUDFLARE_URL_SCANNER_DEFAULT_VISIBILITY = 'Unlisted'
const CLOUDFLARE_URL_SCANNER_POLL_ATTEMPTS = 2
const CLOUDFLARE_URL_SCANNER_POLL_DELAY_MS = 10_000

let rdapBootstrapPromise: Promise<RdapBootstrap> | null = null

export const DEFAULT_CACHE_TTL_SECONDS = 604_800

export function clearRdapBootstrapCacheForTests() {
  rdapBootstrapPromise = null
}

export async function runStoreResearch(
  request: StoreSafetyRequest,
  env: ResearchEnv,
  reportProgress?: ResearchProgressReporter,
  options: RunStoreResearchOptions = {},
): Promise<StoreSafetyReport> {
  return resumeStoreResearch({
    request,
    env,
    ttlSeconds: getCacheTtlSeconds(env),
    checkpoint: options.checkpoint,
    onCheckpoint: options.onCheckpoint,
    onProgress: reportProgress,
    steps: {
      collectSiteEvidence,
      collectRdapEvidence,
      collectThreatListEvidence,
      collectTavilyEvidence,
      collectTavilyCoupons,
      classifyEvidenceFactors,
      scoreEvidence,
      summarizeReport,
      dedupeEvidence,
    },
  })
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
  const policyPages = await collectPolicyPages(links.slice(0, 5))
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
      sentiment: 'positive',
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

export async function collectRdapEvidence(hostname: string): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()
  const lookupDomain = getRdapLookupDomain(hostname)

  try {
    const result = await lookupRdapDomain(lookupDomain)

    if (result.status === 'not-found') {
      return [
        {
          sourceType: 'rdap',
          title: 'Domain does not appear to be registered',
          url: result.url,
          snippet: 'RDAP did not find an active registration for this domain.',
          sentiment: 'negative',
          weight: 8,
          observedAt,
        },
      ]
    }

    if (result.status === 'inconclusive') {
      return [
        {
          sourceType: 'rdap',
          title: 'Domain registration lookup was inconclusive',
          url: result.url,
          snippet: result.httpStatus
            ? `RDAP returned HTTP ${result.httpStatus}.`
            : 'The RDAP lookup did not return a usable registration record.',
          sentiment: 'neutral',
          weight: 2,
          observedAt,
        },
      ]
    }

    const registeredAt = getRdapRegistrationDate(result.data)
    const domainAgeDays = registeredAt
      ? Math.floor((Date.now() - new Date(registeredAt).getTime()) / 86_400_000)
      : null

    if (domainAgeDays === null) {
      return [
        {
          sourceType: 'rdap',
          title: 'RDAP record found without registration age',
          url: result.url,
          snippet: 'RDAP returned a domain record, but no registration event date was available.',
          sentiment: 'neutral',
          weight: 2,
          observedAt,
        },
      ]
    }

    if (domainAgeDays < 30) {
      return [
        {
          sourceType: 'rdap',
          title: 'Domain registered less than 30 days ago',
          url: result.url,
          snippet: `RDAP indicates this domain was registered about ${domainAgeDays} days ago.`,
          sentiment: 'negative',
          weight: 8,
          observedAt,
        },
      ]
    }

    if (domainAgeDays < 90) {
      return [
        {
          sourceType: 'rdap',
          title: 'Domain registered less than 90 days ago',
          url: result.url,
          snippet: `RDAP indicates this domain was registered about ${domainAgeDays} days ago.`,
          sentiment: 'negative',
          weight: 6,
          observedAt,
        },
      ]
    }

    if (domainAgeDays < 365) {
      return [
        {
          sourceType: 'rdap',
          title: 'Domain registered less than one year ago',
          url: result.url,
          snippet: `RDAP indicates this domain was registered about ${domainAgeDays} days ago.`,
          sentiment: 'negative',
          weight: 3,
          observedAt,
        },
      ]
    }

    if (domainAgeDays > 1095) {
      return [
        {
          sourceType: 'rdap',
          title: 'Domain older than three years',
          url: result.url,
          snippet: `RDAP registration date: ${registeredAt}.`,
          sentiment: 'positive',
          weight: 7,
          observedAt,
        },
      ]
    }

    return [
      {
        sourceType: 'rdap',
        title: 'Domain older than one year',
        url: result.url,
        snippet: `RDAP registration date: ${registeredAt}.`,
        sentiment: 'positive',
        weight: 4,
        observedAt,
      },
    ]
  } catch {
    return [
      {
        sourceType: 'rdap',
        title: 'Domain registration lookup failed',
        url: `https://rdap.org/domain/${encodeURIComponent(lookupDomain)}`,
        snippet: 'The RDAP lookup did not complete before the timeout.',
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

function getRdapLookupDomain(hostname: string) {
  const normalizedHostname = hostname.trim().replace(/\.$/, '').toLowerCase()

  return getDomain(normalizedHostname) ?? normalizedHostname
}

async function lookupRdapDomain(domain: string): Promise<RdapFetchResult> {
  let primaryResult: RdapFetchResult | null = null
  const primaryUrl = await getIanaRdapDomainUrl(domain).catch(() => null)

  if (primaryUrl) {
    primaryResult = await fetchRdapDomain(primaryUrl)

    if (primaryResult.status === 'not-found') {
      return primaryResult
    }

    if (
      primaryResult.status === 'found' &&
      getRdapRegistrationDate(primaryResult.data)
    ) {
      return primaryResult
    }
  }

  const fallbackUrl = buildRdapDomainUrl(RDAP_FALLBACK_BASE_URL, domain)

  if (fallbackUrl !== primaryUrl) {
    const fallbackResult = await fetchRdapDomain(fallbackUrl)

    if (primaryResult?.status === 'found' && fallbackResult.status !== 'found') {
      return primaryResult
    }

    return fallbackResult
  }

  return (
    primaryResult ?? {
      status: 'inconclusive',
      url: fallbackUrl,
    }
  )
}

async function getIanaRdapDomainUrl(domain: string) {
  const bootstrap = await getRdapBootstrap()
  const baseUrl = findRdapBaseUrl(domain, bootstrap)

  return baseUrl ? buildRdapDomainUrl(baseUrl, domain) : null
}

function getRdapBootstrap() {
  if (!rdapBootstrapPromise) {
    rdapBootstrapPromise = fetchRdapBootstrap().catch((error) => {
      rdapBootstrapPromise = null
      throw error
    })
  }

  return rdapBootstrapPromise
}

async function fetchRdapBootstrap(): Promise<RdapBootstrap> {
  const response = await fetchWithTimeout(RDAP_BOOTSTRAP_URL, RDAP_FETCH_TIMEOUT_MS, {
    headers: {
      Accept: 'application/json',
    },
  })

  if (!response.ok) {
    throw new Error(`RDAP bootstrap returned HTTP ${response.status}.`)
  }

  const data = (await response.json()) as unknown

  if (!isRecord(data) || !Array.isArray(data.services)) {
    throw new Error('RDAP bootstrap response was not usable.')
  }

  return data as RdapBootstrap
}

function findRdapBaseUrl(domain: string, bootstrap: RdapBootstrap) {
  let bestMatch: { suffixLength: number; baseUrl: string } | null = null

  for (const service of bootstrap.services ?? []) {
    const suffixes = service[0]
    const baseUrls = service[1]

    if (!Array.isArray(suffixes) || !Array.isArray(baseUrls)) {
      continue
    }

    const baseUrl = baseUrls.find((url) => typeof url === 'string' && url.length > 0)

    if (!baseUrl) {
      continue
    }

    for (const suffix of suffixes) {
      if (typeof suffix !== 'string') {
        continue
      }

      const normalizedSuffix = suffix.toLowerCase()
      const domainMatches =
        domain === normalizedSuffix || domain.endsWith(`.${normalizedSuffix}`)

      if (
        domainMatches &&
        (!bestMatch || normalizedSuffix.length > bestMatch.suffixLength)
      ) {
        bestMatch = {
          suffixLength: normalizedSuffix.length,
          baseUrl,
        }
      }
    }
  }

  return bestMatch?.baseUrl ?? null
}

function buildRdapDomainUrl(baseUrl: string, domain: string) {
  const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`

  return new URL(`domain/${encodeURIComponent(domain)}`, normalizedBaseUrl).toString()
}

async function fetchRdapDomain(url: string): Promise<RdapFetchResult> {
  try {
    const response = await fetchWithTimeout(url, RDAP_FETCH_TIMEOUT_MS, {
      headers: {
        Accept: 'application/rdap+json, application/json',
      },
    })

    if (response.status === 404) {
      return {
        status: 'not-found',
        url,
        httpStatus: response.status,
      }
    }

    if (!response.ok) {
      return {
        status: 'inconclusive',
        url,
        httpStatus: response.status,
      }
    }

    const data = (await response.json().catch(() => null)) as unknown

    if (!isRecord(data)) {
      return {
        status: 'inconclusive',
        url,
      }
    }

    return {
      status: 'found',
      url,
      data: data as RdapDomainResponse,
    }
  } catch {
    return {
      status: 'inconclusive',
      url,
    }
  }
}

function getRdapRegistrationDate(data: RdapDomainResponse) {
  const events = data.events ?? []

  return (
    getEarliestRdapEventDate(events, 'registration') ??
    getEarliestRdapEventDate(events, 'reregistration')
  )
}

function getEarliestRdapEventDate(
  events: NonNullable<RdapDomainResponse['events']>,
  eventAction: string,
) {
  let earliest: { timestamp: number; date: string } | null = null

  for (const event of events) {
    if (event.eventAction?.toLowerCase() !== eventAction || !event.eventDate) {
      continue
    }

    const timestamp = new Date(event.eventDate).getTime()

    if (!Number.isFinite(timestamp)) {
      continue
    }

    if (!earliest || timestamp < earliest.timestamp) {
      earliest = {
        timestamp,
        date: event.eventDate,
      }
    }
  }

  return earliest?.date ?? null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export async function collectThreatListEvidence(
  request: StoreSafetyRequest,
  env: Pick<
    ResearchEnv,
    | 'CLOUDFLARE_ACCOUNT_ID'
    | 'CLOUDFLARE_URL_SCANNER_API_TOKEN'
    | 'CLOUDFLARE_URL_SCANNER_VISIBILITY'
    | 'GOOGLE_WEB_RISK_API_KEY'
    | 'URLHAUS_AUTH_KEY'
  >,
): Promise<Evidence[]> {
  const results = await Promise.allSettled([
    collectUrlhausEvidence(request.normalizedUrl, request.hostname, env),
    collectOpenPhishEvidence(request.normalizedUrl, request.hostname),
    collectWebRiskEvidence(request.normalizedUrl, env),
    collectCloudflareUrlScannerEvidence(request, env),
  ])

  return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []))
}

export async function collectCloudflareUrlScannerEvidence(
  request: StoreSafetyRequest,
  env: Pick<
    ResearchEnv,
    | 'CLOUDFLARE_ACCOUNT_ID'
    | 'CLOUDFLARE_URL_SCANNER_API_TOKEN'
    | 'CLOUDFLARE_URL_SCANNER_VISIBILITY'
  >,
): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()
  const accountId = env.CLOUDFLARE_ACCOUNT_ID?.trim()
  const apiToken = env.CLOUDFLARE_URL_SCANNER_API_TOKEN?.trim()

  if (!accountId || !apiToken) {
    return [
      {
        sourceType: 'technical',
        title: 'Cloudflare URL Scanner is not configured',
        snippet:
          'Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_URL_SCANNER_API_TOKEN to include Cloudflare URL Scanner evidence.',
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  }

  const visibility =
    env.CLOUDFLARE_URL_SCANNER_VISIBILITY?.trim() || CLOUDFLARE_URL_SCANNER_DEFAULT_VISIBILITY

  try {
    const scanId = await createCloudflareUrlScannerScan(
      request.normalizedUrl,
      accountId,
      apiToken,
      visibility,
    )

    if (!scanId) {
      return [
        providerUnavailableEvidence(
          'Cloudflare URL Scanner check unavailable',
          observedAt,
          'Cloudflare URL Scanner did not return a scan ID.',
        ),
      ]
    }

    const result = await pollCloudflareUrlScannerResult(scanId, accountId, apiToken)
    const resultUrl = getCloudflareScannerResultUrl(result) ?? CLOUDFLARE_URL_SCANNER_RESULTS_DOCS_URL

    if (!result) {
      return [
        {
          sourceType: 'technical',
          title: 'Cloudflare URL Scanner scan still processing',
          url: resultUrl,
          snippet:
            'Cloudflare accepted the scan submission, but the result was still processing within the report window.',
          sentiment: 'neutral',
          weight: 1,
          observedAt,
        },
      ]
    }

    const malicious = result.result?.verdicts?.overall?.malicious === true
    const phishingSignals = result.result?.verdicts?.phishing ?? []
    const categories = result.result?.verdicts?.overall?.categories ?? []
    const finalUrl = result.result?.page?.finalURL ?? result.result?.page?.url
    const ip = result.result?.page?.ip
    const asn = result.result?.page?.asn
    const asnName = result.result?.page?.asnname
    const tech = result.result?.meta?.processors?.tech ?? []

    const details = [
      finalUrl ? `final URL: ${finalUrl}` : null,
      ip ? `IP: ${ip}` : null,
      asn || asnName ? `ASN: ${[asn, asnName].filter(Boolean).join(' ')}` : null,
      categories.length > 0 ? `categories: ${categories.join(', ')}` : null,
      phishingSignals.length > 0 ? `phishing signals: ${phishingSignals.join(', ')}` : null,
      tech.length > 0 ? `technology: ${tech.slice(0, 6).join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' | ')

    if (malicious || phishingSignals.length > 0) {
      return [
        {
          sourceType: 'technical',
          title: 'Cloudflare URL Scanner flagged malicious behavior',
          url: resultUrl,
          snippet:
            details ||
            'Cloudflare URL Scanner marked this scan as malicious or phishing-related.',
          sentiment: 'negative',
          weight: 10,
          observedAt,
        },
      ]
    }

    return [
      {
        sourceType: 'technical',
        title: 'Cloudflare URL Scanner found no malicious verdict',
        url: resultUrl,
        snippet:
          details ||
          'Cloudflare completed the scan without a malicious overall verdict.',
        sentiment: 'positive',
        weight: 2,
        observedAt,
      },
    ]
  } catch (error) {
    return [
      providerUnavailableEvidence(
        'Cloudflare URL Scanner check unavailable',
        observedAt,
        describeProviderError(error),
      ),
    ]
  }
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

function openPhishHostMatchesListing(storeHostname: string, listingHostname: string) {
  const store = storeHostname.toLowerCase()
  const listing = listingHostname.toLowerCase()
  if (store === listing) {
    return true
  }

  const stripWww = (host: string) => (host.startsWith('www.') ? host.slice(4) : host)

  return stripWww(store) === stripWww(listing)
}

function findOpenPhishListingForHost(feedText: string, storeHostname: string): string | null {
  for (const line of feedText.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    let listingUrl: URL
    try {
      listingUrl = new URL(trimmed)
    } catch {
      continue
    }

    if (listingUrl.protocol !== 'http:' && listingUrl.protocol !== 'https:') {
      continue
    }

    if (openPhishHostMatchesListing(storeHostname, listingUrl.hostname)) {
      return trimmed
    }
  }

  return null
}

export async function collectOpenPhishEvidence(
  normalizedUrl: string,
  storeHostname: string,
): Promise<Evidence[]> {
  const observedAt = new Date().toISOString()

  try {
    const response = await fetchWithTimeout(OPENPHISH_FEED_URL, 20_000, {
      headers: {
        accept: 'text/plain,*/*',
        'user-agent':
          'IsSafeStoreBot/1.0 (+https://issafe.store; store safety public signal checker)',
      },
    })

    if (!response.ok) {
      return [
        providerUnavailableEvidence(
          'OpenPhish feed check unavailable',
          observedAt,
          describeHttpProviderStatus('OpenPhish feed', response.status),
        ),
      ]
    }

    const feedText = await response.text()
    const listing = findOpenPhishListingForHost(feedText, storeHostname)

    if (listing) {
      const displayListing =
        listing.length > 280 ? `${listing.slice(0, 277).trimEnd()}…` : listing

      return [
        {
          sourceType: 'technical',
          title: 'OpenPhish feed match found',
          url: OPENPHISH_FEED_URL,
          snippet: `The public OpenPhish feed lists this host. Example entry: ${displayListing}`,
          sentiment: 'negative',
          weight: 10,
          observedAt,
        },
      ]
    }

    return [
      {
        sourceType: 'technical',
        title: 'No OpenPhish feed match found',
        url: OPENPHISH_FEED_URL,
        snippet: `The OpenPhish public feed did not list URLs for ${new URL(normalizedUrl).hostname}.`,
        sentiment: 'neutral',
        weight: 1,
        observedAt,
      },
    ]
  } catch (error) {
    return [
      providerUnavailableEvidence(
        'OpenPhish feed check unavailable',
        observedAt,
        describeProviderError(error),
      ),
    ]
  }
}

function formatWebRiskThreatTypeLabels(threatTypes: string[]): string {
  return threatTypes
    .filter((t) => t && t !== 'THREAT_TYPE_UNSPECIFIED')
    .map((t) => WEB_RISK_THREAT_TYPE_LABELS[t] ?? t.replaceAll('_', ' ').toLowerCase())
    .join(', ')
}

async function describeGoogleWebRiskErrorResponse(response: Response): Promise<string> {
  const statusPart = describeHttpProviderStatus('Google Web Risk', response.status)
  try {
    const body = (await response.json()) as { error?: { message?: string } }
    if (body.error?.message) {
      return `${statusPart} ${body.error.message}`
    }
  } catch {
    // ignore non-JSON or parse errors
  }
  return statusPart
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
          await describeGoogleWebRiskErrorResponse(response),
        ),
      ]
    }

    const result = (await response.json()) as WebRiskSearchUrisResponse
    const threatTypes = (result.threat?.threatTypes ?? []).filter(
      (t) => t && t !== 'THREAT_TYPE_UNSPECIFIED',
    )
    const expireTime = result.threat?.expireTime

    if (threatTypes.length > 0) {
      const labels = formatWebRiskThreatTypeLabels(threatTypes)
      const expiryNote = expireTime
        ? ` Match metadata expires at ${expireTime} (do not cache this result past that time).`
        : ''
      return [
        {
          sourceType: 'technical',
          title: 'Google Web Risk threat match found',
          url: 'https://cloud.google.com/web-risk',
          snippet: `Google Web Risk matched this URL on: ${labels}.${expiryNote}`,
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
        snippet:
          'Google Web Risk uris:search returned no threat match for this URI on the requested lists: malware, social engineering, unwanted software, and social engineering extended coverage.',
        sentiment: 'positive',
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
      .filter((result) => tavilyResultMatchesHostname(result, hostname))
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

export async function collectTavilyCoupons(
  hostname: string,
  env: Pick<ResearchEnv, 'TAVILY_API_KEY'>,
): Promise<Coupon[]> {
  const observedAt = new Date().toISOString()

  if (!env.TAVILY_API_KEY) {
    return []
  }

  const queries = buildTavilyCouponQueries(hostname)
  const responses = await Promise.allSettled(
    queries.map((query) => searchTavily(query, env.TAVILY_API_KEY ?? '')),
  )
  const coupons = responses.flatMap((response) => {
    if (response.status === 'rejected') {
      return []
    }

    return (response.value.results ?? [])
      .filter((result) => typeof result.score !== 'number' || result.score >= 0.5)
      .filter((result) => tavilyResultMatchesHostname(result, hostname))
      .filter(tavilyResultMentionsCoupon)
      .map((result) => tavilyResultToCoupon(result, observedAt))
  })

  return dedupeCoupons(coupons).slice(0, 3)
}

export function buildTavilyCouponQueries(hostname: string): TavilyQuery[] {
  return [
    { query: `"${hostname}" coupon code` },
    { query: `"${hostname}" promo code` },
    { query: `"${hostname}" discount code` },
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

export function tavilyResultToCoupon(
  result: TavilyResult,
  observedAt: string,
): Coupon {
  const title = result.title?.trim() || 'Public coupon offer'
  const description = (result.content ?? result.url ?? 'Public coupon offer.').trim()
  const url = result.url
  const code = extractCouponCode(`${title} ${description}`)

  return {
    title,
    description,
    ...(code ? { code } : {}),
    ...(url ? { url } : {}),
    source: getCouponSource(url),
    observedAt,
  }
}

function tavilyResultMatchesHostname(result: TavilyResult, hostname: string) {
  const normalizedHostname = hostname.toLowerCase()
  const searchableText = [result.title, result.content].filter(Boolean).join(' ')

  if (containsExactHostnameToken(searchableText, normalizedHostname)) {
    return true
  }

  if (!result.url) {
    return false
  }

  try {
    const url = new URL(result.url)

    if (url.hostname.toLowerCase() === normalizedHostname) {
      return true
    }

    return containsExactHostnameToken(
      decodeUrlText(`${url.pathname} ${url.search} ${url.hash}`),
      normalizedHostname,
    )
  } catch {
    return containsExactHostnameToken(result.url, normalizedHostname)
  }
}

function containsExactHostnameToken(text: string, hostname: string) {
  const normalizedText = text.toLowerCase()
  let index = normalizedText.indexOf(hostname)

  while (index !== -1) {
    const previous = normalizedText[index - 1]
    const next = normalizedText[index + hostname.length]
    const nextAfterDot = normalizedText[index + hostname.length + 1]

    if (
      !isHostnamePrefixCharacter(previous) &&
      !isHostnameSuffixCharacter(next, nextAfterDot)
    ) {
      return true
    }

    index = normalizedText.indexOf(hostname, index + 1)
  }

  return false
}

function isHostnamePrefixCharacter(character: string | undefined) {
  return Boolean(character && /[a-z0-9.-]/.test(character))
}

function isHostnameSuffixCharacter(
  character: string | undefined,
  nextCharacter: string | undefined,
) {
  if (!character) {
    return false
  }

  if (/[a-z0-9-]/.test(character)) {
    return true
  }

  return character === '.' && Boolean(nextCharacter && /[a-z0-9-]/.test(nextCharacter))
}

function decodeUrlText(text: string) {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

function isScamQuestionResult(text: string) {
  return /\b(is|are|was|were)\b.{0,80}\b(legit|safe|scam|fraud|real|trustworthy)\b/.test(
    text,
  )
}

function tavilyResultMentionsCoupon(result: TavilyResult) {
  const haystack = [result.title, result.content, result.url]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  return COUPON_TERMS.some((term) => haystack.includes(term))
}

function extractCouponCode(text: string) {
  const normalized = text.replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
  const patterns = [
    /\b(?:code|coupon code|promo code|voucher code)\s*(?:is|:|-)?\s*["']?([A-Z0-9][A-Z0-9_-]{3,24})["']?/i,
    /\buse\s+(?:code\s+)?["']?([A-Z0-9][A-Z0-9_-]{3,24})["']?/i,
  ]

  for (const pattern of patterns) {
    const match = normalized.match(pattern)
    const code = match?.[1]?.toUpperCase()

    if (code && !isGenericCouponCode(code)) {
      return code
    }
  }

  return undefined
}

function isGenericCouponCode(code: string) {
  return /^(CODE|COUPON|PROMO|VOUCHER|DISCOUNT|OFFER|DEAL|SALE)$/i.test(code)
}

function getCouponSource(url: string | undefined) {
  if (!url) {
    return 'Public search result'
  }

  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Public search result'
  }
}

function dedupeCoupons(coupons: Coupon[]) {
  const seen = new Set<string>()
  const deduped: Coupon[] = []

  for (const coupon of coupons) {
    const key = `${coupon.code ?? ''}:${coupon.url ?? ''}:${coupon.title}`.toLowerCase()

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    deduped.push(coupon)
  }

  return deduped
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

async function collectPolicyPages(urls: string[]): Promise<PolicyPage[]> {
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

  if (status === 401 || status === 403) {
    return `${provider} returned HTTP ${status}. Confirm the provider credentials and key restrictions.`
  }

  if (status === 429) {
    return `${provider} returned HTTP 429. The provider rate limit was reached.`
  }

  return `${provider} returned HTTP ${status}.`
}

async function createCloudflareUrlScannerScan(
  url: string,
  accountId: string,
  apiToken: string,
  visibility: string,
) {
  const response = await fetchWithTimeout(
    `${CLOUDFLARE_URL_SCANNER_BASE_URL}/${encodeURIComponent(accountId)}/urlscanner/v2/scan`,
    7000,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${apiToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        url,
        visibility,
        screenshotsResolutions: ['desktop'],
      }),
    },
  )

  if (!response.ok) {
    throw new Error(describeHttpProviderStatus('Cloudflare URL Scanner', response.status))
  }

  const payload = (await response.json()) as CloudflareUrlScannerScanRequest
  const scanId = payload.result?.uuid

  if (!scanId) {
    throw new Error(
      payload.errors?.[0]?.message || 'Cloudflare URL Scanner did not return a scan UUID.',
    )
  }

  return scanId
}

async function pollCloudflareUrlScannerResult(
  scanId: string,
  accountId: string,
  apiToken: string,
) {
  for (let attempt = 0; attempt < CLOUDFLARE_URL_SCANNER_POLL_ATTEMPTS; attempt += 1) {
    const response = await fetchWithTimeout(
      `${CLOUDFLARE_URL_SCANNER_BASE_URL}/${encodeURIComponent(accountId)}/urlscanner/v2/result/${encodeURIComponent(scanId)}`,
      7000,
      {
        headers: {
          authorization: `Bearer ${apiToken}`,
          accept: 'application/json',
        },
      },
    )

    if (response.status === 404) {
      if (attempt < CLOUDFLARE_URL_SCANNER_POLL_ATTEMPTS - 1) {
        await sleep(CLOUDFLARE_URL_SCANNER_POLL_DELAY_MS)
        continue
      }

      return null
    }

    if (!response.ok) {
      throw new Error(describeHttpProviderStatus('Cloudflare URL Scanner', response.status))
    }

    return (await response.json()) as CloudflareUrlScannerResultResponse
  }

  return null
}

function getCloudflareScannerResultUrl(result: CloudflareUrlScannerResultResponse | null) {
  if (!result) {
    return null
  }

  return result.result?.task?.scanURL ?? result.result?.task?.screenshotURL ?? null
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
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

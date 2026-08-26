import handler from '@tanstack/react-start/server-entry'
import { routeAgentRequest } from 'agents'
import { StoreSafetyAgent } from './agents/store-safety-agent'

export { StoreSafetyAgent }

const CANONICAL_HOST = 'issafe.store'
const WWW_HOST = `www.${CANONICAL_HOST}`
const ONE_YEAR_SECONDS = 31_536_000
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://cloud.umami.is",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "img-src 'self' data: https:",
  "object-src 'none'",
  "script-src 'self' 'unsafe-inline' https://cloud.umami.is",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests",
].join('; ')

export default {
  async fetch(request: Request, env: Env) {
    const redirectResponse = getCanonicalRedirect(request)

    if (redirectResponse) {
      return redirectResponse
    }

    const agentResponse = await routeAgentRequest(request, env)

    if (agentResponse) {
      return withSeoHeaders(request, agentResponse)
    }

    const response = await handler.fetch(request)

    return withSeoHeaders(request, response)
  },
}

function getCanonicalRedirect(request: Request) {
  const url = new URL(request.url)
  const normalizedPathname = getNormalizedPathname(url.pathname)
  const isProductionHost = url.hostname === CANONICAL_HOST || url.hostname === WWW_HOST
  const shouldRedirect =
    (isProductionHost && url.protocol !== 'https:') ||
    url.hostname === WWW_HOST ||
    normalizedPathname !== url.pathname

  if (!shouldRedirect) {
    return null
  }

  url.protocol = 'https:'

  if (url.hostname === WWW_HOST) {
    url.hostname = CANONICAL_HOST
  }

  url.pathname = normalizedPathname

  return Response.redirect(url.toString(), 308)
}

function getNormalizedPathname(pathname: string) {
  if (pathname === '/about/' || pathname.toLowerCase() === '/about') {
    return '/about'
  }

  return pathname
}

function withSeoHeaders(request: Request, response: Response) {
  const url = new URL(request.url)
  const headers = new Headers(response.headers)
  const isProductionHost = url.hostname === CANONICAL_HOST || url.hostname === WWW_HOST

  if (isProductionHost && url.protocol === 'https:') {
    headers.set('strict-transport-security', `max-age=${ONE_YEAR_SECONDS}; includeSubDomains`)
  }

  headers.set('content-security-policy', CONTENT_SECURITY_POLICY)
  headers.set('cross-origin-opener-policy', 'same-origin')
  headers.set('permissions-policy', 'camera=(), geolocation=(), microphone=(), payment=(), usb=()')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-frame-options', 'DENY')

  if (response.ok && url.pathname.startsWith('/assets/')) {
    headers.set('cache-control', `public, max-age=${ONE_YEAR_SECONDS}, immutable`)
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

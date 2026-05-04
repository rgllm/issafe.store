export type NormalizedStoreUrl = {
  inputUrl: string
  normalizedUrl: string
  hostname: string
}

const LOCAL_HOSTNAMES = new Set(['localhost', 'localhost.localdomain'])

export class UrlValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UrlValidationError'
  }
}

export function normalizeStoreUrl(input: string): NormalizedStoreUrl {
  const trimmedInput = input.trim()

  if (!trimmedInput) {
    throw new UrlValidationError('Enter a store URL.')
  }

  if (trimmedInput.length > 2048) {
    throw new UrlValidationError('URL is too long.')
  }

  const withProtocol = /^[a-z][a-z\d+\-.]*:\/\//i.test(trimmedInput)
    ? trimmedInput
    : `https://${trimmedInput}`

  let parsed: URL
  try {
    parsed = new URL(withProtocol)
  } catch {
    throw new UrlValidationError('Enter a valid URL.')
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new UrlValidationError('Only http and https URLs are supported.')
  }

  if (parsed.username || parsed.password) {
    throw new UrlValidationError('URLs with usernames or passwords are not supported.')
  }

  const hostname = parsed.hostname.toLowerCase()

  if (!isPublicHostname(hostname)) {
    throw new UrlValidationError('Enter a public store domain.')
  }

  parsed.hash = ''
  parsed.search = ''
  parsed.pathname = '/'
  parsed.hostname = hostname

  if (
    (parsed.protocol === 'https:' && parsed.port === '443') ||
    (parsed.protocol === 'http:' && parsed.port === '80')
  ) {
    parsed.port = ''
  }

  return {
    inputUrl: trimmedInput,
    normalizedUrl: parsed.toString(),
    hostname,
  }
}

export async function createCheckId(hostname: string) {
  const data = new TextEncoder().encode(hostname)
  const digest = await crypto.subtle.digest('SHA-256', data)
  const hash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')

  return `store-${hash.slice(0, 20)}`
}

export function isPublicHostname(hostname: string) {
  if (!hostname || hostname.length > 253) {
    return false
  }

  if (LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith('.local')) {
    return false
  }

  if (hostname.includes(':')) {
    return false
  }

  if (hostname.endsWith('.')) {
    return false
  }

  if (isIpv4Literal(hostname)) {
    return false
  }

  const labels = hostname.split('.')

  if (labels.length < 2) {
    return false
  }

  return labels.every((label) => {
    if (!label || label.length > 63) {
      return false
    }

    return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
  })
}

function isIpv4Literal(hostname: string) {
  const octets = hostname.split('.').map(Number)

  return (
    /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) &&
    octets.every((octet) => octet >= 0 && octet <= 255)
  )
}

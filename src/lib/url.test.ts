import { describe, expect, it } from 'vitest'
import { createCheckId, normalizeStoreUrl, UrlValidationError } from './url'

describe('normalizeStoreUrl', () => {
  it('normalizes a store hostname to a clean HTTPS origin', () => {
    expect(normalizeStoreUrl('Example-Store.com/products?utm=ad#reviews')).toEqual({
      inputUrl: 'Example-Store.com/products?utm=ad#reviews',
      normalizedUrl: 'https://example-store.com/',
      hostname: 'example-store.com',
    })
  })

  it('rejects local, private, direct IP, and single-label hosts', () => {
    const blockedHosts = [
      'localhost',
      'http://internal',
      'http://127.0.0.1',
      'http://10.0.0.5',
      'http://192.168.1.10',
      'http://8.8.8.8',
      'http://[::1]',
    ]

    for (const host of blockedHosts) {
      expect(() => normalizeStoreUrl(host), host).toThrow(UrlValidationError)
    }
  })

  it('rejects unsupported protocols and credentialed URLs', () => {
    expect(() => normalizeStoreUrl('ftp://example.com')).toThrow(UrlValidationError)
    expect(() => normalizeStoreUrl('https://user:pass@example.com')).toThrow(
      UrlValidationError,
    )
  })

  it('creates stable opaque check ids from hostnames', async () => {
    await expect(createCheckId('example.com')).resolves.toMatch(/^store-[a-f0-9]{20}$/)
    await expect(createCheckId('example.com')).resolves.toBe(await createCheckId('example.com'))
  })
})

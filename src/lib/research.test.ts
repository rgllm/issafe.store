import { describe, expect, it } from 'vitest'
import { buildTavilyQueries, getCacheTtlSeconds } from './research'

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
  it('builds global-English reputation queries for a hostname', () => {
    expect(buildTavilyQueries('example.com')).toEqual([
      '"example.com" reviews',
      '"example.com" scam OR fraud OR complaints',
      '"example.com" Trustpilot Reddit refund',
    ])
  })
})

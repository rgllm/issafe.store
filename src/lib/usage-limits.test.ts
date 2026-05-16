import { describe, expect, it } from 'vitest'
import {
  DAILY_WINDOW_SECONDS,
  UsageLimitError,
  assertUsageLimits,
  getConfiguredLimit,
} from './usage-limits'

type CounterRow = {
  count: number
  expires_at: string
}

class FakeD1Statement {
  constructor(
    private readonly counters: Map<string, CounterRow>,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new FakeD1Statement(this.counters, this.sql, params)
  }

  async run() {
    if (this.sql.includes('INSERT INTO usage_counters')) {
      this.incrementUsageCounter()
    }

    return { success: true }
  }

  async first<T>() {
    if (this.sql.includes('INSERT INTO usage_counters')) {
      return { count: this.incrementUsageCounter().count } as T
    }

    if (this.sql.includes('SELECT count FROM usage_counters')) {
      const [key, now] = this.params.map(String)
      const row = this.counters.get(key)

      return (row && row.expires_at > now ? { count: row.count } : null) as T | null
    }

    return null
  }

  private incrementUsageCounter() {
    const [key, expiresAt, now] = this.params.map(String)
    const existing = this.counters.get(key)

    if (!existing || existing.expires_at <= now) {
      const next = { count: 1, expires_at: expiresAt }
      this.counters.set(key, next)

      return next
    }

    const next = {
      count: existing.count + 1,
      expires_at: existing.expires_at,
    }
    this.counters.set(key, next)

    return next
  }
}

class FakeD1Database {
  readonly counters = new Map<string, CounterRow>()

  prepare(sql: string) {
    return new FakeD1Statement(this.counters, sql)
  }
}

describe('usage limits', () => {
  it('allows requests until the configured daily limit is reached', async () => {
    const db = new FakeD1Database()
    const limit = {
      scope: 'checks:global',
      windowSeconds: DAILY_WINDOW_SECONDS,
      limit: 2,
      message: 'Daily limit reached.',
    }
    const now = new Date('2026-05-16T12:00:00.000Z')

    await assertUsageLimits(db as unknown as D1Database, [limit], now)
    await assertUsageLimits(db as unknown as D1Database, [limit], now)

    await expect(
      assertUsageLimits(db as unknown as D1Database, [limit], now),
    ).rejects.toBeInstanceOf(UsageLimitError)
  })

  it('uses a new daily counter after midnight UTC', async () => {
    const db = new FakeD1Database()
    const limit = {
      scope: 'checks:global',
      windowSeconds: DAILY_WINDOW_SECONDS,
      limit: 1,
      message: 'Daily limit reached.',
    }

    await assertUsageLimits(
      db as unknown as D1Database,
      [limit],
      new Date('2026-05-16T23:59:00.000Z'),
    )
    await assertUsageLimits(
      db as unknown as D1Database,
      [limit],
      new Date('2026-05-17T00:00:00.000Z'),
    )

    expect(db.counters.size).toBe(2)
  })

  it('falls back for invalid configured limits and accepts zero as disabled', () => {
    expect(getConfiguredLimit(undefined, 10)).toBe(10)
    expect(getConfiguredLimit('not-a-number', 10)).toBe(10)
    expect(getConfiguredLimit('-1', 10)).toBe(10)
    expect(getConfiguredLimit('0', 10)).toBe(0)
    expect(getConfiguredLimit('5', 10)).toBe(5)
  })
})

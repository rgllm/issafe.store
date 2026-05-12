import { describe, expect, it } from 'vitest'
import { getCachedReport, saveReport } from './reports-db'
import type { StoreSafetyReport } from '../types/report'

type StoredRow = {
  hostname: string
  report_json: string
  expires_at: string
}

class FakeD1Statement {
  constructor(
    private readonly rows: Map<string, StoredRow>,
    private readonly sql: string,
    private readonly params: unknown[] = [],
  ) {}

  bind(...params: unknown[]) {
    return new FakeD1Statement(this.rows, this.sql, params)
  }

  async run() {
    if (this.sql.includes('INSERT INTO reports')) {
      const [id, hostname, , reportJson, , expiresAt] = this.params

      this.rows.set(String(id), {
        hostname: String(hostname),
        report_json: String(reportJson),
        expires_at: String(expiresAt),
      })
    }

    return { success: true }
  }

  async first<T>() {
    const [id] = this.params

    return (this.rows.get(String(id)) ?? null) as T | null
  }
}

class FakeD1Database {
  readonly rows = new Map<string, StoredRow>()

  prepare(sql: string) {
    return new FakeD1Statement(this.rows, sql)
  }
}

const createReport = (expiresAt: string): StoreSafetyReport => ({
  id: 'store-test',
  inputUrl: 'example.com',
  normalizedUrl: 'https://example.com/',
  hostname: 'example.com',
  status: 'complete',
  score: 82,
  confidence: 76,
  recommendation: 'likely-safe',
  summary: 'Public signals are positive.',
  evidence: [],
  coupons: [],
  createdAt: '2026-05-04T00:00:00.000Z',
  expiresAt,
})

describe('reports D1 cache', () => {
  it('saves and returns unexpired reports', async () => {
    const db = new FakeD1Database()
    const report = createReport('2026-05-05T00:00:00.000Z')

    await saveReport(db as unknown as D1Database, report)

    await expect(
      getCachedReport(db as unknown as D1Database, report.id, new Date('2026-05-04T12:00:00.000Z')),
    ).resolves.toEqual(report)
  })

  it('returns null for expired reports', async () => {
    const db = new FakeD1Database()
    const report = createReport('2026-05-04T10:00:00.000Z')

    await saveReport(db as unknown as D1Database, report)

    await expect(
      getCachedReport(db as unknown as D1Database, report.id, new Date('2026-05-04T12:00:00.000Z')),
    ).resolves.toBeNull()
  })

  it('normalizes the persisted hostname to the registrable domain', async () => {
    const db = new FakeD1Database()
    const report = {
      ...createReport('2026-05-05T00:00:00.000Z'),
      hostname: 'www.zara.com',
    }

    await saveReport(db as unknown as D1Database, report)

    const row = db.rows.get(report.id)

    expect(row?.hostname).toBe('zara.com')
    expect(JSON.parse(row?.report_json ?? '{}')).toMatchObject({
      hostname: 'zara.com',
    })
  })
})

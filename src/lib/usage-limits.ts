export type UsageLimit = {
  limit: number
  message: string
  scope: string
  windowSeconds: number
}

type UsageCounterRow = {
  count: number
}

export const DAILY_WINDOW_SECONDS = 86_400

export const LAUNCH_LIMIT_DEFAULTS = {
  aiCallsPerDay: 600,
  checksPerDay: 300,
  domainChecksPerDay: 5,
  tavilyCallsPerDay: 700,
  urlScannerSubmissionsPerDay: 15,
  urlScannerSubmissionWindowSeconds: 10,
} as const

export class UsageLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UsageLimitError'
  }
}

export async function ensureUsageCountersTable(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS usage_counters (
        key TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    )
    .run()

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_usage_counters_expires_at
        ON usage_counters (expires_at)`,
    )
    .run()
}

export async function assertUsageLimits(
  db: D1Database,
  limits: UsageLimit[],
  now = new Date(),
) {
  const activeLimits = limits.filter((limit) => limit.limit > 0)

  if (activeLimits.length === 0) {
    return
  }

  await ensureUsageCountersTable(db)

  for (const limit of activeLimits) {
    const key = getUsageCounterKey(limit.scope, limit.windowSeconds, now)
    const expiresAt = getUsageCounterExpiry(limit.windowSeconds, now).toISOString()
    const row = await db
      .prepare(
        `INSERT INTO usage_counters (key, count, expires_at)
          VALUES (?, 1, ?)
          ON CONFLICT(key) DO UPDATE SET
            count = CASE
              WHEN expires_at <= ? THEN 1
              ELSE count + 1
            END,
            expires_at = CASE
              WHEN expires_at <= ? THEN excluded.expires_at
              ELSE expires_at
            END
          RETURNING count`,
      )
      .bind(key, expiresAt, now.toISOString(), now.toISOString())
      .first<UsageCounterRow>()

    if ((row?.count ?? 0) > limit.limit) {
      throw new UsageLimitError(limit.message)
    }
  }
}

export function getConfiguredLimit(
  value: string | undefined,
  fallback: number,
) {
  const parsed = Number(value)

  if (!Number.isInteger(parsed) || parsed < 0) {
    return fallback
  }

  return parsed
}

function getUsageCounterKey(scope: string, windowSeconds: number, now: Date) {
  if (windowSeconds === DAILY_WINDOW_SECONDS) {
    return `${scope}:${now.toISOString().slice(0, 10)}`
  }

  return `${scope}:${Math.floor(now.getTime() / (windowSeconds * 1000))}`
}

function getUsageCounterExpiry(windowSeconds: number, now: Date) {
  if (windowSeconds === DAILY_WINDOW_SECONDS) {
    return new Date(
      Date.UTC(
        now.getUTCFullYear(),
        now.getUTCMonth(),
        now.getUTCDate() + 1,
      ),
    )
  }

  return new Date(
    Math.floor(now.getTime() / (windowSeconds * 1000)) * windowSeconds * 1000 +
      windowSeconds * 1000,
  )
}

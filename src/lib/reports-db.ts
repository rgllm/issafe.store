import type { StoreSafetyReport } from '../types/report'

type ReportRow = {
  report_json: string
  expires_at: string
}

export async function ensureReportsTable(db: D1Database) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS reports (
        id TEXT PRIMARY KEY,
        hostname TEXT NOT NULL,
        normalized_url TEXT NOT NULL,
        report_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      )`,
    )
    .run()

  await db
    .prepare(
      `CREATE INDEX IF NOT EXISTS idx_reports_hostname_expires_at
        ON reports (hostname, expires_at)`,
    )
    .run()
}

export async function getCachedReport(
  db: D1Database,
  id: string,
  now = new Date(),
): Promise<StoreSafetyReport | null> {
  await ensureReportsTable(db)

  const row = await db
    .prepare('SELECT report_json, expires_at FROM reports WHERE id = ?')
    .bind(id)
    .first<ReportRow>()

  if (!row || new Date(row.expires_at).getTime() <= now.getTime()) {
    return null
  }

  return JSON.parse(row.report_json) as StoreSafetyReport
}

export async function saveReport(db: D1Database, report: StoreSafetyReport) {
  await ensureReportsTable(db)

  await db
    .prepare(
      `INSERT INTO reports (
        id,
        hostname,
        normalized_url,
        report_json,
        created_at,
        expires_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        hostname = excluded.hostname,
        normalized_url = excluded.normalized_url,
        report_json = excluded.report_json,
        created_at = excluded.created_at,
        expires_at = excluded.expires_at`,
    )
    .bind(
      report.id,
      report.hostname,
      report.normalizedUrl,
      JSON.stringify(report),
      report.createdAt,
      report.expiresAt,
    )
    .run()
}

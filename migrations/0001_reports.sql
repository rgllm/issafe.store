CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  hostname TEXT NOT NULL,
  normalized_url TEXT NOT NULL,
  report_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_reports_hostname_expires_at
  ON reports (hostname, expires_at);

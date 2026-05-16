CREATE TABLE IF NOT EXISTS usage_counters (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_counters_expires_at
  ON usage_counters (expires_at);

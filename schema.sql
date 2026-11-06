CREATE TABLE IF NOT EXISTS snapshots (
  account_id TEXT NOT NULL,
  ts INTEGER NOT NULL,          -- unix ms, rounded down to the minute
  lifetime TEXT NOT NULL,       -- lifetimeVolume, USDC base units (6 decimals)
  volume30d TEXT NOT NULL,
  PRIMARY KEY (account_id, ts)
);

CREATE TABLE IF NOT EXISTS tracked (
  account_id TEXT PRIMARY KEY,
  added_at INTEGER NOT NULL
);

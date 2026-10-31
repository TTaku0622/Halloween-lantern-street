CREATE TABLE IF NOT EXISTS lanterns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  strokes TEXT NOT NULL,          -- 彫った線の JSON
  color TEXT,                     -- 灯りの色（#rrggbb）。NULL は既定のろうそく色
  created_at INTEGER NOT NULL,    -- ミリ秒
  ip_hash TEXT NOT NULL,          -- 連投制限・通報の重複防止用（IP そのものは保存しない）
  reports INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS lanterns_street ON lanterns (hidden, created_at DESC);

CREATE TABLE IF NOT EXISTS reports (
  lantern_id TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  PRIMARY KEY (lantern_id, ip_hash)
);

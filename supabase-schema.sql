-- Run this once in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sessions (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  session_date TEXT         UNIQUE NOT NULL,
  state        JSONB        NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- Auto-delete sessions older than 14 days (run once in Supabase SQL Editor)
-- Requires pg_cron: enable it in Supabase Dashboard → Database → Extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'delete-old-sessions',          -- job name (idempotent re-run)
  '0 3 * * *',                    -- daily at 03:00 UTC
  $$DELETE FROM sessions WHERE session_date::date < now() - interval '14 days'$$
);

-- Public access (no auth per PRD design intent)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read"   ON sessions FOR SELECT USING (true);
CREATE POLICY "public insert" ON sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON sessions FOR UPDATE USING (true);

-- Enable Realtime so postgres_changes events are sent to WebSocket subscribers
ALTER PUBLICATION supabase_realtime ADD TABLE sessions;


-- ── Internal tournament (/internal-match) ────────────────────────────────────
-- Separate table from `sessions` on purpose: the roster must outlive the
-- 14-day pg_cron sweep above, and a non-date key would break that job's
-- session_date::date cast.
CREATE TABLE IF NOT EXISTS tournaments (
  id         TEXT         PRIMARY KEY,
  state      JSONB        NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ  DEFAULT NOW()
);

ALTER TABLE tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read"   ON tournaments FOR SELECT USING (true);
CREATE POLICY "public insert" ON tournaments FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON tournaments FOR UPDATE USING (true);

-- Realtime for the roster, so an edit on /internal/player shows up on every
-- other open device immediately instead of on the next 60s poll.
-- Run this once in the SQL Editor; the table itself already exists.
ALTER PUBLICATION supabase_realtime ADD TABLE tournaments;

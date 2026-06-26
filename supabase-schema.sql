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


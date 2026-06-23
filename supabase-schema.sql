-- Run this once in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS sessions (
  id           UUID         DEFAULT gen_random_uuid() PRIMARY KEY,
  session_date TEXT         UNIQUE NOT NULL,
  state        JSONB        NOT NULL DEFAULT '{}',
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- Public access (no auth per PRD design intent)
ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read"   ON sessions FOR SELECT USING (true);
CREATE POLICY "public insert" ON sessions FOR INSERT WITH CHECK (true);
CREATE POLICY "public update" ON sessions FOR UPDATE USING (true);

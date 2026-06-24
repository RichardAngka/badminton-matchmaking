import { createClient } from '@supabase/supabase-js'
import type { AppState } from './types'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

// ponytail: null when env vars absent — all callers check before use
export const supabase = (url && key) ? createClient(url, key) : null

export interface SessionMeta {
  session_date: string
  player_count: number
  total_shuttles: number
}

export async function fetchRemoteState(date: string): Promise<AppState | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('sessions')
    .select('state')
    .eq('session_date', date)
    .maybeSingle()
  if (error) { console.error('[supabase] fetch failed:', error.message); return null }
  if (!data) return null
  return data.state as AppState
}

export async function upsertRemoteState(date: string, state: AppState): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('sessions').upsert(
    { session_date: date, state, updated_at: new Date().toISOString() },
    { onConflict: 'session_date' },
  )
  if (error) console.error('[supabase] upsert failed:', error.message)
}

export async function listRemoteSessions(): Promise<SessionMeta[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('sessions')
    .select('session_date, state')
    .order('updated_at', { ascending: false })
    .limit(60)
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => ({
    session_date: row.session_date,
    player_count: (row.state?.players ?? []).filter((p: { status: string }) => p.status !== 'Left').length,
    total_shuttles: (row.state?.matches ?? []).reduce(
      (s: number, m: { shuttlesUsed?: number }) => s + (m.shuttlesUsed ?? 0), 0
    ),
  }))
}

import { createClient } from '@supabase/supabase-js'
import type { AppState, Match, Player, TournamentState } from './types'
import type { MemberLists } from './members'

const url = import.meta.env.VITE_SUPABASE_URL as string
// Supabase renamed the browser key: legacy `anon` (a JWT) -> `publishable`
// (sb_publishable_...). Read both so local and Vercel work whichever is set.
const key = (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
          ?? import.meta.env.VITE_SUPABASE_ANON_KEY) as string

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

export interface HistorySession { session_date: string; players: Player[]; matches: Match[] }

/** Every session's players and matches, oldest first — what the Elo replay reads. */
export async function fetchHistory(): Promise<HistorySession[]> {
  if (!supabase) return []
  const { data, error } = await supabase
    .from('sessions')
    .select('session_date, players:state->players, matches:state->matches')
    .order('session_date')
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => ({
    session_date: r.session_date as string,
    players: (r.players ?? []) as unknown as Player[],
    matches: (r.matches ?? []) as unknown as Match[],
  }))
}

// ── Internal tournament ──────────────────────────────────────────────────────
// ponytail: one row, fixed id — single tournament, reshuffled in place
export const TOURNAMENT_ID = 'internal-match'

export async function fetchTournament(): Promise<TournamentState | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('tournaments')
    .select('state')
    .eq('id', TOURNAMENT_ID)
    .maybeSingle()
  if (error) { console.error('[supabase] tournament fetch failed:', error.message); return null }
  return (data?.state as TournamentState) ?? null
}

export async function upsertTournament(state: TournamentState): Promise<void> {
  if (!supabase) return
  const { error } = await supabase.from('tournaments').upsert(
    { id: TOURNAMENT_ID, state, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  if (error) console.error('[supabase] tournament upsert failed:', error.message)
}

const PHOTO_BUCKET = 'players'

/** Uploads a player photo and returns its public URL. Throws on failure. */
export async function uploadPlayerPhoto(file: File, playerId: string): Promise<string> {
  if (!supabase) throw new Error('Supabase belum dikonfigurasi')
  // A fresh path per upload, so a replaced photo is never served from cache.
  const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
  const path = `${playerId}-${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: file.type })
  if (error) throw new Error(error.message)
  return supabase.storage.from(PHOTO_BUCKET).getPublicUrl(path).data.publicUrl
}

// ── Standing member lists (Selasa / Kamis) ───────────────────────────────────
// ponytail: one more row in `tournaments`, which is already a public id → JSON
// store kept out of the 14-day sweep; a table of its own adds a migration and
// buys nothing until members need per-row history.
export const MEMBERS_ID = 'members'

/** null when nothing has been saved yet; throws when the read itself failed. */
export async function fetchMembers(): Promise<MemberLists | null> {
  if (!supabase) return null
  const { data, error } = await supabase
    .from('tournaments')
    .select('state')
    .eq('id', MEMBERS_ID)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return (data?.state as MemberLists) ?? null
}

export async function upsertMembers(lists: MemberLists): Promise<MemberLists> {
  if (!supabase) return lists
  const { error } = await supabase.from('tournaments').upsert(
    { id: MEMBERS_ID, state: lists, updated_at: new Date().toISOString() },
    { onConflict: 'id' },
  )
  if (error) throw new Error(error.message)
  return lists
}

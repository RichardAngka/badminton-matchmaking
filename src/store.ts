import type { AppState } from './types'
import { fetchRemoteState, upsertRemoteState } from './supabase'

const KEY = 'pbsor-v1'

export const DEFAULT_STATE: AppState = {
  sessionDate: new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' }),
  shuttlePrice: 14000,
  targetPlayers: 36,
  timeSlots: [
    { start: '17:00', end: '20:00', courts: 2 },
    { start: '20:00', end: '23:00', courts: 3 },
  ],
  players: [],
  matches: [],
  matchCounter: 0,
}

export function loadState(): AppState {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULT_STATE, ...JSON.parse(raw) } : DEFAULT_STATE
  } catch {
    return DEFAULT_STATE
  }
}

export function saveLocal(state: AppState): AppState {
  localStorage.setItem(KEY, JSON.stringify(state))
  return state
}

// Loads for a given date: Supabase first, localStorage fallback
export async function loadStateForDate(date: string): Promise<AppState> {
  const today = new Date().toLocaleDateString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const remote = await fetchRemoteState(date)
  if (remote) {
    if (date === today) saveLocal(remote)  // keep local cache warm for today
    return { ...DEFAULT_STATE, ...remote }
  }
  if (date === today) return loadState()
  return { ...DEFAULT_STATE, sessionDate: date }
}

// Saves locally + pushes to Supabase
export async function persistState(date: string, state: AppState): Promise<AppState> {
  saveLocal(state)
  await upsertRemoteState(date, state)
  return state
}

export function getActiveCourts(state: AppState): number {
  const now = new Date()
  const hhmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const slot = state.timeSlots.find(s => hhmm >= s.start && hhmm < s.end)
  return slot?.courts ?? state.timeSlots[0]?.courts ?? 2
}

export function getActiveMatchMap(state: AppState): Map<number, string> {
  const map = new Map<number, string>()
  for (const m of state.matches) {
    if (!m.endTime) map.set(m.courtId, m.id)
  }
  return map
}

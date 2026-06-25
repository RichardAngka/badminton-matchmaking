import type { AppState } from './types'
import { fetchRemoteState, upsertRemoteState } from './supabase'

export const DEFAULT_STATE: AppState = {
  sessionDate: new Date().toLocaleDateString('en-CA'),
  shuttlePrice: 14000,
  harianFee: 25000,
  targetPlayers: 36,
  timeSlots: [
    { start: '17:00', end: '20:00', courts: 2 },
    { start: '20:00', end: '23:00', courts: 3 },
  ],
  players: [],
  matches: [],
  matchCounter: 0,
}

export async function loadStateForDate(date: string): Promise<AppState> {
  const remote = await fetchRemoteState(date)
  return remote ? { ...DEFAULT_STATE, ...remote } : { ...DEFAULT_STATE, sessionDate: date }
}

export async function persistState(date: string, state: AppState): Promise<AppState> {
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

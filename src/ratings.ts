import { useCallback, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { AppState, Gender, Match, Player, SkillLevel } from './types'
import { fetchHistory, type HistorySession } from './supabase'

// Power = Elo, stored nowhere: every scored match of every session is replayed
// on load. An edited or deleted match corrects itself, and a grade change moves
// a player by the gap between bases, because the seed is read from today's grade.
const BASE: Record<SkillLevel, number> = { A1: 1600, A2: 1500, B1: 1400, B2: 1300 }
const K = 24
const PROVISIONAL = 5  // games played on double K, so a newcomer finds their level fast
const RECENT = 4       // earlier sessions that still count as "met before" — ~2 weeks of Selasa + Kamis

export type Power = (p: Player) => number
/** pairKey → the cost of putting these two together again, as partners or as opponents. */
export interface Met { partners: Map<string, number>; opponents: Map<string, number> }

export const nameKey = (name: string) => name.trim().toLowerCase()
// By name, not id: ids are minted per session, names carry across them.
export const pairKey = (a: Player, b: Player) => [nameKey(a.name), nameKey(b.name)].sort().join('|')
export const seed = (skill: SkillLevel, gender: Gender) => BASE[skill] - (gender === 'F' ? 100 : 0)
/** Team 1's chance of winning, from the two teams' average power. */
export const winProb = (r1: number, r2: number) => 1 / (1 + 10 ** ((r2 - r1) / 400))

interface Form { delta: number; games: number }

export function replay(sessions: HistorySession[]): Map<string, Form> {
  const form = new Map<string, Form>()
  const get = (key: string) => form.get(key) ?? form.set(key, { delta: 0, games: 0 }).get(key)!
  for (const s of [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date))) {
    const byId = new Map(s.players.map(p => [p.id, p]))
    for (const m of [...s.matches].sort((a, b) => a.matchNumber - b.matchNumber)) {
      // "21-" or "" is a score nobody finished typing, not a result.
      const score = m.endTime ? /^(\d+)-(\d+)$/.exec(m.score ?? '') : null
      if (!score || score[1] === score[2]) continue
      const t1 = m.team1.map(id => byId.get(id)), t2 = m.team2.map(id => byId.get(id))
      if ([...t1, ...t2].some(p => !p)) continue
      const rating = (p: Player) => seed(p.skill, p.gender) + get(nameKey(p.name)).delta
      const avg = (t: (Player | undefined)[]) => (rating(t[0]!) + rating(t[1]!)) / 2
      const margin = Math.abs(+score[1] - +score[2])
      // ln(margin+1)/ln(8): a 7-point win counts 1×, 21-19 about half, 21-0 about 1.5×.
      const swing = (Math.log(margin + 1) / Math.log(8)) * ((+score[1] > +score[2] ? 1 : 0) - winProb(avg(t1), avg(t2)))
      for (const [team, sign] of [[t1, 1], [t2, -1]] as const)
        for (const p of team) {
          const f = get(nameKey(p!.name))
          f.delta += sign * swing * (f.games < PROVISIONAL ? 2 * K : K)
          f.games++
        }
    }
  }
  return form
}

/**
 * Who already partnered or faced whom. Tonight's matches, running ones too, at
 * the full price the matchmaker always charged (partner 2, opponent 1); the last
 * RECENT sessions before it at a quarter, so variety holds across the week.
 */
export function metFrom(today: HistorySession, earlier: HistorySession[]): Met {
  const met: Met = { partners: new Map(), opponents: new Map() }
  const add = (map: Map<string, number>, a: Player, b: Player, w: number) => {
    const k = pairKey(a, b)
    map.set(k, (map.get(k) ?? 0) + w)
  }
  const weighted: [HistorySession, number][] = [...earlier.slice(-RECENT).map(s => [s, 0.25] as [HistorySession, number]), [today, 1]]
  for (const [s, w] of weighted) {
    const byId = new Map(s.players.map(p => [p.id, p]))
    for (const m of s.matches) {
      const [a, b, c, d] = [...m.team1, ...m.team2].map(id => byId.get(id))
      if (!a || !b || !c || !d) continue
      add(met.partners, a, b, 2 * w)
      add(met.partners, c, d, 2 * w)
      for (const [x, y] of [[a, c], [a, d], [b, c], [b, d]]) add(met.opponents, x, y, w)
    }
  }
  return met
}

/**
 * Every player's power and who they have met, with the open session read from
 * live state so a match just finished counts before the history query
 * refetches. Viewers pass enabled=false: the numbers are for the admin.
 */
export function useStats(state: AppState, date: string, enabled: boolean): { power: Power; met: Met } {
  const { data } = useQuery({ queryKey: ['history'], queryFn: fetchHistory, staleTime: 5 * 60_000, enabled })
  const { form, met } = useMemo(() => {
    const today = { session_date: date, players: state.players, matches: state.matches }
    const others = (data ?? []).filter(s => s.session_date !== date)
    return { form: replay([...others, today]), met: metFrom(today, others.filter(s => s.session_date < date)) }
  }, [data, date, state.players, state.matches])
  const power = useCallback(
    (p: Player) => Math.round(seed(p.skill, p.gender) + (form.get(nameKey(p.name))?.delta ?? 0)),
    [form],
  )
  return { power, met }
}

if (import.meta.env.DEV) {
  const p = (id: string): Player => ({
    id, name: id, skill: 'B1', gender: 'M', type: 'harian', status: 'Waiting',
    checkInTime: null, checkOutTime: null, restingSince: null, totalCost: 0, gamesPlayed: 0,
  })
  const m = (score?: string): Match => ({
    id: 'm', matchNumber: 1, courtId: 1, team1: ['a', 'b'], team2: ['c', 'd'], startTime: 0, endTime: 1, score,
  })
  const run = (...ms: Match[]) => replay([{ session_date: '2026-01-01', players: ['a', 'b', 'c', 'd'].map(p), matches: ms }])
  const won = run(m('21-15'))
  console.assert(winProb(1500, 1500) === 0.5, '[ratings] even teams not 50%')
  console.assert(won.get('a')!.delta > 0 && won.get('a')!.delta === -won.get('c')!.delta, '[ratings] winner not up by what loser lost')
  console.assert(run(m(), m('21-'), m('15-15')).size === 0, '[ratings] unscored match moved a rating')
  const day = (date: string): HistorySession => ({ session_date: date, players: ['a', 'b', 'c', 'd'].map(p), matches: [m('21-15')] })
  const met = metFrom(day('2026-01-09'), ['01', '02', '03', '04', '05', '06'].map(d => day(`2026-01-${d}`)))
  // Tonight once (2) plus the last four sessions at a quarter (4 × 0.5): the two older ones are forgotten.
  console.assert(met.partners.get('a|b') === 4 && met.opponents.get('a|c') === 2, '[ratings] met weights off')
}

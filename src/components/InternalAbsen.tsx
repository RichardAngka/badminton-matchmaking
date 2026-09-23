import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Day, TourPlayer, TournamentState } from '../types'
import { EMPTY_BRACKET, LEVEL_CLASS, TEAM_IDS, isHere, loadTournament, resolve } from '../internalMatch'
import { TOURNAMENT_ID, supabase, upsertTournament } from '../supabase'
import { useCaptainTeam, useIsAdmin } from '../RoleContext'

const DAYS: Day[] = [1, 2]

export function InternalAbsen() {
  const isAdmin = useIsAdmin()
  const captain = useCaptainTeam()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Day | null>(null)  // null = follow the bracket
  const searchRef = useRef<HTMLInputElement>(null)

  // No polling: only admins and captains open this page, and Realtime covers them.
  const { data: state } = useQuery({ queryKey: ['tournament'], queryFn: loadTournament })

  // Check-in is rapid tapping at the door. The scope runs writes one at a
  // time in tap order, so a slow early write can't land last and undo later taps.
  const mut = useMutation({ mutationFn: upsertTournament, scope: { id: 'tournament' } })

  // Another admin's check-ins, live. Skipped while a write is in flight, so a
  // refetch can't swap the cache back to a state missing the latest taps.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('tournament-absen')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${TOURNAMENT_ID}` },
        () => { if (!qc.isMutating()) qc.invalidateQueries({ queryKey: ['tournament'] }) },
      )
      .subscribe()
    return () => { supabase?.removeChannel(channel) }
  }, [qc])

  if (!isAdmin && !captain) return <div className="im-empty">Khusus admin dan kapten tim.</div>
  if (!state) return <div className="im-loading">Memuat absen…</div>

  // Day 2 is the day after the semis, so once both have a winner, open on it.
  const day = picked ?? (resolve({ ...EMPTY_BRACKET, ...state.bracket }).pairs.final.every(Boolean) ? 2 : 1)
  // A captain only ever sees their own team — the other rosters are not listed.
  const roster = state.players.filter(p =>
    !p.external && p.team !== null && (!captain || p.team === captain))
  const q = search.trim().toLowerCase()

  // ponytail: whole-blob write per tap, last-write-wins against another admin
  // saving at the same moment (e.g. a lineup pick) — a per-player attendance
  // table fixes that if two admins at once ever loses a check-in.
  const toggle = async (p: TourPlayer) => {
    await qc.cancelQueries({ queryKey: ['tournament'] })  // an in-flight refetch would undo this tap
    // From the cache, not the render: a second tap can land before the re-render.
    const cur = qc.getQueryData<TournamentState>(['tournament']) ?? state
    const here = isHere(p, day)
    const next: TournamentState = {
      ...cur,
      players: cur.players.map(x => x.id !== p.id ? x
        : { ...x, present: isHere(x, day) ? x.present!.filter(d => d !== day) : [...(x.present ?? []), day] }),
    }
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
    // Door flow: type a name, tap, type the next one.
    if (q && !here) { setSearch(''); searchRef.current?.focus() }
  }

  const teams = (captain ? [captain] : TEAM_IDS).map(t => {
    const members = roster.filter(p => p.team === t)
    return {
      t, count: members.length,
      here: members.filter(p => isHere(p, day)).length,
      shown: members.filter(p => !q || p.name.toLowerCase().includes(q))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  })

  return (
    <section className="ws-section">
      <div className="ws-head">
        <div className="ws-head-l">
          <h2>Absen</h2>
          <span className="ws-head-sub">
            {captain ? `Ketuk pemain ${state.teamNames[captain]} yang sudah datang` : 'Ketuk pemain yang sudah datang'}
          </span>
        </div>
        <span className="ws-pill">Hadir {roster.filter(p => isHere(p, day)).length}/{roster.length}</span>
      </div>

      <div className="im-segmented im-tabs" role="group" aria-label="Hari">
        {DAYS.map(d => (
          <button key={d} className={`im-seg${day === d ? ' on' : ''}`}
            aria-pressed={day === d} onClick={() => setPicked(d)}>
            <span className="im-tab-label">Hari {d}</span>
          </button>
        ))}
      </div>

      <div className="im-controls">
        <input ref={searchRef} className="im-search" placeholder="Cari nama…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {teams.every(t => !t.shown.length) && <div className="im-empty">Tidak ada yang cocok.</div>}
      {teams.filter(t => t.shown.length).map(({ t, count, here, shown }) => (
        <div key={t} className="im-group">
          <div className="im-group-head">
            <span>{state.teamNames[t]}</span>
            <span className={`im-group-count ${here === count ? 'ok' : 'short'}`}>{here}/{count}</span>
          </div>
          <div className="im-rows">
            {shown.map(p => {
              const on = isHere(p, day)
              return (
                <button key={p.id} className={`im-row ab-row${on ? ' on' : ''}`}
                  aria-pressed={on} onClick={() => toggle(p)}>
                  <span className="ab-check" aria-hidden>{on ? '✓' : ''}</span>
                  <span className="im-row-name">{p.name}</span>
                  {p.gender === 'F' && <span className="im-w">W</span>}
                  <span className={`lvl-badge ${LEVEL_CLASS[p.level]}`}>{p.level}</span>
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </section>
  )
}

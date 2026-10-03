import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Bracket, BracketKey, Day, Extra, PartaiResult, Score, Slot, TeamId, TourPlayer, TournamentState,
} from '../types'
import {
  COURTS, DAY, EMPTY_BRACKET, LEVELS, LEVEL_CLASS, MAX_POINT, OTHER, PARTAI, SLOTS, WO,
  elapsed, isHere, lineupOf, loadTournament, officials, partaiWinner, ready, resolve, setExtra,
  setPartai, setSlot,
  tally,
} from '../internalMatch'
import { TOURNAMENT_ID, supabase, upsertTournament } from '../supabase'
import { useCaptainTeam, useIsAdmin } from '../RoleContext'

const MATCHES: [BracketKey, string][] = [
  ['sf1', 'SF 1'], ['sf2', 'SF 2'], ['final', 'Final'], ['third', 'Juara 3'],
]

type Side = {
  team: TeamId
  name: string
  slots: Slot[]
  members: TourPlayer[]
  here: Set<string>
  masked: boolean   // opponent's column, still hidden from this captain
}

export function InternalLineup() {
  const isAdmin = useIsAdmin()
  const captain = useCaptainTeam()
  const qc = useQueryClient()
  const [match, setMatch] = useState<BracketKey>('sf1')
  const [anyLevel, setAnyLevel] = useState(false)         // show off-grade players

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    refetchInterval: 60_000,  // fallback in case the Realtime socket drops
  })

  // Same scope as /internal/absen: writes land in the order they were made.
  const mut = useMutation({ mutationFn: upsertTournament, scope: { id: 'tournament' } })

  // Realtime, same as Bagan: a point or a pick shows up on every open phone.
  // Skipped while a write is in flight, so a refetch can't swap the cache back
  // to a state missing what was just entered.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('tournament-lineup')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${TOURNAMENT_ID}` },
        () => { if (!qc.isMutating()) qc.invalidateQueries({ queryKey: ['tournament'] }) },
      )
      .subscribe()
    return () => { supabase?.removeChannel(channel) }
  }, [qc])

  if (!state) return <div className="im-loading">Memuat line-up…</div>

  const label = MATCHES.find(([k]) => k === match)![1]
  const day = DAY[match]
  const b: Bracket = { ...EMPTY_BRACKET, ...state.bracket }
  const pair = resolve(b).pairs[match]
  const [ta, tb] = pair
  const results = b.results?.[match] ?? []
  const score = tally(b, match)

  const side = (team: TeamId): Side => {
    const members = state.players
      .filter(p => !p.external && p.team === team)
      .sort((a, c) => LEVELS.indexOf(a.level) - LEVELS.indexOf(c.level) || a.name.localeCompare(c.name))
    return {
      team, members,
      name: state.teamNames[team],
      slots: lineupOf(state, team, day),
      here: new Set(members.filter(p => isHere(p, day)).map(p => p.id)),
      masked: false,
    }
  }
  const sides = ta && tb ? [side(ta), side(tb)] : null
  const complete = !!sides && sides.every(s => ready(s.slots, s.here) === SLOTS.length)
  // A captain always sees their own column; the opponent's waits for the reveal.
  const mine = (s: Side) => captain === s.team
  if (sides && !complete && !isAdmin) sides.forEach(s => { s.masked = !mine(s) })
  const canSee = isAdmin || complete || (!!sides && sides.some(mine))
  // Two jobs, two shapes. Before the reveal a captain can only act on their own
  // twenty — the opponent's column and the points are noise they cannot touch,
  // and drawing them triples the scroll for nothing.
  const own = sides?.find(mine)
  const filling = !isAdmin && !complete && !!own

  // ponytail: whole-blob write per edit, same last-write-wins as the other
  // internal pages. The patch reads the row out of the cache rather than closing
  // over this render's copy: a check-in here and a pick a second later would
  // otherwise both build on the same stale players array, and the pick would
  // quietly undo the check-in.
  const save = async (patch: (cur: TournamentState) => TournamentState) => {
    await qc.cancelQueries({ queryKey: ['tournament'] })  // an in-flight refetch would undo this edit
    const next = patch(qc.getQueryData<TournamentState>(['tournament']) ?? state)
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
  }
  const pick = (s: Side, i: number, v: Slot) => save(cur => ({
    ...cur,
    lineups: {
      ...cur.lineups,
      [s.team]: { ...cur.lineups?.[s.team], [day]: setSlot(lineupOf(cur, s.team, day), i, v) },
    },
  }))
  const editPartai = (i: number, patch: Partial<PartaiResult>) => save(cur => ({
    ...cur,
    bracket: setPartai({ ...EMPTY_BRACKET, ...cur.bracket }, match, i, patch),
  }))
  const editExtra = (patch: Partial<Extra>) => save(cur => ({
    ...cur,
    bracket: setExtra({ ...EMPTY_BRACKET, ...cur.bracket }, match, patch),
  }))
  /**
   * Checks a player in for this match's day, writing the same players[].present
   * that /internal/absen writes — so it lands on that page, and on every other
   * open phone, without this page knowing anything about it.
   *
   * One way only: a name that is holding the twenty back is a problem worth
   * fixing where it is seen, but un-checking someone is an absen job, and
   * twenty "hadir" toggles here would bury the one that matters.
   */
  const markHere = (id: string) => save(cur => ({
    ...cur,
    players: cur.players.map(x =>
      x.id === id && !isHere(x, day) ? { ...x, present: [...(x.present ?? []), day] } : x),
  }))

  return (
    <section className="ws-section">
      <div className="ws-head">
        <div className="ws-head-l">
          <h2>Line-up</h2>
          <span className="ws-head-sub">
            {isAdmin || captain
              ? 'Kedua susunan tampil setelah tiap tim memasang 20 pemain yang sudah hadir.'
              : 'Susunan pemain tiap partai'}
          </span>
        </div>
      </div>

      <div className="im-segmented im-tabs" role="tablist" aria-label="Pertandingan">
        {MATCHES.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={match === k}
            className={`im-seg${match === k ? ' on' : ''}`}
            onClick={() => setMatch(k)}>
            <span className="im-tab-label">{l}</span>
          </button>
        ))}
      </div>

      {!sides ? <div className="im-empty">Line-up terbuka setelah hasil semifinal masuk.</div>
        : <>
            {/* The tie score and each side's shortfall, in reach from partai 10
                as well as partai 1. */}
            <div className="lu-bar">
              <SideStat s={sides[0]} />
              <div className="lu-bar-net">
                <span className="lu-bar-sc">{score?.[0] ?? 0}</span>
                <span className="lu-bar-rule" aria-hidden />
                <span className="lu-bar-sc">{score?.[1] ?? 0}</span>
                <span className="lu-bar-unit">partai</span>
              </div>
              <SideStat s={sides[1]} end />
            </div>

            {(isAdmin || captain) && (
              <div className="im-controls">
                {/* Grade is the format, fixed per slot; this opens the other
                    grades for a stand-in when someone is hurt or missing. */}
                <button className={`btn btn-ghost btn-sm${anyLevel ? ' on' : ''}`}
                  aria-pressed={anyLevel} onClick={() => setAnyLevel(v => !v)}>
                  {anyLevel ? 'Kembali ke grade slot' : 'Buka semua grade'}
                </button>
                {isAdmin && (
                  /* No completeness gate. It guarded nothing — an admin is
                     already looking at both susunan — and it blocked the sheet
                     when it is most wanted: empty, printed before play, to fill
                     in by hand. A slot with nobody in it draws as an empty box,
                     a partai with no points draws as an empty score cell. */
                  <button className="btn btn-ghost btn-sm"
                    onClick={() => exportPNG({
                      label, day, date: dayDate(b, day), sides, results, score,
                      tiebreak: b.tiebreak?.[match], extra: b.extra?.[match],
                    })}>Unduh score sheet</button>
                )}
              </div>
            )}

            {/* Viewers see nothing until both sides are in, so neither captain
                can counter-pick. ponytail: hidden in the UI only — the row is
                public, real secrecy needs its own RLS-guarded table. */}
            {!canSee
              ? <p className="lu-locked">
                  Kedua susunan tampil di sini setelah masing-masing tim memasang 20 pemain
                  yang sudah hadir.
                </p>
              : filling
                ? <FillList s={own!} anyLevel={anyLevel} onPick={pick} />
                : <ol className="lu-sheet">
                    {PARTAI.map((_, p) => (
                      <PartaiCard key={p} p={p} r={results[p]} sides={sides} isAdmin={isAdmin}
                        canEdit={s => isAdmin || mine(s)} anyLevel={anyLevel}
                        onHere={isAdmin ? markHere : undefined}
                        state={state} day={day} pair={pair}
                        clash={!!results[p]?.court && b.results?.[OTHER[match]]?.[p]?.court === results[p]?.court}
                        onPick={pick} onEdit={patch => editPartai(p, patch)} />
                    ))}
                    {/* Only once the ten have split evenly — before that there
                        is nothing to decide, and an empty card invites points
                        that would not count. */}
                    {(tied(score) || !!b.extra?.[match]) && (
                      <ExtraCard x={b.extra?.[match]} sides={sides} isAdmin={isAdmin}
                        onEdit={editExtra} />
                    )}
                  </ol>}
          </>}
    </section>
  )
}

/** 5–5: the ten partai split evenly, so an extra one decides the tie. */
const tied = (s?: Score) => !!s && s[0] === s[1] && s[0] === PARTAI.length / 2

/**
 * The extra partai played at 5–5. It picks from the whole roster rather than
 * the lineup: a team may put up any pair for it, so there is no slot, no grade
 * and no WO — just four names and the points, which are the tie's result.
 */
function ExtraCard({ x, sides, isAdmin, onEdit }: {
  x?: Extra
  sides: Side[]
  isAdmin: boolean
  onEdit: (patch: Partial<Extra>) => void
}) {
  const won = partaiWinner(x)
  const players = x?.players ?? []
  const setPlayer = (i: number, v: string) => {
    const next = [0, 1, 2, 3].map(j => (j === i ? v || null : players[j] ?? null))
    onEdit({ players: next })
  }
  const setScore = (j: 0 | 1, n: number) => {
    const other = x?.score?.[1 - j] ?? 0
    onEdit({ score: (j === 0 ? [n, other] : [other, n]) as Score })
  }
  const group = (j: 0 | 1) => {
    const s = sides[j]
    return (
      <div className={`lu-side${j ? ' b' : ''}${won === undefined ? '' : won === j ? ' won' : ' lost'}`}>
        <div className="lu-side-h">
          <span className="lu-side-team">{s.name}</span>
          {won === j && <span className="lu-side-won">Menang</span>}
          {isAdmin
            ? <PointBox value={x?.score?.[j]} label={`Poin ${s.name} partai ekstra`}
                onCommit={n => setScore(j, n)} />
            : <span className="lu-side-pt">{x?.score?.[j] ?? '–'}</span>}
        </div>
        {[0, 1].map(k => {
          const i = j * 2 + k
          const v = players[i] ?? null
          if (!isAdmin) {
            return (
              <div className="lu-row" key={k}>
                <span className="lu-name">{s.members.find(m => m.id === v)?.name ?? '–'}</span>
              </div>
            )
          }
          return (
            <div className="lu-row" key={k}>
              <select className={`lu-sel${v ? '' : ' empty'}`} value={v ?? ''}
                aria-label={`${s.name} pemain ${k + 1} partai ekstra`}
                onChange={e => setPlayer(i, e.target.value)}>
                <option value="">Belum dipilih</option>
                {s.members.map(m => (
                  <option key={m.id} value={m.id}>{m.name} ({m.level})</option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <li className="lu-p">
      <div className="lu-p-h">
        <span className="lu-p-n">Partai ekstra</span>
        <span className="lu-p-lap">Penentu 5–5</span>
      </div>
      <div className="lu-p-body">
        {group(0)}
        <div className="lu-net" aria-hidden />
        {group(1)}
      </div>
    </li>
  )
}

/** What is still holding a side's twenty back, in the words the absen page uses. */
function shortfall(s: Side) {
  const empty = s.slots.filter(v => v === null).length
  const away = s.slots.filter(v => v && v !== WO && !s.here.has(v)).length
  const bits: string[] = []
  if (empty) bits.push(`${empty} kosong`)
  if (away) bits.push(`${away} belum hadir`)
  return bits.length ? bits.join(', ') : null
}

/** A side of the tally bar: its name, and what it still needs. */
function SideStat({ s, end }: { s: Side; end?: boolean }) {
  const short = shortfall(s)
  return (
    <div className={`lu-bar-s${end ? ' b' : ''}`}>
      <span className="lu-bar-team">{s.name}</span>
      <span className={`lu-bar-state${short ? '' : ' ok'}`}>{short ?? 'Siap'}</span>
    </div>
  )
}

/** A captain's own twenty, in partai pairs. Nothing else is theirs to set yet. */
function FillList({ s, anyLevel, onPick }: {
  s: Side
  anyLevel: boolean
  onPick: (s: Side, i: number, v: Slot) => void
}) {
  return (
    <ol className="lu-fill">
      {PARTAI.map((_, p) => (
        <li key={p} className="lu-fill-p">
          <span className="lu-fill-n">Partai {p + 1}</span>
          <div className="lu-fill-rows">
            {[0, 1].map(k => (
              <SlotRow key={k} side={s} i={p * 2 + k} canEdit anyLevel={anyLevel}
                onPick={v => onPick(s, p * 2 + k, v)} />
            ))}
          </div>
        </li>
      ))}
    </ol>
  )
}

/** One partai: two sides eitherteside of the net, points astride it. */
function PartaiCard({ p, r, sides, isAdmin, canEdit, anyLevel, state, day, pair, clash, onPick, onEdit, onHere }: {
  p: number
  r?: PartaiResult
  sides: Side[]
  isAdmin: boolean
  canEdit: (s: Side) => boolean
  anyLevel: boolean
  onHere?: (id: string) => void
  state: TournamentState
  day: 1 | 2
  pair: (TeamId | undefined)[]
  clash: boolean
  onPick: (s: Side, i: number, v: Slot) => void
  onEdit: (patch: Partial<PartaiResult>) => void
}) {
  const won = partaiWinner(r)
  const live = !!r?.started && !r.ended
  // A running partai shows no counter: this page has no clock tick, so a number
  // would sit frozen at the minute the page happened to render.
  const when = live ? 'Sedang main' : r?.ended ? `${elapsed(r)} menit` : null
  const setScore = (j: 0 | 1, n: number) => {
    const other = r?.score?.[1 - j] ?? 0
    onEdit({ score: (j === 0 ? [n, other] : [other, n]) as [number, number] })
  }
  const group = (j: 0 | 1) => (
    <SideGroup s={sides[j]} j={j} p={p} pts={r?.score?.[j]} won={won}
      canEdit={canEdit(sides[j])} editPoints={isAdmin} anyLevel={anyLevel}
      onPick={onPick} onScore={n => setScore(j, n)} onHere={onHere} />
  )
  return (
    <li className={`lu-p${live ? ' live' : !r?.court && !r?.started ? ' unset' : ''}`}>
      <div className="lu-p-h">
        <span className="lu-p-n">Partai {p + 1}</span>
        {when && <span className="lu-p-when">{when}</span>}
        {isAdmin ? (
          <div className="lu-p-act">
            <select className={`lu-in${clash ? ' away' : ''}`} value={r?.court ?? ''}
              aria-label={`Lapangan partai ${p + 1}`}
              title={clash ? 'Lapangan ini dipakai partai yang sama di pertandingan satunya' : undefined}
              onChange={e => onEdit({ court: Number(e.target.value) || undefined })}>
              <option value="">Pilih lapangan</option>
              {COURTS.map(c => <option key={c} value={c}>Lapangan {c}</option>)}
            </select>
            {live
              ? <button className="btn btn-primary btn-sm"
                  onClick={() => onEdit({ ended: Date.now() })}>Selesai</button>
              : <button className="btn btn-ghost btn-sm" disabled={!r?.court}
                  title={r?.court ? undefined : 'Pilih lapangan dulu'}
                  onClick={() => onEdit({ started: Date.now(), ended: undefined })}>
                  {r?.ended ? 'Mulai ulang' : 'Mulai'}
                </button>}
          </div>
        ) : (
          <span className="lu-p-lap">
            {r?.court ? `Lapangan ${r.court}` : 'Lapangan belum diatur'}
          </span>
        )}
      </div>

      <div className="lu-p-body">
        {group(0)}
        <div className="lu-net" aria-hidden />
        {group(1)}
      </div>

      <Crew r={r} p={p} isAdmin={isAdmin} state={state} day={day} pair={pair} onEdit={onEdit} />
    </li>
  )
}

/** One team's half of a partai: who they field, and the points they scored. */
function SideGroup({ s, j, p, pts, won, canEdit, editPoints, anyLevel, onPick, onScore, onHere }: {
  s: Side
  j: number
  p: number
  pts?: number
  won?: 0 | 1
  canEdit: boolean
  editPoints: boolean
  anyLevel: boolean
  onPick: (s: Side, i: number, v: Slot) => void
  onScore: (n: number) => void
  onHere?: (id: string) => void
}) {
  const outcome = won === undefined ? '' : won === j ? ' won' : ' lost'
  return (
    <div className={`lu-side${j ? ' b' : ''}${outcome}`}>
      <div className="lu-side-h">
        <span className="lu-side-team">{s.name}</span>
        {won === j && <span className="lu-side-won">Menang</span>}
        {editPoints
          ? <PointBox value={pts} label={`Poin ${s.name} partai ${p + 1}`} onCommit={onScore} />
          : <span className="lu-side-pt">{pts ?? '–'}</span>}
      </div>
      {[0, 1].map(k => (
        <SlotRow key={k} side={s} i={p * 2 + k} canEdit={canEdit} anyLevel={anyLevel}
          onPick={v => onPick(s, p * 2 + k, v)} onHere={onHere} />
      ))}
    </div>
  )
}

/**
 * One slot: the grade it is for, who fills it, and anything wrong with that.
 * Each fact appears once — the closed select carries the name, the chips carry
 * the problems, so nothing has to be read out of a truncated option label.
 */
function SlotRow({ side, i, canEdit, anyLevel, onPick, onHere }: {
  side: Side
  i: number
  canEdit: boolean
  anyLevel: boolean
  onPick: (v: Slot) => void
  onHere?: (id: string) => void
}) {
  const v = side.slots[i]
  const level = SLOTS[i]
  const p = side.members.find(m => m.id === v)
  const badge = <span className={`lvl-badge ${LEVEL_CLASS[level]}`}>{level}</span>

  if (side.masked) {
    return <div className="lu-row">{badge}<span className="lu-hid">Belum tampil</span></div>
  }

  const away = !!p && !side.here.has(p.id)
  const chips = (
    <>
      {p && p.level !== level && (
        <span className="lu-chip grade" title={`${p.level} main di slot ${level}`}>grade {p.level}</span>
      )}
      {p && away && (onHere
        ? <button type="button" className="lu-chip away act" title={`Tandai ${p.name} hadir`}
            onClick={() => onHere(p.id)}>Tandai hadir</button>
        : <span className="lu-chip away">belum hadir</span>)}
    </>
  )

  if (!canEdit) {
    return (
      <div className="lu-row">
        {badge}
        {v === WO
          ? <span className="lu-name wo">WO</span>
          : <span className="lu-name">{p?.name ?? '–'}</span>}
        {chips}
      </div>
    )
  }

  // Where each teammate already plays, so picking one visibly moves them.
  const where = (id: string) => {
    const j = side.slots.indexOf(id)
    return j >= 0 && j !== i ? ` · P${(j >> 1) + 1}` : ''
  }
  // Attendance is the optgroup's job, so the label carries only what the closed
  // select has to say: the name, an off-grade marker, and a move warning.
  const opt = (m: TourPlayer) => (
    <option key={m.id} value={m.id}>
      {m.name}{m.level !== level ? ` (${m.level})` : ''}{where(m.id)}
    </option>
  )
  // Grade-only unless it has been opened up: the slot's grade is the format.
  const eligible = side.members.filter(m => anyLevel || m.level === level || m.id === v)
  const here = eligible.filter(m => side.here.has(m.id))
  return (
    <div className="lu-row">
      {badge}
      <select className={`lu-sel${v ? '' : ' empty'}${away ? ' away' : ''}`} value={v ?? ''}
        aria-label={`${side.name} partai ${(i >> 1) + 1} (${level})`}
        onChange={e => onPick(e.target.value || null)}>
        <option value="">Belum dipilih</option>
        <optgroup label="Sudah hadir">
          {here.filter(m => m.level === level).map(opt)}
          {anyLevel && here.filter(m => m.level !== level).map(opt)}
        </optgroup>
        <optgroup label="Belum hadir">
          {eligible.filter(m => !side.here.has(m.id)).map(opt)}
        </optgroup>
        <option value={WO}>WO (walkover)</option>
      </select>
      {chips}
    </div>
  )
}

/** Wasit and linesman. Folded away: courtside it is set once and then read. */
function Crew({ r, p, isAdmin, state, day, pair, onEdit }: {
  r?: PartaiResult
  p: number
  isAdmin: boolean
  state: TournamentState
  day: 1 | 2
  pair: (TeamId | undefined)[]
  onEdit: (patch: Partial<PartaiResult>) => void
}) {
  const crew = officials(state, pair, day)
  const name = (id?: string) => state.players.find(x => x.id === id)?.name ?? '–'
  const lines = r?.lines ?? []

  const setCrew = (v: string, slot: 'wasit' | 0 | 1) => {
    if (slot === 'wasit') return onEdit({ wasit: v || undefined })
    const next = [...lines]
    next[slot] = v
    onEdit({ lines: next.filter(Boolean) as string[] })
  }
  const field = (value: string | undefined, label: string, slot: 'wasit' | 0 | 1) => (
    <div className="lu-crew-f" key={label}>
      <span>{label}</span>
      {isAdmin ? (
        <select className="lu-in" value={value ?? ''} aria-label={`${label} partai ${p + 1}`}
          onChange={e => setCrew(e.target.value, slot)}>
          <option value="">Belum dipilih</option>
          {[...new Set(crew.map(c => c.team!))].map(t => (
            <optgroup key={t} label={state.teamNames[t]}>
              {crew.filter(c => c.team === t).map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
      ) : <strong>{name(value)}</strong>}
    </div>
  )

  return (
    <details className="lu-crew">
      <summary className="lu-crew-s">
        {r?.wasit ? `Wasit ${name(r.wasit)}` : 'Petugas belum diatur'}
      </summary>
      <div className="lu-crew-b">
        {field(r?.wasit, 'Wasit', 'wasit')}
        {field(lines[0], 'Linesman 1', 0)}
        {field(lines[1], 'Linesman 2', 1)}
      </div>
    </details>
  )
}

/**
 * A points box: digits only, no blur or Enter needed. The digit shows at once
 * but saves a third of a second after the last one — typing "21" would
 * otherwise store a 2 first, and every phone on the realtime channel would see
 * the wrong team leading. Winner falls out of comparing the two numbers.
 */
function PointBox({ value, label, onCommit }: {
  value?: number
  label: string
  onCommit: (n: number) => void
}) {
  const [raw, setRaw] = useState(String(value ?? ''))
  useEffect(() => setRaw(String(value ?? '')), [value])
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  const type = (s: string) => {
    const t = s.replace(/\D/g, '').slice(0, 2)
    const n = Math.min(MAX_POINT, Number(t || 0))
    setRaw(t === '' ? '' : String(n))
    clearTimeout(timer.current)
    timer.current = setTimeout(() => { timer.current = undefined; onCommit(n) }, 350)
  }
  // Leaving the box saves it now: switching match tab unmounts this, and a
  // pending digit would go with it.
  const flush = () => {
    if (timer.current === undefined) return
    clearTimeout(timer.current)
    timer.current = undefined
    onCommit(Math.min(MAX_POINT, Number(raw || 0)))
  }
  return (
    <input className="lu-pt" type="text" inputMode="numeric" placeholder="–"
      value={raw} aria-label={label} autoComplete="off"
      onChange={e => type(e.target.value)} onBlur={flush} />
  )
}

/**
 * When a day was played, taken from the first partai actually started on it, so
 * a sheet downloaded weeks later still carries the day's own date. Nothing
 * started yet means the sheet is being printed to fill in, so: today.
 */
function dayDate(b: Bracket, day: Day) {
  const started = (Object.keys(DAY) as BracketKey[])
    .filter(k => DAY[k] === day)
    .flatMap(k => b.results?.[k] ?? [])
    .map(r => r?.started)
    .filter((n): n is number => !!n)
  return new Date(started.length ? Math.min(...started) : Date.now())
}

/** "29th", the way the paper sheet writes the date. */
function ordinal(d: number) {
  if (d % 100 >= 11 && d % 100 <= 13) return `${d}th`
  return `${d}${['th', 'st', 'nd', 'rd'][d % 10] ?? 'th'}`
}

/**
 * The match drawn as the paper scoresheet used at the hall: white, black ink,
 * a shield either side of the title, the two teams' names flanking the score
 * column, the tie total underneath and an empty tie-breaker row.
 *
 * It is one sheet for two moments — printed blank before play and shared filled
 * in afterwards — so a partai with no points leaves its cells empty instead of
 * drawing a 0 – 0 that never happened.
 */
async function exportPNG(o: {
  label: string
  day: Day
  date: Date
  sides: Side[]
  results: PartaiResult[]
  score?: Score
  tiebreak?: TeamId
  extra?: Extra
}) {
  await document.fonts.ready  // Inter must be loaded or the canvas falls back

  const PAD = 36, NAME = 236, WIN = 68, SCORE = 190
  const TW = NAME * 2 + WIN * 2 + SCORE
  const W = TW + PAD * 2
  const LOGO = 78, HEAD = 36, LINE = 31, ROW = LINE * 2
  const TOP = 154                                   // under the title block
  const TABLE = HEAD + PARTAI.length * ROW
  const SUM_Y = TOP + TABLE + 20, SUM_H = 104
  const TIE_Y = SUM_Y + SUM_H + 34, TIE_H = ROW     // label sits above the box
  const H = TIE_Y + TIE_H + PAD
  const SCALE = 2                                   // retina-sharp when zoomed on a phone

  const INK = '#111111'
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const g = canvas.getContext('2d')!
  g.scale(SCALE, SCALE)
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, W, H)
  g.fillStyle = INK
  g.strokeStyle = INK
  g.textBaseline = 'middle'

  const rule = (x1: number, y1: number, x2: number, y2: number, lw = 1.1) => {
    g.lineWidth = lw
    g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke()
  }
  const box = (x: number, y: number, w: number, h: number, lw = 1.8) => {
    g.lineWidth = lw
    g.strokeRect(x, y, w, h)
  }
  const mid = (s: string, x: number, y: number, font: string, max?: number) => {
    g.font = font; g.textAlign = 'center'; g.fillText(s, x, y, max)
  }
  // Drawn rather than typed: a ✓ glyph is not guaranteed in every Inter build.
  const tick = (x: number, y: number) => {
    g.lineWidth = 3.4; g.lineCap = 'round'; g.lineJoin = 'round'
    g.beginPath()
    g.moveTo(x - 11, y + 1); g.lineTo(x - 3, y + 10); g.lineTo(x + 12, y - 10)
    g.stroke()
    g.lineWidth = 1; g.lineCap = 'butt'
  }

  // ── Title block ──
  try {
    const logo = new Image()
    logo.src = encodeURI('/Logo PB SOR.png')
    await logo.decode()
    g.drawImage(logo, PAD + 8, 26, LOGO, LOGO)
    g.drawImage(logo, W - PAD - 8 - LOGO, 26, LOGO, LOGO)
  } catch { /* no logo file: the sheet reads fine without the shields */ }

  const cx = W / 2
  const when = `${o.date.toLocaleDateString('en-GB', { weekday: 'long' })}, `
    + `${ordinal(o.date.getDate())} `
    + `${o.date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}`
  mid(`INTERNAL MATCH DAY ${o.day}`, cx, 46, '700 23px Inter, sans-serif')
  mid('PB SOR', cx, 79, '800 33px Inter, sans-serif')
  mid('3RD YEAR ANNIVERSARY', cx, 107, '700 21px Inter, sans-serif')
  mid(when, cx, 131, '500 14px Inter, sans-serif')

  // ── Results table ──
  const X = [PAD, PAD + NAME, PAD + NAME + WIN, PAD + NAME + WIN + SCORE, PAD + TW - NAME, PAD + TW]
  const cell = (i: number) => (X[i] + X[i + 1]) / 2
  const rowsY = TOP + HEAD

  // The winner's half of a row, washed grey. Laid down before the rules so the
  // lines stay on top of it: courtside the ticks are small, and the eye should
  // land on who won before it finds the right column.
  const wash = (j: number, y: number, h: number) => {
    g.fillStyle = '#ededed'
    g.fillRect(j ? X[3] : X[0], y, j ? X[5] - X[3] : X[2] - X[0], h)
    g.fillStyle = INK
  }
  PARTAI.forEach((_, p) => {
    const w = partaiWinner(o.results[p])
    if (w !== undefined) wash(w, rowsY + p * ROW, ROW)
  })
  const tieWon = o.sides.findIndex(s => s.team === o.tiebreak)
  if (tieWon >= 0) wash(tieWon, TIE_Y, TIE_H)

  box(PAD, TOP, TW, TABLE)
  for (let i = 1; i <= 4; i++) rule(X[i], TOP, X[i], TOP + TABLE, 1.4)
  rule(PAD, rowsY, PAD + TW, rowsY, 1.8)

  const headFont = '700 15px Inter, sans-serif'
  mid(o.sides[0].name.toUpperCase(), cell(0), TOP + HEAD / 2, headFont, NAME - 14)
  mid('WIN', cell(1), TOP + HEAD / 2, headFont)
  mid('SCORE RESULTS', cell(2), TOP + HEAD / 2, headFont)
  mid('WIN', cell(3), TOP + HEAD / 2, headFont)
  mid(o.sides[1].name.toUpperCase(), cell(4), TOP + HEAD / 2, headFont, NAME - 14)

  PARTAI.forEach((_, p) => {
    const y = rowsY + p * ROW
    const r = o.results[p]
    const won = partaiWinner(r)
    // A partai is two names deep but one result wide, so the light rule between
    // the names stops at the WIN column, exactly as the printed sheet does.
    rule(X[0], y + LINE, X[1], y + LINE, 0.7)
    rule(X[4], y + LINE, X[5], y + LINE, 0.7)
    if (p < PARTAI.length - 1) rule(X[0], y + ROW, X[5], y + ROW, 1.4)

    o.sides.forEach((s, j) => {
      [0, 1].forEach(k => {
        const m = s.members.find(x => x.id === s.slots[p * 2 + k])
        const label = m ? m.name.toUpperCase() : s.slots[p * 2 + k] === WO ? 'WO' : ''
        mid(label, cell(j ? 4 : 0), y + LINE * k + LINE / 2, '600 15px Inter, sans-serif', NAME - 14)
      })
      if (won === j) tick(cell(j ? 3 : 1), y + ROW / 2)
    })
    if (r?.score) {
      mid(`${r.score[0]} - ${r.score[1]}`, cell(2), y + ROW / 2, '800 24px Inter, sans-serif')
    }
  })

  // ── Tie total ──
  const SUM_SPLIT = SUM_Y + 40
  box(PAD, SUM_Y, TW, SUM_H)
  rule(PAD, SUM_SPLIT, PAD + TW, SUM_SPLIT, 1.4)
  const lx = PAD + TW * 0.24, rx = PAD + TW * 0.76
  mid(o.sides[0].name.toUpperCase(), lx, SUM_Y + 20, '700 21px Inter, sans-serif', TW * 0.4)
  mid('vs', cx, SUM_Y + 20, '500 17px Inter, sans-serif')
  mid(o.sides[1].name.toUpperCase(), rx, SUM_Y + 20, '700 21px Inter, sans-serif', TW * 0.4)
  mid(String(o.score?.[0] ?? ''), lx, SUM_SPLIT + 32, '800 38px Inter, sans-serif')
  mid('-', cx, SUM_SPLIT + 32, '500 22px Inter, sans-serif')
  mid(String(o.score?.[1] ?? ''), rx, SUM_SPLIT + 32, '800 38px Inter, sans-serif')

  // ── Tie breaker: the extra partai, or an empty row to fill by hand ──
  g.textAlign = 'left'
  g.font = '700 15px Inter, sans-serif'
  g.fillText('TIE BREAKER:', PAD, TIE_Y - 16)
  box(PAD, TIE_Y, TW, TIE_H)
  for (let i = 1; i <= 4; i++) rule(X[i], TIE_Y, X[i], TIE_Y + TIE_H, 1.4)
  o.sides.forEach((s, j) => {
    rule(X[j ? 4 : 0], TIE_Y + LINE, X[j ? 5 : 1], TIE_Y + LINE, 0.7)
    ;[0, 1].forEach(k => {
      const m = s.members.find(x => x.id === o.extra?.players?.[j * 2 + k])
      mid(m ? m.name.toUpperCase() : '', cell(j ? 4 : 0),
        TIE_Y + LINE * k + LINE / 2, '600 15px Inter, sans-serif', NAME - 14)
    })
    if (o.tiebreak && o.tiebreak === s.team) tick(cell(j ? 3 : 1), TIE_Y + TIE_H / 2)
  })
  const xs = o.extra?.score
  mid(xs ? `${xs[0]} - ${xs[1]}` : '-', cell(2), TIE_Y + TIE_H / 2,
    xs ? '800 24px Inter, sans-serif' : '500 18px Inter, sans-serif')

  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `pbsor-day${o.day}-${o.label.replace(/\s/g, '').toLowerCase()}`
    + `-${o.date.toLocaleDateString('en-CA')}.png`
  a.click()
}

import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Bracket, BracketKey, PartaiResult, Slot, TeamId, TourPlayer, TournamentState,
} from '../types'
import {
  COURTS, DAY, EMPTY_BRACKET, LEVELS, LEVEL_CLASS, MAX_POINT, OTHER, PARTAI, SLOTS, WO,
  isHere, lineupOf, loadTournament, officials, partaiWinner, ready, resolve, setPartai, setSlot,
  tally,
} from '../internalMatch'
import { TOURNAMENT_ID, supabase, upsertTournament } from '../supabase'
import { useCaptainTeam, useIsAdmin } from '../RoleContext'
import { LEVEL_COLOR } from './InternalMatch'

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
  const [open, setOpen] = useState<number | null>(null)   // expanded partai
  const [openAll, setOpenAll] = useState(false)           // every partai's panel at once
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

  // ponytail: whole-blob write per edit, same last-write-wins as the other
  // internal pages. Every control here is a select or a blur, so no debounce.
  const save = async (next: TournamentState) => {
    await qc.cancelQueries({ queryKey: ['tournament'] })  // an in-flight refetch would undo this edit
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
  }
  const pick = (s: Side, i: number, v: Slot) => save({
    ...state,
    lineups: { ...state.lineups, [s.team]: { ...state.lineups?.[s.team], [day]: setSlot(s.slots, i, v) } },
  })
  const editPartai = (i: number, patch: Partial<PartaiResult>) =>
    save({ ...state, bracket: setPartai(b, match, i, patch) })

  return (
    <section className="ws-section">
      <div className="ws-head">
        <div className="ws-head-l">
          <h2>Line-up</h2>
          <span className="ws-head-sub">
            {isAdmin || captain
              ? 'Tampil ke semua setelah kedua tim lengkap: pemain yang sudah hadir, atau WO.'
              : 'Susunan pemain tiap partai'}
          </span>
        </div>
      </div>

      <div className="im-segmented im-tabs" role="tablist" aria-label="Pertandingan">
        {MATCHES.map(([k, l]) => (
          <button key={k} role="tab" aria-selected={match === k}
            className={`im-seg${match === k ? ' on' : ''}`}
            onClick={() => { setMatch(k); setOpen(null) }}>
            <span className="im-tab-label">{l}</span>
          </button>
        ))}
      </div>

      {!sides ? <div className="im-empty">Menunggu hasil semifinal.</div>
        // Viewers see nothing until both sides are in, so neither captain can
        // counter-pick. ponytail: hidden in the UI only — the row is public,
        // real secrecy needs its own RLS-guarded table.
        : !canSee
          ? <div className="im-empty">
              Line-up belum lengkap · {sides.map(s => `${s.name} ${ready(s.slots, s.here)}/${SLOTS.length}`).join(' · ')}
            </div>
          : <>
              <div className="im-controls">
                {isAdmin && (
                  <button className="btn btn-ghost btn-sm" disabled={!complete}
                    onClick={() => exportPNG(label, sides)}>Export PNG</button>
                )}
                {/* All ten partai as one list, to fill lapangan/poin/petugas in
                    one pass before play starts. */}
                <button className={`btn btn-ghost btn-sm${openAll ? ' on' : ''}`}
                  aria-pressed={openAll}
                  onClick={() => { setOpenAll(v => !v); setOpen(null) }}>
                  {openAll ? 'Tutup semua' : 'Buka semua'}
                </button>
                {(isAdmin || captain) && (
                  /* Grade is fixed per slot; this opens the other grades for a
                     stand-in when someone is hurt or missing. */
                  <button className={`btn btn-ghost btn-sm${anyLevel ? ' on' : ''}`}
                    aria-pressed={anyLevel} onClick={() => setAnyLevel(v => !v)}>
                    {anyLevel ? 'Batasi ke grade' : 'Pemain lain'}
                  </button>
                )}
              </div>

              <div className="lu-wrap">
                <table className="lu">
                  <colgroup><col className="lu-c0" /><col /><col /></colgroup>
                  <thead>
                    <tr>
                      <th aria-label="Partai" />
                      {sides.map((s, j) => (
                        <th key={s.team} scope="col">
                          <span className="lu-team">{s.name}</span>
                          <span className="lu-head-n">
                            {score && <span className="lu-score">{score[j]}</span>}
                            {(isAdmin || captain) && (
                              <span className={`lu-count${ready(s.slots, s.here) === SLOTS.length ? ' ok' : ''}`}>
                                {ready(s.slots, s.here)}/{SLOTS.length}
                              </span>
                            )}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>

                  {PARTAI.map((levels, p) => {
                    const r = results[p]
                    const won = partaiWinner(r)
                    return (
                      <tbody key={p}>
                        <tr>
                          <th scope="row">
                            {levels.map((l, k) => (
                              <div key={k} className="lu-line">
                                <span className="lu-num">{k === 0 ? p + 1 : ''}</span>
                                <span className={`lvl-badge ${LEVEL_CLASS[l]}`}>{l}</span>
                              </div>
                            ))}
                          </th>
                          {sides.map((s, j) => (
                            <td key={s.team} className={won === j ? 'win' : won === undefined ? '' : 'lose'}>
                              {levels.map((_, k) => (
                                <SlotCell key={k} side={s} i={p * 2 + k} anyLevel={anyLevel}
                                  canEdit={isAdmin || mine(s)} won={won === j && k === 0}
                                  onPick={v => pick(s, p * 2 + k, v)} />
                              ))}
                            </td>
                          ))}
                        </tr>
                        <tr className="lu-meta-row">
                          <td colSpan={3}>
                            <button className="lu-meta" aria-expanded={openAll || open === p}
                              onClick={() => setOpen(open === p ? null : p)}>
                              <span className="lu-meta-txt">{metaLine(r, state, sides, won)}</span>
                              <span className="lu-meta-caret" aria-hidden>{openAll || open === p ? '▴' : '▾'}</span>
                            </button>
                          </td>
                        </tr>
                        {(openAll || open === p) && (
                          <tr className="lu-panel-row">
                            <td colSpan={3}>
                              <PartaiPanel
                                r={r} p={p} isAdmin={isAdmin} state={state} day={day} pair={pair}
                                clash={!!r?.court && b.results?.[OTHER[match]]?.[p]?.court === r.court}
                                sides={sides}
                                onEdit={patch => editPartai(p, patch)}
                              />
                            </td>
                          </tr>
                        )}
                      </tbody>
                    )
                  })}
                </table>
              </div>
            </>}
    </section>
  )
}

/** The one-line summary under a partai: court, points, winner, wasit. */
function metaLine(r: PartaiResult | undefined, state: TournamentState, sides: Side[], won?: 0 | 1) {
  const name = (id?: string) => state.players.find(p => p.id === id)?.name
  const bits = [
    `Lap ${r?.court ?? '–'}`,
    r?.score ? `${r.score[0]} – ${r.score[1]}` : 'belum ada poin',
  ]
  if (won !== undefined) bits.push(`✓ ${sides[won].name}`)
  bits.push(`W: ${name(r?.wasit) ?? '–'}`)
  return bits.join(' · ')
}

function SlotCell({ side, i, canEdit, anyLevel, won, onPick }: {
  side: Side
  i: number
  canEdit: boolean
  anyLevel: boolean
  won: boolean
  onPick: (v: Slot) => void
}) {
  const v = side.slots[i]
  const level = SLOTS[i]
  const p = side.members.find(m => m.id === v)

  if (side.masked) return <div className="lu-line"><span className="lu-name hid">—</span></div>

  const sub = p && p.level !== level && (
    <span className="lu-sub" title={`${p.level} main di slot ${level}`}>⚠{p.level}</span>
  )

  if (!canEdit) {
    return (
      <div className="lu-line">
        {won && <span className="lu-win" aria-label="Menang">✓</span>}
        {v === WO
          ? <span className="lu-name wo">WO</span>
          : <span className="lu-name">{p?.name}</span>}
        {sub}
      </div>
    )
  }

  // Where each teammate already plays, so picking one visibly moves them.
  const where = (id: string) => {
    const j = side.slots.indexOf(id)
    return j >= 0 && j !== i ? ` · P${(j >> 1) + 1}` : ''
  }
  // The closed select shows the picked option's label, so a no-show's own
  // label is what flags them in the table.
  const opt = (m: TourPlayer) => (
    <option key={m.id} value={m.id}>
      {m.name}{m.level !== level ? ` (${m.level})` : ''}
      {side.here.has(m.id) ? '' : ' · belum hadir'}{where(m.id)}
    </option>
  )
  // Grade-only unless the admin opened it up: the slot's grade is the format.
  const eligible = side.members.filter(m => anyLevel || m.level === level || m.id === v)
  const here = eligible.filter(m => side.here.has(m.id))
  const away = p && !side.here.has(p.id)
  return (
    <div className="lu-line">
      {won && <span className="lu-win" aria-label="Menang">✓</span>}
      <select className={`lu-pick${v ? '' : ' empty'}${away ? ' away' : ''}`} value={v ?? ''}
        aria-label={`${side.name} partai ${(i >> 1) + 1} (${level})`}
        onChange={e => onPick(e.target.value || null)}>
        <option value="">–</option>
        <optgroup label={anyLevel ? 'Sudah hadir' : level}>
          {here.filter(m => m.level === level).map(opt)}
          {anyLevel && here.filter(m => m.level !== level).map(opt)}
        </optgroup>
        <optgroup label="Belum hadir">
          {eligible.filter(m => !side.here.has(m.id)).map(opt)}
        </optgroup>
        <option value={WO}>WO (walkover)</option>
      </select>
      {sub}
    </div>
  )
}

/** Court, points and officials for one partai. Admin-only to edit. */
function PartaiPanel({ r, p, isAdmin, state, day, pair, clash, sides, onEdit }: {
  r?: PartaiResult
  p: number
  isAdmin: boolean
  state: TournamentState
  day: 1 | 2
  pair: (TeamId | undefined)[]
  clash: boolean
  sides: Side[]
  onEdit: (patch: Partial<PartaiResult>) => void
}) {
  const crew = officials(state, pair, day)
  const name = (id?: string) => state.players.find(x => x.id === id)?.name ?? '–'
  const lines = r?.lines ?? []

  if (!isAdmin) {
    return (
      <dl className="lu-panel">
        <div><dt>Lapangan</dt><dd>{r?.court ?? '–'}</dd></div>
        <div><dt>Poin</dt><dd>{r?.score ? `${r.score[0]} – ${r.score[1]}` : '–'}</dd></div>
        <div><dt>Wasit</dt><dd>{name(r?.wasit)}</dd></div>
        <div><dt>Linesman</dt><dd>{[0, 1].map(i => name(lines[i])).join(' · ')}</dd></div>
      </dl>
    )
  }

  const setCrew = (v: string, slot: 'wasit' | 0 | 1) => {
    if (slot === 'wasit') return onEdit({ wasit: v || undefined })
    const next = [...lines]
    next[slot] = v
    onEdit({ lines: next.filter(Boolean) as string[] })
  }
  const crewSelect = (value: string | undefined, label: string, slot: 'wasit' | 0 | 1) => (
    <select className="lu-in" value={value ?? ''} aria-label={`${label} partai ${p + 1}`}
      onChange={e => setCrew(e.target.value, slot)}>
      <option value="">–</option>
      {[...new Set(crew.map(c => c.team!))].map(t => (
        <optgroup key={t} label={state.teamNames[t]}>
          {crew.filter(c => c.team === t).map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </optgroup>
      ))}
    </select>
  )

  return (
    <dl className="lu-panel">
      <div>
        <dt>Lapangan</dt>
        <dd>
          <select className={`lu-in${clash ? ' away' : ''}`} value={r?.court ?? ''}
            aria-label={`Lapangan partai ${p + 1}`}
            title={clash ? 'Lapangan ini dipakai partai yang sama di pertandingan satunya' : undefined}
            onChange={e => onEdit({ court: Number(e.target.value) || undefined })}>
            <option value="">–</option>
            {COURTS.map(c => <option key={c} value={c}>Lapangan {c}</option>)}
          </select>
        </dd>
      </div>
      <div>
        <dt>Poin</dt>
        <dd className="lu-points">
          {sides.map((s, j) => (
            <PointBox key={s.team} value={r?.score?.[j]} label={`Poin ${s.name} partai ${p + 1}`}
              onCommit={n => {
                const other = r?.score?.[1 - j] ?? 0
                onEdit({ score: (j === 0 ? [n, other] : [other, n]) as [number, number] })
              }} />
          ))}
        </dd>
      </div>
      <div><dt>Wasit</dt><dd>{crewSelect(r?.wasit, 'Wasit', 'wasit')}</dd></div>
      <div>
        <dt>Linesman</dt>
        <dd className="lu-points">
          {crewSelect(lines[0], 'Linesman 1', 0)}
          {crewSelect(lines[1], 'Linesman 2', 1)}
        </dd>
      </div>
    </dl>
  )
}

/**
 * A points box that saves when you leave it, not on every keystroke — typing
 * "21" would otherwise write a 2 first. Remounts when the stored value changes,
 * so another device's entry shows up here too.
 */
function PointBox({ value, label, onCommit }: {
  value?: number
  label: string
  onCommit: (n: number) => void
}) {
  const commit = (raw: string) => {
    const n = Math.round(Number(raw))
    onCommit(Number.isFinite(n) ? Math.min(MAX_POINT, Math.max(0, n)) : 0)
  }
  return (
    <input key={String(value ?? '')} className="lu-in lu-point" type="number"
      inputMode="numeric" min={0} max={MAX_POINT} defaultValue={value ?? ''} aria-label={label}
      onBlur={e => commit(e.target.value)}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}

/** The selected match's lineup as one image, for the group chat. */
async function exportPNG(label: string, sides: Side[]) {
  await document.fonts.ready  // Inter must be loaded or the canvas falls back
  const PAD = 24, TITLE = 56, HEAD = 40, LINE = 26, ROW = LINE * 2 + 12
  const NUM = 30, LV = 60, COL = 240, GAP = 10
  const W = PAD * 2 + NUM + LV + COL * 2 + GAP
  const H = TITLE + HEAD + PARTAI.length * ROW + PAD
  const SCALE = 2  // retina-sharp when zoomed on a phone

  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = H * SCALE
  const g = canvas.getContext('2d')!
  g.scale(SCALE, SCALE)
  g.textBaseline = 'middle'
  g.fillStyle = '#0e0e0e'
  g.fillRect(0, 0, W, H)

  g.fillStyle = '#e5e2e1'
  g.font = '800 22px Inter, sans-serif'
  g.fillText(`Line-up · ${label}`, PAD, PAD + 14)

  const colX = (j: number) => PAD + NUM + LV + j * (COL + GAP)
  sides.forEach((s, j) => {
    g.fillStyle = '#adc7ff'
    g.fillRect(colX(j), TITLE, COL, HEAD)
    g.fillStyle = '#0A0800'
    g.font = '800 16px Inter, sans-serif'
    g.fillText(s.name, colX(j) + 12, TITLE + HEAD / 2, COL - 24)
  })

  PARTAI.forEach((levels, p) => {
    const y = TITLE + HEAD + p * ROW
    if (p % 2 === 0) {
      g.fillStyle = '#131313'
      g.fillRect(PAD, y, W - PAD * 2, ROW)
    }
    g.fillStyle = '#8b90a0'
    g.font = '800 14px "JetBrains Mono", monospace'
    g.fillText(String(p + 1), PAD + 6, y + 6 + LINE / 2)

    levels.forEach((lv, k) => {
      const cy = y + 6 + LINE * k + LINE / 2
      g.fillStyle = LEVEL_COLOR[lv]
      g.font = '800 11px Inter, sans-serif'
      g.fillText(lv, PAD + NUM, cy)

      sides.forEach((s, j) => {
        const m = s.members.find(x => x.id === s.slots[p * 2 + k])
        g.fillStyle = m ? '#e5e2e1' : '#8b90a0'
        g.font = `${m ? '' : 'italic '}600 14px Inter, sans-serif`
        // maxWidth squeezes an overlong name instead of spilling into the badge
        g.fillText(m ? m.name : 'WO', colX(j) + 12, cy, COL - 70)
        if (m && m.level !== lv) {
          g.fillStyle = '#FFB020'
          g.font = '800 11px Inter, sans-serif'
          g.textAlign = 'right'
          g.fillText(`⚠${m.level}`, colX(j) + COL - 12, cy)
          g.textAlign = 'left'
        }
      })
    })
  })

  const a = document.createElement('a')
  a.href = canvas.toDataURL('image/png')
  a.download = `pbsor-lineup-${label.replace(/\s/g, '').toLowerCase()}-${new Date().toLocaleDateString('en-CA')}.png`
  a.click()
}

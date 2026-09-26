import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  Acara, Bracket, BracketKey, Day, Drag, Rundown, Slot, TeamId, TourPlayer, TournamentState,
} from '../types'
import {
  EMPTY_BRACKET, LEVEL_CLASS, PARTAI, SLOTS, STEP, WO,
  acaraOf, clock, isHere, lineupOf, loadTournament, mins, nextAcaraStart, partaiTimes,
  COURTS, PARTAI_MIN, dragDelta, editAcara, lanes, partaiWinner, playEnd, ready, resolve,
  rundownOf, setPartai, shift, snapTime,
} from '../internalMatch'
import { TOURNAMENT_ID, supabase, upsertTournament } from '../supabase'
import { useCaptainTeam, useIsAdmin } from '../RoleContext'

const DAYS: Day[] = [1, 2]
const KEYS: Record<Day, [BracketKey, BracketKey]> = { 1: ['sf1', 'sf2'], 2: ['final', 'third'] }
const LABEL: Record<BracketKey, string> = { sf1: 'SF 1', sf2: 'SF 2', final: 'Final', third: 'Juara 3' }

// A line every quarter hour is a reading aid; times snap to STEP (5 minutes).
const LINE = 15

const floorH = (m: number) => Math.floor(m / 60) * 60
const ceilH = (m: number) => Math.ceil(m / 60) * 60
const nowMin = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes() }

// What a double-clicked block edits.
type Target =
  | { kind: 'acara'; d: Day; i: number }
  | { kind: 'partai'; d: Day; p: number; k: BracketKey }

type Side = {
  team: TeamId
  name: string
  slots: Slot[]
  members: TourPlayer[]
  here: Set<string>
  masked: boolean   // opponent's line-up, still hidden from this viewer
}

export function InternalRundown() {
  const isAdmin = useIsAdmin()
  const captain = useCaptainTeam()
  const qc = useQueryClient()
  const [edit, setEdit] = useState(false)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [form, setForm] = useState<Target | null>(null)   // double-clicked block
  const [now, setNow] = useState(nowMin())
  const grabY = useRef(0)

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    refetchInterval: 60_000,  // fallback in case the Realtime socket drops
  })

  // Same scope as the other internal pages: writes land in the order made.
  const mut = useMutation({ mutationFn: upsertTournament, scope: { id: 'tournament' } })

  // Realtime: an admin moving tumpengan shows up on every open phone.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('tournament-rundown')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${TOURNAMENT_ID}` },
        () => { if (!qc.isMutating()) qc.invalidateQueries({ queryKey: ['tournament'] }) },
      )
      .subscribe()
    return () => { supabase?.removeChannel(channel) }
  }, [qc])

  useEffect(() => {
    const id = setInterval(() => setNow(nowMin()), 60_000)
    return () => clearInterval(id)
  }, [])

  if (!state) return <div className="im-loading">Memuat jadwal…</div>

  const saved = rundownOf(state)
  // A drag renders from a shifted copy, so the partai visibly slide with the
  // acara being dragged; only the release writes.
  const r = drag ? shift(saved, drag) : saved
  const b: Bracket = { ...EMPTY_BRACKET, ...state.bracket }
  const { pairs } = resolve(b)
  // Each day's partai, already pushed past that day's acara.
  const times: Record<Day, number[]> = { 1: partaiTimes(r, 1), 2: partaiTimes(r, 2) }
  const ends: Record<Day, number> = { 1: playEnd(r, 1), 2: playEnd(r, 2) }

  // The grid spans everything on it, so editing a time can never push an event
  // off the top or bottom. Measured from the saved times, not the dragged ones:
  // a grid that re-bounds mid-drag would slide out from under the cursor.
  const all = DAYS.flatMap(d => acaraOf(saved, d))
  const T0 = floorH(Math.min(mins(saved.start), ...all.map(a => mins(a.start))))
  const T1 = ceilH(Math.max(...DAYS.map(d => playEnd(saved, d)), ...all.map(a => mins(a.end))))
  // ponytail: enough px/min that a 20-minute block fits its three lines, instead
  // of a second font scale for the tight case.
  const PX = 72 / PARTAI_MIN
  const y = (m: number) => (m - T0) * PX
  const lines = Array.from({ length: (T1 - T0) / LINE + 1 }, (_, i) => T0 + i * LINE)

  // ponytail: whole-blob write per edit, same last-write-wins as the other
  // internal pages. Every control is a select, a time picker or a blur.
  const save = async (next: TournamentState) => {
    await qc.cancelQueries({ queryKey: ['tournament'] })
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
  }
  const saveRundown = (next: Rundown) => save({ ...state, rundown: next })
  const setAcara = (d: Day, i: number, patch: Partial<Acara>) => saveRundown({
    ...r,
    acara: { ...r.acara, [d]: acaraOf(r, d).map((a, j) => (j === i ? editAcara(a, patch) : a)) },
  })
  const addAcara = (d: Day) => {
    const list = acaraOf(r, d)
    const start = nextAcaraStart(r, list)
    saveRundown({
      ...r,
      acara: { ...r.acara, [d]: [...list, { start: clock(start), end: clock(start + 30), title: 'Acara' }] },
    })
  }
  const delAcara = (d: Day, i: number) =>
    saveRundown({ ...r, acara: { ...r.acara, [d]: acaraOf(r, d).filter((_, j) => j !== i) } })

  // A match edit touches the rundown (its kickoff) and the bracket (its court),
  // so both go in one write. A null kickoff drops the override.
  const savePartai = (t: Extract<Target, { kind: 'partai' }>, start: string | null, court?: number) => {
    const day = { ...r.starts?.[t.d] }
    if (start === null) delete day[t.p]
    else day[t.p] = start
    save({
      ...state,
      rundown: { ...r, starts: { ...r.starts, [t.d]: day } },
      bracket: setPartai(b, t.k, t.p, { court }),
    })
    setForm(null)
  }

  // Drag an acara to move it, or its bottom edge to stretch it. Pointer events
  // cover mouse and touch in one path, and pointer capture means no
  // window-level listeners to clean up.
  const canDrag = isAdmin
  const grab = (d: Day, i: number, edge: boolean) => (e: React.PointerEvent) => {
    if (!canDrag) return
    // No preventDefault: it suppresses the compatibility mouse events, and with
    // them the dblclick that opens the form. user-select/touch-action in the CSS
    // already stop text selection and page scroll.
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    grabY.current = e.clientY
    setDrag({ d, i, minutes: 0, edge })
  }
  // Raw minutes, so the block tracks the cursor; only the 5-minute rounding of
  // it reaches the times and the save.
  const move = (e: React.PointerEvent) => {
    if (drag) setDrag({ ...drag, minutes: (e.clientY - grabY.current) / PX })
  }
  const drop = () => {
    if (!drag) return
    if (dragDelta(drag)) saveRundown(shift(saved, drag))
    setDrag(null)
  }

  // One column per match: its two sides' line-ups, filtered to who checked in
  // that day on /internal/absen — same masking rule as the Line-up page, so the
  // rundown can't leak a team's picks before both sides are in.
  const column = (k: BracketKey, day: Day) => {
    const pair = pairs[k]
    const sides = pair.every(Boolean) ? (pair as TeamId[]).map((t): Side => {
      const members = state.players.filter(p => !p.external && p.team === t)
      return {
        team: t, members,
        name: state.teamNames[t],
        slots: lineupOf(state, t, day),
        here: new Set(members.filter(p => isHere(p, day)).map(p => p.id)),
        masked: false,
      }
    }) : null
    const complete = !!sides && sides.every(s => ready(s.slots, s.here) === SLOTS.length)
    if (sides && !complete && !isAdmin) sides.forEach(s => { s.masked = captain !== s.team })
    return { k, sides, complete }
  }

  return (
    <section className="ws-section">
      <div className="ws-head">
        <div className="ws-head-l">
          <h2>Jadwal</h2>
          <span className="ws-head-sub">
            Perkiraan {PARTAI_MIN} menit per partai · acara menggeser jadwal partai
          </span>
        </div>
        <span className="ws-pill">{clock(now)}</span>
      </div>

      {isAdmin && (
        <div className="im-controls">
          <button className={`btn btn-ghost btn-sm${edit ? ' on' : ''}`} aria-pressed={edit}
            onClick={() => setEdit(v => !v)}>{edit ? 'Selesai ubah' : 'Ubah jadwal'}</button>
          <span className="rd-edit-note">
            Geser blok acara untuk memindah · tepi bawahnya untuk memanjangkan · klik dua kali untuk ubah jam
          </span>
        </div>
      )}

      {isAdmin && edit && (
        <div className="rd-edit">
          <div className="rd-edit-row">
            <label className="rd-f">
              <span>Mulai partai</span>
              <TimeBox value={r.start} label="Mulai partai"
                onCommit={t => saveRundown({ ...r, start: t })} />
            </label>
            <span className="rd-edit-note">
              {PARTAI.length} x {PARTAI_MIN} menit · selesai hari 1 {clock(ends[1])} · hari 2 {clock(ends[2])}
            </span>
          </div>

          {DAYS.map(d => (
            <div key={d} className="rd-edit-day">
              <div className="rd-edit-head">Acara hari {d}</div>
              {acaraOf(r, d).map((a, i) => (
                <div key={i} className="rd-edit-row">
                  <TimeBox value={a.start} label="Mulai" cls="rd-t"
                    onCommit={t => setAcara(d, i, { start: t })} />
                  <TimeBox value={a.end} label="Selesai" cls="rd-t"
                    onCommit={t => setAcara(d, i, { end: t })} />
                  {/* Commits on blur, not per keystroke — one write per rename. */}
                  <input key={a.title} className="lu-in" defaultValue={a.title} aria-label="Nama acara"
                    placeholder="Nama acara"
                    onBlur={e => e.target.value.trim() && setAcara(d, i, { title: e.target.value.trim() })}
                    onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
                  <button className="icon-btn" aria-label={`Hapus ${a.title}`}
                    onClick={() => delAcara(d, i)}>×</button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={() => addAcara(d)}>+ Tambah acara</button>
            </div>
          ))}
        </div>
      )}

      <div className="rd-grid">
        <div className="rd-gutter">
          <div className="rd-pad" />
          <div style={{ position: 'relative', height: y(T1) }}>
            {lines.filter(m => m % 60 === 0).map(m => (
              <div key={m} className="rd-hour" style={{ top: y(m) }}>{clock(m)}</div>
            ))}
          </div>
        </div>

        {DAYS.map(d => {
          const cols = KEYS[d].map(k => column(k, d))
          return (
            <div key={d} className="rd-day">
              <div className="rd-head">
                <div className="rd-head-day">
                  Hari {d} <span className="rd-head-win">{clock(times[d][0])}–{clock(ends[d])}</span>
                </div>
                <div className="rd-head-cols">
                  {cols.map(c => (
                    <div key={c.k} className="rd-head-col">
                      <span className="rd-head-k">{LABEL[c.k]}</span>
                      <span className="rd-head-v">
                        {c.sides ? c.sides.map(s => s.name).join(' vs ') : 'menunggu SF'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rd-body" style={{ height: y(T1) }}>
                {lines.map(m => (
                  <div key={m} className={`rd-line${m % 60 ? ' q' : ''}`} style={{ top: y(m) }} />
                ))}
                {now >= T0 && now <= T1 && <div className="rd-now" style={{ top: y(now) }} />}

                {acaraOf(r, d).map((a, i, list) => {
                  const held = drag?.d === d && drag.i === i
                  const { lane, of } = lanes(list)[i]
                  // The part of the drag the snap threw away, so the block stays
                  // under the cursor while its label reads the time it will save.
                  const off = held ? (drag!.minutes - dragDelta(drag!)) * PX : 0
                  const h = Math.max(STEP, mins(a.end) - mins(a.start)) * PX
                  return (
                    <div key={i} className={`rd-ev acara${canDrag ? ' grabbable' : ''}${held ? ' held' : ''}`}
                      style={{
                        top: y(mins(a.start)) + (held && !drag!.edge ? off : 0),
                        height: held && drag!.edge ? Math.max(14, h + off) : h,
                        left: `${lane * (100 / of)}%`, width: `${100 / of}%`,
                      }}
                      onPointerDown={grab(d, i, false)} onPointerMove={move}
                      onPointerUp={drop} onPointerCancel={drop}
                      title={isAdmin ? 'Geser untuk pindah · klik dua kali untuk ubah' : undefined}
                      onDoubleClick={() => isAdmin && setForm({ kind: 'acara', d, i })}>
                      <div className="rd-ev-t"><span className="rd-title">{a.title}</span></div>
                      <div className="rd-ev-time">{a.start}–{a.end}</div>
                      {canDrag && <div className="rd-handle" onPointerDown={grab(d, i, true)} />}
                    </div>
                  )
                })}

                {cols.flatMap((c, j) => PARTAI.map((levels, p) => {
                  const from = times[d][p]
                  const res = b.results?.[c.k]?.[p]
                  const won = partaiWinner(res)
                  return (
                    <div key={`${c.k}-${p}`} className="rd-ev match"
                      style={{ top: y(from), height: PARTAI_MIN * PX, left: `${j * 50}%`, width: '50%' }}
                      title={isAdmin ? 'Klik dua kali untuk ubah jam & lapangan' : undefined}
                      onDoubleClick={() => isAdmin && setForm({ kind: 'partai', d, p, k: c.k })}>
                      <div className="rd-ev-t">
                        <span className="rd-p">P{p + 1}</span>
                        {levels.map((l, i) => (
                          <span key={i} className={`lvl-badge ${LEVEL_CLASS[l]}`}>{l}</span>
                        ))}
                        <span className="rd-lap">
                          {clock(from)}{res?.court ? ` · L${res.court}` : ''}
                          {r.starts?.[d]?.[p] ? ' ⏱' : ''}
                        </span>
                      </div>
                      {c.sides
                        ? c.sides.map((s, i) => (
                          <div key={s.team}
                            className={`rd-side${won === i ? ' win' : won === undefined ? '' : ' lose'}`}>
                            <Names side={s} p={p} />
                            {res?.score && <span className="rd-pt">{res.score[i]}</span>}
                          </div>
                        ))
                        : <div className="rd-wait">Menunggu hasil semifinal</div>}
                    </div>
                  )
                }))}
              </div>
            </div>
          )
        })}
      </div>

      {form && (
        <JadwalForm
          target={form} r={r} label={form.kind === 'partai' ? LABEL[form.k] : ''}
          natural={form.kind === 'partai' ? clock(times[form.d][form.p]) : ''}
          court={form.kind === 'partai' ? b.results?.[form.k]?.[form.p]?.court : undefined}
          onClose={() => setForm(null)}
          onSaveAcara={next => { saveRundown(next); setForm(null) }}
          onSavePartai={savePartai}
          onDelete={form.kind === 'acara' ? () => { delAcara(form.d, form.i); setForm(null) } : undefined} />
      )}
    </section>
  )
}

/**
 * The double-click form: an acara's name and times, or one match's kickoff and
 * court. Holds a draft and writes once on Simpan — a modal that saved per
 * keystroke would fight the Batal button. Times step in 5 minutes and are
 * snapped again on save, same as every other time on this page.
 */
function JadwalForm({ target, r, label, natural, court, onClose, onSaveAcara, onSavePartai, onDelete }: {
  target: Target
  r: Rundown
  label: string
  natural: string
  court?: number
  onClose: () => void
  onSaveAcara: (next: Rundown) => void
  onSavePartai: (t: Extract<Target, { kind: 'partai' }>, start: string | null, court?: number) => void
  onDelete?: () => void
}) {
  const acara = target.kind === 'acara' ? acaraOf(r, target.d)[target.i] : undefined
  const set = target.kind === 'partai' ? r.starts?.[target.d]?.[target.p] : undefined
  const [draft, setDraft] = useState<Acara>(acara ?? { start: set ?? natural, end: natural, title: '' })
  const [lap, setLap] = useState(court ?? 0)

  useEffect(() => {
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = '' }
  }, [])

  const bad = !!acara && !draft.title.trim()
  // Editing the start carries the length along, exactly as dragging the block
  // does, so a later start can never leave the end behind it.
  const edit = (patch: Partial<Acara>) => setDraft(acara ? editAcara(draft, patch) : { ...draft, ...patch })
  const submit = () => {
    if (bad) return
    if (target.kind === 'partai') return onSavePartai(target, snapTime(draft.start), lap || undefined)
    onSaveAcara({
      ...r,
      acara: {
        ...r.acara,
        [target.d]: acaraOf(r, target.d).map((a, j) => j !== target.i ? a
          : { start: snapTime(draft.start), end: snapTime(draft.end), title: draft.title.trim() }),
      },
    })
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{acara ? 'Ubah Acara' : `Partai ${(target as { p: number }).p + 1} · ${label}`}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="config-form">
            {acara && (
              <div>
                <label className="config-label" htmlFor="rd-title">Nama acara</label>
                <input id="rd-title" className="config-input" autoFocus value={draft.title}
                  onChange={e => setDraft({ ...draft, title: e.target.value })}
                  onKeyDown={e => { if (e.key === 'Enter') submit() }} />
              </div>
            )}
            <div className="rd-edit-row">
              <div style={{ flex: 1 }}>
                <label className="config-label" htmlFor="rd-from">Mulai</label>
                <input id="rd-from" className="config-input" type="time" step={STEP * 60}
                  value={draft.start} onChange={e => e.target.value && edit({ start: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                {acara ? (
                  <>
                    <label className="config-label" htmlFor="rd-to">Selesai</label>
                    <input id="rd-to" className="config-input" type="time" step={STEP * 60}
                      value={draft.end} onChange={e => e.target.value && edit({ end: e.target.value })} />
                  </>
                ) : (
                  <>
                    <label className="config-label" htmlFor="rd-lap">Lapangan</label>
                    <select id="rd-lap" className="config-input" value={lap}
                      onChange={e => setLap(Number(e.target.value))}>
                      <option value={0}>–</option>
                      {COURTS.map(c => <option key={c} value={c}>Lapangan {c}</option>)}
                    </select>
                  </>
                )}
              </div>
            </div>
            <span className="rd-edit-note" style={{ marginLeft: 0 }}>
              {acara
                ? bad ? 'Nama acara belum diisi.'
                  : 'Panjang acara ikut pindah · jam dibulatkan ke 5 menit · jam partai ikut bergeser'
                : `${PARTAI_MIN} menit · tanpa penundaan mulai ${natural} · partai setelahnya ikut bergeser`}
            </span>
          </div>
        </div>
        <div className="modal-footer">
          <div className="rd-edit-row">
            <button className="btn btn-primary" disabled={bad} onClick={submit}>Simpan</button>
            <button className="btn btn-ghost" onClick={onClose}>Batal</button>
            {onDelete && <button className="btn btn-ghost" style={{ marginLeft: 'auto', color: 'var(--red)' }}
              onClick={onDelete}>Hapus</button>}
            {target.kind === 'partai' && set && (
              <button className="btn btn-ghost" style={{ marginLeft: 'auto' }}
                onClick={() => onSavePartai(target, null, lap || undefined)}>Reset jam</button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/** A side's pair for one partai. A pick who has not checked in shows in red. */
function Names({ side, p }: { side: Side; p: number }) {
  if (side.masked) return <span className="rd-names hid">— line-up belum lengkap</span>
  const cells = [0, 1].map(k => {
    const id = side.slots[p * 2 + k]
    if (id === WO) return { name: 'WO', away: false }
    const m = side.members.find(x => x.id === id)
    return m ? { name: m.name, away: !side.here.has(m.id) } : { name: '–', away: false }
  })
  return (
    <span className="rd-names" title={`${side.name}: ${cells.map(c => c.name).join(' · ')}`}>
      {cells.map((c, i) => (
        <span key={i} className={c.away ? 'away' : undefined}>{i ? ' · ' : ''}{c.name}</span>
      ))}
    </span>
  )
}

/**
 * A time field that saves when you leave it. Typing into a controlled time
 * input reads '' until both segments are filled, so committing on change threw
 * half-typed values away and put the old time back — it looked like the edit
 * did nothing. Remounts when the stored value changes, so a snapped 17:07 shows
 * up as 17:00 and another device's edit lands here too.
 */
function TimeBox({ value, label, cls, onCommit }: {
  value: string
  label: string
  cls?: string
  onCommit: (t: string) => void
}) {
  return (
    <input key={value} className={`lu-in ${cls ?? ''}`} type="time" step={STEP * 60}
      defaultValue={value} aria-label={label}
      onBlur={e => { if (e.target.value && snapTime(e.target.value) !== value) onCommit(snapTime(e.target.value)) }}
      onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} />
  )
}

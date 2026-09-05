import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Gender, ShirtSize, TourLevel, TourPlayer, TournamentState } from '../types'
import {
  LEVELS, LEVEL_CLASS, SIZES, duplicateNumbers, loadTournament, newPlayerId,
} from '../internalMatch'
import { TOURNAMENT_ID, supabase, upsertTournament } from '../supabase'
import { useIsAdmin } from '../RoleContext'

/** '' | '07' | 'abc' -> undefined | 7 | undefined */
function parseNumber(v: string): number | undefined {
  const n = Number(v.trim())
  return v.trim() && Number.isInteger(n) && n >= 0 && n < 1000 ? n : undefined
}

const EMPTY_DRAFT = {
  name: '', number: '', jersey: '',
  size: '' as ShirtSize | '', level: 'B1' as TourLevel, gender: 'M' as Gender,
}

export function InternalPlayers() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState(EMPTY_DRAFT)

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    // Fallback poll in case the Realtime WebSocket drops, same as the session
    // view. Admins poll too now that Realtime keeps them in sync.
    refetchInterval: 60_000,
  })

  const mut = useMutation({ mutationFn: upsertTournament })

  // Realtime: pick up another device's save the moment it lands. The row is a
  // single blob, so any write is a full-roster update.
  useEffect(() => {
    if (!supabase) return
    const channel = supabase
      .channel('tournament-live')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'tournaments', filter: `id=eq.${TOURNAMENT_ID}` },
        () => { qc.invalidateQueries({ queryKey: ['tournament'] }) },
      )
      .subscribe()
    return () => { supabase?.removeChannel(channel) }
  }, [qc])

  if (!state) return <div className="im-loading">Memuat daftar baju…</div>

  // ponytail: commits on blur (text) or change (select), not per keystroke, so
  // no debounce is needed — unlike the team builder, which edits a name field
  // that re-renders on every character.
  const save = (next: TournamentState) => {
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
  }
  const patch = (fn: (ps: TourPlayer[]) => TourPlayer[]) =>
    save({ ...state, players: fn(state.players) })

  const edit = (id: string, p: Partial<TourPlayer>) =>
    patch(ps => ps.map(x => (x.id === id ? { ...x, ...p } : x)))

  /**
   * Warns before handing out a number someone else already wears. Overridable
   * rather than blocking: swapping two players' numbers has to pass through a
   * moment where they collide, and one real duplicate (7) predates this page.
   */
  const confirmNumber = (n: number | undefined, selfId?: string) => {
    if (n === undefined) return true
    const owner = state.players.find(x => x.number === n && x.id !== selfId)
    return !owner || confirm(`Nomor ${n} sudah dipakai ${owner.name}. Tetap pakai?`)
  }

  const addPlayer = () => {
    const name = draft.name.trim()
    if (!name) return
    const number = parseNumber(draft.number)
    if (!confirmNumber(number)) return
    patch(ps => [...ps, {
      id: newPlayerId(name, ps),
      name,
      level: draft.level,
      gender: draft.gender,
      team: null,
      number,
      jersey: draft.jersey.trim() || undefined,
      size: draft.size || undefined,
    }])
    setDraft({ ...EMPTY_DRAFT, level: draft.level, gender: draft.gender })
  }

  const removePlayer = (p: TourPlayer) => {
    if (!confirm(`Hapus ${p.name} dari daftar? Ini juga menghapusnya dari turnamen.`)) return
    patch(ps => ps.filter(x => x.id !== p.id))
  }

  const dups = duplicateNumbers(state.players)
  const ordered = state.players.filter(p => p.size).length
  const cols = isAdmin ? 7 : 5

  return (
    <section className="ws-section">
      <div className="ws-head">
        <div className="ws-head-l">
          <h2>Baju Internal</h2>
          <span className="ws-head-sub">PB SOR 3rd Anniv — nomor, nama baju, ukuran</span>
        </div>
        <span className="ws-pill">{ordered} baju</span>
      </div>

      {dups.size > 0 && (
        <div className="ip-warn">
          ⚠ Nomor dipakai lebih dari satu orang: <b>{[...dups].sort((a, b) => a - b).join(', ')}</b>
        </div>
      )}

      {isAdmin && (
        <div className="im-controls">
          <button className="btn btn-ghost btn-sm" onClick={() => setAdding(a => !a)}>
            {adding ? 'Tutup' : '+ Pemain'}
          </button>
          <span className="im-pool-total">{state.players.length} orang</span>
        </div>
      )}

      {isAdmin && adding && (
        <div className="im-add">
          <input
            placeholder="Nama pemain" autoFocus value={draft.name}
            onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && addPlayer()}
          />
          <input
            className="ip-in-sm" placeholder="No. PB" inputMode="numeric" value={draft.number}
            onChange={e => setDraft(d => ({ ...d, number: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && addPlayer()}
          />
          <input
            placeholder="Nama baju" value={draft.jersey}
            onChange={e => setDraft(d => ({ ...d, jersey: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && addPlayer()}
          />
          <select value={draft.size}
            onChange={e => setDraft(d => ({ ...d, size: e.target.value as ShirtSize | '' }))}>
            <option value="">Size —</option>
            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={draft.level}
            onChange={e => setDraft(d => ({ ...d, level: e.target.value as TourLevel }))}>
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={draft.gender}
            onChange={e => setDraft(d => ({ ...d, gender: e.target.value as Gender }))}>
            <option value="M">Putra</option>
            <option value="F">Putri</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={addPlayer}>Tambah</button>
        </div>
      )}

      <div className="ip-wrap">
        <table className="ip-table">
          <thead>
            <tr>
              <th className="ip-no">No</th>
              <th>Nama</th>
              <th className="ip-pb">No. PB</th>
              <th>Nama Baju</th>
              <th className="ip-size">Size</th>
              {isAdmin && <th className="ip-size">Grade</th>}
              {isAdmin && <th className="ip-act" aria-label="Aksi" />}
            </tr>
          </thead>

          {LEVELS.map(level => {
            const rows = state.players
              .filter(p => p.level === level)
              .sort((a, b) => a.name.localeCompare(b.name))
            return (
              <tbody key={level}>
                <tr className="ip-grouphead">
                  <th colSpan={cols}>
                    <span className={`lvl-badge ${LEVEL_CLASS[level]}`}>{level}</span>
                    <span className="ip-count">{rows.length} orang</span>
                  </th>
                </tr>

                {rows.length === 0 && (
                  <tr><td className="ip-none" colSpan={cols}>Belum ada pemain.</td></tr>
                )}

                {/* Inputs are uncontrolled on purpose: a Realtime refetch must
                    never yank a half-typed value out from under the editor. */}
                {rows.map((p, i) => {
                  const dup = p.number !== undefined && dups.has(p.number)
                  return (
                    <tr key={p.id}>
                      <td className="ip-no">{i + 1}</td>
                      <td className="ip-name">
                        {isAdmin ? (
                          <input
                            className="ip-in" defaultValue={p.name}
                            aria-label={`Nama ${p.name}`}
                            onBlur={e => {
                              const v = e.target.value.trim()
                              // A blank name would make the row unfindable, so
                              // an empty field snaps back instead of saving.
                              if (!v) { e.target.value = p.name; return }
                              if (v !== p.name) edit(p.id, { name: v })
                            }}
                          />
                        ) : (
                          p.name
                        )}
                        {p.gender === 'F' && <span className="im-w">W</span>}
                      </td>
                      <td className={`ip-pb${dup ? ' dup' : ''}`}>
                        {isAdmin ? (
                          <input
                            className="ip-in ip-in-sm" inputMode="numeric"
                            defaultValue={p.number ?? ''}
                            aria-label={`Nomor PB ${p.name}`}
                            onBlur={e => {
                              const n = parseNumber(e.target.value)
                              if (n === p.number) return   // no edit, no upsert
                              if (!confirmNumber(n, p.id)) {
                                e.target.value = String(p.number ?? '')
                                return
                              }
                              edit(p.id, { number: n })
                            }}
                          />
                        ) : (
                          p.number ?? '—'
                        )}
                        {dup && <span className="ip-dup" title="Nomor ganda">⚠</span>}
                      </td>
                      <td className="ip-jersey">
                        {isAdmin ? (
                          <input
                            className="ip-in" defaultValue={p.jersey ?? ''}
                            aria-label={`Nama baju ${p.name}`}
                            onBlur={e => edit(p.id, { jersey: e.target.value.trim() || undefined })}
                          />
                        ) : (
                          p.jersey ?? '—'
                        )}
                      </td>
                      <td className="ip-size">
                        {isAdmin ? (
                          <select
                            className="ip-in" value={p.size ?? ''}
                            aria-label={`Ukuran ${p.name}`}
                            onChange={e => edit(p.id, {
                              size: (e.target.value || undefined) as ShirtSize | undefined,
                            })}
                          >
                            <option value="">—</option>
                            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          p.size ?? '—'
                        )}
                      </td>
                      {isAdmin && (
                        <td className="ip-size">
                          <select
                            className="ip-in" value={p.level}
                            aria-label={`Grade ${p.name}`}
                            onChange={e => edit(p.id, { level: e.target.value as TourLevel })}
                          >
                            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
                          </select>
                        </td>
                      )}
                      {isAdmin && (
                        <td className="ip-act">
                          <button
                            className="im-mini danger" title={`Hapus ${p.name}`}
                            onClick={() => removePlayer(p)}
                          >✕</button>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            )
          })}
        </table>
      </div>
    </section>
  )
}

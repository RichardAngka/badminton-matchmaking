import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ShirtSize, TourPlayer, TournamentState } from '../types'
import { LEVELS, LEVEL_CLASS, SIZES, duplicateNumbers, loadTournament } from '../internalMatch'
import { upsertTournament } from '../supabase'
import { useIsAdmin } from '../RoleContext'

/** '' | '07' | 'abc' -> undefined | 7 | undefined */
function parseNumber(v: string): number | undefined {
  const n = Number(v.trim())
  return v.trim() && Number.isInteger(n) && n >= 0 && n < 1000 ? n : undefined
}

export function InternalPlayers() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    refetchInterval: isAdmin ? false : 15_000,
  })

  const mut = useMutation({ mutationFn: upsertTournament })

  if (!state) return <div className="im-loading">Memuat daftar baju…</div>

  // ponytail: commits on blur (text) or change (select), not per keystroke, so
  // no debounce is needed here — unlike the team builder, which types into a
  // name field on every edit.
  const save = (next: TournamentState) => {
    qc.setQueryData(['tournament'], next)
    mut.mutate(next)
  }
  const edit = (id: string, patch: Partial<TourPlayer>) =>
    save({ ...state, players: state.players.map(p => (p.id === id ? { ...p, ...patch } : p)) })

  const dups = duplicateNumbers(state.players)
  const ordered = state.players.filter(p => p.size).length

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

      <div className="ip-wrap">
        <table className="ip-table">
          <thead>
            <tr>
              <th className="ip-no">No</th>
              <th>Nama</th>
              <th className="ip-pb">No. PB</th>
              <th>Nama Baju</th>
              <th className="ip-size">Size</th>
            </tr>
          </thead>

          {LEVELS.map(level => {
            const rows = state.players
              .filter(p => p.level === level)
              .sort((a, b) => a.name.localeCompare(b.name))
            return (
              <tbody key={level}>
                <tr className="ip-grouphead">
                  <th colSpan={5}>
                    <span className={`lvl-badge ${LEVEL_CLASS[level]}`}>{level}</span>
                    <span className="ip-count">{rows.length} orang</span>
                  </th>
                </tr>

                {rows.map((p, i) => {
                  const dup = p.number !== undefined && dups.has(p.number)
                  return (
                    <tr key={p.id}>
                      <td className="ip-no">{i + 1}</td>
                      <td className="ip-name">
                        {isAdmin ? (
                          <input
                            key={p.name}
                            className="ip-in"
                            defaultValue={p.name}
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
                            key={p.number ?? ''}
                            className="ip-in"
                            inputMode="numeric"
                            defaultValue={p.number ?? ''}
                            aria-label={`Nomor PB ${p.name}`}
                            onBlur={e => edit(p.id, { number: parseNumber(e.target.value) })}
                          />
                        ) : (
                          p.number ?? '—'
                        )}
                        {dup && <span className="ip-dup" title="Nomor ganda">⚠</span>}
                      </td>
                      <td className="ip-jersey">
                        {isAdmin ? (
                          <input
                            key={p.jersey ?? ''}
                            className="ip-in"
                            defaultValue={p.jersey ?? ''}
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
                            className="ip-in"
                            value={p.size ?? ''}
                            aria-label={`Ukuran ${p.name}`}
                            onChange={e =>
                              edit(p.id, { size: (e.target.value || undefined) as ShirtSize | undefined })
                            }
                          >
                            <option value="">—</option>
                            {SIZES.map(s => <option key={s} value={s}>{s}</option>)}
                          </select>
                        ) : (
                          p.size ?? '—'
                        )}
                      </td>
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

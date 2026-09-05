import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Gender, TeamId, TourLevel, TourPlayer, TournamentState } from '../types'
import {
  LEVELS, LEVEL_CLASS, QUOTA, TEAM_IDS, TEAM_SIZE, countByLevel, loadTournament,
} from '../internalMatch'
import { upsertTournament } from '../supabase'
import { useIsAdmin } from '../RoleContext'

export function InternalMatch() {
  const isAdmin = useIsAdmin()
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<TourLevel | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [activeTeam, setActiveTeam] = useState<TeamId>(1)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<{ name: string; level: TourLevel; gender: Gender }>(
    { name: '', level: 'B1', gender: 'M' },
  )

  const { data: state } = useQuery({
    queryKey: ['tournament'],
    queryFn: loadTournament,
    // ponytail: admin is the only writer, so polling would clobber their own
    // in-flight edits; viewers poll instead. Two admins at once = last write wins.
    refetchInterval: isAdmin ? false : 15_000,
  })

  const mut = useMutation({ mutationFn: upsertTournament })

  // ponytail: the cache updates instantly but the network write coalesces —
  // every save ships the whole 80-player blob, and typing a name or a team
  // title would otherwise fire one upsert per keystroke.
  const pending = useRef<TournamentState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flush = () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = undefined }
    if (pending.current) { mut.mutate(pending.current); pending.current = null }
  }
  // Write out anything still queued if the tab is left mid-edit.
  useEffect(() => flush, [])

  if (!state) return <div className="im-loading">Memuat turnamen…</div>

  const save = (next: TournamentState) => {
    qc.setQueryData(['tournament'], next)
    pending.current = next
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, 400)
  }
  const patchPlayers = (fn: (p: TourPlayer[]) => TourPlayer[]) =>
    save({ ...state, players: fn(state.players) })

  const setTeam = (id: string, team: TeamId | null) =>
    patchPlayers(ps => ps.map(p => (p.id === id ? { ...p, team } : p)))

  const editPlayer = (id: string, patch: Partial<TourPlayer>) =>
    patchPlayers(ps => ps.map(p => (p.id === id ? { ...p, ...patch } : p)))

  const removePlayer = (p: TourPlayer) => {
    if (!confirm(`Hapus ${p.name} dari turnamen?`)) return
    setEditingId(null)
    patchPlayers(ps => ps.filter(x => x.id !== p.id))
  }

  const addPlayer = () => {
    const name = draft.name.trim()
    if (!name) return
    const id = `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now().toString(36)}`
    patchPlayers(ps => [...ps, { id, name, level: draft.level, gender: draft.gender, team: null }])
    setDraft({ name: '', level: draft.level, gender: 'M' })
  }

  const clearTeams = () => {
    if (!confirm('Kosongkan semua tim? Semua 80 pemain kembali ke pool.')) return
    patchPlayers(ps => ps.map(p => ({ ...p, team: null })))
  }

  const renameTeam = (t: TeamId, name: string) =>
    save({ ...state, teamNames: { ...state.teamNames, [t]: name } })

  // ── readouts ──────────────────────────────────────────────────────────────
  const pool = countByLevel(state.players)
  const poolOk = LEVELS.every(l => pool[l] === QUOTA[l] * 4)

  const byTeam = Object.fromEntries(TEAM_IDS.map(t => {
    const members = state.players.filter(p => p.team === t)
    const have = countByLevel(members)
    return [t, { members, have, full: LEVELS.every(l => have[l] === QUOTA[l]) }]
  })) as Record<TeamId, { members: TourPlayer[]; have: Record<TourLevel, number>; full: boolean }>

  const unassigned = state.players.filter(p => p.team === null)
  const q = search.trim().toLowerCase()
  const visible = unassigned.filter(p =>
    (!levelFilter || p.level === levelFilter) && (!q || p.name.toLowerCase().includes(q)))

  return (
    <>
      {/* Pool integrity — the roster has zero slack, so a bad level edit or a
          no-show has to surface immediately, not at the fourth team. */}
      <section className="ws-section">
        <div className="im-pool-bar">
          <span className={`im-pool-label ${poolOk ? 'ok' : 'bad'}`}>
            {poolOk ? '✓ Pool lengkap' : '✕ Pool tidak cukup'}
          </span>
          {LEVELS.map(l => {
            const need = QUOTA[l] * 4
            return (
              <span key={l} className={`im-pool-cell ${pool[l] === need ? 'ok' : 'bad'}`}>
                <span className={`lvl-badge ${LEVEL_CLASS[l]}`}>{l}</span>
                {pool[l]}/{need}
              </span>
            )
          })}
          <span className="im-pool-total">{state.players.length} orang</span>
        </div>
      </section>

      {/* ── Pool ── */}
      <section className="ws-section">
        <div className="ws-head">
          <div className="ws-head-l">
            <h2>Belum Masuk Tim</h2>
            <span className="ws-head-sub">Ketuk 1–4 untuk memasukkan ke tim</span>
          </div>
          <span className="ws-pill">{unassigned.length} tersisa</span>
        </div>

        <div className="im-controls">
          <input
            className="im-search"
            placeholder="Cari nama…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {/* Segmented filter: one bordered track, dividers between segments,
              filled active segment, count in a badge. */}
          <div className="im-segmented" role="group" aria-label="Filter level">
            {([null, ...LEVELS] as (TourLevel | null)[]).map(l => {
              const count = l ? unassigned.filter(p => p.level === l).length : unassigned.length
              const on = levelFilter === l
              return (
                <button
                  key={l ?? 'all'}
                  className={`im-seg${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setLevelFilter(l)}
                >
                  <span>{l ?? 'Semua'}</span>
                  <span className="im-seg-count">{count}</span>
                </button>
              )
            })}
          </div>
          {isAdmin && (
            <div className="im-actions">
              <button className="btn btn-ghost btn-sm" onClick={() => setAdding(a => !a)}>
                {adding ? 'Tutup' : '+ Pemain'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={clearTeams}>Kosongkan Tim</button>
            </div>
          )}
        </div>

        {isAdmin && adding && (
          <div className="im-add">
            <input
              placeholder="Nama pemain"
              value={draft.name}
              autoFocus
              onChange={e => setDraft(d => ({ ...d, name: e.target.value }))}
              onKeyDown={e => e.key === 'Enter' && addPlayer()}
            />
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

        {visible.length === 0
          ? <div className="im-empty">
              {unassigned.length === 0 ? 'Semua pemain sudah masuk tim.' : 'Tidak ada yang cocok.'}
            </div>
          : LEVELS.filter(l => visible.some(p => p.level === l)).map(l => (
              <div key={l} className="im-group">
                <div className="im-group-head">
                  <span className={`lvl-badge ${LEVEL_CLASS[l]}`}>{l}</span>
                  <span>{visible.filter(p => p.level === l).length} orang</span>
                </div>
                <div className="im-rows">
                  {visible.filter(p => p.level === l).map(p => (
                    <PlayerRow
                      key={p.id} p={p} isAdmin={isAdmin}
                      editing={editingId === p.id}
                      onEdit={() => setEditingId(editingId === p.id ? null : p.id)}
                      onPatch={patch => editPlayer(p.id, patch)}
                      onRemove={() => removePlayer(p)}
                      onTeam={t => setTeam(p.id, t)}
                    />
                  ))}
                </div>
              </div>
            ))}
      </section>

      {/* ── Teams ── */}
      <section className="ws-section">
        <div className="ws-head">
          <div className="ws-head-l">
            <h2>Tim</h2>
            <span className="ws-head-sub">
              Tiap tim {TEAM_SIZE} orang · {LEVELS.map(l => `${QUOTA[l]} ${l}`).join(' · ')}
            </span>
          </div>
        </div>

        {/* Tabs reuse the filter's segmented track, full-width. The badge
            carries each team's fill so a short team is still visible from the
            tab bar — otherwise tabs would hide exactly what you need to see. */}
        <div className="im-segmented im-tabs" role="tablist" aria-label="Tim">
          {TEAM_IDS.map(t => {
            const { members, full } = byTeam[t]
            const on = activeTeam === t
            return (
              <button
                key={t}
                role="tab"
                aria-selected={on}
                className={`im-seg${on ? ' on' : ''}${full ? ' done' : ''}`}
                onClick={() => setActiveTeam(t)}
              >
                <span className="im-tab-label">{state.teamNames[t]}</span>
                <span className="im-seg-count">{members.length}/{TEAM_SIZE}</span>
              </button>
            )
          })}
        </div>

        {(() => {
          const { members, have, full } = byTeam[activeTeam]
          return (
            <div className={`im-team${full ? ' full' : ''}`}>
              <div className="im-team-head">
                {isAdmin
                  ? <input
                      className="im-team-name"
                      value={state.teamNames[activeTeam]}
                      onChange={e => renameTeam(activeTeam, e.target.value)}
                      aria-label="Nama tim"
                    />
                  : <span className="im-team-name static">{state.teamNames[activeTeam]}</span>}
                <span className={`im-team-count${members.length === TEAM_SIZE ? ' ok' : ''}`}>
                  {members.length}/{TEAM_SIZE}
                </span>
              </div>

              {/* Every level, A1+ down to W-B2, even when empty — a missing
                  level is exactly what you need to see, and filtering it out
                  hides the gap. */}
              <div className="im-team-body">
                {LEVELS.map(l => {
                  const inLevel = members.filter(p => p.level === l)
                  const fill = have[l] === QUOTA[l] ? 'ok' : have[l] > QUOTA[l] ? 'over' : 'short'
                  return (
                    <div key={l} className="im-group">
                      <div className="im-group-head">
                        <span className={`lvl-badge ${LEVEL_CLASS[l]}`}>{l}</span>
                        <span className={`im-group-count ${fill}`}>{have[l]}/{QUOTA[l]}</span>
                      </div>
                      <div className="im-rows">
                        {inLevel.length === 0
                          ? <div className="im-slot-empty">Butuh {QUOTA[l]} pemain {l}</div>
                          : inLevel.map(p => (
                              <PlayerRow
                                key={p.id} p={p} isAdmin={isAdmin}
                                editing={editingId === p.id}
                                onEdit={() => setEditingId(editingId === p.id ? null : p.id)}
                                onPatch={patch => editPlayer(p.id, patch)}
                                onRemove={() => removePlayer(p)}
                                onTeam={tt => setTeam(p.id, tt)}
                              />
                            ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })()}
      </section>
    </>
  )
}

function PlayerRow({ p, isAdmin, editing, onEdit, onPatch, onRemove, onTeam }: {
  p: TourPlayer
  isAdmin: boolean
  editing: boolean
  onEdit: () => void
  onPatch: (patch: Partial<TourPlayer>) => void
  onRemove: () => void
  onTeam: (t: TeamId | null) => void
}) {
  return (
    <div className="im-row">
      {editing ? (
        <>
          <input className="im-row-input" value={p.name} autoFocus
            onChange={e => onPatch({ name: e.target.value })}
            onKeyDown={e => e.key === 'Enter' && onEdit()} />
          <select value={p.level}
            onChange={e => onPatch({ level: e.target.value as TourLevel })}>
            {LEVELS.map(l => <option key={l} value={l}>{l}</option>)}
          </select>
          <select value={p.gender}
            onChange={e => onPatch({ gender: e.target.value as Gender })}>
            <option value="M">Putra</option>
            <option value="F">Putri</option>
          </select>
          <button className="im-mini danger" onClick={onRemove} title="Hapus">✕</button>
          <button className="im-mini" onClick={onEdit} title="Selesai">✓</button>
        </>
      ) : (
        <>
          <span className="im-row-name">{p.name}</span>
          {p.gender === 'F' && <span className="im-w">W</span>}
          <span className={`lvl-badge ${LEVEL_CLASS[p.level]}`}>{p.level}</span>
          {isAdmin && (
            <>
              <div className="im-teamstrip">
                {TEAM_IDS.map(t => (
                  <button key={t}
                    className={`im-tbtn${p.team === t ? ' on' : ''}`}
                    onClick={() => onTeam(t)}>{t}</button>
                ))}
                <button className="im-tbtn clear" disabled={p.team === null}
                  onClick={() => onTeam(null)} title="Keluarkan dari tim">–</button>
              </div>
              <button className="im-mini" onClick={onEdit} title="Ubah">✎</button>
            </>
          )}
        </>
      )}
    </div>
  )
}

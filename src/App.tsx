import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  loadStateForDate, persistState, getActiveCourts, getActiveMatchMap, DEFAULT_STATE,
} from './store'
import { listRemoteSessions, supabase } from './supabase'
import { findBestFour } from './matchmaker'
import type { AppState, Player, PlayerStatus, TimeSlot } from './types'
import { CourtCard } from './components/CourtCard'
import { LedgerPanel } from './components/LedgerPanel'
import { PlayerPanel } from './components/PlayerPanel'

const TODAY = new Date().toLocaleDateString('id-ID', {
  day: '2-digit', month: '2-digit', year: 'numeric',
})

export function App() {
  const qc = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [playerPanelOpen, setPlayerPanelOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [reqMatchOpen, setReqMatchOpen] = useState(false)
  const [logoError, setLogoError] = useState(false)
  const [editingMatch, setEditingMatch] = useState<{ id: string; bola: number; score: string } | null>(null)

  const isHistorical = selectedDate !== TODAY

  // Main state query — keyed by date so switching sessions re-fetches cleanly
  const { data: state = DEFAULT_STATE } = useQuery({
    queryKey: ['state', selectedDate],
    queryFn: () => loadStateForDate(selectedDate),
    staleTime: isHistorical ? Infinity : 30_000,
  })

  // Session list from Supabase for the history picker
  const { data: sessions = [] } = useQuery({
    queryKey: ['sessions'],
    queryFn: listRemoteSessions,
    staleTime: 60_000,
    enabled: !!supabase,
  })

  const mut = useMutation({
    mutationFn: (s: AppState) => persistState(selectedDate, s),
    onSuccess: s => qc.setQueryData(['state', selectedDate], s),
  })

  const activeCourts   = getActiveCourts(state)
  const activeMatchMap = getActiveMatchMap(state)
  const waitingPlayers = state.players.filter(p => p.status === 'Waiting')
  const activePlayers  = state.players.filter(p => p.status !== 'Left').length

  const now    = new Date()
  const hhmm   = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`
  const slot   = state.timeSlots.find(s => hhmm >= s.start && hhmm < s.end)

  function generateMatches() {
    if (isHistorical) return
    let next = { ...state }
    for (let courtId = 1; courtId <= activeCourts; courtId++) {
      if (next.matches.some(m => m.courtId === courtId && !m.endTime)) continue
      const waiting = next.players.filter(p => p.status === 'Waiting')
      const pastPairs = new Set(next.matches.flatMap(m => [
        [...m.team1].sort().join('|'),
        [...m.team2].sort().join('|'),
      ]))
      const four = findBestFour(waiting, pastPairs)
      if (!four) break
      const matchNum = next.matchCounter + 1
      next = {
        ...next,
        matchCounter: matchNum,
        matches: [...next.matches, {
          id: crypto.randomUUID(),
          matchNumber: matchNum,
          courtId,
          team1: [four[0].id, four[1].id],
          team2: [four[2].id, four[3].id],
          startTime: Date.now(),
        }],
        players: next.players.map(p =>
          four.find(f => f.id === p.id) ? { ...p, status: 'Playing' as PlayerStatus } : p
        ),
      }
    }
    mut.mutate(next)
  }

  function requestMatch(courtId: number, four: [string, string, string, string]) {
    if (isHistorical) return
    const matchNum = state.matchCounter + 1
    mut.mutate({
      ...state,
      matchCounter: matchNum,
      matches: [...state.matches, {
        id: crypto.randomUUID(),
        matchNumber: matchNum,
        courtId,
        team1: [four[0], four[1]],
        team2: [four[2], four[3]],
        startTime: Date.now(),
      }],
      players: state.players.map(p =>
        four.includes(p.id) ? { ...p, status: 'Playing' as PlayerStatus } : p
      ),
    })
  }

  function editMatch(matchId: string, shuttlesUsed: number, score: string) {
    const match = state.matches.find(m => m.id === matchId)!
    const oldCost = Math.round(((match.shuttlesUsed ?? 0) * state.shuttlePrice) / 4)
    const newCost = Math.round((shuttlesUsed * state.shuttlePrice) / 4)
    const delta = newCost - oldCost
    const playerIds = new Set([...match.team1, ...match.team2])
    mut.mutate({
      ...state,
      matches: state.matches.map(m =>
        m.id === matchId ? { ...m, shuttlesUsed, score } : m
      ),
      players: delta === 0 ? state.players : state.players.map(p =>
        playerIds.has(p.id) ? { ...p, totalCost: p.totalCost + delta } : p
      ),
    })
    setEditingMatch(null)
  }

  function endMatch(matchId: string, shuttlesUsed: number, score: string) {
    if (isHistorical) return
    const match = state.matches.find(m => m.id === matchId)!
    const costPerPlayer = Math.round((shuttlesUsed * state.shuttlePrice) / 4)
    const playerIds = new Set([...match.team1, ...match.team2])
    mut.mutate({
      ...state,
      matches: state.matches.map(m =>
        m.id === matchId ? { ...m, endTime: Date.now(), shuttlesUsed, score } : m
      ),
      players: state.players.map(p =>
        playerIds.has(p.id)
          ? { ...p, status: 'Waiting' as PlayerStatus, restingSince: Date.now(), totalCost: p.totalCost + costPerPlayer, gamesPlayed: p.gamesPlayed + 1 }
          : p
      ),
    })
  }

  // Sessions for picker: always show today first, then past (from Supabase)
  const pastSessions = sessions.filter(s => s.session_date !== TODAY)

  return (
    <div className="app-root">
      {/* ── Header ── */}
      <header className="header">
        {logoError ? (
          <div className="header-logo-fallback">SOR</div>
        ) : (
          <img
            className="header-logo"
            src="/Logo PB SOR.png"
            alt="PB. SOR"
            onError={() => setLogoError(true)}
          />
        )}

        <div className="header-title">
          <h1>
            ORDER TO PLAY OF THE DAY!!!!&ensp;
            (Tanggal:&nbsp;<span className="date-part">{state.sessionDate}</span>)&ensp;—&ensp;
            <span className="club-part">PB. SOR</span>
          </h1>
        </div>

        <div className="header-right">
          {/* Session picker — history only shown when Supabase is connected */}
          <select
            className="session-select"
            value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
          >
            <option value={TODAY}>Hari Ini ({TODAY})</option>
            {pastSessions.map(s => (
              <option key={s.session_date} value={s.session_date}>
                {s.session_date} — {s.player_count} pemain · {s.total_shuttles} bola
              </option>
            ))}
          </select>

          <div className="player-count-badge">
            <strong>{activePlayers}</strong> / {state.targetPlayers}
          </div>

          <div className="db-badge" title={supabase ? 'Terhubung ke Supabase' : 'Offline — hanya localStorage'}>
            <div className={`db-dot ${supabase ? 'on' : 'off'}`} />
            {supabase ? 'DB' : 'Local'}
          </div>

          <button className="btn btn-ghost btn-sm" onClick={() => setConfigOpen(true)} title="Konfigurasi">⚙</button>
        </div>
      </header>

      {/* Historical session banner */}
      {isHistorical && (
        <div className="history-banner">
          👁&nbsp; Melihat sesi {selectedDate} — read only
          &nbsp;·&nbsp;
          <button
            style={{ background: 'none', border: 'none', color: 'var(--gold)', cursor: 'pointer', fontWeight: 700, fontSize: 12, fontFamily: 'inherit', padding: 0 }}
            onClick={() => setSelectedDate(TODAY)}
          >
            Kembali ke hari ini →
          </button>
        </div>
      )}

      <div className="main-layout">
        {/* ── Left panel ── */}
        <div className="left-panel">
          {!isHistorical && (
            <div className="controls-bar">
              <button className="btn btn-ghost btn-sm" onClick={() => setPlayerPanelOpen(true)}>
                + Kelola Pemain
              </button>
              <button
                className="btn btn-primary"
                onClick={generateMatches}
                disabled={waitingPlayers.length < 4}
              >
                ▶ Generate Match
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => setReqMatchOpen(true)}
                disabled={waitingPlayers.length < 4}
              >
                ✋ Request Match
              </button>
              {slot && (
                <div className="slot-tag">
                  <strong>{slot.start}–{slot.end}</strong>
                  {slot.courts} lapangan
                </div>
              )}
            </div>
          )}

          <div className="courts-grid">
            {Array.from({ length: activeCourts }, (_, i) => i + 1).map(courtId => {
              const matchId = activeMatchMap.get(courtId)
              const match   = matchId ? state.matches.find(m => m.id === matchId) : undefined
              return (
                <CourtCard
                  key={courtId}
                  courtId={courtId}
                  match={match}
                  players={state.players}
                  onEndMatch={isHistorical ? undefined : endMatch}
                />
              )
            })}
          </div>

          {waitingPlayers.length > 0 && (
            <div className="waiting-section">
              <div className="section-title">
                <span>Antrian Menunggu</span>
                <span>{waitingPlayers.length} pemain</span>
              </div>
              <div className="waiting-grid">
                {[...waitingPlayers]
                  .sort((a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0))
                  .map(p => (
                    <div key={p.id} className="waiting-chip">
                      <div className="status-dot waiting" />
                      <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                      {p.name}
                    </div>
                  ))}
              </div>
            </div>
          )}

          {state.matches.some(m => m.endTime) && (
            <div className="waiting-section" style={{ marginTop: 12 }}>
              <div className="section-title">
                <span>Riwayat Match</span>
                <span>{state.matches.filter(m => m.endTime).length} match</span>
              </div>
              <div className="match-history-grid">
                {[...state.matches]
                  .filter(m => m.endTime)
                  .sort((a, b) => a.matchNumber - b.matchNumber)
                  .map(m => {
                    const n = (id: string) => state.players.find(p => p.id === id)?.name ?? '?'
                    return (
                      <div key={m.id} className="mh-card">
                        <div className="mh-card-header">
                          <span className="mh-num">#{m.matchNumber}</span>
                          {editingMatch?.id === m.id ? (
                            <input
                              type="number" min={0}
                              value={editingMatch.bola}
                              onChange={e => setEditingMatch(em => em && ({ ...em, bola: +e.target.value }))}
                              style={{ width: 52, fontSize: 11, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px' }}
                            />
                          ) : (
                            <span
                              className="mh-bola-tag"
                              style={!isHistorical ? { cursor: 'pointer' } : undefined}
                              onClick={() => !isHistorical && setEditingMatch({ id: m.id, bola: m.shuttlesUsed ?? 0, score: m.score ?? '' })}
                            >
                              {m.shuttlesUsed ?? 0} bola{!isHistorical && ' ✏'}
                            </span>
                          )}
                        </div>
                        <div className="mh-team">{n(m.team1[0])} · {n(m.team1[1])}</div>
                        <div className="mh-vs">vs</div>
                        <div className="mh-team">{n(m.team2[0])} · {n(m.team2[1])}</div>
                        {editingMatch?.id === m.id ? (
                          <>
                            <input
                              value={editingMatch.score}
                              placeholder="Skor (mis: 21-15)"
                              onChange={e => setEditingMatch(em => em && ({ ...em, score: e.target.value }))}
                              onKeyDown={e => e.key === 'Enter' && editMatch(m.id, editingMatch.bola, editingMatch.score)}
                              style={{ fontSize: 11, width: '100%', marginTop: 4, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 6px', boxSizing: 'border-box' }}
                            />
                            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                              <button className="btn btn-primary btn-sm" style={{ flex: 1, fontSize: 10, padding: '2px 6px' }}
                                onClick={() => editMatch(m.id, editingMatch.bola, editingMatch.score)}>
                                Simpan
                              </button>
                              <button className="btn btn-ghost btn-sm" style={{ fontSize: 10, padding: '2px 6px' }}
                                onClick={() => setEditingMatch(null)}>
                                Batal
                              </button>
                            </div>
                          </>
                        ) : (
                          m.score && <div className="mh-score">{m.score}</div>
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          )}
        </div>

        <LedgerPanel state={state} />
      </div>

      {/* ── Player panel (today only) ── */}
      {!isHistorical && (
        <PlayerPanel
          open={playerPanelOpen}
          onClose={() => setPlayerPanelOpen(false)}
          state={state}
          onUpdate={s => mut.mutate(s)}
        />
      )}

      {reqMatchOpen && (
        <RequestMatchModal
          state={state}
          activeCourts={activeCourts}
          activeMatchMap={activeMatchMap}
          onSubmit={(courtId, four) => { requestMatch(courtId, four); setReqMatchOpen(false) }}
          onClose={() => setReqMatchOpen(false)}
        />
      )}

      {configOpen && (
        <ConfigModal
          state={state}
          onSave={s => { mut.mutate(s); setConfigOpen(false) }}
          onClose={() => setConfigOpen(false)}
          onHardReset={async () => {
            if (!confirm('HARD RESET: hapus SEMUA data (pemain, pertandingan, riwayat)? Ini tidak bisa dibatalkan.')) return
            await persistState(TODAY, DEFAULT_STATE)
            window.location.reload()
          }}
        />
      )}
    </div>
  )
}

// ── Config modal ──────────────────────────────────────────────────────────────

interface ConfigModalProps {
  state: AppState
  onSave: (s: AppState) => void
  onClose: () => void
  onHardReset: () => void
}

function ConfigModal({ state, onSave, onClose, onHardReset }: ConfigModalProps) {
  const [form, setForm] = useState({
    sessionDate:   state.sessionDate,
    shuttlePrice:  state.shuttlePrice,
    targetPlayers: state.targetPlayers,
    timeSlots:     state.timeSlots.map(s => ({ ...s })),
  })

  function updateSlot(i: number, field: keyof TimeSlot, val: string | number) {
    setForm(f => ({
      ...f,
      timeSlots: f.timeSlots.map((s, idx) => idx === i ? { ...s, [field]: val } : s),
    }))
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Konfigurasi Sesi</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="config-form">
            <div>
              <label className="config-label">Tanggal Sesi</label>
              <input className="config-input" value={form.sessionDate}
                onChange={e => setForm(f => ({ ...f, sessionDate: e.target.value }))} />
            </div>
            <div>
              <label className="config-label">Target Pemain</label>
              <input className="config-input" type="number" min={1} value={form.targetPlayers}
                onChange={e => setForm(f => ({ ...f, targetPlayers: +e.target.value }))} />
            </div>
            <div>
              <label className="config-label">Harga Bola per Biji (Rp)</label>
              <input className="config-input" type="number" min={1} value={form.shuttlePrice}
                onChange={e => setForm(f => ({ ...f, shuttlePrice: +e.target.value }))} />
            </div>
            <div>
              <label className="config-label">Time Slots & Lapangan</label>
              {form.timeSlots.map((slot, i) => (
                <div key={i} className="slot-row">
                  <input className="config-input" value={slot.start} placeholder="17:00"
                    onChange={e => updateSlot(i, 'start', e.target.value)} />
                  <span style={{ color: 'var(--muted)', flexShrink: 0 }}>–</span>
                  <input className="config-input" value={slot.end} placeholder="20:00"
                    onChange={e => updateSlot(i, 'end', e.target.value)} />
                  <input className="config-input slot-courts-input" type="number" min={1} max={10}
                    value={slot.courts}
                    onChange={e => updateSlot(i, 'courts', +e.target.value)} />
                  <span style={{ fontSize: 11, color: 'var(--dim)', flexShrink: 0 }}>lap</span>
                  {form.timeSlots.length > 1 && (
                    <button className="btn btn-ghost btn-sm"
                      style={{ padding: '4px 8px', flexShrink: 0 }}
                      onClick={() => setForm(f => ({ ...f, timeSlots: f.timeSlots.filter((_, idx) => idx !== i) }))}>
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 6 }}
                onClick={() => setForm(f => ({ ...f, timeSlots: [...f.timeSlots, { start: '', end: '', courts: 2 }] }))}>
                + Tambah Slot
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" style={{ flex: 1 }}
                onClick={() => onSave({ ...state, ...form })}>
                Simpan
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Batal</button>
            </div>

            <hr style={{ border: 'none', borderTop: '1px solid var(--border)' }} />
            <button className="btn btn-danger btn-sm" style={{ width: '100%' }}
              onClick={() => {
                if (!confirm('Reset semua data sesi? Ini akan menghapus semua pemain dan pertandingan hari ini.')) return
                onSave({ ...DEFAULT_STATE, ...form })
              }}>
              ⚠ Reset Sesi
            </button>

            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 11, color: 'var(--dim)', cursor: 'pointer', userSelect: 'none' }}>
                🛠 Testing Tools
              </summary>
              <div style={{ marginTop: 8 }}>
                <button className="btn btn-danger btn-sm" style={{ width: '100%', opacity: 0.85 }}
                  onClick={onHardReset}>
                  💣 Hard Reset (hapus semua data + reload)
                </button>
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Request Match modal ───────────────────────────────────────────────────────

interface ReqMatchProps {
  state: AppState
  activeCourts: number
  activeMatchMap: Map<number, string>
  onSubmit: (courtId: number, four: [string, string, string, string]) => void
  onClose: () => void
}

function RequestMatchModal({ state, activeCourts, activeMatchMap, onSubmit, onClose }: ReqMatchProps) {
  const emptyCourts = Array.from({ length: activeCourts }, (_, i) => i + 1).filter(id => !activeMatchMap.has(id))
  const [courtId, setCourtId] = useState(emptyCourts[0] ?? 1)
  const [selected, setSelected] = useState<string[]>([])

  const waiting = state.players.filter((p: Player) => p.status === 'Waiting')

  function toggle(id: string) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 4 ? [...s, id] : s)
  }

  const ready = selected.length === 4 && emptyCourts.includes(courtId)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>✋ Request Match</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="config-form">
            <div>
              <label className="config-label">Lapangan</label>
              {emptyCourts.length === 0 ? (
                <p style={{ color: 'var(--red)', fontSize: 12 }}>Semua lapangan sedang penuh.</p>
              ) : (
                <select
                  className="config-input"
                  value={courtId}
                  onChange={e => setCourtId(+e.target.value)}
                  style={{ width: '100%' }}
                >
                  {emptyCourts.map(id => (
                    <option key={id} value={id}>Lapangan {id}</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="config-label">
                Pilih 4 Pemain ({selected.length}/4) — urutan: Team 1 (1,2) vs Team 2 (3,4)
              </label>
              {waiting.length < 4 && (
                <p style={{ color: 'var(--muted)', fontSize: 11 }}>Tidak cukup pemain menunggu.</p>
              )}
              <div className="waiting-grid" style={{ marginTop: 6 }}>
                {waiting.map((p: Player) => {
                  const idx = selected.indexOf(p.id)
                  const isTeam1 = idx === 0 || idx === 1
                  const isTeam2 = idx === 2 || idx === 3
                  return (
                    <div
                      key={p.id}
                      className="waiting-chip"
                      onClick={() => toggle(p.id)}
                      style={{
                        cursor: 'pointer',
                        outline: idx >= 0 ? `2px solid ${isTeam1 ? 'var(--gold)' : '#4fc3f7'}` : 'none',
                        opacity: selected.length === 4 && idx < 0 ? 0.4 : 1,
                      }}
                    >
                      {idx >= 0 && (
                        <span style={{ fontSize: 10, fontWeight: 800, color: isTeam1 ? 'var(--gold)' : '#4fc3f7', minWidth: 14 }}>
                          {idx + 1}
                        </span>
                      )}
                      <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                      {p.name}
                    </div>
                  )
                })}
              </div>
            </div>

            {selected.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--gold)' }}>
                  Tim 1: {selected.slice(0,2).map(id => state.players.find((p: Player) => p.id === id)?.name ?? '?').join(' · ')}
                </span>
                {selected.length > 2 && (
                  <span style={{ color: '#4fc3f7' }}>
                    Tim 2: {selected.slice(2,4).map(id => state.players.find((p: Player) => p.id === id)?.name ?? '?').join(' · ')}
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!ready}
                onClick={() => onSubmit(courtId, selected as [string, string, string, string])}
              >
                Mulai Match
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Batal</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

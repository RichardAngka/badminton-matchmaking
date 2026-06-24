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
import { CalendarPicker } from './components/CalendarPicker'

const TODAY = new Date().toLocaleDateString('en-CA')  // YYYY-MM-DD, valid for date column

export function App() {
  const qc = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [pickingDate, setPickingDate] = useState(false)
  const [playerPanelOpen, setPlayerPanelOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [reqMatchOpen, setReqMatchOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [logoError, setLogoError] = useState(false)
  const [editingMatch, setEditingMatch] = useState<{ id: string; bola: number; scoreL: string; scoreR: string } | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)

  const isHistorical = false // ponytail: was selectedDate !== TODAY, restore to re-lock past dates

  // Main state query — keyed by date so switching sessions re-fetches cleanly
  const { data: state = DEFAULT_STATE } = useQuery({
    queryKey: ['state', selectedDate],
    queryFn: () => loadStateForDate(selectedDate),
    staleTime: isHistorical ? Infinity : 30_000,
    refetchInterval: isHistorical ? false : 600_000,
  })

  // Session list from Supabase for the history picker
  const { data: sessions = [], status: dbStatus } = useQuery({
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

  function buildPastSets(matches: typeof state.matches) {
    const pastPairs = new Set(matches.flatMap(m => [
      [...m.team1].sort().join('|'),
      [...m.team2].sort().join('|'),
    ]))
    const pastOpponents = new Set(matches.flatMap(m => {
      const [a, b] = m.team1, [c, d] = m.team2
      return [[a,c],[a,d],[b,c],[b,d]].map(p => p.sort().join('|'))
    }))
    return { pastPairs, pastOpponents }
  }

  function addToQueue(four: [string, string, string, string]) {
    if (isHistorical) return
    mut.mutate({ ...state, pregenerated: [...(state.pregenerated ?? []), four] })
  }

  function removeFromQueue(idx: number) {
    if (isHistorical) return
    mut.mutate({ ...state, pregenerated: (state.pregenerated ?? []).filter((_, i) => i !== idx) })
  }

  function generateMatches() {
    if (isHistorical) return
    let next = { ...state }
    for (let courtId = 1; courtId <= activeCourts; courtId++) {
      if (next.matches.some(m => m.courtId === courtId && !m.endTime)) continue
      const queue = next.pregenerated ?? []
      let four: Player[] | null = null
      let newQueue = queue
      // use first valid queue item (all 4 still Waiting)
      for (let qi = 0; qi < queue.length; qi++) {
        const fourPlayers = queue[qi]
          .map(id => next.players.find(p => p.id === id && p.status === 'Waiting'))
          .filter((p): p is Player => !!p)
        if (fourPlayers.length === 4) {
          four = fourPlayers
          newQueue = queue.filter((_, i) => i !== qi)
          break
        }
      }
      if (!four) {
        const waiting = next.players.filter(p => p.status === 'Waiting')
        const { pastPairs, pastOpponents } = buildPastSets(next.matches)
        four = findBestFour(waiting, pastPairs, pastOpponents)
        newQueue = queue
      }
      if (!four) break
      const matchNum = next.matchCounter + 1
      next = {
        ...next,
        matchCounter: matchNum,
        pregenerated: newQueue,
        matches: [...next.matches, {
          id: crypto.randomUUID(),
          matchNumber: matchNum,
          courtId,
          team1: [four[0].id, four[1].id],
          team2: [four[2].id, four[3].id],
          startTime: Date.now(),
        }],
        players: next.players.map(p =>
          four!.find(f => f.id === p.id) ? { ...p, status: 'Playing' as PlayerStatus } : p
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

  function editMatchPlayers(matchId: string, team1: [string, string], team2: [string, string]) {
    if (isHistorical) return
    const match = state.matches.find(m => m.id === matchId)!
    const oldIds = new Set([...match.team1, ...match.team2])
    const newIds = new Set([...team1, ...team2])
    mut.mutate({
      ...state,
      matches: state.matches.map(m => m.id === matchId ? { ...m, team1, team2 } : m),
      players: state.players.map(p => {
        if (oldIds.has(p.id) && !newIds.has(p.id)) return { ...p, status: 'Waiting' as PlayerStatus }
        if (!oldIds.has(p.id) && newIds.has(p.id)) return { ...p, status: 'Playing' as PlayerStatus }
        return p
      }),
    })
  }

  function endMatch(matchId: string, shuttlesUsed: number, score: string) {
    if (isHistorical) return
    const match = state.matches.find(m => m.id === matchId)!
    const costPerPlayer = Math.round((shuttlesUsed * state.shuttlePrice) / 4)
    const playerIds = new Set([...match.team1, ...match.team2])
    let next: AppState = {
      ...state,
      matches: state.matches.map(m =>
        m.id === matchId ? { ...m, endTime: Date.now(), shuttlesUsed, score } : m
      ),
      players: state.players.map(p =>
        playerIds.has(p.id)
          ? { ...p, status: 'Waiting' as PlayerStatus, restingSince: Date.now(), totalCost: p.totalCost + costPerPlayer, gamesPlayed: p.gamesPlayed + 1 }
          : p
      ),
    }
    // auto-start first valid queued match on the freed court (queue-only, no fallback)
    const queue = next.pregenerated ?? []
    for (let qi = 0; qi < queue.length; qi++) {
      const fourPlayers = queue[qi]
        .map(id => next.players.find(p => p.id === id && p.status === 'Waiting'))
        .filter((p): p is Player => !!p)
      if (fourPlayers.length === 4) {
        const matchNum = next.matchCounter + 1
        next = {
          ...next,
          matchCounter: matchNum,
          pregenerated: queue.filter((_, i) => i !== qi),
          matches: [...next.matches, {
            id: crypto.randomUUID(),
            matchNumber: matchNum,
            courtId: match.courtId,
            team1: [fourPlayers[0].id, fourPlayers[1].id],
            team2: [fourPlayers[2].id, fourPlayers[3].id],
            startTime: Date.now(),
          }],
          players: next.players.map(p =>
            fourPlayers.find(f => f.id === p.id) ? { ...p, status: 'Playing' as PlayerStatus } : p
          ),
        }
        break
      }
    }
    mut.mutate(next)
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
          {/* Session picker */}
          <div style={{ position: 'relative' }}>
            <select
              className="session-select"
              value={selectedDate}
              onChange={e => {
                if (e.target.value === '__pick__') { setPickingDate(true); return }
                setSelectedDate(e.target.value)
              }}
            >
              <option value={TODAY}>Hari Ini ({TODAY})</option>
              {pastSessions.map(s => (
                <option key={s.session_date} value={s.session_date}>
                  {s.session_date} — {s.player_count} pemain · {s.total_shuttles} bola
                </option>
              ))}
              <option value="__pick__">📅 Pilih tanggal…</option>
            </select>
            {pickingDate && (
              <CalendarPicker
                value={selectedDate}
                onSelect={setSelectedDate}
                onClose={() => setPickingDate(false)}
              />
            )}
          </div>

          <div className="player-count-badge">
            <strong>{activePlayers}</strong> / {state.targetPlayers}
          </div>

          <div className="db-badge" title={
            !supabase ? 'Supabase tidak dikonfigurasi' :
            dbStatus === 'error' ? 'Gagal terhubung ke Supabase' :
            dbStatus === 'success' ? 'Terhubung ke Supabase' : 'Menghubungkan…'
          }>
            <div className={`db-dot ${!supabase || dbStatus === 'error' ? 'off' : dbStatus === 'success' ? 'on' : 'pending'}`} />
            {!supabase ? 'Local' : dbStatus === 'error' ? 'DB ✗' : dbStatus === 'success' ? 'DB' : 'DB…'}
          </div>

          <button className="btn btn-ghost btn-sm" onClick={() => setLedgerOpen(true)} title="Biaya Bola">💰</button>
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
                className="btn btn-ghost btn-sm"
                onClick={() => setQueueOpen(true)}
              >
                ⚡ Antri Match
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
            {(() => {
              // assign queue items to empty courts in order
              const queue = state.pregenerated ?? []
              let qi = 0
              return Array.from({ length: activeCourts }, (_, i) => i + 1).map(courtId => {
                const matchId = activeMatchMap.get(courtId)
                const match   = matchId ? state.matches.find(m => m.id === matchId) : undefined
                let upcoming: Player[] | undefined
                if (!match && qi < queue.length) {
                  const four = queue[qi++]
                  const players = four.map(id => state.players.find(p => p.id === id)).filter((p): p is Player => !!p)
                  if (players.length === 4) upcoming = players
                }
                return (
                  <CourtCard
                    key={courtId}
                    courtId={courtId}
                    match={match}
                    players={state.players}
                    upcoming={upcoming}
                    onEndMatch={isHistorical ? undefined : endMatch}
                    onEditPlayers={isHistorical ? undefined : editMatchPlayers}
                  />
                )
              })
            })()}
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

          {(state.pregenerated ?? []).length > 0 && (
            <div className="waiting-section" style={{ marginTop: 12 }}>
              <div className="section-title">
                <span>⚡ Antrian Match</span>
                <span>{(state.pregenerated ?? []).length} antrian</span>
              </div>
              <div className="match-history-grid">
                {(state.pregenerated ?? []).map((four, idx) => {
                  const n = (id: string) => state.players.find(p => p.id === id)?.name ?? '?'
                  return (
                    <div key={idx} className="mh-card" style={{ borderLeft: '3px solid var(--gold)' }}>
                      <div className="mh-card-header">
                        <span className="mh-num">#{idx + 1}</span>
                        {!isHistorical && (
                          <button onClick={() => removeFromQueue(idx)}
                            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>✕</button>
                        )}
                      </div>
                      <div className="mh-team" style={{ color: 'var(--gold)' }}>{n(four[0])} · {n(four[1])}</div>
                      <div className="mh-vs">vs</div>
                      <div className="mh-team" style={{ color: '#4fc3f7' }}>{n(four[2])} · {n(four[3])}</div>
                    </div>
                  )
                })}
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
                  .sort((a, b) => b.matchNumber - a.matchNumber)
                  .map(m => {
                    const n = (id: string) => state.players.find(p => p.id === id)?.name ?? '?'
                    return (
                      <div key={m.id} className="mh-card">
                        <div className="mh-card-header">
                          <span className="mh-num">#{m.matchNumber}</span>
                          {editingMatch?.id === m.id ? (
                            <input
                              type="number" inputMode="numeric" min={0}
                              value={editingMatch.bola}
                              onChange={e => setEditingMatch(em => em && ({ ...em, bola: +e.target.value }))}
                              style={{ width: 52, fontSize: 11, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 4px' }}
                            />
                          ) : (
                            <span
                              className="mh-bola-tag"
                              style={!isHistorical ? { cursor: 'pointer' } : undefined}
                              onClick={() => !isHistorical && setEditingMatch({ id: m.id, bola: m.shuttlesUsed ?? 0, scoreL: (m.score ?? '').split('-')[0] ?? '', scoreR: (m.score ?? '').split('-')[1] ?? '' })}
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
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4 }}>
                              <input
                                type="number" inputMode="numeric" min={0}
                                value={editingMatch.scoreL}
                                placeholder="Skor"
                                onChange={e => setEditingMatch(em => em && ({ ...em, scoreL: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') editMatch(m.id, editingMatch.bola, editingMatch.scoreL !== '' || editingMatch.scoreR !== '' ? `${editingMatch.scoreL}-${editingMatch.scoreR}` : '') }}
                                style={{ width: 44, fontSize: 11, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px' }}
                              />
                              <span style={{ color: 'var(--muted)', flexShrink: 0 }}>–</span>
                              <input
                                type="number" inputMode="numeric" min={0}
                                value={editingMatch.scoreR}
                                placeholder="Skor"
                                onChange={e => setEditingMatch(em => em && ({ ...em, scoreR: e.target.value }))}
                                onKeyDown={e => { if (e.key === 'Enter') editMatch(m.id, editingMatch.bola, editingMatch.scoreL !== '' || editingMatch.scoreR !== '' ? `${editingMatch.scoreL}-${editingMatch.scoreR}` : '') }}
                                style={{ width: 44, fontSize: 11, background: 'var(--surface)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 4px' }}
                              />
                            </div>
                            <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                              <button className="btn btn-primary btn-sm" style={{ flex: 1, fontSize: 10, padding: '2px 6px' }}
                                onClick={() => editMatch(m.id, editingMatch.bola, editingMatch.scoreL !== '' || editingMatch.scoreR !== '' ? `${editingMatch.scoreL}-${editingMatch.scoreR}` : '')}>
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

        {ledgerOpen && <div className="drawer-backdrop" onClick={() => setLedgerOpen(false)} />}
        <LedgerPanel state={state} open={ledgerOpen} onClose={() => setLedgerOpen(false)} />
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

      {queueOpen && (
        <AddToQueueModal
          state={state}
          onSubmit={four => { addToQueue(four); setQueueOpen(false) }}
          onClose={() => setQueueOpen(false)}
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

// ── Add to Queue modal ────────────────────────────────────────────────────────

interface AddQueueProps {
  state: AppState
  onSubmit: (four: [string, string, string, string]) => void
  onClose: () => void
}

function AddToQueueModal({ state, onSubmit, onClose }: AddQueueProps) {
  const [selected, setSelected] = useState<string[]>([])

  const waiting = [...state.players].filter(p => p.status === 'Waiting').sort((a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0))
  const playing = state.players.filter(p => p.status === 'Playing')

  function toggle(id: string) {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 4 ? [...s, id] : s)
  }

  const ready = selected.length === 4

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>⚡ Antri Match</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="config-form">
            <div>
              <label className="config-label">
                Pilih 4 Pemain ({selected.length}/4) — urutan: Tim 1 (1,2) vs Tim 2 (3,4)
              </label>
              {[{ label: 'Belum Main', list: waiting }, { label: 'Sedang Main', list: playing }].map(({ label, list }) =>
                list.length > 0 && (
                  <div key={label} style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>{label.toUpperCase()}</div>
                    <div className="waiting-grid">
                      {list.map(p => {
                        const idx = selected.indexOf(p.id)
                        const isTeam1 = idx === 0 || idx === 1
                        return (
                          <div key={p.id} className="waiting-chip" onClick={() => toggle(p.id)}
                            style={{
                              cursor: 'pointer',
                              outline: idx >= 0 ? `2px solid ${isTeam1 ? 'var(--gold)' : '#4fc3f7'}` : 'none',
                              opacity: selected.length === 4 && idx < 0 ? 0.4 : 1,
                            }}>
                            {idx >= 0 && <span style={{ fontSize: 10, fontWeight: 800, color: isTeam1 ? 'var(--gold)' : '#4fc3f7', minWidth: 14 }}>{idx + 1}</span>}
                            <div className={`status-dot ${p.status === 'Playing' ? 'playing' : 'waiting'}`} />
                            <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                            {p.name}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              )}
            </div>

            {selected.length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ color: 'var(--gold)' }}>
                  Tim 1: {selected.slice(0,2).map(id => state.players.find(p => p.id === id)?.name ?? '?').join(' · ')}
                </span>
                {selected.length > 2 && (
                  <span style={{ color: '#4fc3f7' }}>
                    Tim 2: {selected.slice(2,4).map(id => state.players.find(p => p.id === id)?.name ?? '?').join(' · ')}
                  </span>
                )}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-primary"
                style={{ flex: 1 }}
                disabled={!ready}
                onClick={() => onSubmit(selected as [string, string, string, string])}
              >
                Tambah ke Antrian
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Batal</button>
            </div>
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

  // ponytail: longest-resting first so picker naturally shows the "due" players at the top
  const waiting = state.players
    .filter((p: Player) => p.status === 'Waiting')
    .sort((a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0))

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

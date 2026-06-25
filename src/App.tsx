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
import { PlayerPanel, TYPE_COLOR, teamType } from './components/PlayerPanel'
import { CalendarPicker } from './components/CalendarPicker'

const TODAY = new Date().toLocaleDateString('en-CA')  // YYYY-MM-DD, valid for date column

export function App() {
  const qc = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [pickingDate, setPickingDate] = useState(false)
  const [playerPanelOpen, setPlayerPanelOpen] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [editingQueueIdx, setEditingQueueIdx] = useState<number | null>(null)
  const [logoError, setLogoError] = useState(false)
  const [editingMatch, setEditingMatch] = useState<{ id: string; bola: number; scoreL: string; scoreR: string } | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [assignQueueIdx, setAssignQueueIdx] = useState<number | null>(null)

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
  const allCourtIds    = Array.from({ length: activeCourts }, (_, i) => i + 1)
  const freeCourts     = allCourtIds.filter(id => !activeMatchMap.has(id))
  const waitingPlayers = state.players.filter(p => p.status === 'Waiting')
  const waitingInQueue = [...waitingPlayers].filter(p => p.gamesPlayed > 0).sort((a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0))
  const waitingNotYet  = waitingPlayers.filter(p => p.gamesPlayed === 0)
  const queuedIds = new Set((state.pregenerated ?? []).flat())
  // ponytail: include Playing players so machine can pre-queue full rotation; auto-start skips them until they're Waiting
  const availableForQueue = state.players.filter(p => p.status !== 'Left' && !queuedIds.has(p.id))
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

  function replaceInQueue(idx: number, four: [string, string, string, string]) {
    if (isHistorical) return
    mut.mutate({ ...state, pregenerated: (state.pregenerated ?? []).map((item, i) => i === idx ? four : item) })
  }

  function generateOneToQueue() {
    if (isHistorical) return
    const { pastPairs, pastOpponents } = buildPastSets(state.matches)
    const four = findBestFour(availableForQueue, pastPairs, pastOpponents)
    if (!four) return
    addToQueue([four[0].id, four[1].id, four[2].id, four[3].id])
  }

  function startFromQueue(queueIdx: number, courtId: number) {
    if (isHistorical) return
    const queue = state.pregenerated ?? []
    const four = queue[queueIdx]
      ?.map(id => state.players.find(p => p.id === id && p.status === 'Waiting'))
      .filter((p): p is Player => !!p)
    if (!four || four.length !== 4) return
    const matchNum = state.matchCounter + 1
    mut.mutate({
      ...state,
      matchCounter: matchNum,
      pregenerated: queue.filter((_, i) => i !== queueIdx),
      matches: [...state.matches, {
        id: crypto.randomUUID(),
        matchNumber: matchNum,
        courtId,
        team1: [four[0].id, four[1].id],
        team2: [four[2].id, four[3].id],
        startTime: Date.now(),
      }],
      players: state.players.map(p =>
        four!.find(f => f.id === p.id) ? { ...p, status: 'Playing' as PlayerStatus } : p
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

  function deleteMatch(matchId: string) {
    if (!confirm('Hapus match ini? Biaya shuttle akan dikembalikan.')) return
    const match = state.matches.find(m => m.id === matchId)!
    const cost = Math.round(((match.shuttlesUsed ?? 0) * state.shuttlePrice) / 4)
    const playerIds = new Set([...match.team1, ...match.team2])
    mut.mutate({
      ...state,
      matches: state.matches.filter(m => m.id !== matchId),
      players: cost === 0 ? state.players : state.players.map(p =>
        playerIds.has(p.id) ? { ...p, totalCost: p.totalCost - cost } : p
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
            <button className="btn btn-ghost btn-sm session-select" onClick={() => setPickingDate(true)}>
              📅 {selectedDate.slice(8)}/{selectedDate.slice(5,7)}/{selectedDate.slice(2,4)}{selectedDate === TODAY ? ' ✦' : ''}
            </button>
            {pickingDate && (
              <CalendarPicker
                value={selectedDate}
                onSelect={setSelectedDate}
                onClose={() => setPickingDate(false)}
              />
            )}
          </div>

          <div className="player-count-badge" style={{ cursor: 'pointer' }} onClick={() => setPlayerPanelOpen(true)}>
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
                className="btn btn-primary btn-sm"
                onClick={generateOneToQueue}
                disabled={availableForQueue.length < 4}
              >
                ▶ Antri Match (Machine)
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
              const queue = state.pregenerated ?? []
              let qi = 0
              return Array.from({ length: activeCourts }, (_, i) => i + 1).map(courtId => {
                const matchId = activeMatchMap.get(courtId)
                const match   = matchId ? state.matches.find(m => m.id === matchId) : undefined
                let upcoming: Player[] | undefined
                let upcomingIdx: number | undefined
                if (!match && qi < queue.length) {
                  const four = queue[qi]
                  const players = four.map(id => state.players.find(p => p.id === id)).filter((p): p is Player => !!p)
                  if (players.length === 4) { upcoming = players; upcomingIdx = qi }
                  qi++
                }
                const capturedIdx = upcomingIdx
                return (
                  <CourtCard
                    key={courtId}
                    courtId={courtId}
                    match={match}
                    players={state.players}
                    upcoming={upcoming}
                    onEndMatch={isHistorical ? undefined : endMatch}
                    onEditPlayers={isHistorical ? undefined : editMatchPlayers}
                    onStart={!isHistorical && capturedIdx !== undefined ? () => startFromQueue(capturedIdx, courtId) : undefined}
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
              {waitingInQueue.length > 0 && (
                <>
                  <div className="waiting-sub-label">Menunggu</div>
                  <div className="waiting-grid">
                    {waitingInQueue.map(p => (
                      <div key={p.id} className="waiting-chip">
                        <div className="status-dot waiting" />
                        <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                        {p.name}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {waitingNotYet.length > 0 && (
                <>
                  <div className="waiting-sub-label">Belum Main</div>
                  <div className="waiting-grid">
                    {waitingNotYet.map(p => (
                      <div key={p.id} className="waiting-chip">
                        <div className="status-dot waiting" />
                        <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                        {p.name}
                      </div>
                    ))}
                  </div>
                </>
              )}
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
                  const allReady = four.every(id => state.players.find(p => p.id === id)?.status === 'Waiting')
                  return (
                    <div key={idx} className="mh-card" style={{ borderLeft: '3px solid var(--gold)', cursor: !isHistorical ? 'pointer' : undefined }}
                      onClick={() => !isHistorical && setEditingQueueIdx(idx)}>
                      <div className="mh-card-header">
                        <span className="mh-num">#{idx + 1}</span>
                        {!isHistorical && (
                          <button onClick={e => { e.stopPropagation(); removeFromQueue(idx) }}
                            style={{ background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 13, padding: '0 2px', lineHeight: 1 }}>✕</button>
                        )}
                      </div>
                      <div className="mh-team" style={{ color: 'var(--gold)' }}>{n(four[0])} · {n(four[1])}</div>
                      <div className="mh-vs">vs</div>
                      <div className="mh-team" style={{ color: '#4fc3f7' }}>{n(four[2])} · {n(four[3])}</div>
                      {!isHistorical && (
                        <div style={{ display: 'flex', gap: 4, marginTop: 6 }} onClick={e => e.stopPropagation()}>
                          <button
                            className="btn btn-primary btn-sm"
                            style={{ flex: 1, fontSize: 10 }}
                            disabled={!allReady || freeCourts.length === 0}
                            onClick={() => startFromQueue(idx, freeCourts[0])}
                          >
                            ⚡ Auto
                          </button>
                          <button
                            className="btn btn-ghost btn-sm"
                            style={{ flex: 1, fontSize: 10 }}
                            disabled={!allReady || freeCourts.length === 0}
                            onClick={() => setAssignQueueIdx(idx)}
                          >
                            📍 Pilih
                          </button>
                        </div>
                      )}
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
                    const ns = (id: string) => { const pl = state.players.find(p => p.id === id); return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}><span style={{ color: 'var(--text)', fontWeight: 700 }}>{pl?.name ?? '?'}</span><span className={`skill-badge skill-${pl?.skill ?? 'B1'}`}>{pl?.skill ?? '?'}</span></span> }
                    const t1t = teamType(m.team1, state.players)
                    const t2t = teamType(m.team2, state.players)
                    return (
                      <div key={m.id} className="mh-card"
                        style={{ borderLeft: `3px solid ${TYPE_COLOR[t1t]}`, ...(!isHistorical ? { cursor: 'pointer' } : {}) }}
                        onClick={() => !isHistorical && setEditingMatch({ id: m.id, bola: m.shuttlesUsed ?? 0, scoreL: (m.score ?? '').split('-')[0] ?? '', scoreR: (m.score ?? '').split('-')[1] ?? '' })}
                      >
                        <div className="mh-card-header">
                          <span className="mh-num">#{m.matchNumber}</span>
                          <span style={{ fontSize: 10, display: 'flex', gap: 2, alignItems: 'center', background: 'var(--bg)', borderRadius: 3, padding: '1px 5px' }}>
                            <span style={{ color: TYPE_COLOR[t1t], fontWeight: 700 }}>{t1t}</span>
                            <span style={{ color: 'var(--dim)' }}>vs</span>
                            <span style={{ color: TYPE_COLOR[t2t], fontWeight: 700 }}>{t2t}</span>
                          </span>
                          <span className="mh-bola-tag">
                            {m.shuttlesUsed ?? 0} bola{!isHistorical && ' ✏'}
                          </span>
                        </div>
                        <div className="mh-team">{ns(m.team1[0])} · {ns(m.team1[1])}</div>
                        <div className="mh-vs">vs</div>
                        <div className="mh-team">{ns(m.team2[0])} · {ns(m.team2[1])}</div>
                        {m.score && <div className="mh-score">{m.score}</div>}
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

      {editingMatch && (
        <EditMatchModal
          editingMatch={editingMatch}
          setEditingMatch={setEditingMatch}
          onSave={editMatch}
          onDelete={deleteMatch}
        />
      )}

      {/* ── Player panel (today only) ── */}
      {!isHistorical && (
        <PlayerPanel
          open={playerPanelOpen}
          onClose={() => setPlayerPanelOpen(false)}
          state={state}
          onUpdate={s => mut.mutate(s)}
        />
      )}

      {queueOpen && (
        <AddToQueueModal
          state={state}
          onSubmit={four => { addToQueue(four); setQueueOpen(false) }}
          onClose={() => setQueueOpen(false)}
        />
      )}

      {assignQueueIdx !== null && (
        <AssignCourtModal
          allCourts={allCourtIds}
          freeCourts={freeCourts}
          onAssign={courtId => { startFromQueue(assignQueueIdx, courtId); setAssignQueueIdx(null) }}
          onClose={() => setAssignQueueIdx(null)}
        />
      )}

      {editingQueueIdx !== null && (
        <AddToQueueModal
          state={state}
          initialSelected={(state.pregenerated ?? [])[editingQueueIdx] ?? []}
          submitLabel="Simpan Antrian"
          onSubmit={four => { replaceInQueue(editingQueueIdx, four); setEditingQueueIdx(null) }}
          onClose={() => setEditingQueueIdx(null)}
        />
      )}

      {configOpen && (
        <ConfigModal
          state={state}
          onSave={s => { mut.mutate(s); setConfigOpen(false) }}
          onClose={() => setConfigOpen(false)}
          onHardReset={async () => {
            if (!confirm(`HARD RESET: hapus semua data hari ini (${TODAY})? Ini tidak bisa dibatalkan.`)) return
            await persistState(TODAY, DEFAULT_STATE)
            window.location.reload()
          }}
        />
      )}
    </div>
  )
}

// ── Assign Court modal ───────────────────────────────────────────────────────

function AssignCourtModal({ allCourts, freeCourts, onAssign, onClose }: {
  allCourts: number[], freeCourts: number[],
  onAssign: (courtId: number) => void, onClose: () => void
}) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 320 }}>
        <div className="modal-header">
          <h2>Pilih Lapangan</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {allCourts.map(id => {
              const free = freeCourts.includes(id)
              return (
                <button
                  key={id}
                  className={`btn ${free ? 'btn-primary' : 'btn-ghost'}`}
                  disabled={!free}
                  style={{ flexDirection: 'column', height: 56, lineHeight: 1.3 }}
                  onClick={() => onAssign(id)}
                >
                  <span>Lapangan {id}</span>
                  <span style={{ fontSize: 10, opacity: 0.75 }}>{free ? 'Kosong ✓' : 'Sedang dipakai'}</span>
                </button>
              )
            })}
          </div>
        </div>
      </div>
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
    harianFee:     state.harianFee ?? 25000,
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
              <label className="config-label">Biaya Harian (Rp)</label>
              <input className="config-input" type="number" min={0} value={form.harianFee}
                onChange={e => setForm(f => ({ ...f, harianFee: +e.target.value }))} />
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
  initialSelected?: string[]
  submitLabel?: string
  onSubmit: (four: [string, string, string, string]) => void
  onClose: () => void
}

function AddToQueueModal({ state, initialSelected, submitLabel, onSubmit, onClose }: AddQueueProps) {
  const [selected, setSelected] = useState<string[]>(initialSelected ?? [])
  const [warning, setWarning] = useState<string | null>(null)

  const notYetPlayed = [...state.players].filter(p => p.status === 'Waiting' && p.gamesPlayed === 0)
  const inQueue      = [...state.players].filter(p => p.status === 'Waiting' && p.gamesPlayed > 0).sort((a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0))
  const playing      = state.players.filter(p => p.status === 'Playing')

  const pastPairs = new Set(state.matches.flatMap(m => [
    [...m.team1].sort().join('|'),
    [...m.team2].sort().join('|'),
  ]))
  const pastOpponents = new Set(state.matches.flatMap(m => {
    const [a, b] = m.team1, [c, d] = m.team2
    return [[a,c],[a,d],[b,c],[b,d]].map(p => [...p].sort().join('|'))
  }))

  function toggle(id: string) {
    setWarning(null)
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 4 ? [...s, id] : s)
  }

  function checkAndSubmit() {
    if (selected.length !== 4) return
    const [a, b, c, d] = selected
    const pk = (x: string, y: string) => [x, y].sort().join('|')
    const partnerConflict = pastPairs.has(pk(a, b)) || pastPairs.has(pk(c, d))
    const opponentConflict = [pk(a,c), pk(a,d), pk(b,c), pk(b,d)].some(k => pastOpponents.has(k))
    if (partnerConflict || opponentConflict) {
      const msgs = []
      if (partnerConflict) msgs.push('pasangan ini pernah main bersama')
      if (opponentConflict) msgs.push('ada pemain yang pernah bertemu sebagai lawan')
      setWarning(msgs.join(' & '))
    } else {
      onSubmit(selected as [string, string, string, string])
    }
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
              {[{ label: 'Belum Main', list: notYetPlayed }, { label: 'Antrian Menunggu', list: inQueue }, { label: 'Sedang Main', list: playing }].map(({ label, list }) =>
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

            {warning ? (
              <div style={{ background: 'rgba(255,200,0,0.08)', border: '1px solid var(--gold)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700, marginBottom: 6 }}>⚠ Peringatan</div>
                <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 10, textTransform: 'capitalize' }}>{warning}. Tetap lanjutkan?</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => onSubmit(selected as [string, string, string, string])}>
                    Lanjutkan
                  </button>
                  <button className="btn btn-ghost" onClick={() => setWarning(null)}>Ganti Pemain</button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ flex: 1 }}
                  disabled={!ready}
                  onClick={checkAndSubmit}
                >
                  {submitLabel ?? 'Tambah ke Antrian'}
                </button>
                <button className="btn btn-ghost" onClick={onClose}>Batal</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Edit Match modal ──────────────────────────────────────────────────────────

type EditingMatch = { id: string; bola: number; scoreL: string; scoreR: string }

function EditMatchModal({ editingMatch, setEditingMatch, onSave, onDelete }: {
  editingMatch: EditingMatch
  setEditingMatch: (v: EditingMatch | null) => void
  onSave: (matchId: string, bola: number, score: string) => void
  onDelete: (matchId: string) => void
}) {
  const score = editingMatch.scoreL !== '' || editingMatch.scoreR !== ''
    ? `${editingMatch.scoreL}-${editingMatch.scoreR}` : ''
  const set = (patch: Partial<EditingMatch>) => setEditingMatch({ ...editingMatch, ...patch })
  return (
    <div className="modal-overlay" onClick={() => setEditingMatch(null)}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 280 }}>
        <div className="modal-header">
          <h2>Edit Match</h2>
          <button className="btn btn-ghost btn-sm" onClick={() => setEditingMatch(null)}>✕</button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <label className="config-label">Bola</label>
            <input
              type="number" inputMode="numeric" min={0}
              className="config-input"
              value={editingMatch.bola}
              onChange={e => set({ bola: +e.target.value })}
            />
          </div>
          <div>
            <label className="config-label">Skor</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number" inputMode="numeric" min={0}
                className="config-input"
                placeholder="Tim 1"
                value={editingMatch.scoreL}
                onChange={e => set({ scoreL: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') onSave(editingMatch.id, editingMatch.bola, score) }}
              />
              <span style={{ color: 'var(--muted)', flexShrink: 0 }}>–</span>
              <input
                type="number" inputMode="numeric" min={0}
                className="config-input"
                placeholder="Tim 2"
                value={editingMatch.scoreR}
                onChange={e => set({ scoreR: e.target.value })}
                onKeyDown={e => { if (e.key === 'Enter') onSave(editingMatch.id, editingMatch.bola, score) }}
              />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" style={{ flex: 1 }}
              onClick={() => onSave(editingMatch.id, editingMatch.bola, score)}>
              Simpan
            </button>
            <button className="btn btn-ghost" onClick={() => setEditingMatch(null)}>
              Batal
            </button>
          </div>
          <div style={{ borderTop: '1px solid var(--border-s)', paddingTop: 12, marginTop: 4 }}>
            <button className="btn btn-ghost" style={{ width: '100%', color: 'var(--red, #ef4444)' }}
              onClick={() => onDelete(editingMatch.id)}>
              Hapus Match
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

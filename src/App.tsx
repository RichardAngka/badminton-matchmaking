import { useState, useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
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
import { matchCostByPlayer, playerTotal } from './ledgerMath'
import { useIsAdmin } from './RoleContext'

const TODAY = new Date().toLocaleDateString('en-CA')  // YYYY-MM-DD, valid for date column

export function App() {
  const qc = useQueryClient()
  const [selectedDate, setSelectedDate] = useState(TODAY)
  const [pickingDate, setPickingDate] = useState(false)
  const [configOpen, setConfigOpen] = useState(false)
  const [queueOpen, setQueueOpen] = useState(false)
  const [editingQueueIdx, setEditingQueueIdx] = useState<number | null>(null)
  const [logoError, setLogoError] = useState(false)
  const [editingMatch, setEditingMatch] = useState<{ id: string; bola: number; scoreL: string; scoreR: string } | null>(null)
  const [ledgerOpen, setLedgerOpen] = useState(false)
  const [assignQueueIdx, setAssignQueueIdx] = useState<number | null>(null)
  const [waitingTab, setWaitingTab] = useState<'menunggu' | 'antrian'>('menunggu')
  const { pathname } = useLocation()
  const navigate = useNavigate()
  type Tab = 'lapangan' | 'menunggu' | 'antrian' | 'riwayat' | 'pemain'
  const ROUTE_TAB: Record<string, Tab> = {
    '/': 'lapangan',
    '/waiting-player': 'menunggu',
    '/waiting-list': 'antrian',
    '/history': 'riwayat',
    '/player': 'pemain',
  }
  const TAB_ROUTE: Record<Tab, string> = {
    lapangan: '/',
    menunggu: '/waiting-player',
    antrian: '/waiting-list',
    riwayat: '/history',
    pemain: '/player',
  }
  const mainTab: Tab = ROUTE_TAB[pathname] ?? 'lapangan'
  const setMainTab = (tab: Tab) => navigate(TAB_ROUTE[tab])

  const isAdmin = useIsAdmin()
  const isHistorical = !isAdmin  // ponytail: false for admin (full edit), true for viewer (read-only)

  // Main state query — keyed by date so switching sessions re-fetches cleanly
  const { data: state = DEFAULT_STATE } = useQuery({
    queryKey: ['state', selectedDate],
    queryFn: () => loadStateForDate(selectedDate),
    staleTime: isHistorical ? Infinity : 30_000,
    // Fallback poll every 60s in case Realtime WebSocket drops
    refetchInterval: isHistorical ? false : 60_000,
  })

  // Supabase Realtime: invalidate cache the moment any other client saves changes
  useEffect(() => {
    if (!supabase || isHistorical) return
    const channel = supabase
      .channel(`session-${selectedDate}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'sessions', filter: `session_date=eq.${selectedDate}` },
        () => { qc.invalidateQueries({ queryKey: ['state', selectedDate] }) },
      )
      .subscribe()
    return () => { supabase?.removeChannel(channel) }
  }, [selectedDate, isHistorical, qc])

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
  const queuedIds      = new Set((state.pregenerated ?? []).flat())
  const waitingPlayers = state.players.filter(p => p.status === 'Waiting')
  const waitingQueued  = [...waitingPlayers].filter(p => queuedIds.has(p.id))
  const waitingInQueue = [...waitingPlayers].filter(p => p.gamesPlayed > 0 && !queuedIds.has(p.id)).sort((a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0))
  const waitingNotYet  = waitingPlayers.filter(p => p.gamesPlayed === 0 && !queuedIds.has(p.id))
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

  const finished = state.matches.filter(m => m.endTime)
  const fmtDate = `${selectedDate.slice(8)}/${selectedDate.slice(5,7)}/${selectedDate.slice(2,4)}`
  const TAB_META: Record<typeof mainTab, { title: string; sub: string }> = {
    lapangan: { title: 'Dashboard', sub: 'Lapangan aktif & aktivitas terkini' },
    menunggu: { title: 'Menunggu', sub: 'Pemain siap masuk antrian' },
    antrian:  { title: 'Antrian', sub: 'Match yang sudah disusun' },
    riwayat:  { title: 'Riwayat', sub: 'Pertandingan selesai hari ini' },
    pemain:   { title: 'Pemain', sub: 'Kelola pemain & check-in' },
  }
  const meta = TAB_META[mainTab]
  const nm = (id: string) => state.players.find(p => p.id === id)?.name ?? '?'
  const fmtDur = (ms: number) => { const s = Math.floor(ms / 1000); return `${String(Math.floor(s / 60)).padStart(2,'0')}:${String(s % 60).padStart(2,'0')}` }

  return (
    <>
    <div className="app-shell">
      {/* ── Sidebar ── */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          {logoError
            ? <div className="brand-logo-fallback">SOR</div>
            : <img className="brand-logo" src="/Logo PB SOR.png" alt="PB. SOR" onError={() => setLogoError(true)} />}
          <div className="brand-text">
            <span className="brand-name">PB SOR</span>
            <span className="brand-sub">Matchmaking</span>
          </div>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item${mainTab === 'lapangan' ? ' active' : ''}`} onClick={() => setMainTab('lapangan')}>
            <Icon name="grid" /><span>Dashboard</span>
            {activeMatchMap.size > 0 && <span className="nav-count">{activeMatchMap.size}</span>}
          </button>
          <button className={`nav-item${mainTab === 'menunggu' ? ' active' : ''}`} onClick={() => setMainTab('menunggu')}>
            <Icon name="clock" /><span>Menunggu</span>
            {waitingPlayers.length > 0 && <span className="nav-count">{waitingPlayers.length}</span>}
          </button>
          <button className={`nav-item${mainTab === 'antrian' ? ' active' : ''}`} onClick={() => setMainTab('antrian')}>
            <Icon name="bolt" /><span>Antrian</span>
            {(state.pregenerated ?? []).length > 0 && <span className="nav-count">{(state.pregenerated ?? []).length}</span>}
          </button>
          <button className={`nav-item${mainTab === 'riwayat' ? ' active' : ''}`} onClick={() => setMainTab('riwayat')}>
            <Icon name="history" /><span>Riwayat</span>
            {finished.length > 0 && <span className="nav-count">{finished.length}</span>}
          </button>
          <button className={`nav-item${mainTab === 'pemain' ? ' active' : ''}`} onClick={() => setMainTab('pemain')}>
            <Icon name="users" /><span>Pemain</span>
            {state.players.filter(p => p.status !== 'Left').length > 0 && <span className="nav-count">{state.players.filter(p => p.status !== 'Left').length}</span>}
          </button>
        </nav>
        <div className="sidebar-foot">
          <button className="nav-item" style={{ color: 'var(--muted)' }}
            onClick={() => supabase?.auth.signOut()} title="Keluar">
            <Icon name="logout" /><span>Keluar</span>
          </button>
        </div>
      </aside>

      {/* ── Workspace ── */}
      <div className="workspace">
        <header className="topbar">
          <div className="topbar-title">
            <h1>{meta.title}</h1>
            <span className="topbar-sub">{meta.sub}</span>
          </div>
          <div className="topbar-actions">
            <div style={{ position: 'relative' }}>
              <button className="chip-btn" onClick={() => setPickingDate(true)}>
                📅 <span className="full-date">{fmtDate}{selectedDate === TODAY ? ' ✦' : ''}</span>
              </button>
              {pickingDate && (
                <CalendarPicker value={selectedDate} onSelect={setSelectedDate} onClose={() => setPickingDate(false)} />
              )}
            </div>
            <div className="player-count-badge" style={{ cursor: 'pointer' }} onClick={() => setMainTab('pemain')}>
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
            <button className="icon-btn" onClick={() => setLedgerOpen(true)} title="Live Ledger"><Icon name="wallet" /></button>
            {isAdmin && <button className="icon-btn" onClick={() => setConfigOpen(true)} title="Konfigurasi"><Icon name="gear" /></button>}
            <button className="btn btn-primary new-match-btn" onClick={() => setQueueOpen(true)} disabled={isHistorical}>
              <Icon name="plus" /> New Match
            </button>
          </div>
        </header>

        <div className="workspace-body">
          {!isHistorical && (mainTab === 'lapangan' || mainTab === 'antrian') && (
            <div className="controls-bar">
              <button
                className="btn btn-primary btn-sm"
                onClick={generateOneToQueue}
                disabled={availableForQueue.length < 4}
              >
                ⚡ Antri Otomatis
              </button>
              {slot && (
                <div className="slot-tag">
                  <strong>{slot.start}–{slot.end}</strong>
                  {slot.courts} lapangan
                </div>
              )}
            </div>
          )}

          {mainTab === 'lapangan' && (
            <>
            <section className="ws-section">
              <div className="ws-head">
                <div className="ws-head-l">
                  <h2>Active Courts</h2>
                  <span className="ws-head-sub">Live matches in progress</span>
                </div>
                <span className="ws-pill">{activeMatchMap.size} / {activeCourts} aktif</span>
              </div>
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
            </section>

            <section className="ws-section">
              <div className="ws-head">
                <div className="ws-head-l">
                  <h2>Recent Activity</h2>
                  <span className="ws-head-sub">Match terakhir yang selesai</span>
                </div>
              </div>
              {finished.length === 0 ? (
                <div className="activity-empty">Belum ada match selesai.<br />Mulai dari Lapangan, lalu isi bola &amp; skor lalu klik <strong>Selesai</strong>.</div>
              ) : (
                <div className="activity-list">
                  {[...finished].sort((a, b) => b.matchNumber - a.matchNumber).slice(0, 5).map(m => (
                    <div key={m.id} className="activity-row"
                      onClick={() => !isHistorical && setEditingMatch({ id: m.id, bola: m.shuttlesUsed ?? 0, scoreL: (m.score ?? '').split('-')[0] ?? '', scoreR: (m.score ?? '').split('-')[1] ?? '' })}>
                      <div className="activity-icon"><Icon name="flag" /></div>
                      <div className="activity-main">
                        <div className="activity-title">Match #{m.matchNumber}<span style={{ color: 'var(--dim)', fontWeight: 500 }}>· Court {m.courtId}</span>{m.endTime && <span className="match-timer">{fmtDur(m.endTime - m.startTime)}</span>}</div>
                        <div className="activity-meta">{nm(m.team1[0])} · {nm(m.team1[1])}　vs　{nm(m.team2[0])} · {nm(m.team2[1])}</div>
                      </div>
                      {m.score
                        ? <div className="activity-score">{m.score}</div>
                        : <div className="activity-score" style={{ color: 'var(--dim)', fontSize: 13 }}>{m.shuttlesUsed ?? 0} bola</div>}
                    </div>
                  ))}
                </div>
              )}
            </section>
            </>
          )}

          {mainTab === 'menunggu' && waitingPlayers.length === 0 && (
            <div className="activity-empty">Belum ada pemain menunggu.<br />Tambah pemain lewat menu <strong>Pemain</strong>.</div>
          )}

          {mainTab === 'menunggu' && waitingPlayers.length > 0 && (
            <div className="waiting-section">
              <div className="section-title">
                <span>Antrian Menunggu</span>
                <span>{waitingPlayers.length} pemain</span>
              </div>
              {(waitingInQueue.length > 0 || waitingQueued.length > 0) && (
                <>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <button
                      className={`btn btn-sm${waitingTab === 'menunggu' ? ' btn-primary' : ' btn-ghost'}`}
                      onClick={() => setWaitingTab('menunggu')}
                    >Menunggu ({waitingInQueue.length})</button>
                    <button
                      className={`btn btn-sm${waitingTab === 'antrian' ? ' btn-primary' : ' btn-ghost'}`}
                      onClick={() => setWaitingTab('antrian')}
                    >Sedang Dalam Antrian ({waitingQueued.length})</button>
                  </div>
                  <div className="waiting-grid">
                    {(waitingTab === 'menunggu' ? waitingInQueue : waitingQueued).map(p => (
                      <div key={p.id} className="waiting-chip">
                        <div className="status-dot waiting" />
                        <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                        <span className="waiting-chip-name">{p.name}</span>
                        <span className="waiting-chip-meta">{p.gamesPlayed}x main</span>
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
                        <span className="waiting-chip-name">{p.name}</span>
                        <span className="waiting-chip-meta">Belum main</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {mainTab === 'antrian' && (state.pregenerated ?? []).length > 0 && (
            <div className="waiting-section" style={{ marginTop: 12 }}>
              <div className="section-title">
                <span>Antrian Match</span>
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
                            onClick={() => freeCourts.length === 1 ? startFromQueue(idx, freeCourts[0]) : setAssignQueueIdx(idx)}
                          >
                            📍 Mulai di Lapangan
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {mainTab === 'riwayat' && state.matches.some(m => m.endTime) && (
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
                    const t1t = teamType(m.team1, state.players)
                    const pl = (id: string) => state.players.find(p => p.id === id)
                    const [s1, s2] = (m.score ?? '').split('-')
                    const n1 = parseInt(s1 ?? '0'), n2 = parseInt(s2 ?? '0')
                    return (
                      <div key={m.id} className="mh-card"
                        style={{ borderLeft: `3px solid ${TYPE_COLOR[t1t]}`, ...(!isHistorical ? { cursor: 'pointer' } : {}) }}
                        onClick={() => !isHistorical && setEditingMatch({ id: m.id, bola: m.shuttlesUsed ?? 0, scoreL: s1 ?? '', scoreR: s2 ?? '' })}
                      >
                        <div className="mh-card-header">
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span className="mh-num">#{m.matchNumber}</span>
                            <span style={{ fontSize: 10, fontWeight: 700, color: TYPE_COLOR[t1t], background: 'var(--bg)', padding: '1px 6px', borderRadius: 3 }}>{t1t}</span>
                          </div>
                          <span className="mh-status">✓ Selesai{!isHistorical && ` · ${m.shuttlesUsed ?? 0} bola ✏`}{m.endTime && <span className="match-timer" style={{ marginLeft: 6 }}>{fmtDur(m.endTime - m.startTime)}</span>}</span>
                        </div>
                        <div className="mh-body">
                          <div className="mh-team-col">
                            {m.team1.map(id => { const p = pl(id); return <div key={id} className="mh-player"><span>{p?.name ?? '?'}</span><span className={`skill-badge skill-${p?.skill ?? 'B1'}`}>{p?.skill ?? '?'}</span></div> })}
                          </div>
                          <div className="mh-score-box">
                            <div className="mh-score-vs">vs</div>
                            {m.score ? <>
                              <div className="mh-score-num" style={{ color: n1 >= n2 ? 'var(--text)' : 'var(--gold)' }}>{s1}</div>
                              <div className="mh-score-dash">—</div>
                              <div className="mh-score-num" style={{ color: n2 > n1 ? 'var(--text)' : 'var(--gold)' }}>{s2}</div>
                            </> : <div style={{ color: 'var(--dim)', fontSize: 13 }}>—</div>}
                          </div>
                          <div className="mh-team-col right">
                            {m.team2.map(id => { const p = pl(id); return <div key={id} className="mh-player right"><span>{p?.name ?? '?'}</span><span className={`skill-badge skill-${p?.skill ?? 'B1'}`}>{p?.skill ?? '?'}</span></div> })}
                          </div>
                        </div>
                      </div>
                    )
                  })}
              </div>
            </div>
          )}

          {mainTab === 'pemain' && (
            <PlayerPanel
              inline
              open={false}
              onClose={() => setMainTab('lapangan')}
              state={state}
              onUpdate={s => mut.mutate(s)}
            />
          )}
        </div>
      </div>

      {/* ── Right rail: Master Pool + Live Ledger ── */}
      <aside className="rail">
        <MasterPool players={state.players} onAdd={() => setMainTab('pemain')} />
        <LedgerCard state={state} onViewAll={() => setLedgerOpen(true)} />
      </aside>
    </div>

    {/* ── Drawers ── */}
    {ledgerOpen && <div className="drawer-backdrop" onClick={() => setLedgerOpen(false)} />}
    <LedgerPanel state={state} open={ledgerOpen} onClose={() => setLedgerOpen(false)} />

      {editingMatch && (
        <EditMatchModal
          editingMatch={editingMatch}
          setEditingMatch={setEditingMatch}
          onSave={editMatch}
          onDelete={deleteMatch}
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
    </>
  )
}

// ── Sidebar / rail / icon helpers ─────────────────────────────────────────────

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}
function rp(n: number) { return `Rp ${n.toLocaleString('id-ID')}` }

function MasterPool({ players, onAdd }: { players: Player[]; onAdd: () => void }) {
  const active = players.filter(p => p.status !== 'Left')
  return (
    <div className="rail-card">
      <div className="rail-card-head">
        <h3>Master Pool</h3>
        <span className="rail-count">{active.length} pemain</span>
      </div>
      <div className="rail-pool-list">
        {active.length === 0
          ? <div className="rail-empty">Belum ada pemain.<br />Tambah lewat tombol di bawah.</div>
          : active.map(p => (
            <div key={p.id} className="pool-row">
              <div className={`player-avatar avatar-${p.skill}`}>{initials(p.name)}</div>
              <div className="pool-row-name">
                {p.name}
                <span className="pool-row-meta">{(p.type ?? 'member') === 'harian' ? 'Harian' : 'Member'} · {p.gamesPlayed}x</span>
              </div>
              <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
            </div>
          ))}
      </div>
      <button className="btn btn-ghost btn-sm rail-add" onClick={onAdd}>+ Tambah Pemain</button>
    </div>
  )
}

function LedgerCard({ state, onViewAll }: { state: AppState; onViewAll: () => void }) {
  const matchCost = matchCostByPlayer(state)
  const total = (p: Player) => playerTotal(state, p, matchCost)
  const totalCost = state.players.reduce((s, p) => s + total(p), 0)
  const totalShuttles = state.matches.reduce((s, m) => s + (m.shuttlesUsed ?? 0), 0)
  const rows = [...state.players].filter(p => total(p) > 0).sort((a, b) => total(b) - total(a)).slice(0, 5)
  return (
    <div className="rail-card">
      <div className="rail-card-head">
        <h3>Live Ledger</h3>
        <span className="rail-count">{totalShuttles} bola</span>
      </div>
      <div className="ledger-card-total">
        <span>Total Outstanding</span>
        <strong>{rp(totalCost)}</strong>
      </div>
      <div className="ledger-card-rows">
        {rows.length === 0
          ? <div className="rail-empty">Belum ada transaksi.</div>
          : rows.map(p => (
            <div key={p.id} className="ledger-card-row"><span>{p.name}</span><span className="lc-amt">{rp(total(p))}</span></div>
          ))}
      </div>
      <button className="btn btn-ghost btn-sm rail-add" onClick={onViewAll}>Lihat Semua Transaksi</button>
    </div>
  )
}

function Icon({ name }: { name: string }) {
  const paths: Record<string, JSX.Element> = {
    grid: <><rect x="3" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="3" width="7.5" height="7.5" rx="1.6" /><rect x="13.5" y="13.5" width="7.5" height="7.5" rx="1.6" /><rect x="3" y="13.5" width="7.5" height="7.5" rx="1.6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5V12l3.2 1.8" /></>,
    bolt: <path d="M13 2.5 4.5 13.5H11l-1 8 8.5-11.5H12l1-7.5z" />,
    history: <><path d="M3.2 9A9 9 0 1 1 3 13" /><path d="M3 3.5V9h5.5" /><path d="M12 8.2V12l3 1.8" /></>,
    users: <><circle cx="9" cy="8" r="3.4" /><path d="M2.8 20a6.2 6.2 0 0 1 12.4 0" /><path d="M16.5 5.3a3.2 3.2 0 0 1 0 5.9" /><path d="M18.2 20a6 6 0 0 0-2.4-4.3" /></>,
    gear: <><circle cx="12" cy="12" r="3.3" /><path d="M12 2.4v3.1M12 18.5v3.1M21.6 12h-3.1M5.5 12H2.4M18.5 5.5l-2.2 2.2M7.7 16.3l-2.2 2.2M18.5 18.5l-2.2-2.2M7.7 7.7 5.5 5.5" /></>,
    wallet: <><rect x="3" y="6" width="18" height="13" rx="2.6" /><path d="M3 10.5h18" /><circle cx="16.5" cy="14.5" r="1.25" fill="currentColor" stroke="none" /></>,
    flag: <><path d="M4.5 21V4" /><path d="M4.5 4.5h12l-1.6 4 1.6 4h-12" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    logout: <><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></>,
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
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
  const [skippedFirst, setSkippedFirst] = useState<string | null>(null)
  const [modalTab, setModalTab] = useState<'menunggu' | 'antrian'>('menunggu')

  const queuedIds     = new Set((state.pregenerated ?? []).flat())
  const notYetPlayed  = [...state.players].filter(p => p.status === 'Waiting' && p.gamesPlayed === 0 && !queuedIds.has(p.id))
  const inQueue       = [...state.players].filter(p => p.status === 'Waiting' && p.gamesPlayed > 0 && !queuedIds.has(p.id)).sort((a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0))
  const inQueueQueued = [...state.players].filter(p => p.status === 'Waiting' && queuedIds.has(p.id))
  const playing       = state.players.filter(p => p.status === 'Playing')

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

  function proceedWithConflictCheck() {
    setSkippedFirst(null)
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

  function checkAndSubmit() {
    if (selected.length !== 4) return
    if (inQueue[0] && !selected.includes(inQueue[0].id) && skippedFirst === null) {
      setSkippedFirst(inQueue[0].name)
      return
    }
    proceedWithConflictCheck()
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
              {(() => {
                const chip = (p: Player) => {
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
                }
                const sub = (label: string) => <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
                return (
                  <>
                    {notYetPlayed.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {sub('BELUM MAIN')}
                        <div className="waiting-grid">{notYetPlayed.map(chip)}</div>
                      </div>
                    )}
                    {(inQueue.length > 0 || inQueueQueued.length > 0) && (
                      <div style={{ marginTop: 8 }}>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                          <button className={`btn btn-sm${modalTab === 'menunggu' ? ' btn-primary' : ' btn-ghost'}`} onClick={() => setModalTab('menunggu')}>
                            Menunggu ({inQueue.length})
                          </button>
                          <button className={`btn btn-sm${modalTab === 'antrian' ? ' btn-primary' : ' btn-ghost'}`} onClick={() => setModalTab('antrian')}>
                            Sedang Dalam Antrian ({inQueueQueued.length})
                          </button>
                        </div>
                        <div className="waiting-grid">{(modalTab === 'menunggu' ? inQueue : inQueueQueued).map(chip)}</div>
                      </div>
                    )}
                    {playing.length > 0 && (
                      <div style={{ marginTop: 8 }}>
                        {sub('SEDANG MAIN')}
                        <div className="waiting-grid">{playing.map(chip)}</div>
                      </div>
                    )}
                  </>
                )
              })()}
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

            {skippedFirst ? (
              <div style={{ background: 'rgba(255,200,0,0.08)', border: '1px solid var(--gold)', borderRadius: 8, padding: 12 }}>
                <div style={{ fontSize: 13, color: 'var(--gold)', fontWeight: 700, marginBottom: 6 }}>⚠ Peringatan</div>
                <div style={{ fontSize: 12, color: 'var(--text)', marginBottom: 10 }}>
                  pemain <strong>{skippedFirst}</strong> sudah lama berhenti, pertimbangkan untuk set ulang
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={proceedWithConflictCheck}>Lanjutkan</button>
                  <button className="btn btn-ghost" onClick={() => setSkippedFirst(null)}>Ganti Pemain</button>
                </div>
              </div>
            ) : warning ? (
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

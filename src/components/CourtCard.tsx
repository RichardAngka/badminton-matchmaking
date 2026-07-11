import { useState, useRef, useEffect } from 'react'
import type { Match, Player } from '../types'
import { Button } from './ui/button'

interface Props {
  courtId: number
  match: Match | undefined
  players: Player[]
  upcoming?: Player[]
  onEndMatch?: (matchId: string, shuttles: number, score: string) => void
  onEditPlayers?: (matchId: string, team1: [string, string], team2: [string, string]) => void
  onCancelMatch?: (matchId: string) => void
  onStart?: () => void
}

function byId(players: Player[], id: string) {
  return players.find(p => p.id === id)
}

const fmt = (ms: number) => {
  const s = Math.floor(ms / 1000)
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

export function CourtCard({ courtId, match, players, upcoming, onEndMatch, onEditPlayers, onCancelMatch, onStart }: Props) {
  const [shuttles, setShuttles] = useState('')
  const [scoreL, setScoreL] = useState('')
  const [scoreR, setScoreR] = useState('')
  const refShuttles = useRef<HTMLInputElement>(null)
  const refScoreL = useRef<HTMLInputElement>(null)
  const refScoreR = useRef<HTMLInputElement>(null)
  const refSelesai = useRef<HTMLButtonElement>(null)
  const [editingPlayers, setEditingPlayers] = useState(false)
  const [editSelected, setEditSelected] = useState<string[]>([])
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!match) return
    const id = setInterval(() => setTick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [match?.id])

  function handleEnd() {
    if (!match || shuttles === '' || +shuttles < 0 || !onEndMatch) return
    const score = scoreL !== '' || scoreR !== '' ? `${scoreL}-${scoreR}` : ''
    onEndMatch(match.id, +shuttles, score)
    setShuttles('')
    setScoreL('')
    setScoreR('')
  }

  function startEdit() {
    if (!match) return
    setEditSelected([match.team1[0], match.team1[1], match.team2[0], match.team2[1]])
    setEditingPlayers(true)
  }

  function saveEdit() {
    if (!match || !onEditPlayers || editSelected.length !== 4 || new Set(editSelected).size !== 4) return
    onEditPlayers(match.id, [editSelected[0], editSelected[1]], [editSelected[2], editSelected[3]])
    setEditingPlayers(false)
  }

  function toggleEdit(id: string) {
    setEditSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length < 4 ? [...s, id] : s)
  }

  const matchIds = match ? new Set([...match.team1, ...match.team2]) : new Set<string>()
  const t1 = match ? match.team1.map(id => byId(players, id)) : []
  const t2 = match ? match.team2.map(id => byId(players, id)) : []

  return (
    <div className={`court-card${match ? ' active' : ' empty'}`}>
      <div className="court-header">
        <span className="court-number">COURT {courtId}</span>
        {match
          ? <><span className="match-num-badge">#{match.matchNumber}</span><span className="match-timer">{fmt(Date.now() - match.startTime)}</span></>
          : <span className="match-number">Menunggu pemain</span>
        }
        {match && onCancelMatch && (
          <Button variant="ghost" size="icon" onClick={() => onCancelMatch(match.id)} title="Batalkan match" className="ml-auto h-7 w-7">✕</Button>
        )}
        {match && onEditPlayers && (
          <Button variant="ghost" size="icon" onClick={startEdit} title="Edit pemain" className={onCancelMatch ? "h-7 w-7" : "ml-auto h-7 w-7"}>✏️</Button>
        )}
      </div>

      {editingPlayers && match && (
        <div className="modal-overlay" onClick={() => setEditingPlayers(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>✏️ Edit Pemain — Court {courtId}</h2>
              <Button variant="ghost" size="sm" onClick={() => setEditingPlayers(false)}>✕</Button>
            </div>
            <div className="modal-body">
              <div className="config-form">
                <div>
                  <label className="config-label">
                    Pilih 4 Pemain ({editSelected.length}/4) — urutan: Tim 1 (1,2) vs Tim 2 (3,4)
                  </label>
                  {[
                    { label: 'Belum Main', list: players.filter(p => p.status === 'Waiting') },
                    { label: 'Di Lapangan Ini', list: players.filter(p => matchIds.has(p.id)) },
                  ].map(({ label, list }) =>
                    list.length > 0 && (
                      <div key={label} style={{ marginTop: 8 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', letterSpacing: 1, marginBottom: 4 }}>{label.toUpperCase()}</div>
                        <div className="waiting-grid">
                          {list.map(p => {
                            const idx = editSelected.indexOf(p.id)
                            const isTeam1 = idx === 0 || idx === 1
                            return (
                              <div key={p.id} className="waiting-chip" onClick={() => toggleEdit(p.id)}
                                style={{
                                  cursor: 'pointer',
                                  outline: idx >= 0 ? `2px solid ${isTeam1 ? 'var(--gold)' : '#4fc3f7'}` : 'none',
                                  opacity: editSelected.length === 4 && idx < 0 ? 0.4 : 1,
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

                {editSelected.length > 0 && (
                  <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ color: 'var(--gold)' }}>
                      Tim 1: {editSelected.slice(0, 2).map(id => players.find(p => p.id === id)?.name ?? '?').join(' · ')}
                    </span>
                    {editSelected.length > 2 && (
                      <span style={{ color: '#4fc3f7' }}>
                        Tim 2: {editSelected.slice(2, 4).map(id => players.find(p => p.id === id)?.name ?? '?').join(' · ')}
                      </span>
                    )}
                  </div>
                )}

                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    className="flex-1"
                    disabled={editSelected.length !== 4 || new Set(editSelected).size !== 4}
                    onClick={saveEdit}
                  >
                    Simpan
                  </Button>
                  <Button variant="ghost" onClick={() => setEditingPlayers(false)}>Batal</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {match ? (
        <>
          <div className="match-teams">
            <div className="team">
              {t1.map(p => p && (
                <div key={p.id} className="player-row">
                  <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                  <span className="player-name">{p.name}</span>
                  {p.gender === 'F' && <span className="gender-tag gender-F">W</span>}
                </div>
              ))}
            </div>
            <div className="vs-divider">VS</div>
            <div className="team team-2">
              {t2.map(p => p && (
                <div key={p.id} className="player-row player-row-r">
                  <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                  <span className="player-name">{p.name}</span>
                  {p.gender === 'F' && <span className="gender-tag gender-F">W</span>}
                </div>
              ))}
            </div>
          </div>
          {onEndMatch && (
            <div className="end-match-form">
              <input
                ref={refShuttles}
                className="shuttle-input"
                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2}
                placeholder="Bola"
                value={shuttles}
                onChange={e => { const v = e.target.value.replace(/\D/g, ''); setShuttles(v); if (v.length === 2) refScoreL.current?.focus() }}
                onKeyDown={e => e.key === 'Enter' && refScoreL.current?.focus()}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  ref={refScoreL}
                  className="score-input"
                  type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2}
                  placeholder="Skor"
                  value={scoreL}
                  onChange={e => { const v = e.target.value.replace(/\D/g, ''); setScoreL(v); if (v.length === 2) refScoreR.current?.focus() }}
                  onKeyDown={e => e.key === 'Enter' && refScoreR.current?.focus()}
                />
                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>–</span>
                <input
                  ref={refScoreR}
                  className="score-input"
                  type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2}
                  placeholder="Skor"
                  value={scoreR}
                  onChange={e => { const v = e.target.value.replace(/\D/g, ''); setScoreR(v); if (v.length === 2) refSelesai.current?.focus() }}
                  onKeyDown={e => e.key === 'Enter' && handleEnd()}
                />
              </div>
              <Button
                ref={refSelesai}
                size="sm"
                className="basis-full"
                onClick={handleEnd}
                disabled={shuttles === '' || +shuttles < 0}
              >
                Selesai
              </Button>
            </div>
          )}
        </>
      ) : upcoming && upcoming.length === 4 ? (
        <div>
          <span className="segera-label">SEGERA BERMAIN</span>
          <div className="match-teams" style={{ opacity: 0.85 }}>
            <div className="team">
              {upcoming.slice(0, 2).map(p => (
                <div key={p.id} className="player-row">
                  <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                  <span className="player-name">{p.name}</span>
                  {p.gender === 'F' && <span className="gender-tag gender-F">W</span>}
                </div>
              ))}
            </div>
            <div className="vs-divider">VS</div>
            <div className="team team-2">
              {upcoming.slice(2, 4).map(p => (
                <div key={p.id} className="player-row player-row-r">
                  <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                  <span className="player-name">{p.name}</span>
                  {p.gender === 'F' && <span className="gender-tag gender-F">W</span>}
                </div>
              ))}
            </div>
          </div>
          {onStart && (
            <Button size="sm" className="w-full mt-2" onClick={onStart}>
              ▶ Mulai
            </Button>
          )}
        </div>
      ) : (
        <div className="empty-court-msg">
          Tambah antrian match<br />
          lalu klik <strong>▶ Mulai</strong>
        </div>
      )}
    </div>
  )
}

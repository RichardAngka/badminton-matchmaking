import { useState } from 'react'
import type { Match, Player } from '../types'

interface Props {
  courtId: number
  match: Match | undefined
  players: Player[]
  onEndMatch?: (matchId: string, shuttles: number, score: string) => void
  onEditPlayers?: (matchId: string, team1: [string, string], team2: [string, string]) => void
}

function byId(players: Player[], id: string) {
  return players.find(p => p.id === id)
}

export function CourtCard({ courtId, match, players, onEndMatch, onEditPlayers }: Props) {
  const [shuttles, setShuttles] = useState('')
  const [scoreL, setScoreL] = useState('')
  const [scoreR, setScoreR] = useState('')
  const [editingPlayers, setEditingPlayers] = useState(false)
  const [editT1, setEditT1] = useState<[string, string]>(['', ''])
  const [editT2, setEditT2] = useState<[string, string]>(['', ''])

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
    setEditT1([match.team1[0], match.team1[1]])
    setEditT2([match.team2[0], match.team2[1]])
    setEditingPlayers(true)
  }

  function saveEdit() {
    if (!match || !onEditPlayers) return
    const all = [editT1[0], editT1[1], editT2[0], editT2[1]]
    if (all.some(id => !id) || new Set(all).size !== 4) return
    onEditPlayers(match.id, editT1, editT2)
    setEditingPlayers(false)
  }

  // players available for selection: Waiting + anyone already in this match
  const matchIds = match ? new Set([...match.team1, ...match.team2]) : new Set<string>()
  const selectablePlayers = players.filter(p => p.status !== 'Left' && (p.status === 'Waiting' || matchIds.has(p.id)))

  const t1 = match ? match.team1.map(id => byId(players, id)) : []
  const t2 = match ? match.team2.map(id => byId(players, id)) : []

  return (
    <div className={`court-card${match ? ' active' : ' empty'}`}>
      <div className="court-header">
        <span className="court-number">COURT {courtId}</span>
        <span className="match-number">{match ? `Match #${match.matchNumber}` : 'Menunggu pemain'}</span>
        {match && onEditPlayers && !editingPlayers && (
          <button className="btn-icon" onClick={startEdit} title="Edit pemain" style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, padding: '0 2px' }}>✏️</button>
        )}
      </div>

      {match ? (
        <>
          {editingPlayers ? (
            <div className="edit-players-form" style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '8px 0' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                {([0, 1] as const).map(i => (<>
                  <select key={`t1-${i}`} value={editT1[i]} onChange={e => setEditT1(p => [i === 0 ? e.target.value : p[0], i === 1 ? e.target.value : p[1]])}>
                    <option value="">Kiri P{i + 1}</option>
                    {selectablePlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <select key={`t2-${i}`} value={editT2[i]} onChange={e => setEditT2(p => [i === 0 ? e.target.value : p[0], i === 1 ? e.target.value : p[1]])}>
                    <option value="">Kanan P{i + 1}</option>
                    {selectablePlayers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </>))}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-primary btn-sm" onClick={saveEdit} disabled={new Set([editT1[0], editT1[1], editT2[0], editT2[1]]).size !== 4 || [editT1[0], editT1[1], editT2[0], editT2[1]].some(id => !id)}>Simpan</button>
                <button className="btn btn-sm" onClick={() => setEditingPlayers(false)}>Batal</button>
              </div>
            </div>
          ) : (
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
          )}
          {onEndMatch && !editingPlayers && (
            <div className="end-match-form">
              <input
                className="shuttle-input"
                type="number" inputMode="numeric" min="0"
                placeholder="Bola"
                value={shuttles}
                onChange={e => setShuttles(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEnd()}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <input
                  className="score-input"
                  type="number" inputMode="numeric" min="0"
                  placeholder="Skor"
                  value={scoreL}
                  onChange={e => setScoreL(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleEnd()}
                  style={{ width: 52 }}
                />
                <span style={{ color: 'var(--muted)', flexShrink: 0 }}>–</span>
                <input
                  className="score-input"
                  type="number" inputMode="numeric" min="0"
                  placeholder="Skor"
                  value={scoreR}
                  onChange={e => setScoreR(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleEnd()}
                  style={{ width: 52 }}
                />
              </div>
              <button
                className="btn btn-primary btn-sm"
                onClick={handleEnd}
                disabled={shuttles === '' || +shuttles < 0}
              >
                Selesai
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="empty-court-msg">
          Klik <strong>Generate Match</strong><br />
          untuk mengisi lapangan ini
        </div>
      )}
    </div>
  )
}

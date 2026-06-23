import { useState } from 'react'
import type { Match, Player } from '../types'

interface Props {
  courtId: number
  match: Match | undefined
  players: Player[]
  onEndMatch?: (matchId: string, shuttles: number, score: string) => void
}

function byId(players: Player[], id: string) {
  return players.find(p => p.id === id)
}

export function CourtCard({ courtId, match, players, onEndMatch }: Props) {
  const [shuttles, setShuttles] = useState('')
  const [score, setScore] = useState('')

  function handleEnd() {
    if (!match || !shuttles || +shuttles <= 0 || !onEndMatch) return
    onEndMatch(match.id, +shuttles, score)
    setShuttles('')
    setScore('')
  }

  const t1 = match ? match.team1.map(id => byId(players, id)) : []
  const t2 = match ? match.team2.map(id => byId(players, id)) : []

  return (
    <div className={`court-card${match ? ' active' : ' empty'}`}>
      <div className="court-header">
        <span className="court-number">COURT {courtId}</span>
        <span className="match-number">{match ? `Match #${match.matchNumber}` : 'Menunggu pemain'}</span>
      </div>

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
              <input className="shuttle-input" type="number" min="0" placeholder="Bola"
                value={shuttles} onChange={e => setShuttles(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEnd()} />
              <input className="score-input" type="text" placeholder="Skor (21-15, 21-18)"
                value={score} onChange={e => setScore(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleEnd()} />
              <button className="btn btn-primary btn-sm" onClick={handleEnd} disabled={!shuttles || +shuttles <= 0}>
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

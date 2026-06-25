import { useState } from 'react'
import type { AppState, Match, Player, SkillLevel, Gender, PlayerStatus, PlayerType } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  state: AppState
  onUpdate: (s: AppState) => void
}

const STATUS_ORDER: Record<PlayerStatus, number> = { Waiting: 0, Playing: 1, Left: 2 }

export function PlayerPanel({ open, onClose, state, onUpdate }: Props) {
  const [name, setName] = useState('')
  const [skill, setSkill] = useState<SkillLevel>('B1')
  const [gender, setGender] = useState<Gender>('M')
  const [playerType, setPlayerType] = useState<PlayerType>('member')
  const [editId, setEditId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ name: '', skill: 'B1' as SkillLevel, gender: 'M' as Gender, type: 'member' as PlayerType })
  const [profileId, setProfileId] = useState<string | null>(null)

  function startEdit(p: Player) {
    setEditId(p.id)
    setEditDraft({ name: p.name, skill: p.skill, gender: p.gender, type: p.type ?? 'member' })
  }

  function saveEdit() {
    if (!editId || !editDraft.name.trim()) return
    onUpdate({
      ...state,
      players: state.players.map(p =>
        p.id === editId ? { ...p, name: editDraft.name.trim(), skill: editDraft.skill, gender: editDraft.gender, type: editDraft.type } : p
      ),
    })
    setEditId(null)
  }

  function addPlayer() {
    if (!name.trim()) return
    const now = Date.now()
    const restTimes = state.players
      .filter(p => p.status === 'Waiting' && p.restingSince != null)
      .map(p => p.restingSince!)
      .sort((a, b) => a - b)
    // ponytail: interpolate between 2nd and last waiter — truly random, never steals #1
    const restingSince = restTimes.length >= 2
      ? restTimes[1] + Math.random() * (restTimes[restTimes.length - 1] - restTimes[1])
      : now
    const player: Player = {
      id: crypto.randomUUID(),
      name: name.trim(),
      skill,
      gender,
      type: playerType,
      status: 'Waiting',
      checkInTime: now,
      restingSince,
      totalCost: playerType === 'harian' ? (state.harianFee ?? 25000) : 0,
      gamesPlayed: 0,
    }
    onUpdate({ ...state, players: [...state.players, player] })
    setName('')
  }

  function markLeft(p: Player) {
    if (p.status === 'Playing') return  // can't leave mid-game
    const newStatus: PlayerStatus = p.status === 'Left' ? 'Waiting' : 'Left'
    onUpdate({
      ...state,
      players: state.players.map(pl =>
        pl.id === p.id
          ? { ...pl, status: newStatus, restingSince: newStatus === 'Waiting' ? Date.now() : pl.restingSince }
          : pl
      ),
    })
  }

  const sorted = [...state.players].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])

  const dotStyle = (p: Player) => ({
    background: p.status === 'Waiting' ? 'var(--accent)' : p.status === 'Playing' ? 'var(--primary)' : 'var(--dim)',
    animation: p.status === 'Waiting' ? 'pulse 2s infinite' : 'none',
    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
  } as React.CSSProperties)

  return (
    <>
      {open && <div className="player-panel-backdrop" onClick={onClose} />}
      {profileId && (() => {
        const p = state.players.find(pl => pl.id === profileId)!
        return <PlayerProfileModal player={p} matches={state.matches} allPlayers={state.players} onClose={() => setProfileId(null)} />
      })()}
      <div className={`player-panel${open ? ' open' : ''}`}>
        <div className="player-panel-header">
          <h2>Pemain ({state.players.filter(p => p.status !== 'Left').length} aktif)</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="player-list">
          {sorted.map(p => (
            <div key={p.id} className={`player-item${p.status === 'Left' ? ' is-left' : ''}`}>
              <div style={dotStyle(p)} />
              {editId === p.id ? (
                <div className="player-info" style={{ flex: 1, gap: 4, display: 'flex', flexDirection: 'column' }}>
                  <input
                    autoFocus
                    value={editDraft.name}
                    onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                    onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null) }}
                    style={{ fontSize: 13, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', width: '100%' }}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <select value={editDraft.skill} onChange={e => setEditDraft(d => ({ ...d, skill: e.target.value as SkillLevel }))} style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
                      <option value="A1">A1</option>
                      <option value="A2">A2</option>
                      <option value="B1">B1</option>
                      <option value="B2">B2</option>
                    </select>
                    <select value={editDraft.gender} onChange={e => setEditDraft(d => ({ ...d, gender: e.target.value as Gender }))} style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                    <select value={editDraft.type} onChange={e => setEditDraft(d => ({ ...d, type: e.target.value as PlayerType }))} style={{ fontSize: 12, padding: '2px 4px', borderRadius: 4, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}>
                      <option value="member">Member</option>
                      <option value="harian">Harian</option>
                    </select>
                    <button className="btn btn-primary btn-sm" onClick={saveEdit}>✓</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>✕</button>
                  </div>
                </div>
              ) : (
                <div className="player-info" style={{ cursor: 'pointer' }} onClick={() => setProfileId(p.id)}>
                  <div className="player-item-name" style={{ fontWeight: 700 }}>
                    {p.name}
                    <span className={`gender-tag gender-${p.gender}`}>{p.gender === 'F' ? 'W' : 'M'}</span>
                  </div>
                  <div className="player-item-meta">
                    <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: (p.type ?? 'member') === 'harian' ? '#f59e0b22' : '#4fc3f722', color: (p.type ?? 'member') === 'harian' ? '#f59e0b' : '#4fc3f7' }}>
                      {(p.type ?? 'member') === 'harian' ? 'Harian' : 'Member'}
                    </span>
                    <span>{p.gamesPlayed}x main</span>
                    {p.totalCost > 0 && <span>Rp {p.totalCost.toLocaleString('id-ID')}</span>}
                    {p.status === 'Playing' && <span style={{ color: 'var(--primary)' }}>● Bermain</span>}
                  </div>
                </div>
              )}
              <div className="player-actions">
                {editId !== p.id && (
                  <button className="btn btn-ghost btn-sm" onClick={() => startEdit(p)} title="Edit pemain">✏</button>
                )}
                {p.status !== 'Playing' && editId !== p.id && (
                  <button
                    className={`btn btn-sm ${p.status === 'Left' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => markLeft(p)}
                    title={p.status === 'Left' ? 'Check-in kembali' : 'Tandai pulang'}
                  >
                    {p.status === 'Left' ? '↩' : '→'}
                  </button>
                )}
              </div>
            </div>
          ))}
          {state.players.length === 0 && (
            <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
              Belum ada pemain.<br />Tambah pemain di bawah.
            </div>
          )}
        </div>

        <div className="add-player-form">
          <h3>+ Tambah / Check-In Pemain</h3>
          <div className="form-row">
            <div className="form-field" style={{ flex: 2 }}>
              <label>Nama Pemain</label>
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addPlayer()}
                placeholder="contoh: Felix W"
                autoComplete="off"
              />
            </div>
          </div>
          <div className="form-row">
            <div className="form-field">
              <label>Level</label>
              <select value={skill} onChange={e => setSkill(e.target.value as SkillLevel)}>
                <option value="A1">A1 — Elite</option>
                <option value="A2">A2 — Kuat</option>
                <option value="B1">B1 — Menengah</option>
                <option value="B2">B2 — Berkembang</option>
              </select>
            </div>
            <div className="form-field">
              <label>Gender</label>
              <select value={gender} onChange={e => setGender(e.target.value as Gender)}>
                <option value="M">M — Pria</option>
                <option value="F">F — Wanita</option>
              </select>
            </div>
            <div className="form-field">
              <label>Tipe</label>
              <select value={playerType} onChange={e => setPlayerType(e.target.value as PlayerType)}>
                <option value="member">Member</option>
                <option value="harian">Harian (+Rp 25.000)</option>
              </select>
            </div>
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={addPlayer}>
            Check-In Pemain
          </button>
        </div>
      </div>
    </>
  )
}

export const TYPE_COLOR = { XD: '#ce93d8', MD: '#4fc3f7', WD: '#f48fb1' } as const
type MatchType = 'XD' | 'MD' | 'WD'
export function teamType(ids: readonly string[], all: Player[]): MatchType {
  const gs = ids.map(id => all.find(p => p.id === id)?.gender)
  return gs.every(g => g === 'M') ? 'MD' : gs.every(g => g === 'F') ? 'WD' : 'XD'
}

function PlayerProfileModal({ player, matches, allPlayers, onClose }: {
  player: Player
  matches: Match[]
  allPlayers: Player[]
  onClose: () => void
}) {
  const n = (id: string) => allPlayers.find(p => p.id === id)?.name ?? '?'
  const initials = player.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const playerMatches = matches
    .filter(m => m.team1.includes(player.id) || m.team2.includes(player.id))
    .sort((a, b) => b.matchNumber - a.matchNumber)

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h2>Profil Pemain</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 16 }}>
            <div style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 20, fontWeight: 800, color: '#000', flexShrink: 0,
            }}>
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{player.name}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                <span className={`skill-badge skill-${player.skill}`}>{player.skill}</span>
                <span className={`gender-tag gender-${player.gender}`}>{player.gender === 'F' ? 'W' : 'M'}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
                {player.gamesPlayed}x main · Rp {player.totalCost.toLocaleString('id-ID')}
              </div>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', letterSpacing: 1, marginBottom: 8 }}>
              RIWAYAT MATCH ({playerMatches.length})
            </div>
            {playerMatches.length === 0 ? (
              <div style={{ color: 'var(--dim)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>
                Belum ada match.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
                {playerMatches.map(m => {
                  const inTeam1 = m.team1.includes(player.id)
                  const t1t = teamType(m.team1, allPlayers)
                  const t2t = teamType(m.team2, allPlayers)
                  const hi = (id: string) => (
                    <span key={id} style={id === player.id ? { color: 'var(--gold)', fontWeight: 700 } : undefined}>
                      {n(id)}
                    </span>
                  )
                  return (
                    <div key={m.id} className="mh-card" style={{ borderLeft: `3px solid ${TYPE_COLOR[t1t]}` }}>
                      <div className="mh-card-header">
                        <span className="mh-num">#{m.matchNumber}</span>
                        <span style={{ fontSize: 10, display: 'flex', gap: 2, alignItems: 'center', background: 'var(--bg)', borderRadius: 3, padding: '1px 5px' }}>
                          <span style={{ color: TYPE_COLOR[t1t], fontWeight: 700 }}>{t1t}</span>
                          <span style={{ color: 'var(--dim)' }}>vs</span>
                          <span style={{ color: TYPE_COLOR[t2t], fontWeight: 700 }}>{t2t}</span>
                        </span>
                        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 3, padding: '1px 5px', background: !m.endTime ? 'var(--primary)' : 'var(--border)', color: !m.endTime ? '#000' : 'var(--muted)' }}>
                          {!m.endTime ? 'Live' : 'Selesai'}
                        </span>
                      </div>
                      {m.shuttlesUsed != null && <span className="mh-bola-tag">{m.shuttlesUsed} bola</span>}
                      <div className="mh-team" style={{ color: inTeam1 ? 'var(--gold)' : undefined }}>
                        {hi(m.team1[0])} · {hi(m.team1[1])}
                      </div>
                      <div className="mh-vs">vs</div>
                      <div className="mh-team" style={{ color: !inTeam1 ? '#4fc3f7' : undefined }}>
                        {hi(m.team2[0])} · {hi(m.team2[1])}
                      </div>
                      {m.score && <div className="mh-score">{m.score}</div>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

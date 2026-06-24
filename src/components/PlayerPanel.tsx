import { useState } from 'react'
import type { AppState, Player, SkillLevel, Gender, PlayerStatus } from '../types'

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
  const [editId, setEditId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ name: '', skill: 'B1' as SkillLevel, gender: 'M' as Gender })

  function startEdit(p: Player) {
    setEditId(p.id)
    setEditDraft({ name: p.name, skill: p.skill, gender: p.gender })
  }

  function saveEdit() {
    if (!editId || !editDraft.name.trim()) return
    onUpdate({
      ...state,
      players: state.players.map(p =>
        p.id === editId ? { ...p, name: editDraft.name.trim(), skill: editDraft.skill, gender: editDraft.gender } : p
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
      ? restTimes[1] + Math.random() * (restTimes.at(-1)! - restTimes[1])
      : now
    const player: Player = {
      id: crypto.randomUUID(),
      name: name.trim(),
      skill,
      gender,
      status: 'Waiting',
      checkInTime: now,
      restingSince,
      totalCost: 0,
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
                    <button className="btn btn-primary btn-sm" onClick={saveEdit}>✓</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditId(null)}>✕</button>
                  </div>
                </div>
              ) : (
                <div className="player-info">
                  <div className="player-item-name">
                    {p.name}
                    <span className={`gender-tag gender-${p.gender}`}>{p.gender === 'F' ? 'W' : 'M'}</span>
                  </div>
                  <div className="player-item-meta">
                    <span className={`skill-badge skill-${p.skill}`}>{p.skill}</span>
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
          </div>
          <button className="btn btn-primary" style={{ width: '100%' }} onClick={addPlayer}>
            Check-In Pemain
          </button>
        </div>
      </div>
    </>
  )
}

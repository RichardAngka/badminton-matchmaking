import { useRef, useState } from 'react'
import { clickable, useDialog } from '../ui'
import type { AppState, Match, Player, SkillLevel, Gender, PlayerStatus, PlayerType } from '../types'
import { Button } from './ui/button'
import { useIsAdmin } from '../RoleContext'
import { findMember, memberDay, useMemberLists, type Member } from '../members'
import { MemberEditor } from './MemberEditor'

interface Props {
  open: boolean
  onClose: () => void
  state: AppState
  onUpdate: (s: AppState) => void
  inline?: boolean
  canWrite?: boolean
}

const STATUS_ORDER: Record<PlayerStatus, number> = { Waiting: 0, Playing: 1, Left: 2 }
const SKILL_ORDER: Record<SkillLevel, number> = { A1: 0, A2: 1, B1: 2, B2: 3 }

const fieldStyle: React.CSSProperties = {
  width: '100%', background: 'var(--card-lo)',
  border: '1px solid rgba(255,255,255,0.09)', borderRadius: 10,
  padding: '12px 14px', color: 'var(--text)', fontSize: 14,
  boxSizing: 'border-box', outline: 'none',
}
const labelStyle: React.CSSProperties = {
  display: 'block', fontSize: 10, fontWeight: 700,
  letterSpacing: '.12em', color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase',
}

export function PlayerPanel({ open, onClose, state, onUpdate, inline, canWrite = true }: Props) {
  const isAdmin = useIsAdmin()
  const [name, setName] = useState('')
  const [skill, setSkill] = useState<SkillLevel>('B1')
  const [gender, setGender] = useState<Gender>('M')
  const [playerType, setPlayerType] = useState<PlayerType>('member')
  const [editId, setEditId] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState({ name: '', skill: 'B1' as SkillLevel, gender: 'M' as Gender, type: 'member' as PlayerType })
  const [profileId, setProfileId] = useState<string | null>(null)
  const [filterGrade, setFilterGrade] = useState<SkillLevel | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const memberLists = useMemberLists()
  const { label: memberLabel, list: members } = memberDay(state.sessionDate, memberLists.lists)
  const [editingMembers, setEditingMembers] = useState(false)
  // What the last tap did, so every tap answers: a new check-in, a member
  // back from going home, or one who was already on the list.
  const [lastAdded, setLastAdded] = useState<{ name: string; at: number; kind: 'in' | 'back' | 'already' } | null>(null)

  function startEdit(p: Player) {
    setEditId(p.id)
    setEditDraft({ name: p.name, skill: p.skill, gender: p.gender, type: p.type ?? 'member' })
  }

  function saveEdit() {
    if (!isAdmin || !editId || !editDraft.name.trim()) return
    const fee = state.harianFee ?? 25000
    onUpdate({
      ...state,
      players: state.players.map(p => {
        if (p.id !== editId) return p
        const oldType = p.type ?? 'member'
        // ponytail: keep totalCost's baked-in harian fee in sync when type flips, so ledger's totalCost - harianFee stays non-negative
        const feeDelta = editDraft.type === oldType ? 0 : editDraft.type === 'harian' ? fee : -fee
        return { ...p, name: editDraft.name.trim(), skill: editDraft.skill, gender: editDraft.gender, type: editDraft.type, totalCost: p.totalCost + feeDelta }
      }),
    })
    setEditId(null)
  }

  // `m` is a member tapped in the standing list: it checks in straight away
  // instead of filling the form. Without it the form's own fields are used.
  function addPlayer(m?: Member) {
    const who = m ? { name: m.name, skill: m.skill, gender: m.gender ?? 'M' as Gender } : { name: name.trim(), skill, gender }
    if (!canWrite || !who.name) return
    // A tap on a chip ends that search: the next person to walk in should see
    // the whole list, not the filter for the last one.
    if (m) setName('')
    // A member already on today's list is not added twice; one who went home
    // is checked back in, which is what tapping their struck-through chip means.
    const existing = state.players.find(p => p.name.toLowerCase() === who.name.toLowerCase())
    if (m && existing) {
      if (existing.status === 'Left') {
        markLeft(existing)
        setLastAdded({ name: existing.name, at: Date.now(), kind: 'back' })
      } else {
        setLastAdded({ name: existing.name, at: existing.checkInTime ?? Date.now(), kind: 'already' })
      }
      return
    }
    const now = Date.now()
    const restTimes = state.players
      .filter(p => p.status === 'Waiting' && p.restingSince != null)
      .map(p => p.restingSince!)
      .sort((a, b) => a - b)
    // ponytail: interpolate between 2nd and last waiter — truly random, never steals #1
    const restingSince = restTimes.length >= 2
      ? restTimes[1] + Math.random() * (restTimes[restTimes.length - 1] - restTimes[1])
      : now
    const type: PlayerType = isAdmin ? playerType : 'member'
    const player: Player = {
      id: crypto.randomUUID(),
      name: who.name,
      skill: who.skill, gender: who.gender,
      type,
      status: 'Waiting',
      checkInTime: now,
      checkOutTime: null,
      restingSince,
      totalCost: type === 'harian' ? (state.harianFee ?? 25000) : 0,
      gamesPlayed: 0,
    }
    onUpdate({ ...state, players: [...state.players, player] })
    setName('')
    setLastAdded({ name: player.name, at: now, kind: 'in' })
    // Only the typed flow gets the caret back — refocusing after a chip tap
    // would throw the phone keyboard over the list you are tapping.
    if (!m) nameRef.current?.focus()
  }

  function deletePlayer(id: string) {
    if (!isAdmin || !window.confirm('Hapus pemain ini?')) return
    onUpdate({ ...state, players: state.players.filter(p => p.id !== id) })
  }

  function markLeft(p: Player) {
    if (!canWrite || p.status === 'Playing') return
    const newStatus: PlayerStatus = p.status === 'Left' ? 'Waiting' : 'Left'
    onUpdate({
      ...state,
      players: state.players.map(pl =>
        pl.id === p.id
          ? {
              ...pl,
              status: newStatus,
              restingSince: newStatus === 'Waiting' ? Date.now() : pl.restingSince,
              checkInTime: newStatus === 'Waiting' ? Date.now() : pl.checkInTime,
              checkOutTime: newStatus === 'Left' ? Date.now() : pl.checkOutTime,
            }
          : pl
      ),
    })
  }

  const sorted = [...state.players].sort((a, b) => {
    const skillDiff = SKILL_ORDER[a.skill] - SKILL_ORDER[b.skill]
    return skillDiff !== 0 ? skillDiff : STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
  })
  const displayed = filterGrade ? sorted.filter(p => p.skill === filterGrade) : sorted
  const activeCount = state.players.filter(p => p.status !== 'Left').length

  const fee = state.harianFee ?? 25000
  const rp = (n: number) => `Rp ${n.toLocaleString('id-ID')}`

  const dotClass = (p: Player) =>
    `status-dot ${p.status === 'Waiting' ? 'waiting' : p.status === 'Playing' ? 'playing' : 'left'}`

  const profileModal = profileId && (() => {
    const p = state.players.find(pl => pl.id === profileId)!
    return <PlayerProfileModal player={p} matches={state.matches} allPlayers={state.players} onClose={() => setProfileId(null)} />
  })()

  const filterChips = (
    <div className="rf" role="group" aria-label="Saring menurut grade">
      {([null, 'A1', 'A2', 'B1', 'B2'] as (SkillLevel | null)[]).map(g => (
        <button key={g ?? 'all'} aria-pressed={filterGrade === g} onClick={() => setFilterGrade(g)}>
          {g ?? 'Semua'}
          <span className="rf-n">{state.players.filter(p => p.status !== 'Left' && (g === null || p.skill === g)).length}</span>
        </button>
      ))}
    </div>
  )

  const playerList = (
    <div className="player-list">
      {displayed.map(p => (
        <div key={p.id} className={`player-item${p.status === 'Left' ? ' is-left' : ''}${editId === p.id ? ' is-editing' : ''}`}>
          {editId === p.id ? (
            /* Editing speaks the same form language as check-in: one name
               field, the same three rows of buttons. Learn it once. */
            <div className="ci ci-edit">
              <div className="ci-top">
                <input
                  autoFocus
                  className="ci-name"
                  value={editDraft.name}
                  aria-label="Nama pemain"
                  onChange={e => setEditDraft(d => ({ ...d, name: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditId(null) }}
                />
                <button className="btn btn-primary ci-go" onClick={saveEdit} disabled={!editDraft.name.trim()}>Simpan</button>
                <button className="btn btn-ghost ci-go" onClick={() => setEditId(null)}>Batal</button>
              </div>
              <div className="ci-rows">
                <div className="ci-field">
                  <div className="ci-seg" role="group" aria-label="Grade">
                    {(['A1', 'A2', 'B1', 'B2'] as SkillLevel[]).map(g => (
                      <button key={g} aria-pressed={editDraft.skill === g}
                        onClick={() => setEditDraft(d => ({ ...d, skill: g }))}>{g}</button>
                    ))}
                  </div>
                </div>
                <div className="ci-field">
                  <div className="ci-seg" role="group" aria-label="Jenis kelamin">
                    <button aria-pressed={editDraft.gender === 'M'} onClick={() => setEditDraft(d => ({ ...d, gender: 'M' }))}>Pria</button>
                    <button aria-pressed={editDraft.gender === 'F'} onClick={() => setEditDraft(d => ({ ...d, gender: 'F' }))}>Wanita</button>
                  </div>
                </div>
                <div className="ci-field">
                  <div className="ci-seg" role="group" aria-label="Tipe pemain">
                    <button aria-pressed={editDraft.type === 'member'} onClick={() => setEditDraft(d => ({ ...d, type: 'member' }))}>Member</button>
                    <button aria-pressed={editDraft.type === 'harian'} onClick={() => setEditDraft(d => ({ ...d, type: 'harian' }))}>Harian +{rp(fee)}</button>
                  </div>
                </div>
              </div>
              {/* Switching type moves money, so the row says what it will do. */}
              {editDraft.type !== (p.type ?? 'member') && (
                <div className="ci-note warn">
                  {editDraft.type === 'harian'
                    ? `Tagihan ${p.name} bertambah ${rp(fee)}.`
                    : `Tagihan ${p.name} berkurang ${rp(fee)}.`}
                </div>
              )}
            </div>
          ) : (
            <>
            <div className={`player-avatar avatar-${p.skill}${p.gender === 'F' ? ' w' : ''}`}>
              {p.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <div className="player-info" title={`Lihat profil ${p.name}`}
              aria-label={`Lihat profil ${p.name}`}
              {...clickable(() => setProfileId(p.id))}>
              <div className="player-item-name" style={{ fontWeight: 700 }}>
                <div className={dotClass(p)} />
                {p.name}
                <span className={`gender-tag gender-${p.gender}`}>{p.gender === 'F' ? 'W' : 'M'}</span>
              </div>
              <div className="player-item-meta">
                <span className={`skill-badge skill-${p.skill}${p.gender === 'F' ? ' w' : ''}`}>{p.skill}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: (p.type ?? 'member') === 'harian' ? 'var(--gold-bg)' : 'rgba(250,250,248,.07)', color: (p.type ?? 'member') === 'harian' ? 'var(--gold)' : 'var(--muted)' }}>
                  {(p.type ?? 'member') === 'harian' ? 'Harian' : 'Member'}
                </span>
                <span>{p.gamesPlayed}x</span>
                {p.totalCost > 0 && <span style={{ fontSize: 11.5 }}>Rp {p.totalCost.toLocaleString('id-ID')}</span>}
              </div>
              {(p.checkInTime != null || p.checkOutTime != null) && (
                <div className="player-item-times">
                  {p.checkInTime != null && (
                    <span className="time-badge time-badge-in">
                      <span className="time-badge-dot" />Check-in: {new Date(p.checkInTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </span>
                  )}
                  {p.checkOutTime != null && (
                    <span className="time-badge time-badge-out">
                      <span className="time-badge-dot" />Check-out: {new Date(p.checkOutTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="player-actions">
            {isAdmin && (
              <Button
                variant="tertiary"
                size="icon"
                className="h-9 w-9"
                onClick={() => startEdit(p)}
                title={`Edit ${p.name}`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" /><path d="M14.5 6.5l3 3" />
                </svg>
              </Button>
            )}
            {p.status !== 'Playing' && (
              <Button
                variant={p.status === 'Left' ? 'default' : 'outline'}
                size="sm"
                className="checkinout-btn"
                onClick={() => markLeft(p)}
                title={p.status === 'Left' ? `Check-in ${p.name} kembali` : `${p.name} pulang`}
              >
                {p.status === 'Left' ? 'Check-in' : 'Check-out'}
              </Button>
            )}
            {isAdmin && p.status !== 'Playing' && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9 text-[var(--dim)] hover:text-[var(--red)] hover:bg-[rgba(244,96,108,.12)]"
                onClick={() => deletePlayer(p.id)}
                title={`Hapus ${p.name}`}
                aria-label={`Hapus ${p.name}`}
              >✕</Button>
            )}
            </div>
            </>
          )}
        </div>
      ))}
      {displayed.length === 0 && state.players.length > 0 && (
        <div style={{ padding: '28px 16px', textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
          Belum ada pemain grade {filterGrade} hari ini.
        </div>
      )}
      {state.players.length === 0 && (
        <div style={{ padding: '40px 16px', textAlign: 'center', color: 'var(--dim)', fontSize: 13 }}>
          Belum ada pemain hari ini.<br />Tap nama member di atas untuk check-in.
        </div>
      )}
    </div>
  )

  /* The member list is the form's subject, not an extra below it: on a club
     night the job is "tap whoever just walked in", and only a guest needs the
     grade and gender controls — so those appear when the typed name is not a
     member, and stay out of the way when it is. */
  const query = name.trim().toLowerCase()
  const exact = findMember(members, name)
  const presentOf = (m: Member) =>
    state.players.find(p => p.name.toLowerCase() === m.name.toLowerCase() && p.status !== 'Left')
  // A member who is checked in moves to the roster below and leaves this list;
  // checking them out or removing them there brings the chip back. Highest
  // grade first — A1 down to B2 — with the chat's order breaking any tie.
  const shown = members
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !presentOf(m) && (!query || m.name.toLowerCase().includes(query)))
    .sort((a, b) => SKILL_ORDER[a.m.skill] - SKILL_ORDER[b.m.skill] || a.i - b.i)
  const hadir = members.filter(m => presentOf(m)).length
  const isGuest = Boolean(query) && !exact   // a name nobody on the list has

  const composer = (
    <div className="ci">
      <div className="ci-top">
        <input
          ref={nameRef}
          className="ci-name"
          value={name}
          onChange={e => setName(e.target.value)}
          // Enter means the obvious one: the member whose name is typed out, or
          // the only one still matching. A half-typed query is nobody, so it
          // waits rather than checking in a player called "fel".
          onKeyDown={e => {
            if (e.key !== 'Enter') return
            const only = shown.length === 1 ? shown[0].m : undefined
            if (exact || only) addPlayer(exact ?? only)
            else if (isGuest) addPlayer()
          }}
          placeholder="Cari member atau tulis nama baru"
          aria-label="Cari member atau tulis nama pemain baru"
          autoComplete="off"
        />
        {isGuest && (
          <button className="btn btn-primary ci-go" onClick={() => addPlayer()}>
            Check-in {name.trim()}
          </button>
        )}
      </div>

      <div className="ci-mem">
        <div className="ci-mem-h">
          <span>Member tetap {memberLabel}</span>
          <span className="ci-mem-n">
            {hadir} hadir, {members.length - hadir} belum
            <button className="ci-mem-manage" onClick={() => setEditingMembers(true)}>Kelola member</button>
          </span>
        </div>
        {editingMembers && (
          <MemberEditor {...memberLists} onClose={() => setEditingMembers(false)} />
        )}
        <div className="ci-mem-list">
          {shown.map(({ m }) => (
            <button
              key={m.name}
              className="ci-mem-chip"
              title={`Check-in ${m.name}, grade ${m.skill}`}
              onClick={() => addPlayer(m)}
            >
              <span className={`ci-mem-g${m.gender === 'F' ? ' w' : ''}`} data-g={m.skill}>{m.skill}</span>
              {m.name}
            </button>
          ))}
          {shown.length === 0 && (
            <p className="ci-mem-none">
              {exact && presentOf(exact)
                ? `${exact.name} sudah check-in, ada di daftar pemain di bawah.`
                : query
                  ? `Tidak ada member bernama “${name.trim()}”. Tekan Check-in untuk menambahkannya sebagai pemain baru.`
                  : `Semua member ${memberLabel} sudah check-in.`}
            </p>
          )}
        </div>
      </div>

      {/* Only a guest needs these: a member's grade and gender are known. */}
      {isGuest && (
        <div className="ci-rows">
          <div className="ci-field">
            <div className="ci-seg grade" role="group" aria-label="Grade">
              {(['A1', 'A2', 'B1', 'B2'] as SkillLevel[]).map(g => (
                <button key={g} data-g={g} aria-pressed={skill === g} onClick={() => setSkill(g)}>{g}</button>
              ))}
            </div>
          </div>

          <div className="ci-field">
            <div className="ci-seg" role="group" aria-label="Jenis kelamin">
              <button aria-pressed={gender === 'M'} onClick={() => setGender('M')}>Pria</button>
              <button aria-pressed={gender === 'F'} onClick={() => setGender('F')}>Wanita</button>
            </div>
          </div>

          {isAdmin && (
            <div className="ci-field">
              <div className="ci-seg" role="group" aria-label="Tipe pemain">
                <button aria-pressed={playerType === 'member'} onClick={() => setPlayerType('member')}>Member</button>
                <button aria-pressed={playerType === 'harian'} onClick={() => setPlayerType('harian')}>
                  Harian +{rp(fee)}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="ci-note" data-kind={lastAdded?.kind} aria-live="polite">
        {lastAdded && (() => {
          const jam = new Date(lastAdded.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
          return <>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
              {lastAdded.kind === 'already'
                ? <><circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /></>
                : <path d="M20 6 9 17l-5-5" />}
            </svg>
            <b>{lastAdded.name}</b>
            {lastAdded.kind === 'in' ? ` check-in ${jam}`
              : lastAdded.kind === 'back' ? ` check-in lagi ${jam}`
              : ` sudah check-in sejak ${jam}`}
          </>
        })()}
      </div>
    </div>
  )

  if (inline) {
    return (
      <>
        {profileModal}
        {canWrite && isAdmin && composer}
        <div className="roster">
          {filterChips}
          {playerList}
        </div>
      </>
    )
  }

  return (
    <>
      {open && <div className="player-panel-backdrop" onClick={onClose} />}
      {profileModal}
      <div className={`player-panel${open ? ' open' : ''}`}>
        <div className="player-panel-header">
          <div>
            <h2>Pemain</h2>
            <div style={{ fontSize: 12.5, color: 'var(--dim)' }}>{activeCount} pemain aktif</div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>
        {filterChips}
        {playerList}
        {canWrite && isAdmin && composer}
      </div>
    </>
  )
}

export const TYPE_COLOR = { XD: '#D4AF37', MD: '#93A7CC', WD: '#D9A1AE' } as const
type MatchType = 'XD' | 'MD' | 'WD'
export function teamType(ids: readonly string[], all: Player[]): MatchType {
  const gs = ids.map(id => all.find(p => p.id === id)?.gender)
  return gs.every(g => g === 'M') ? 'MD' : gs.every(g => g === 'F') ? 'WD' : 'XD'
}

function PlayerProfileModal({ player, matches, allPlayers, onClose }: {
  player: Player; matches: Match[]; allPlayers: Player[]; onClose: () => void
}) {
  const n = (id: string) => allPlayers.find(p => p.id === id)?.name ?? '?'
  const initials = player.name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
  const playerMatches = matches
    .filter(m => m.team1.includes(player.id) || m.team2.includes(player.id))
    .sort((a, b) => b.matchNumber - a.matchNumber)

  const dialog = useDialog(onClose)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" {...dialog} aria-labelledby="profile-title"
        onClick={e => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <div className="modal-header">
          <h2 id="profile-title">{player.name}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Tutup">✕</Button>
        </div>
        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: '50%', background: 'var(--gold)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#10100A', flexShrink: 0 }}>
              {initials}
            </div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{player.name}</div>
              <div style={{ display: 'flex', gap: 6, marginTop: 4, alignItems: 'center' }}>
                <span className={`skill-badge skill-${player.skill}${player.gender === 'F' ? ' w' : ''}`}>{player.skill}</span>
                <span className={`gender-tag gender-${player.gender}`}>{player.gender === 'F' ? 'W' : 'M'}</span>
                <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: (player.type ?? 'member') === 'harian' ? 'var(--gold-bg)' : 'rgba(250,250,248,.07)', color: (player.type ?? 'member') === 'harian' ? 'var(--gold)' : 'var(--muted)' }}>
                  {(player.type ?? 'member') === 'harian' ? 'Harian' : 'Member'}
                </span>
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
              <div style={{ color: 'var(--dim)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>Belum ada match.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: 6 }}>
                {playerMatches.map(m => {
                  const inTeam1 = m.team1.includes(player.id)
                  const t1t = teamType(m.team1, allPlayers)
                  const t2t = teamType(m.team2, allPlayers)
                  const hi = (id: string) => (
                    <span key={id} style={id === player.id ? { color: 'var(--gold)', fontWeight: 700 } : undefined}>{n(id)}</span>
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
                        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 3, padding: '1px 5px', background: !m.endTime ? 'var(--primary)' : 'var(--border)', color: !m.endTime ? '#10100A' : 'var(--muted)' }}>
                          {!m.endTime ? 'Live' : 'Selesai'}
                        </span>
                      </div>
                      {m.shuttlesUsed != null && <span className="mh-bola-tag">{m.shuttlesUsed} bola</span>}
                      <div className="mh-team" style={{ color: inTeam1 ? 'var(--gold)' : undefined }}>{hi(m.team1[0])} · {hi(m.team1[1])}</div>
                      <div className="mh-vs">vs</div>
                      <div className="mh-team" style={{ color: !inTeam1 ? 'var(--teal)' : undefined }}>{hi(m.team2[0])} · {hi(m.team2[1])}</div>
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

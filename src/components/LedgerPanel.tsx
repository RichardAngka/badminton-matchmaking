import { useState } from 'react'
import * as XLSX from 'xlsx'
import type { AppState, Player } from '../types'
import { Button } from './ui/button'
import { matchCostByPlayer, playerTotal } from '../ledgerMath'
import { useIsAdmin } from '../RoleContext'

interface Props { state: AppState; open: boolean; onClose: () => void }

function rp(amount: number) {
  return `Rp ${amount.toLocaleString('id-ID')}`
}

function exportXLSX(state: AppState) {
  const playerMap = new Map(state.players.map(p => [p.id, p]))
  const done = state.matches.filter(m => m.endTime !== undefined)

  const matchSheet = [
    ['Match No', 'Team 1 P1', 'Team 1 P2', 'Team 2 P1', 'Team 2 P2', 'Bola', 'Biaya/Orang (IDR)', 'Skor'],
    ...done.map(m => {
      const [p1, p2, p3, p4] = [...m.team1, ...m.team2].map(id => playerMap.get(id)?.name ?? id)
      const cost = m.shuttlesUsed ? Math.round((m.shuttlesUsed * state.shuttlePrice) / 4) : 0
      return [m.matchNumber, p1, p2, p3, p4, m.shuttlesUsed ?? 0, cost, m.score ?? '']
    }),
  ]
  const matchCost = matchCostByPlayer(state)
  const ballUsage = (p: { id: string }) => matchCost.get(p.id) ?? 0
  const matchCount = new Map<string, number>()
  for (const m of done) for (const id of [...m.team1, ...m.team2]) matchCount.set(id, (matchCount.get(id) ?? 0) + 1)
  const played = (p: { id: string }) => matchCount.get(p.id) ?? 0

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'id')
  const members = [...state.players].filter(p => p.type === 'member').sort(byName)
  const harians = [...state.players].filter(p => p.type === 'harian').sort(byName)

  const ledgerSheet = [
    ['No', 'Nama', 'Harian Price', 'Ball Usage Price', 'Total Played Match', 'Total to Pay'],
    ...members.map((p, i) => [i + 1, p.name, 0, ballUsage(p), played(p), ballUsage(p)]),
    [],
    ...harians.map((p, i) => [i + 1, p.name, state.harianFee, ballUsage(p), played(p), state.harianFee + ballUsage(p)]),
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matchSheet), 'Match Log')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ledgerSheet), 'Ledger')
  const [y, mo, d] = state.sessionDate.split('-').map(Number)
  const day = ['min','sen','sel','rab','kam','jum','sab'][new Date(y, mo - 1, d).getDay()]
  XLSX.writeFile(wb, `pbsor-${day}-${state.sessionDate}.xlsx`)
}

function initials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase()
}

export function LedgerPanel({ state, open, onClose }: Props) {
  const isAdmin = useIsAdmin()
  const [filter, setFilter] = useState<'both' | 'member' | 'harian'>('both')
  const totalShuttles = state.matches.reduce((sum, m) => sum + (m.shuttlesUsed ?? 0), 0)
  const matchCost = matchCostByPlayer(state)
  const total = (p: Player) => playerTotal(state, p, matchCost)
  const totalCost = state.players.reduce((sum, p) => sum + total(p), 0)
  const rows = [...state.players]
    .filter(p => p.gamesPlayed > 0 || total(p) > 0)
    .sort((a, b) => total(b) - total(a))
  const filtered = filter === 'both' ? rows : rows.filter(p => (p.type ?? 'member') === filter)

  return (
    <div className={`right-panel${open ? ' open' : ''}`}>
      <div className="ledger-header">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div className="ledger-title">Live Ledger</div>
          <Button variant="ghost" size="sm" onClick={onClose}>✕</Button>
        </div>
        <div className="ledger-subtitle">Biaya bola sesi ini per pemain</div>
        <div className="ledger-outstanding-label">Total Outstanding</div>
        <div className="ledger-total">
          {rp(totalCost)}
          <span>{totalShuttles} bola</span>
        </div>
      </div>

      <div className="ledger-list">
        {rows.length === 0 ? (
          <div className="ledger-empty">
            Selesaikan pertandingan pertama<br />
            untuk melihat rekapan biaya
          </div>
        ) : (
          <>
            <div className="ledger-section-label">
              <span>Pemain Aktif</span>
              <span>Diurutkan tertinggi</span>
            </div>
            <div style={{ display: 'flex', gap: 6, padding: '4px 0 8px' }}>
              {(['both', 'member', 'harian'] as const).map(f => (
                <button key={f} onClick={() => setFilter(f)} style={{
                  padding: '4px 12px', borderRadius: 999, fontSize: 12, fontWeight: 500,
                  border: 'none', cursor: 'pointer',
                  background: filter === f ? '#d4a017' : 'rgba(255,255,255,0.08)',
                  color: filter === f ? '#000' : 'rgba(255,255,255,0.6)',
                }}>
                  {f === 'both' ? 'Semua' : f === 'member' ? 'Member' : 'Harian'}
                </button>
              ))}
            </div>
            {filtered.map(p => (
              <div key={p.id} className="ledger-row">
                <div className={`player-avatar avatar-${p.skill}`}>{initials(p.name)}</div>
                <div className="ledger-name-block">
                  <div className="ledger-name">{p.name}</div>
                  <div className="ledger-name-sub">
                    {p.skill} · {(p.type ?? 'member') === 'harian' ? 'Harian' : 'Member'} · {p.gamesPlayed}x main
                  </div>
                </div>
                <div className="ledger-cost">{rp(total(p))}</div>
              </div>
            ))}
            {filtered.length === 0 && <div className="ledger-empty">Tidak ada pemain {filter}</div>}
          </>
        )}
      </div>

      {isAdmin && <div className="ledger-footer">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => exportXLSX(state)}
          disabled={rows.length === 0}
        >
          ↓ Download XLSX
        </Button>
      </div>}
    </div>
  )
}

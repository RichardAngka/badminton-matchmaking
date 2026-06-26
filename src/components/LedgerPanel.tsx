import * as XLSX from 'xlsx'
import type { AppState } from '../types'

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

  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'id')
  const members = [...state.players].filter(p => p.type === 'member').sort(byName)
  const harians = [...state.players].filter(p => p.type === 'harian').sort(byName)

  const ledgerSheet = [
    ['No', 'Nama', 'Harian Price', 'Ball Usage Price', 'Total to Pay'],
    ...members.map((p, i) => [i + 1, p.name, 0, p.totalCost, p.totalCost]),
    [],
    ...harians.map((p, i) => [i + 1, p.name, state.harianFee, p.totalCost, state.harianFee + p.totalCost]),
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(matchSheet), 'Match Log')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(ledgerSheet), 'Ledger')
  const [y, mo, d] = state.sessionDate.split('-').map(Number)
  const day = ['min','sen','sel','rab','kam','jum','sab'][new Date(y, mo - 1, d).getDay()]
  XLSX.writeFile(wb, `pbsor-${day}-${state.sessionDate}.xlsx`)
}

export function LedgerPanel({ state, open, onClose }: Props) {
  const totalShuttles = state.matches.reduce((sum, m) => sum + (m.shuttlesUsed ?? 0), 0)
  const rows = [...state.players]
    .filter(p => p.gamesPlayed > 0 || p.totalCost > 0)
    .sort((a, b) => b.totalCost - a.totalCost)

  return (
    <div className={`right-panel${open ? ' open' : ''}`}>
      <div className="ledger-header" style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div className="ledger-title">List Biaya Bola / Orang</div>
          <div className="ledger-total">
            {totalShuttles} Bola
            <span>total sesi</span>
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ marginTop: 2 }}>✕</button>
      </div>

      <div className="ledger-list">
        {rows.length === 0 ? (
          <div className="ledger-empty">
            Selesaikan pertandingan pertama<br />
            untuk melihat rekapan biaya
          </div>
        ) : rows.map((p, i) => (
          <div key={p.id} className="ledger-row">
            <div className={`ledger-rank${i < 3 ? ' top' : ''}`}>{i + 1}</div>
            <div className="ledger-name">{p.name}</div>
            <div className="ledger-cost">{rp(p.totalCost)}</div>
            <div className="ledger-games">{p.gamesPlayed}x main</div>
          </div>
        ))}
      </div>

      <div className="ledger-footer">
        <button
          className="btn btn-accent"
          style={{ width: '100%' }}
          onClick={() => exportXLSX(state)}
          disabled={rows.length === 0}
        >
          ↓ Download XLSX (2 sheet)
        </button>
      </div>
    </div>
  )
}

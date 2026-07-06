import type { AppState, Player } from './types'

// ponytail: ground truth for what a player owes — derived from matches + type + harianFee,
// never from Player.totalCost, since totalCost drifts whenever an edit path (type switch,
// match delete/edit) forgets to keep it in sync.
export function matchCostByPlayer(state: AppState): Map<string, number> {
  const map = new Map<string, number>()
  for (const m of state.matches) {
    if (!m.endTime) continue
    const cost = m.shuttlesUsed ? Math.round((m.shuttlesUsed * state.shuttlePrice) / 4) : 0
    for (const id of [...m.team1, ...m.team2]) map.set(id, (map.get(id) ?? 0) + cost)
  }
  return map
}

export function playerTotal(state: AppState, player: Player, costMap: Map<string, number>): number {
  const ballUsage = costMap.get(player.id) ?? 0
  return (player.type === 'harian' ? state.harianFee : 0) + ballUsage
}

import type { Player, SkillLevel } from './types'

const VAL: Record<SkillLevel, number> = { A1: 4, A2: 3, B1: 2, B2: 1 }

function pair(a: SkillLevel, b: SkillLevel): [number, number] {
  return [Math.max(VAL[a], VAL[b]), Math.min(VAL[a], VAL[b])]
}

function priority(a: SkillLevel, b: SkillLevel, c: SkillLevel, d: SkillLevel): number {
  const t1 = pair(a, b), t2 = pair(c, d)
  // P1: perfect mirror — all same skill
  if (t1[0] === t1[1] && t2[0] === t2[1] && t1[0] === t2[0]) return 1
  // P2: slight split mirror — identical pair composition
  if (t1[0] === t2[0] && t1[1] === t2[1]) return 2
  // P3/P4: average-equal — both teams same sum, split by variance
  if (t1[0] + t1[1] === t2[0] + t2[1]) return Math.max(t1[0] - t1[1], t2[0] - t2[1]) <= 2 ? 3 : 4
  // P5: any remaining valid pairing
  return 5
}

const pairKey = (a: Player, b: Player) => [a.id, b.id].sort().join('|')

// ponytail: O(n^4) combo scan — acceptable for n≤40 players
export function findBestFour(pool: Player[], pastPairs: Set<string> = new Set()): [Player, Player, Player, Player] | null {
  const sorted = [...pool].sort((a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0))
  if (sorted.length < 4) return null

  let best: [Player, Player, Player, Player] | null = null
  let bestScore = Infinity

  outer:
  for (let i = 0; i < sorted.length - 3; i++)
  for (let j = i + 1; j < sorted.length - 2; j++)
  for (let k = j + 1; k < sorted.length - 1; k++)
  for (let l = k + 1; l < sorted.length; l++) {
    const [p, q, r, s] = [sorted[i], sorted[j], sorted[k], sorted[l]]
    const fCount = (p.gender === 'F' ? 1 : 0) + (q.gender === 'F' ? 1 : 0) + (r.gender === 'F' ? 1 : 0) + (s.gender === 'F' ? 1 : 0)
    // 3 distinct team pairings from 4 players
    for (const [a, b, c, d] of [[p, q, r, s], [p, r, q, s], [p, s, q, r]] as [Player, Player, Player, Player][]) {
      // XD: when ≤2 females in combo, each team gets at most 1 (relaxed for 3+ females)
      const t1f = (a.gender === 'F' ? 1 : 0) + (b.gender === 'F' ? 1 : 0)
      if (fCount <= 2 && (t1f > 1 || fCount - t1f > 1)) continue
      // ponytail: +1 per repeated partnership keeps skill balance primary, variety secondary
      let pri = priority(a.skill, b.skill, c.skill, d.skill)
      if (pastPairs.has(pairKey(a, b))) pri += 1
      if (pastPairs.has(pairKey(c, d))) pri += 1
      // ponytail: WD tiebreaker — prefer all-female at equal skill priority; break only on WD P1 (optimal)
      const score = pri * 2 + (fCount === 4 ? 0 : 1)
      if (score < bestScore) {
        bestScore = score
        best = [a, b, c, d]
        if (score === 2) break outer  // WD priority-1: can't improve
      }
    }
  }
  return best
}

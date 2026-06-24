import type { Player, SkillLevel } from "./types";

const VAL: Record<SkillLevel, number> = { A1: 4, A2: 3, B1: 2, B2: 1 };

function pair(a: SkillLevel, b: SkillLevel): [number, number] {
  return [Math.max(VAL[a], VAL[b]), Math.min(VAL[a], VAL[b])];
}

function matchCost(
  a: SkillLevel,
  b: SkillLevel,
  c: SkillLevel,
  d: SkillLevel,
): number {
  const t1 = pair(a, b),
    t2 = pair(c, d);
  if (t1[0] === t2[0] && t1[1] === t2[1]) return 1; // mirror — valid fallback when no variety possible
  if (t1[0] + t1[1] === t2[0] + t2[1]) return 0; // balanced variety
  return Infinity; // unbalanced
}

const pairKey = (a: Player, b: Player) => [a.id, b.id].sort().join("|");

// ponytail: O(n^4) combo scan — acceptable for n≤40 players
export function findBestFour(
  pool: Player[],
  pastPairs: Set<string> = new Set(),
  pastOpponents: Set<string> = new Set(),
): [Player, Player, Player, Player] | null {
  const sorted = [...pool].sort(
    (a, b) => (a.restingSince ?? 0) - (b.restingSince ?? 0),
  );
  if (sorted.length < 4) return null;

  let bestScore = Infinity;
  // ponytail: collect all tied-best matches, pick randomly for variety
  const candidates: [Player, Player, Player, Player][] = [];

  for (let i = 0; i < sorted.length - 3; i++)
    for (let j = i + 1; j < sorted.length - 2; j++)
      for (let k = j + 1; k < sorted.length - 1; k++)
        for (let l = k + 1; l < sorted.length; l++) {
          const [p, q, r, s] = [sorted[i], sorted[j], sorted[k], sorted[l]];
          const fCount =
            (p.gender === "F" ? 1 : 0) +
            (q.gender === "F" ? 1 : 0) +
            (r.gender === "F" ? 1 : 0) +
            (s.gender === "F" ? 1 : 0);

          for (const [a, b, c, d] of [
            [p, q, r, s],
            [p, r, q, s],
            [p, s, q, r],
          ] as [Player, Player, Player, Player][]) {
            const t1f = (a.gender === "F" ? 1 : 0) + (b.gender === "F" ? 1 : 0);
            if (fCount <= 2 && (t1f > 1 || fCount - t1f > 1)) continue;

            const baseCost = matchCost(a.skill, b.skill, c.skill, d.skill);
            if (baseCost === Infinity) continue;

            let score = baseCost;
            if (pastPairs.has(pairKey(a, b))) score += 2;
            if (pastPairs.has(pairKey(c, d))) score += 2;
            // ponytail: +1 per cross pair seen before; 4 cross pairs max +4, same ceiling as partner repeat
            if (pastOpponents.has(pairKey(a, c))) score += 1;
            if (pastOpponents.has(pairKey(a, d))) score += 1;
            if (pastOpponents.has(pairKey(b, c))) score += 1;
            if (pastOpponents.has(pairKey(b, d))) score += 1;
            score += fCount === 4 ? 0 : 1;

            if (score < bestScore) {
              bestScore = score;
              candidates.length = 0;
              candidates.push([a, b, c, d]);
            } else if (score === bestScore) {
              candidates.push([a, b, c, d]);
            }
          }
        }

  return candidates.length
    ? candidates[Math.floor(Math.random() * candidates.length)]
    : null;
}

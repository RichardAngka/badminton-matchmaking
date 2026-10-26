import type { Player } from "./types";
import { pairKey, seed, winProb, type Met, type Power } from "./ratings";

export interface Rec {
  four: [Player, Player, Player, Player]; // team 1 = [0,1], team 2 = [2,3]
  p1: number;        // team 1's chance of winning
  lopsided: boolean; // outside 30–70%: shown only when nothing fairer fills the four
  cost: number;
}

const fem = (p: Player) => (p.gender === "F" ? 1 : 0);
// Lopsided last, then cheapest.
const byRank = (x: Rec, y: Rec) => Number(x.lopsided) - Number(y.lopsided) || x.cost - y.cost;
// How far from a coin flip: 0 is 50–50, 0.2 is 70–30.
const edge = (r: Rec) => Math.abs(r.p1 - 0.5);
// Best is the most even match; the other three are taken one per band of edge
// out to 70%, so the four show a range instead of four coin flips.
const BANDS = [0, 0.05, 0.1, 0.15];
const REST_MS = 8 * 60_000; // off court this long before a new match costs nothing extra

/** The allowed ways to split these four into two pairs, each scored. */
function splits(four: Player[], power: Power, met: Met): Rec[] {
  const fCount = four.reduce((n, p) => n + fem(p), 0);
  // same-skill group must be gender-pure (all-M or all-F only)
  if (four.every(p => p.skill === four[0].skill) && fCount > 0 && fCount < 4) return [];
  const out: Rec[] = [];
  for (const [i, j, k, l] of [[0, 1, 2, 3], [0, 2, 1, 3], [0, 3, 1, 2]]) {
    const [a, b, c, d] = [four[i], four[j], four[k], four[l]];
    const t1f = fem(a) + fem(b);
    if (fCount <= 2 && (t1f > 1 || fCount - t1f > 1)) continue;

    const p1 = winProb((power(a) + power(b)) / 2, (power(c) + power(d)) / 2);
    // ponytail: 20× puts 55% at cost 1, the price of one repeat opponent tonight
    let cost = 20 * Math.abs(p1 - 0.5)
      + (met.partners.get(pairKey(a, b)) ?? 0) + (met.partners.get(pairKey(c, d)) ?? 0);
    for (const [x, y] of [[a, c], [a, d], [b, c], [b, d]])
      cost += met.opponents.get(pairKey(x, y)) ?? 0;
    out.push({ four: [a, b, c, d], p1, lopsided: p1 < 0.3 || p1 > 0.7, cost });
  }
  return out;
}

/** The fairest split of four players picked by hand, or null if the gender rules allow none. */
export function bestPairing(four: Player[], power: Power, met: Met): Rec | null {
  return splits(four, power, met).sort(byRank)[0] ?? null;
}

// ponytail: O(n³) scan with the first player pinned — ~9k groups at 40 players
/** Up to four matches, each a different group of players, most even (Best) to least (Worst). */
export function findTopFour(pool: Player[], met: Met, power: Power): Rec[] {
  // On court sorts last: restingSince is only set when a match ends, so someone
  // still in their first match reads as null — "waiting longest" — and would be pinned.
  const onCourt = (p: Player) => (p.status === "Playing" ? 1 : 0);
  const sorted = [...pool].sort(
    (a, b) => onCourt(a) - onCourt(b) || (a.restingSince ?? 0) - (b.restingSince ?? 0),
  );
  if (sorted.length < 4) return [];

  // Rotation: someone above the session's average, still on court, or only just
  // off it waits behind someone who is not. On court costs 2, as much as a
  // repeat partner; just off starts there and fades to 0 over REST_MS.
  const avgGames = pool.reduce((n, p) => n + p.gamesPlayed, 0) / pool.length;
  const now = Date.now();
  const tired = (p: Player) =>
    p.status === "Playing" ? 2
    : p.restingSince ? 2 * Math.max(0, 1 - (now - p.restingSince) / REST_MS)
    : 0;
  const rest = (p: Player) => 0.5 * Math.max(0, p.gamesPlayed - avgGames) + tired(p);

  // ponytail: pin first-in-queue player (sorted[0]) — queue position beats skill balance
  const first = sorted[0];
  const recs: Rec[] = [];
  for (let j = 1; j < sorted.length - 2; j++)
    for (let k = j + 1; k < sorted.length - 1; k++)
      for (let l = k + 1; l < sorted.length; l++) {
        const four = [first, sorted[j], sorted[k], sorted[l]];
        const best = bestPairing(four, power, met);
        if (!best) continue;
        // Same level beats merely balanced: A1+B2 vs A2+B1 is 50% on paper,
        // four B1s is a real fight. 50 points of spread costs 1, a tier 2.
        const powers = four.map(power);
        best.cost += four.reduce((n, p) => n + rest(p), 0)
          + (Math.max(...powers) - Math.min(...powers)) / 50;
        recs.push(best);
      }

  // Shuffled before the stable sort so equally good groups vary between taps.
  for (let i = recs.length - 1; i > 0; i--) {
    const r = Math.floor(Math.random() * (i + 1));
    [recs[i], recs[r]] = [recs[r], recs[i]];
  }
  recs.sort(byRank);
  const picked: Rec[] = [];
  BANDS.forEach((lo, i) => {
    const hi = BANDS[i + 1] ?? Infinity;
    const pick = recs.find(r => !r.lopsided && edge(r) >= lo && edge(r) < hi);
    if (pick) picked.push(pick);
  });
  // A band nobody fits is filled from the rest, in-band first, Timpang last.
  for (const r of recs) if (picked.length < 4 && !picked.includes(r)) picked.push(r);
  return picked.sort((x, y) => edge(x) - edge(y));
}

if (import.meta.env.DEV) {
  const p = (id: string, skill: Player["skill"], gender: Player["gender"] = "M", restingSince = 1): Player => ({
    id, name: id, skill, gender, type: "harian", status: "Waiting",
    checkInTime: null, checkOutTime: null, restingSince, totalCost: 0, gamesPlayed: 0,
  });
  const pool = [
    p("first", "B1", "M", 0), p("a1", "A1"), p("a2", "A2"), p("b1", "B1"),
    p("b2", "B2"), p("w1", "B1", "F"), p("w2", "B2", "F"), p("a1b", "A1"),
    { ...p("court", "A1", "M", 0), status: "Playing" as const, restingSince: null },
  ];
  const none: Met = { partners: new Map(), opponents: new Map() };
  const bySeed = (q: Player) => seed(q.skill, q.gender);
  const recs = findTopFour(pool, none, bySeed);
  const groups = recs.map(r => r.four.map(q => q.id).sort().join());
  console.assert(recs.length === 4, "[matchmaker] not four recommendations");
  console.assert(new Set(groups).size === recs.length, "[matchmaker] two recommendations share a group");
  console.assert(recs.every(r => r.four.some(q => q.id === "first")), "[matchmaker] longest-waiting player left out");
  console.assert(recs.every((r, i) => i === 0 || edge(recs[i - 1]) <= edge(r)), "[matchmaker] not Best → Worst");
  console.assert(edge(recs[3]) - edge(recs[0]) >= 0.1, "[matchmaker] four coin flips, no range");
  // Four B1s waiting beside A1s and B2s: Best is the B1s, not an A1+B2 pairing.
  const level = [p("first", "B1", "M", 0), p("b1", "B1"), p("b1x", "B1"), p("b1y", "B1"),
    p("a1", "A1"), p("a1b", "A1"), p("b2", "B2"), p("b2b", "B2")];
  const top = findTopFour(level, none, bySeed)[0];
  console.assert(top.four.every(q => q.skill === "B1"), "[matchmaker] Best is not the same-level group");
  // A B1 who just walked off loses to an equal B1 who has rested.
  const fresh = findTopFour([...level, p("b1z", "B1"), { ...p("tired", "B1"), restingSince: Date.now() }], none, bySeed)[0];
  console.assert(!fresh.four.some(q => q.id === "tired"), "[matchmaker] picked someone straight off court");
  // Partnered before: same four B1s, but first is split from b1.
  const met: Met = { partners: new Map([[pairKey(level[0], level[1]), 10]]), opponents: new Map() };
  const split = findTopFour(level, met, bySeed)[0];
  console.assert(split.four[1].id !== "b1", "[matchmaker] repeated a partnership it was told to avoid");
  console.assert(recs.every(r => fem(r.four[0]) + fem(r.four[1]) <= 1 && fem(r.four[2]) + fem(r.four[3]) <= 1), "[matchmaker] two women on one team");
}

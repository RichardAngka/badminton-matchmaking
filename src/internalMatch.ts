import type { Gender, TeamId, TourLevel, TournamentState, TourPlayer } from './types'

export const TEAM_IDS: TeamId[] = [1, 2, 3, 4]

export const LEVELS: TourLevel[] = ['A1+', 'A1', 'A2', 'B1', 'B2', 'W-B1', 'W-B2']

// The match format. Each team fields one pair per Partai = 20 players.
export const PARTAI: [TourLevel, TourLevel][] = [
  ['A1+', 'A1'],   // Partai 1
  ['A1+', 'A1'],   // Partai 2
  ['A1',  'A2'],   // Partai 3
  ['A2',  'A2'],   // Partai 4
  ['B1',  'B1'],   // Partai 5 — tie breaker
  ['B1',  'B2'],   // Partai 6
  ['B1',  'B2'],   // Partai 7
  ['B2',  'B2'],   // Partai 8
  ['B1',  'W-B2'], // Partai 9
  ['W-B1','W-B2'], // Partai 10
]

// Derived from PARTAI rather than hand-written, so the quota can never drift
// from the format: { 'A1+': 2, A1: 3, A2: 3, B1: 5, B2: 4, 'W-B1': 1, 'W-B2': 2 }
export const QUOTA: Record<TourLevel, number> = PARTAI.flat().reduce(
  (acc, lvl) => ({ ...acc, [lvl]: (acc[lvl] ?? 0) + 1 }),
  Object.fromEntries(LEVELS.map(l => [l, 0])) as Record<TourLevel, number>,
)

export const TEAM_SIZE = LEVELS.reduce((s, l) => s + QUOTA[l], 0)  // 20

// '+' and '-' are not valid in a CSS class name, so badges look their class up
// here instead of interpolating the level into `lvl-${level}`.
export const LEVEL_CLASS: Record<TourLevel, string> = {
  'A1+': 'lvl-ap', 'A1': 'lvl-a1', 'A2': 'lvl-a2',
  'B1': 'lvl-b1', 'B2': 'lvl-b2', 'W-B1': 'lvl-wb1', 'W-B2': 'lvl-wb2',
}

const F: Gender = 'F'
const M: Gender = 'M'

// name, or [name, gender] when not male
type SeedEntry = string | [string, Gender]

const SEED: Record<TourLevel, SeedEntry[]> = {
  'A1+': ['Jericko', 'Andrew', 'Wesley', 'Harwin', 'Rendy', 'Alpen', 'Paul', 'Kenzie'],
  'A1': ['RO', 'Davin K', 'Doni', 'Albert K', 'Ferry', 'Uncle Anton', 'Fred W', 'Maliq',
         'Riyo', 'Darren', 'Justine T', 'Alvin S'],
  'A2': ['Super Lim', 'RA', 'Felix W', 'Jones', 'Gilbert Thedy', 'Fredik', 'Winson', 'Alex',
         'Hendry Mok', 'Nicholas Hans', ['Vidya', F], ['Syifa', F]],
  'B1': ['Mavric', 'Alvin', 'David Cai', 'Kewver', 'Jeksen', 'Josua', 'Haudy', 'Dickson',
         'Eric C', 'Bima', 'Franky', 'Martin Liu', 'Calvine', 'Ricky H', ['Stefanny', F],
         'Marvinzimka', 'Louis V', 'Justine W', 'Cung', 'Jeffry Nemesis'],
  'B2': ['Henry K', 'Martin Leo', 'Viggo', 'Kristanto', 'Kewin', 'Andy W', 'Martin Tanzil',
         'Gryntama', 'Pipit', 'Juan', 'Arvin', 'Calvin P', 'Chiang Bacoet', 'Robin',
         'Felix IG', 'Fred Kidal'],
  'W-B1': [['Widya', F], ['Tetie', F], ['Stevi', F], ['Desfiner', F]],
  'W-B2': [['Fellya', F], ['Sherly', F], ['Ci Moni', F], ['Ciyun', F], ['Jesslyn Kacamata', F],
           ['Nata', F], ['Vicky', F], ['Clarrisa', F]],
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

export function seedState(): TournamentState {
  const players: TourPlayer[] = LEVELS.flatMap(level =>
    SEED[level].map(entry => {
      const [name, gender] = Array.isArray(entry) ? entry : [entry, M]
      return { id: slug(name), name, level, gender, team: null }
    }),
  )
  return {
    teamNames: { 1: 'Team 1', 2: 'Team 2', 3: 'Team 3', 4: 'Team 4' },
    players,
  }
}

/** How many of each level sit in `players`. */
export function countByLevel(players: TourPlayer[]): Record<TourLevel, number> {
  const out = Object.fromEntries(LEVELS.map(l => [l, 0])) as Record<TourLevel, number>
  for (const p of players) out[p.level]++
  return out
}

// ── dev-only self-check ──────────────────────────────────────────────────────
// The roster has zero slack: every level pool is exactly 4x its per-team quota.
// A typo in SEED or an edit to PARTAI that breaks that should fail loudly at
// dev-server start, not at the fourth team on tournament day.
function selfCheck() {
  const s = seedState()
  const counts = countByLevel(s.players)
  const bad: string[] = []

  if (s.players.length !== 80) bad.push(`roster is ${s.players.length}, expected 80`)
  if (TEAM_SIZE !== 20) bad.push(`quota sums to ${TEAM_SIZE}, expected 20`)
  if (PARTAI.length !== 10) bad.push(`${PARTAI.length} partai, expected 10`)

  for (const l of LEVELS) {
    if (counts[l] !== QUOTA[l] * 4) {
      bad.push(`${l}: pool ${counts[l]}, needs ${QUOTA[l] * 4} (4 x ${QUOTA[l]})`)
    }
  }

  const seen = new Set<string>()
  for (const p of s.players) {
    if (seen.has(p.id)) bad.push(`duplicate name/id: ${p.name}`)
    seen.add(p.id)
  }

  if (bad.length) throw new Error(`[internalMatch] seed does not fit the match format:\n  ${bad.join('\n  ')}`)
}

if (import.meta.env.DEV) selfCheck()

import type { Gender, ShirtSize, TeamId, TourLevel, TournamentState, TourPlayer } from './types'
import { fetchTournament, upsertTournament } from './supabase'

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

// ── Jersey / PB SOR number (/internal/player) ────────────────────────────────
export const SIZES: ShirtSize[] = ['XS', 'S', 'M', 'L', 'XL', '2XL', '3XL', '4XL']

// Two sources merged, keyed by TourPlayer.id (the slug of the roster name):
//   1. the "List Baju Internal PB Sor 3rd Anniv" chat message — 56 shirt orders
//   2. the club sheet's number registry — fills numbers the chat left blank
// Both use nicknames, so the mapping to roster names is resolved once, here.
// Non-obvious ones, and how they were established:
//   Steven      = Super Lim     — registry and chat both put him at number 1
//   Richard     = RA            — registry "66 Richard A"
//   Ricky Ong   = RO            — registry 58, matching the chat's 58
//   Acung       = Cung (84), Hendry = Hendry Mok (16), Nicholas = Nicholas Hans
//   ynnaf-stefanny = Stefanny   — registry "59 Ong fann"
//   Frederick   = Fred Kidal    — registry lists "Fredderick" (no number) as a
//                                 person distinct from Fredik (55); GUESS
//   Justine 35  = Justine W     — registry says only "Justine"; she is the one
//                                 who ordered a shirt, Justine T did not; GUESS
// The chat gave 21 to both Franky and Desfiner; the registry says 21 = Franky
// and Desfiner = 0, so Desfiner has no number here. The one real collision left
// is 7 (Jeffry Nemesis from the chat, Andy W from the registry) — deliberately
// left in so the page can flag it, see duplicateNumbers().
type Jersey = { number?: number; jersey?: string; size?: ShirtSize }

export const JERSEY: Record<string, Jersey> = {
  // 3rd Anniv shirt orders, in chat order
  'super-lim':      { number: 1,   jersey: 'Bukan Super Lim', size: '2XL' },
  'ra':             { number: 66,  jersey: '洪硕臨',           size: '2XL' },
  'kewver':         { number: 47,  jersey: 'Kewver AK',       size: '2XL' },
  'haudy':          {              jersey: 'Haudy K',         size: '3XL' },
  'andrew':         { number: 68,  jersey: 'Huang JC',        size: '2XL' },
  'franky':         { number: 21,  jersey: 'Franky',          size: 'S'   },
  'stevi':          {              jersey: 'Andrean S',       size: 'S'   },
  'felix-w':        { number: 41,  jersey: 'LIX',             size: 'L'   },
  'martin-liu':     { number: 90,  jersey: 'MARTIN LIU',      size: '2XL' },
  'cung':           { number: 84,  jersey: 'CUNGGORO',        size: 'XL'  },
  'justine-w':      { number: 35,  jersey: 'JW',              size: 'L'   },
  'henry-k':        { number: 73,  jersey: 'H.K',             size: 'XL'  },
  'vicky':          { number: 67,  jersey: 'ViCC',            size: 'M'   },
  'jeksen':         {              jersey: 'KEAN YEW',        size: '2XL' },
  'fredik':         { number: 55,  jersey: 'Fred',            size: 'L'   },
  'eric-c':         { number: 23,  jersey: 'Cantonius',       size: 'XL'  },
  'martin-leo':     { number: 22,  jersey: 'Martin Leo',      size: 'L'   },
  'alvin':          { number: 38,  jersey: '彭德森',           size: 'L'   },
  'mavric':         { number: 83,  jersey: 'Tien',            size: 'XL'  },
  'gilbert-thedy':  { number: 87,  jersey: 'Gilbert T',       size: 'XL'  },
  'ro':             { number: 58,  jersey: 'ARROW',           size: 'XL'  },
  'tetie':          { number: 111, jersey: 'TIE',             size: 'L'   },
  'alvin-s':        {              jersey: 'ALVIN S W',       size: 'XL'  },
  'ferry':          {              jersey: 'FERRY',           size: 'XL'  },
  'dickson':        { number: 57,  jersey: 'D K',             size: 'XL'  },
  'fred-w':         {              jersey: 'Drick',           size: 'L'   },
  'martin-tanzil':  { number: 34,  jersey: 'Martin Tanzil',   size: 'L'   },
  'ciyun':          {              jersey: 'C I Y U N',       size: 'L'   },
  'jones':          {              jersey: 'NES',             size: 'XL'  },
  'viggo':          { number: 48,  jersey: '伍',              size: 'L'   },
  'winson':         { number: 50,  jersey: 'Winson C',        size: 'XL'  },
  'nata':           { number: 18,  jersey: 'NATA',            size: 'XL'  },
  'hendry-mok':     { number: 16,  jersey: 'HENDRY',          size: 'L'   },
  'calvin-p':       {              jersey: 'CALVIN P',        size: '2XL' },
  'josua':          {              jersey: 'JOZH',            size: '2XL' },
  'harwin':         {              jersey: 'HARWIN',          size: 'XL'  },
  'davin-k':        { number: 103, jersey: 'CHEN H W',        size: '3XL' },
  'chiang-bacoet':  { number: 42,  jersey: 'CHIANG',          size: 'L'   },
  'kewin':          { number: 77,  jersey: 'WINNN',           size: '3XL' },
  'sherly':         { number: 33,  jersey: 'ESWE',            size: 'S'   },
  'ricky-h':        { number: 31,  jersey: 'Ricky H',         size: 'L'   },
  'felix-ig':       {              jersey: 'LIX',             size: 'L'   },
  'jeffry-nemesis': { number: 7,   jersey: 'JEP',             size: 'L'   },
  'vidya':          { number: 6,   jersey: 'V A',             size: 'L'   },
  'desfiner':       {              jersey: 'DES',             size: 'M'   },
  'wesley':         { number: 105, jersey: 'wesly',           size: 'L'   },
  'darren':         {              jersey: 'Darren T',        size: 'XL'  },
  'fred-kidal':     {              jersey: 'Frederick',       size: 'L'   },
  'nicholas-hans':  { number: 82,  jersey: '黄星銘',           size: 'L'   },
  'stefanny':       { number: 59,  jersey: 'stefanny',        size: 'M'   },
  'rendy':          {                                         size: 'M'   },
  'kristanto':      {              jersey: 'kristanto',       size: 'L'   },
  'juan':           { number: 14,  jersey: '丘運來',           size: 'L'   },
  'alex':           { number: 86,  jersey: 'Alex YG',         size: '3XL' },
  'paul':           {              jersey: '翁明克',           size: 'L'   },
  'alpen':          {                                         size: 'XL'  },

  // Registry only — has a PB SOR number, did not order a 3rd Anniv shirt
  'jericko':        { number: 81 },
  'david-cai':      { number: 45 },
  'marvinzimka':    { number: 8  },
  'andy-w':         { number: 7  },
  'calvine':        { number: 9  },
  'arvin':          { number: 2  },
  'doni':           { number: 88 },
}

/**
 * Fills blank jersey fields from JERSEY. Only ever writes into `undefined`, so
 * an admin edit always wins and re-running is a no-op. Returns `state` itself
 * when nothing changed, which is what tells the caller to skip the DB write.
 */
export function applyJersey(state: TournamentState): TournamentState {
  let changed = false
  const players = state.players.map(p => {
    const j = JERSEY[p.id]
    if (!j) return p
    const next = { ...p }
    let hit = false
    if (next.number === undefined && j.number !== undefined) { next.number = j.number; hit = true }
    if (next.jersey === undefined && j.jersey !== undefined) { next.jersey = j.jersey; hit = true }
    if (next.size   === undefined && j.size   !== undefined) { next.size   = j.size;   hit = true }
    if (!hit) return p
    changed = true
    return next
  })
  return changed ? { ...state, players } : state
}

/** Numbers worn by more than one player — rendered with a warning on the page. */
export function duplicateNumbers(players: TourPlayer[]): Set<number> {
  const seen = new Set<number>()
  const dup = new Set<number>()
  for (const p of players) {
    if (p.number === undefined) continue
    if (seen.has(p.number)) dup.add(p.number)
    seen.add(p.number)
  }
  return dup
}

/**
 * Seeds the row on first ever open, then backfills jersey data into rows saved
 * before those fields existed. Concurrent first-loads write identical content
 * to the same id, so the race is harmless.
 */
export async function loadTournament(): Promise<TournamentState> {
  const remote = await fetchTournament()
  const next = applyJersey(remote?.players?.length ? remote : seedState())
  if (next !== remote) await upsertTournament(next)
  return next
}

// ponytail: dev-only self-check instead of a test runner this project doesn't
// have. Fails loudly on `yarn dev` if a JERSEY key stops matching a roster id
// (a renamed player) or if applyJersey starts clobbering edits.
if (import.meta.env.DEV) {
  const ids = new Set(seedState().players.map(p => p.id))
  const orphans = Object.keys(JERSEY).filter(id => !ids.has(id))
  console.assert(orphans.length === 0, '[jersey] keys match no roster player:', orphans)

  const once = applyJersey(seedState())
  console.assert(applyJersey(once) === once, '[jersey] applyJersey is not idempotent')
  console.assert(
    once.players.find(p => p.id === 'super-lim')?.number === 1,
    '[jersey] backfill did not run',
  )

  const edited = { ...once, players: once.players.map(p =>
    p.id === 'super-lim' ? { ...p, number: 99 } : p) }
  console.assert(
    applyJersey(edited).players.find(p => p.id === 'super-lim')?.number === 99,
    '[jersey] backfill clobbered an existing edit',
  )
  console.assert(
    [...duplicateNumbers(once.players)].join() === '7',
    '[jersey] expected exactly one duplicate number (7):',
    [...duplicateNumbers(once.players)],
  )
}

import type {
  Acara, Bracket, BracketKey, Day, Drag, Gender, PartaiResult, Rundown, Score, ShirtSize, Slot,
  TeamId, TourLevel, TournamentState, TourPlayer,
} from './types'
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

/**
 * A stable id for a new player: the slug of their name, suffixed only when
 * that slug is already taken. Keeping the plain slug where possible is what
 * lets JERSEY (and any future name-keyed data) find a re-added player.
 */
export function newPlayerId(name: string, players: TourPlayer[]): string {
  const base = slug(name)
  return players.some(p => p.id === base) ? `${base}-${Date.now().toString(36)}` : base
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

// ── Bracket (/internal/tournament) ───────────────────────────────────────────
export const EMPTY_BRACKET: Bracket = { draw: 4, partai: {}, tiebreak: {} }

type Pair = [TeamId | undefined, TeamId | undefined]
const HALF = PARTAI.length / 2  // 5

/** Team 1 vs `draw` in SF 1; the remaining two teams in SF 2. */
export function semis(draw: Bracket['draw']): [[TeamId, TeamId], [TeamId, TeamId]] {
  const [c, d] = TEAM_IDS.filter(t => t !== 1 && t !== draw)
  return [[1, draw], [c, d]]
}

/**
 * More than half of the 10 partai wins outright, so 6 decides it even before
 * all 10 are played. 5–5 goes to the extra match.
 */
export function matchWinner([a, b]: Pair, s?: Score, tiebreak?: TeamId): TeamId | undefined {
  if (!a || !b || !s) return undefined
  if (s[0] > HALF) return a
  if (s[1] > HALF) return b
  if (s[0] === HALF && s[1] === HALF && (tiebreak === a || tiebreak === b)) return tiebreak
  return undefined
}

/**
 * Every lineup and winner, derived from the draw and the entered results:
 * semifinal winners meet in the final, losers in the third-place match.
 * `podium` is [champion, runner-up, 2nd runner-up].
 */
export function resolve(b: Bracket) {
  const [sf1, sf2] = semis(b.draw)
  const win = (k: BracketKey, pair: Pair) => matchWinner(pair, tally(b, k), b.tiebreak[k])
  const lose = (pair: Pair, w?: TeamId) => w && pair.find(t => t !== w)
  const w1 = win('sf1', sf1)
  const w2 = win('sf2', sf2)
  const final: Pair = [w1, w2]
  const third: Pair = [lose(sf1, w1), lose(sf2, w2)]
  const pairs: Record<BracketKey, Pair> = { sf1, sf2, final, third }
  const winner: Record<BracketKey, TeamId | undefined> =
    { sf1: w1, sf2: w2, final: win('final', final), third: win('third', third) }
  const podium = [winner.final, lose(final, winner.final), winner.third]
  return { pairs, winner, podium }
}

/** Drops a final / third-place result that a changed semifinal invalidated. */
function clearStale(b: Bracket, next: Bracket): Bracket {
  const [was, now] = [resolve(b).pairs, resolve(next).pairs]
  for (const d of ['final', 'third'] as const) {
    if (was[d][0] !== now[d][0] || was[d][1] !== now[d][1]) {
      next = {
        ...next,
        partai: { ...next.partai, [d]: undefined },
        tiebreak: { ...next.tiebreak, [d]: undefined },
        results: { ...next.results, [d]: undefined },
      }
    }
  }
  return next
}

/**
 * Edits one partai of one match — its court, points, or officials. Points can
 * flip a semifinal, so whatever the new lineup invalidates is dropped rather
 * than left pointing at the wrong teams.
 */
export function setPartai(
  b: Bracket, k: BracketKey, i: number, patch: Partial<PartaiResult>,
): Bracket {
  const rs = PARTAI.map((_, j) => ({ ...b.results?.[k]?.[j], ...(j === i ? patch : {}) }))
  return clearStale(b, { ...b, results: { ...b.results, [k]: rs } })
}

/** The extra partai's winner, which only counts at 5–5. */
export function setTiebreak(b: Bracket, k: BracketKey, t?: TeamId): Bracket {
  return clearStale(b, { ...b, tiebreak: { ...b.tiebreak, [k]: t } })
}

if (import.meta.env.DEV) {
  console.assert(semis(3).flat().sort().join() === '1,2,3,4', '[bracket] semis drop or repeat a team')
  console.assert(matchWinner([1, 2], [6, 4]) === 1, '[bracket] 6–4 should win')
  console.assert(matchWinner([1, 2], [6, 0]) === 1, '[bracket] 6 partai clinches early')
  console.assert(matchWinner([1, 2], [5, 4]) === undefined, '[bracket] 5–4 is not decided')
  console.assert(matchWinner([1, 2], [5, 5]) === undefined, '[bracket] 5–5 needs the extra match')
  console.assert(matchWinner([1, 2], [5, 5], 2) === 2, '[bracket] extra match decides 5–5')
  console.assert(matchWinner([1, 2], [6, 4], 2) === 1, '[bracket] stale extra match overrode 6–4')
  console.assert(partaiWinner({ score: [21, 21] }) === undefined, '[bracket] a draw has no winner')
  console.assert(partaiWinner({ score: [18, 42] }) === 1, '[bracket] higher points should win')

  // draw 4: SF 1 = 1 v 4, SF 2 = 2 v 3. The first `n` partai go to the left side.
  const won = (b: Bracket, k: BracketKey, n: number) =>
    PARTAI.reduce((acc, _, i) => setPartai(acc, k, i, { score: i < n ? [42, 0] : [0, 42] }), b)

  let b = won(EMPTY_BRACKET, 'sf1', 6)
  console.assert(tally(b, 'sf1')!.join() === '6,4', '[bracket] points did not tally', tally(b, 'sf1'))
  b = won(b, 'sf2', 5)
  console.assert(resolve(b).winner.sf2 === undefined, '[bracket] 5–5 decided without the extra partai')
  b = setTiebreak(b, 'sf2', 3)
  b = won(b, 'final', 4)   // 4–6: Team 3 wins the final
  b = won(b, 'third', 6)
  const r = resolve(b)
  console.assert(r.pairs.final.join() === '1,3', '[bracket] wrong finalists', r)
  console.assert(r.pairs.third.join() === '4,2', '[bracket] third place is not the SF losers', r)
  console.assert(r.podium.join() === '3,1,4', '[bracket] wrong podium', r)
  console.assert(resolve(setPartai(b, 'sf1', 9, { score: [42, 0] })).podium.join() === '3,1,4',
    '[bracket] same SF winner should keep later results')
  console.assert(setPartai(b, 'sf1', 0, { court: 2 }).results?.final !== undefined,
    '[bracket] a court edit should not clear the final')
  const flipped = setPartai(b, 'sf1', 0, { score: [0, 42] })  // 5–5: SF 1 has no winner now
  console.assert(flipped.results?.final === undefined && flipped.results?.third === undefined,
    '[bracket] new lineup kept a stale final / third-place result')
  console.assert(tally(EMPTY_BRACKET, 'sf1') === undefined, '[bracket] empty match should have no score')
  console.assert(tally({ ...EMPTY_BRACKET, partai: { sf1: [6, 4] } }, 'sf1')!.join() === '6,4',
    '[bracket] a hand-entered score should still be read')
}

// ── Line-up (/internal/lineup) ───────────────────────────────────────────────
// Slot ids are lowercase slugs, so the uppercase marker can't collide with one.
export const WO = 'WO'

/** The level each of the 20 slots is meant for: PARTAI flattened. */
export const SLOTS: TourLevel[] = PARTAI.flat()

export const DAY: Record<BracketKey, Day> = { sf1: 1, sf2: 1, final: 2, third: 2 }

/**
 * A team's 20 slots for a day. A player who has since left the team on the Tim
 * page reads as empty, so a lineup can only ever show the current roster.
 */
export function lineupOf(state: TournamentState, team: TeamId, day: Day): Slot[] {
  const ids = new Set(state.players.filter(p => !p.external && p.team === team).map(p => p.id))
  const saved = state.lineups?.[team]?.[day] ?? []
  return SLOTS.map((_, i) => {
    const s = saved[i]
    return s === WO || (s && ids.has(s)) ? s : null
  })
}

/** Checked in for that day on /internal/absen. */
export const isHere = (p: TourPlayer, day: Day) => !!p.present?.includes(day)

/**
 * Slots that can actually be played: WO, or a player in `here` (checked in
 * that day). 20 means the lineup is complete — a picked no-show holds it back.
 */
export const ready = (slots: Slot[], here: Set<string>) =>
  slots.filter(s => s === WO || (s !== null && here.has(s))).length

// ── Points, courts and officials (/internal/lineup) ──────────────────────────
export const COURTS = [1, 2, 3, 4]
export const MAX_POINT = 42

/** Which side of the pair won a partai: 0, 1, or undefined while undecided. */
export function partaiWinner(r?: PartaiResult): 0 | 1 | undefined {
  const s = r?.score
  if (!s || s[0] === s[1]) return undefined
  return s[0] > s[1] ? 0 : 1
}

/**
 * Partai won by each side of a match, counted from the points entered. Falls
 * back to the hand-entered score for a match that has no points at all, so a
 * row saved before this page existed still shows its result.
 */
export function tally(b: Bracket, k: BracketKey): Score | undefined {
  const rs = b.results?.[k]
  if (!rs?.some(r => partaiWinner(r) !== undefined)) return b.partai[k]
  const out: Score = [0, 0]
  for (const r of rs) {
    const w = partaiWinner(r)
    if (w !== undefined) out[w]++
  }
  return out
}

/** The other match of the same day — the one whose courts can clash. */
export const OTHER: Record<BracketKey, BracketKey> =
  { sf1: 'sf2', sf2: 'sf1', final: 'third', third: 'final' }

/**
 * Who may officiate a match: the two teams not playing it, checked in that day.
 * Sorted by team, then name, the way the selector lists them.
 */
export function officials(state: TournamentState, playing: (TeamId | undefined)[], day: Day) {
  return state.players
    .filter(p => !p.external && p.team !== null && !playing.includes(p.team) && isHere(p, day))
    .sort((a, b) => a.team! - b.team! || a.name.localeCompare(b.name))
}

/**
 * Puts `v` in slot i. A player already sitting in another slot moves here
 * (one partai per player per match); WO can fill any number of slots.
 */
export function setSlot(slots: Slot[], i: number, v: Slot): Slot[] {
  const next = SLOTS.map((_, j) => (v && v !== WO && slots[j] === v ? null : slots[j] ?? null))
  next[i] = v
  return next
}

if (import.meta.env.DEV) {
  console.assert(SLOTS.length === 20 && SLOTS[17] === 'W-B2', '[lineup] slot levels drifted from PARTAI')
  let s = setSlot([], 0, 'jericko')
  s = setSlot(s, 2, 'jericko')
  console.assert(s[0] === null && s[2] === 'jericko', '[lineup] a picked player should move, not duplicate')
  s = setSlot(setSlot(s, 4, WO), 5, WO)
  console.assert(s[4] === WO && s[5] === WO, '[lineup] WO should fill many slots')
  console.assert(ready(s, new Set()) === 2, '[lineup] a no-show counted as ready')
  console.assert(ready(s, new Set(['jericko'])) === 3, '[lineup] a checked-in pick not counted')

  const st = seedState()
  st.players.find(p => p.id === 'jericko')!.team = 1
  st.lineups = { 1: { 1: s } }
  console.assert(lineupOf(st, 1, 1)[2] === 'jericko', '[lineup] current member dropped')
  st.players.find(p => p.id === 'jericko')!.team = 2
  const moved = lineupOf(st, 1, 1)
  console.assert(moved[2] === null && moved[4] === WO, '[lineup] ex-member still shown, or WO lost')
}

// ── Rundown (/internal/jadwal) ───────────────────────────────────────────────
// Every time on the timeline snaps to 5 minutes: the <input type="time"> steps
// in 5s, drags round to 5, and a typed 17:07 becomes 17:05. The grid still draws
// a line every 15 minutes — that is a reading aid, not the step.
export const STEP = 5

export const mins = (t: string) => +t.slice(0, 2) * 60 + +t.slice(3, 5)
// Wraps: 10 partai x 45 min runs past midnight, and "01:30" reads better than
// "25:30". Positions on the grid stay linear — only the label wraps.
export const clock = (m: number) => {
  const d = ((m % 1440) + 1440) % 1440
  return `${String(Math.floor(d / 60)).padStart(2, '0')}:${String(d % 60).padStart(2, '0')}`
}

/** Nearest STEP minutes, inside one day. */
export const snap = (m: number) => Math.min(24 * 60 - STEP, Math.max(0, Math.round(m / STEP) * STEP))
export const snapTime = (t: string) => clock(snap(mins(t)))

/** Perkiraan satu partai. 10 partai dari jam 18:00 = selesai 21:20. */
export const PARTAI_MIN = 20

export const DEFAULT_RUNDOWN: Rundown = {
  start: '18:00',   // jam 6 malam
  acara: {
    1: [{ start: '17:30', end: '18:00', title: 'Foto Bersama' }],
    2: [
      { start: '16:30', end: '17:00', title: 'Tumpengan' },
      { start: '17:00', end: '17:30', title: 'Foto Bersama' },
      { start: '17:30', end: '18:00', title: 'Yel Yel' },
    ],
  },
}

/** The stored rundown, or the default for a row saved before this page existed. */
export const rundownOf = (state: TournamentState): Rundown => ({ ...DEFAULT_RUNDOWN, ...state.rundown })

export const acaraOf = (r: Rundown, day: Day): Acara[] =>
  [...(r.acara[day] ?? [])].sort((a, b) => mins(a.start) - mins(b.start))

/**
 * When each partai of a day starts. Acara win the timeline: a partai is pushed
 * past any it would overlap, so adding a ceremony — or stretching one — delays
 * the rest of the day instead of colliding with it. Days are computed
 * separately because their acara differ.
 *
 * ponytail: rescans the acara per partai (4 x 10) rather than merging intervals
 * first; make it a merge pass if a day ever has dozens of acara.
 */
export function partaiTimes(r: Rundown, day: Day): number[] {
  const acara = acaraOf(r, day)   // sorted by start, so one pass per partai chains correctly
  const fixed = r.starts?.[day] ?? {}
  const out: number[] = []
  let t = mins(r.start)
  for (let p = 0; p < PARTAI.length; p++) {
    const set = fixed[p]
    if (set) t = Math.max(t, mins(set))   // an admin's kickoff delays, never pulls earlier
    for (const a of acara) {
      if (mins(a.start) < t + PARTAI_MIN && mins(a.end) > t) t = mins(a.end)
    }
    out.push(t)
    t += PARTAI_MIN
  }
  return out
}

/**
 * Side-by-side lanes for acara that overlap in time, the way a calendar splits
 * concurrent events. Without this the later block simply covers the earlier one.
 * `list` must be sorted by start, as acaraOf() returns it.
 */
export function lanes(list: Acara[]): { lane: number; of: number }[] {
  const out = list.map(() => ({ lane: 0, of: 1 }))
  let group: number[] = []
  let groupEnd = -1
  const flush = () => {
    group.forEach((idx, n) => { out[idx] = { lane: n, of: group.length } })
    group = []
    groupEnd = -1
  }
  list.forEach((a, i) => {
    if (group.length && mins(a.start) >= groupEnd) flush()
    group.push(i)
    groupEnd = Math.max(groupEnd, mins(a.end))
  })
  flush()
  return out
}

/** When the last partai of a day finishes. */
export function playEnd(r: Rundown, day: Day): number {
  const t = partaiTimes(r, day)
  return t[t.length - 1] + PARTAI_MIN
}

/**
 * A drag applied to the rundown: moving keeps the acara's length, dragging its
 * bottom edge changes only the end. Clamped inside the day and never shorter
 * than one step. The page renders the preview from this and then writes the
 * same call's result, so what you drop is exactly what you saw.
 */
export function shift(r: Rundown, g: Drag): Rundown {
  const delta = dragDelta(g)
  const list = acaraOf(r, g.d).map((a, j) => {
    if (j !== g.i) return a
    const from = mins(a.start), to = mins(a.end)
    if (g.edge) return { ...a, end: clock(Math.min(1440, Math.max(from + STEP, to + delta))) }
    const start = Math.max(0, Math.min(1440 - (to - from), from + delta))
    return { ...a, start: clock(start), end: clock(start + (to - from)) }
  })
  return { ...r, acara: { ...r.acara, [g.d]: list } }
}

/** A drag rounded to the grid — what shift() actually applies. */
export const dragDelta = (g: Drag) => Math.round(g.minutes / STEP) * STEP

/**
 * One acara patched: moving its start carries its length along, and its end can
 * never land at or before its start. Without the first rule, setting Tumpengan
 * to 20:40 left its end at 17:00 — an acara that cannot be saved or drawn.
 */
export function editAcara(a: Acara, patch: Partial<Acara>): Acara {
  const next = { ...a, ...patch }
  if (patch.start !== undefined && patch.end === undefined) {
    const len = Math.max(STEP, mins(a.end) - mins(a.start))
    next.end = clock(Math.min(1440, mins(next.start) + len))
  }
  if (mins(next.end) <= mins(next.start)) next.end = clock(mins(next.start) + STEP)
  return next
}

/** Where a new acara starts: after the last one, else an hour before play. */
export const nextAcaraStart = (r: Rundown, list: Acara[]) =>
  list.length ? mins(list[list.length - 1].end) : snap(mins(r.start) - 60)

if (import.meta.env.DEV) {
  console.assert(snapTime('17:07') === '17:05' && snapTime('17:08') === '17:10',
    '[rundown] times are not snapping to 5 minutes')
  console.assert(snapTime('20:40') === '20:40', '[rundown] a 5-minute time was moved')
  console.assert(snapTime('23:59') === '23:55', '[rundown] snap ran past midnight')
  console.assert(PARTAI_MIN === 20, '[rundown] a partai is estimated at 20 minutes')
  console.assert([1, 2].every(d => clock(playEnd(DEFAULT_RUNDOWN, d as Day)) === '21:20'),
    '[rundown] default play should run 18:00-21:20', clock(playEnd(DEFAULT_RUNDOWN, 1)))
  console.assert(
    [1, 2].every(d => acaraOf(DEFAULT_RUNDOWN, d as Day).every(a =>
      mins(a.start) % STEP === 0 && mins(a.end) % STEP === 0 && mins(a.end) > mins(a.start))),
    '[rundown] a default acara is off the grid or ends before it starts')
  console.assert(rundownOf({ teamNames: {} as never, players: [] }).start === '18:00',
    '[rundown] a row without a rundown should fall back to the default')
  console.assert(clock(25 * 60 + 30) === '01:30', '[rundown] a past-midnight label did not wrap')

  console.assert(clock(nextAcaraStart(DEFAULT_RUNDOWN, [])) === '17:00',
    '[rundown] the first acara of a day should sit an hour before play')
  console.assert(
    clock(nextAcaraStart(DEFAULT_RUNDOWN, [{ start: '15:00', end: '15:30', title: 'x' }])) === '15:30',
    '[rundown] a new acara should follow the last one')

  // The acara: nothing overlaps play, so the partai keep their own rhythm.
  const plain = partaiTimes(DEFAULT_RUNDOWN, 1).map(clock)
  console.assert(plain[0] === '18:00' && plain[1] === '18:20' && plain[9] === '21:00',
    '[rundown] partai are not 20 minutes apart', plain)

  // An acara running into play postpones it; one in the middle splits the day.
  const late = { ...DEFAULT_RUNDOWN, acara: { 1: [{ start: '17:30', end: '18:30', title: 'Foto' }] } }
  console.assert(clock(partaiTimes(late, 1)[0]) === '18:30' && clock(playEnd(late, 1)) === '21:50',
    '[rundown] an overrunning acara did not postpone the partai', partaiTimes(late, 1).map(clock))

  const mid = { ...DEFAULT_RUNDOWN, acara: { 1: [{ start: '19:00', end: '19:30', title: 'Break' }] } }
  const split = partaiTimes(mid, 1).map(clock)
  console.assert(split[2] === '18:40' && split[3] === '19:30' && clock(playEnd(mid, 1)) === '21:50',
    '[rundown] a mid-session acara did not push the rest of the day', split)
  console.assert(
    partaiTimes(mid, 1).every((t, i) => i === 0 || t >= partaiTimes(mid, 1)[i - 1] + PARTAI_MIN),
    '[rundown] partai overlap each other')

  // Dragging: the block keeps its length and the partai follow it.
  const moved = shift(DEFAULT_RUNDOWN, { d: 1, i: 0, minutes: 30, edge: false })
  console.assert(acaraOf(moved, 1)[0].start === '18:00' && acaraOf(moved, 1)[0].end === '18:30',
    '[rundown] a dragged acara changed length', acaraOf(moved, 1)[0])
  console.assert(clock(partaiTimes(moved, 1)[0]) === '18:30',
    '[rundown] the partai did not follow a dragged acara')
  const grown = shift(DEFAULT_RUNDOWN, { d: 1, i: 0, minutes: 30, edge: true })
  console.assert(acaraOf(grown, 1)[0].start === '17:30' && acaraOf(grown, 1)[0].end === '18:30',
    '[rundown] the bottom edge should move only the end', acaraOf(grown, 1)[0])
  console.assert(
    acaraOf(shift(DEFAULT_RUNDOWN, { d: 1, i: 0, minutes: -120, edge: true }), 1)[0].end === '17:45',
    '[rundown] an acara was dragged shorter than one step')
  const lateNight = { ...DEFAULT_RUNDOWN, acara: { 1: [{ start: '23:00', end: '23:30', title: 'x' }] } }
  console.assert(acaraOf(shift(lateNight, { d: 1, i: 0, minutes: 120, edge: false }), 1)[0].start === '23:30',
    '[rundown] a drag ran off the end of the day',
    acaraOf(shift(lateNight, { d: 1, i: 0, minutes: 120, edge: false }), 1)[0])

  // A drag of more than half a step rounds up to one, less rounds to zero.
  console.assert(dragDelta({ d: 1, i: 0, minutes: 8, edge: false }) === 10
    && dragDelta({ d: 1, i: 0, minutes: 2, edge: false }) === 0,
    '[rundown] a raw drag did not round to the step')

  // Re-timing an acara keeps its length; an inverted one is impossible.
  const tump = { start: '16:30', end: '17:00', title: 'Tumpengan' }
  console.assert(editAcara(tump, { start: '20:40' }).end === '21:10',
    '[rundown] moving an acara lost its length', editAcara(tump, { start: '20:40' }))
  console.assert(editAcara(tump, { end: '16:00' }).end === '16:35',
    '[rundown] an acara was allowed to end before it starts', editAcara(tump, { end: '16:00' }))
  console.assert(editAcara(tump, { title: 'x' }).start === '16:30',
    '[rundown] a rename moved the times')

  // An admin's kickoff delays that partai and the ones after it.
  const held = { ...DEFAULT_RUNDOWN, starts: { 1: { 3: '20:00' } } }
  const ht = partaiTimes(held, 1).map(clock)
  console.assert(ht[2] === '18:40' && ht[3] === '20:00' && ht[4] === '20:20',
    '[rundown] a set kickoff did not delay its partai and the rest', ht)
  console.assert(
    clock(partaiTimes({ ...DEFAULT_RUNDOWN, starts: { 1: { 3: '17:00' } } }, 1)[3]) === '19:00',
    '[rundown] a kickoff before the natural slot should be ignored')

  // Overlapping acara share the width instead of hiding each other.
  const solo = lanes([{ start: '17:00', end: '17:30', title: 'a' }, { start: '17:30', end: '18:00', title: 'b' }])
  console.assert(solo.every(l => l.of === 1), '[rundown] touching acara should not share a lane', solo)
  const pair = lanes([{ start: '17:00', end: '17:45', title: 'a' }, { start: '17:30', end: '18:00', title: 'b' }])
  console.assert(pair[0].lane === 0 && pair[1].lane === 1 && pair.every(l => l.of === 2),
    '[rundown] overlapping acara did not split', pair)
  const trio = lanes([
    { start: '17:00', end: '18:00', title: 'a' }, { start: '17:15', end: '17:30', title: 'b' },
    { start: '17:45', end: '18:15', title: 'c' }, { start: '19:00', end: '19:30', title: 'd' },
  ])
  console.assert(trio.slice(0, 3).every(l => l.of === 3) && trio[3].of === 1 && trio[2].lane === 2,
    '[rundown] a chained overlap group is wrong', trio)

  // Chained acara: each pushes the next partai further, in one pass.
  const chain = { ...DEFAULT_RUNDOWN, acara: { 1: [
    { start: '18:00', end: '18:30', title: 'a' }, { start: '18:20', end: '19:00', title: 'b' },
  ] } }
  console.assert(clock(partaiTimes(chain, 1)[0]) === '19:00',
    '[rundown] overlapping acara did not chain', clock(partaiTimes(chain, 1)[0]))
}

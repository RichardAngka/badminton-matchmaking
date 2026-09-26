export type SkillLevel = 'A1' | 'A2' | 'B1' | 'B2'
export type Gender = 'M' | 'F'
export type PlayerStatus = 'Waiting' | 'Playing' | 'Left'
export type PlayerType = 'harian' | 'member'

export interface Player {
  id: string
  name: string
  skill: SkillLevel
  gender: Gender
  type: PlayerType
  status: PlayerStatus
  checkInTime: number | null
  checkOutTime: number | null
  restingSince: number | null
  totalCost: number  // IDR, always integer
  gamesPlayed: number
}

export interface Match {
  id: string
  matchNumber: number
  courtId: number
  team1: [string, string]  // player IDs
  team2: [string, string]
  startTime: number
  endTime?: number
  shuttlesUsed?: number
  score?: string
}

export interface TimeSlot {
  start: string  // "17:00"
  end: string    // "20:00"
  courts: number
}

export interface AppState {
  sessionDate: string
  shuttlePrice: number
  harianFee: number
  targetPlayers: number
  timeSlots: TimeSlot[]
  players: Player[]
  matches: Match[]
  matchCounter: number
  pregenerated?: [string, string, string, string][]
}

// ── Internal tournament (/internal-match) ────────────────────────────────────
// Standalone from Player/SkillLevel above: this roster is fixed, not per-session,
// and W-B1/W-B2 are their own levels, NOT (B1|B2 + female) — Stefanny is one of
// the 20 B1s, so deriving the women's levels from gender breaks the quota math.
export type TourLevel = 'A1+' | 'A1' | 'A2' | 'B1' | 'B2' | 'W-B1' | 'W-B2'
export type TeamId = 1 | 2 | 3 | 4

// The club size chart. 'XXL' from the shirt-order chat normalises to '2XL' so a
// per-size tally can't count the same size twice.
export type ShirtSize = 'XS' | 'S' | 'M' | 'L' | 'XL' | '2XL' | '3XL' | '4XL'

export interface TourPlayer {
  id: string
  name: string
  level: TourLevel
  gender: Gender
  team: TeamId | null
  // Jersey fields (/internal/player). Optional because the roster predates them
  // and ~17 players have neither a PB SOR number nor a 3rd Anniv shirt.
  number?: number   // PB SOR squad number, unpadded: "07" and 7 are one number
  jersey?: string   // name printed on the back
  size?: ShirtSize
  // Jersey-only, not in the tournament: excluded from the level pool and the
  // team builder, listed in its own group on /internal/player.
  external?: true
  // At most one per team. Dropped whenever the player changes team.
  captain?: true
  // Days checked in on /internal/absen. Kept across team changes — they still arrived.
  present?: Day[]
}

// ── Bracket (/internal/tournament) ───────────────────────────────────────────
// Only the draw and results are stored; every winner, the final and third-place
// lineups and the podium are derived from them, so they can't disagree.
export type BracketKey = 'sf1' | 'sf2' | 'final' | 'third'  // third = semifinal losers
export type Score = [number, number]  // a pair of numbers in the pair's order

// One partai of a match: how it was played and how it ended.
export interface PartaiResult {
  court?: number    // 1–4
  score?: Score     // points, 0–42 each — the higher one wins the partai
  wasit?: string    // player id, from a team not playing this match
  lines?: string[]  // up to 2 linesman player ids, same teams as the wasit
}

export interface Bracket {
  draw: 2 | 3 | 4   // Team 1's semifinal opponent; the other two meet in SF 2
  // Partai won, hand-entered before points existed. Only read for a match whose
  // partai have no points yet, so old rows still show their result.
  partai: Partial<Record<BracketKey, Score>>
  tiebreak: Partial<Record<BracketKey, TeamId>>  // extra-match winner, only read at 5–5
  results?: Partial<Record<BracketKey, PartaiResult[]>>  // one per partai, in PARTAI order
}

// ── Line-up (/internal/lineup) ───────────────────────────────────────────────
// Slot i plays PARTAI[i >> 1] in position i & 1: a player id, 'WO' for a
// forfeited slot, or null while not entered. Stored per team per day, not per
// match — every team plays once a day, so a lineup follows its team if the
// draw or a semifinal result changes.
export type Day = 1 | 2
export type Slot = string | null

// ── Rundown (/internal/jadwal) ────────────────────────────────────────────────
// Every time is "HH:MM" snapped to 5 minutes. The match window is a start plus
// one duration per partai, so its end is derived and can never disagree with
// PARTAI — an end time stored next to a duration could.
export interface Acara { start: string; end: string; title: string }

// A drag in progress on /internal/jadwal: which acara, how far it has been
// pulled in minutes, and whether the bottom edge is moving rather than the
// block. `minutes` is raw — shift() snaps it, so the block can follow the
// cursor pixel for pixel while only 5-minute values are ever saved.
export interface Drag { d: Day; i: number; minutes: number; edge: boolean }

// No per-partai duration here: one partai is estimated at PARTAI_MIN minutes,
// owned by the code so no saved row can hold a stale one.
export interface Rundown {
  start: string   // first partai of the day
  acara: Partial<Record<Day, Acara[]>>
  // Kickoff an admin set for one partai, keyed by day then partai index. It only
  // ever delays — the partai after it follow, so a match that runs long pushes
  // the rest of its day instead of overlapping it.
  starts?: Partial<Record<Day, Record<number, string>>>
}

export interface TournamentState {
  teamNames: Record<TeamId, string>
  players: TourPlayer[]
  bracket?: Bracket  // optional: rows saved before the bracket page existed
  lineups?: Partial<Record<TeamId, Partial<Record<Day, Slot[]>>>>
  rundown?: Rundown  // absent = DEFAULT_RUNDOWN
}

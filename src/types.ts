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
}

export interface TournamentState {
  teamNames: Record<TeamId, string>
  players: TourPlayer[]
}

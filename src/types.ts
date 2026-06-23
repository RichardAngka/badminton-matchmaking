export type SkillLevel = 'A1' | 'A2' | 'B1' | 'B2'
export type Gender = 'M' | 'F'
export type PlayerStatus = 'Waiting' | 'Playing' | 'Left'

export interface Player {
  id: string
  name: string
  skill: SkillLevel
  gender: Gender
  status: PlayerStatus
  checkInTime: number | null
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
  targetPlayers: number
  timeSlots: TimeSlot[]
  players: Player[]
  matches: Match[]
  matchCounter: number
}

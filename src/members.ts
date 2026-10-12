import type { Gender, SkillLevel } from './types'

// Member tetap PB SOR, per hari main. Separate from AppState.players: that is
// one session's check-ins, this is the standing list the check-in form reads.
// Grades come from the tournament roster in internalMatch.ts SEED, with A1+
// folded into A1 (SkillLevel has no A1+) and W-B1/W-B2 read as B1/B2 + female.
export interface Member { name: string; skill: SkillLevel; gender?: Gender }

const F: Gender = 'F'

// ponytail: names not in SEED (Lix, Frederick, david, Mz) default to B1 — fix the
// grade here when someone says what it is, no other file needs to change.
export const MEMBERS: Record<'selasa' | 'kamis', Member[]> = {
  selasa: [
    { name: 'Super Lim', skill: 'A2' },
    { name: 'Felix Ig', skill: 'B2' },
    { name: 'Haudy', skill: 'B1' },
    { name: 'RA', skill: 'A2' },
    { name: 'Lix', skill: 'B1' },
    { name: 'Justin W', skill: 'B1' },
    { name: 'Albert K', skill: 'A1' },
    { name: 'Cung', skill: 'B1' },
    { name: 'Stevi', skill: 'B1', gender: F },
    { name: 'Eric', skill: 'B1' },
    { name: 'Arvin', skill: 'B2' },
    { name: 'Vicky', skill: 'B2', gender: F },
    { name: 'HK', skill: 'B2' },
    { name: 'Kristanto', skill: 'B2' },
    { name: 'Winson', skill: 'A2' },
    { name: 'Robin', skill: 'B2' },
    { name: 'Fellya', skill: 'B2', gender: F },
    { name: 'Ferry', skill: 'A1' },
    { name: 'David Cai', skill: 'B1' },
    { name: 'Ricky H', skill: 'B1' },
    { name: 'Doni', skill: 'A1' },
    { name: 'Frederick', skill: 'B1' },
    { name: 'Jeksen', skill: 'B1' },
    { name: 'Josua', skill: 'B1' },
    { name: 'Thedy', skill: 'A2' },
    { name: 'Martin Liu', skill: 'B1' },
    { name: 'Calvine', skill: 'B1' },
    { name: 'Ci Moni', skill: 'B2', gender: F },
    { name: 'Darren T', skill: 'A1' },
  ],
  kamis: [
    { name: 'Super Lim', skill: 'A2' },
    { name: 'Mavric', skill: 'B1' },
    { name: 'david', skill: 'B1' },
    { name: 'Alvin PB Sor', skill: 'B1' },
    { name: 'Justine', skill: 'A1' },
    { name: 'Nic', skill: 'A2' },
    { name: 'RO', skill: 'A1' },
    { name: 'Jones', skill: 'A2' },
    { name: 'Eric', skill: 'B1' },
    { name: 'Fredik', skill: 'A2' },
    { name: 'Dickson', skill: 'B1' },
    { name: 'mtz', skill: 'B2' },
    { name: 'jericko', skill: 'A1' },
    { name: 'andrew', skill: 'A1' },
    { name: 'Desfiner', skill: 'B1', gender: F },
    { name: 'Fellya', skill: 'B2', gender: F },
    { name: 'Martin Leo', skill: 'B2' },
    { name: 'Kewver', skill: 'B1' },
    { name: 'Doni', skill: 'A1' },
    { name: 'Franky', skill: 'B1' },
    { name: 'Rendy Lim', skill: 'A1' },
    { name: 'Alpen', skill: 'A1' },
    { name: 'Ci Moni', skill: 'B2', gender: F },
    { name: 'Wesly', skill: 'A1' },
    { name: 'Mz', skill: 'B1' },
    { name: 'Harwin', skill: 'A1' },
    { name: 'Calvine', skill: 'B1' },
    { name: 'Kewin', skill: 'B2' },
    { name: 'Alvin S', skill: 'A1' },
    { name: 'Paul Dominie', skill: 'A1' },
  ],
}

/**
 * The standing list for a session date, with a label for it: Tuesday's or
 * Thursday's, and on any other day both merged (first entry wins) so the form
 * still autofills.
 */
export function memberDay(sessionDate: string): { label: string; list: Member[] } {
  const day = new Date(`${sessionDate}T00:00:00`).getDay()
  if (day === 2) return { label: 'Selasa', list: MEMBERS.selasa }
  if (day === 4) return { label: 'Kamis', list: MEMBERS.kamis }
  const seen = new Set<string>()
  const list = [...MEMBERS.selasa, ...MEMBERS.kamis].filter(m => {
    const k = m.name.toLowerCase()
    return seen.has(k) ? false : (seen.add(k), true)
  })
  return { label: 'Selasa + Kamis', list }
}

/** Exact name match, case-insensitive — what the check-in form autofills from. */
export const findMember = (list: Member[], name: string) =>
  list.find(m => m.name.toLowerCase() === name.trim().toLowerCase())

if (import.meta.env.DEV) {
  for (const [day, list] of Object.entries(MEMBERS)) {
    const names = list.map(m => m.name.toLowerCase())
    console.assert(new Set(names).size === names.length, `[members] duplicate name in ${day}`)
  }
  // An invalid date would silently fall through to the merged list.
  console.assert(memberDay('2026-10-13').list === MEMBERS.selasa, '[members] Tuesday not selasa')
  console.assert(memberDay('2026-10-15').list === MEMBERS.kamis, '[members] Thursday not kamis')
  console.assert(memberDay('2026-10-14').list.length > MEMBERS.kamis.length, '[members] merge broken')
}

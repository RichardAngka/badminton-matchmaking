import { createContext, useContext } from 'react'
import type { TeamId } from './types'

/** Admins edit everything; a captain only fills their own team's line-up. */
export type Role = { admin: boolean; team: TeamId | null; signedIn: boolean }

export const RoleCtx = createContext<Role>({ admin: false, team: null, signedIn: false })
export const useIsAdmin = () => useContext(RoleCtx).admin
/** The team this session captains, or null for admins and viewers. */
export const useCaptainTeam = () => useContext(RoleCtx).team
/** Anyone logged in — what the log-out button keys off, admin or not. */
export const useSignedIn = () => useContext(RoleCtx).signedIn

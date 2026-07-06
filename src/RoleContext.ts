import { createContext, useContext } from 'react'
export const RoleCtx = createContext(false) // false = not admin
export const useIsAdmin = () => useContext(RoleCtx)

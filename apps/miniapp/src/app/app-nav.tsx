import { createContext, useContext } from 'react'

export type TabId = 'home' | 'month' | 'history' | 'house'

export const TAB_IDS: readonly TabId[] = ['home', 'month', 'history', 'house']

type AppNav = {
  tab: TabId
  navigate: (tab: TabId) => void
  openAdd: () => void
  openBuys: (options?: { transfer?: boolean }) => void
  openRoutines: () => void
}

export const AppNavContext = createContext<AppNav | null>(null)

/** Cross-screen navigation: switch tabs and open the shell-level sheets. */
export function useAppNav(): AppNav {
  const value = useContext(AppNavContext)
  if (!value) throw new Error('useAppNav must be used within AppNavContext')
  return value
}

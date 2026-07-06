import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'

import {
  getResolvedThemeMode,
  getThemePreference,
  setThemePreference as writeThemePreference,
  subscribeThemeMode,
  type ThemeMode,
  type ThemePreference
} from '@/telegram/theme'

type ThemeContextValue = {
  preference: ThemePreference
  mode: ThemeMode
  setPreference: (preference: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => getThemePreference())
  const [mode, setMode] = useState<ThemeMode>(() => getResolvedThemeMode())

  useEffect(() => subscribeThemeMode(setMode), [])

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next)
    setPreferenceState(next)
  }, [])

  const value = useMemo(
    () => ({ preference, mode, setPreference }),
    [preference, mode, setPreference]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

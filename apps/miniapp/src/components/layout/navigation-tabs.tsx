import { useNavigate, useLocation } from '@solidjs/router'
import { Home, Wallet, BookOpen } from 'lucide-solid'
import { type JSX } from 'solid-js'

import { useI18n } from '../../contexts/i18n-context'

type TabItem = {
  path: string
  label: string
  icon: JSX.Element
}

/**
 * Bottom navigation bar with 3 tabs (Bug #6 fix: reduced to 3 tabs,
 * settings moved to top bar gear icon).
 */
export function NavigationTabs(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { copy } = useI18n()

  const tabs = (): TabItem[] => [
    { path: '/', label: copy().home, icon: <Home size={20} /> },
    { path: '/balances', label: copy().balances, icon: <Wallet size={20} /> },
    { path: '/ledger', label: copy().ledger, icon: <BookOpen size={20} /> }
  ]

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/'
    return location.pathname.startsWith(path)
  }

  return (
    <nav class="nav-grid">
      {tabs().map((tab) => (
        <button
          classList={{ 'is-active': isActive(tab.path) }}
          type="button"
          onClick={() => navigate(tab.path)}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  )
}

import { useNavigate, useLocation } from '@solidjs/router'
import { Home, Receipt, ScrollText, UsersRound } from 'lucide-solid'
import { type JSX } from 'solid-js'

import { useI18n } from '../../contexts/i18n-context'

type TabItem = {
  path: string
  label: string
  icon: JSX.Element
}

/**
 * Bottom navigation bar with 4 tabs.
 */
export function NavigationTabs(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const { copy, locale } = useI18n()

  const tabs = (): TabItem[] => [
    { path: '/', label: locale() === 'ru' ? 'Сегодня' : 'Today', icon: <Home size={20} /> },
    {
      path: '/activity',
      label: locale() === 'ru' ? 'Активность' : 'Activity',
      icon: <ScrollText size={20} />
    },
    { path: '/bills', label: copy().bills, icon: <Receipt size={20} /> },
    {
      path: '/household',
      label: locale() === 'ru' ? 'Дом' : 'Household',
      icon: <UsersRound size={20} />
    }
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

import { House, ReceiptText, Settings } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/dialog'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession } from '@/app/session-context'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { haptics } from '@/telegram/webapp'

export type TabId = 'home' | 'activity' | 'settings'

/** Programmatic tab switch for cross-view affordances (e.g. Home → Activity). */
export function navigateToTab(tab: TabId) {
  window.dispatchEvent(new CustomEvent('miniapp:navigate', { detail: tab }))
}

export function TabBar({ tab, onChange }: { tab: TabId; onChange: (tab: TabId) => void }) {
  const { locale } = useI18n()

  const tabs: { id: TabId; label: string; icon: ReactNode }[] = [
    {
      id: 'home',
      label: locale === 'ru' ? 'Сегодня' : 'Today',
      icon: <House className="size-5" />
    },
    {
      id: 'activity',
      label: locale === 'ru' ? 'Журнал' : 'Activity',
      icon: <ReceiptText className="size-5" />
    },
    {
      id: 'settings',
      label: locale === 'ru' ? 'Настройки' : 'Settings',
      icon: <Settings className="size-5" />
    }
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="mx-auto grid max-w-lg grid-cols-3">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => {
              if (item.id !== tab) haptics.selection()
              onChange(item.id)
            }}
            className={cn(
              'flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium transition-colors',
              item.id === tab ? 'text-primary' : 'text-faint'
            )}
          >
            {item.icon}
            <span>{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  )
}

export function AppHeader() {
  const session = useReadySession()
  const { copy, locale, setLocale } = useI18n()
  const { refreshing, testingRolePreview, testingOverridesActive, demoScenario } = useDashboard()
  const [testingOpen, setTestingOpen] = useState(false)
  const tapCount = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const testingUnlockable = session.mode === 'demo' || import.meta.env.DEV

  function handleTitleTap() {
    if (!testingUnlockable) return
    tapCount.current++
    if (tapCount.current >= 5) {
      setTestingOpen(true)
      tapCount.current = 0
    }
    clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0
    }, 1000)
  }

  return (
    <header className="mx-auto flex max-w-lg items-start justify-between gap-3 px-4 pt-4">
      <div className="min-w-0" onClick={handleTitleTap}>
        <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
          {copy.appSubtitle}
        </p>
        <h1 className="mt-0.5 truncate font-display text-xl font-semibold text-foreground">
          {session.member.householdName || copy.appTitle}
        </h1>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {session.mode === 'demo' ? <Badge tone="primary">{copy.demoBadge}</Badge> : null}
          {testingRolePreview ? (
            <Badge tone="warning">
              {copy.testingViewBadge}:{' '}
              {testingRolePreview === 'admin' ? copy.adminTag : copy.residentTag}
            </Badge>
          ) : null}
          {testingOverridesActive ? (
            <Badge tone="warning">{locale === 'ru' ? 'Тестовая дата' : 'Test date'}</Badge>
          ) : null}
          {refreshing ? (
            <Badge tone="outline">{locale === 'ru' ? 'Обновление…' : 'Refreshing…'}</Badge>
          ) : null}
        </div>
      </div>

      <div className="flex shrink-0 overflow-hidden rounded-full border border-border">
        {(['en', 'ru'] as const).map((code) => (
          <button
            key={code}
            type="button"
            onClick={() => setLocale(code)}
            className={cn(
              'px-2.5 py-1 text-[11px] font-semibold uppercase transition-colors',
              locale === code ? 'bg-primary-soft text-primary' : 'text-faint'
            )}
          >
            {code}
          </button>
        ))}
      </div>

      {testingUnlockable ? (
        <TestingSheet
          open={testingOpen}
          onOpenChange={setTestingOpen}
          demoScenario={demoScenario}
        />
      ) : null}
    </header>
  )
}

function TestingSheet({
  open,
  onOpenChange,
  demoScenario
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  demoScenario: string
}) {
  const session = useReadySession()
  const { copy } = useI18n()
  const {
    testingRolePreview,
    setTestingRolePreview,
    setDemoScenario,
    testingPeriodOverride,
    setTestingPeriodOverride,
    testingTodayOverride,
    setTestingTodayOverride
  } = useDashboard()

  const scenarios = [
    { id: 'current-cycle', label: copy.testingScenarioCurrentCycle },
    { id: 'overdue-utilities', label: copy.testingScenarioOverdueUtilities },
    { id: 'overdue-rent-and-utilities', label: copy.testingScenarioOverdueBoth }
  ] as const

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={copy.testingSurfaceTitle}>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground">
            {copy.testingPreviewRoleLabel}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={testingRolePreview === 'admin' ? 'primary' : 'secondary'}
              onClick={() => setTestingRolePreview('admin')}
            >
              {copy.adminTag}
            </Button>
            <Button
              size="sm"
              variant={testingRolePreview === 'resident' ? 'primary' : 'secondary'}
              onClick={() => setTestingRolePreview('resident')}
            >
              {copy.residentTag}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setTestingRolePreview(null)}>
              {copy.testingUseRealRoleAction}
            </Button>
          </div>
        </div>

        {session.mode === 'demo' ? (
          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">{copy.testingScenarioLabel}</p>
            <div className="flex flex-wrap gap-2">
              {scenarios.map((scenario) => (
                <Button
                  key={scenario.id}
                  size="sm"
                  variant={demoScenario === scenario.id ? 'primary' : 'secondary'}
                  onClick={() => setDemoScenario(scenario.id)}
                >
                  {scenario.label}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3">
          <Field label={copy.testingPeriodOverrideLabel}>
            <Input
              type="month"
              value={testingPeriodOverride ?? ''}
              onChange={(event) => setTestingPeriodOverride(event.target.value || null)}
            />
          </Field>
          <Field label={copy.testingTodayOverrideLabel}>
            <Input
              type="date"
              value={testingTodayOverride ?? ''}
              onChange={(event) => setTestingTodayOverride(event.target.value || null)}
            />
          </Field>
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTestingPeriodOverride(null)
            setTestingTodayOverride(null)
          }}
        >
          {copy.testingClearOverridesAction}
        </Button>
      </div>
    </Sheet>
  )
}

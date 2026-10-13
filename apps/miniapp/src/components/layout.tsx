import { CalendarDays, House, Plus, ReceiptText, UsersRound, type LucideIcon } from 'lucide-react'
import { useRef, useState } from 'react'

import { type TabId } from '@/app/app-nav'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession } from '@/app/session-context'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/dialog'
import { miniAppDemo } from '@/demo/loader'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { haptics } from '@/telegram/webapp'

function TabButton({
  active,
  icon: Icon,
  label,
  onClick
}: {
  active: boolean
  icon: LucideIcon
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1 pb-1 pt-2 text-[11px] font-semibold transition-colors',
        active ? 'text-foreground' : 'text-faint'
      )}
    >
      <span
        className={cn(
          'flex h-7 w-12 items-center justify-center rounded-full transition-colors',
          active && 'bg-primary-soft'
        )}
      >
        <Icon className="size-[20px]" strokeWidth={active ? 2.4 : 2} />
      </span>
      {label}
    </button>
  )
}

/** Five slots: four places and, in the middle, the one way to add anything. */
export function TabBar({
  tab,
  onChange,
  onAdd
}: {
  tab: TabId
  onChange: (tab: TabId) => void
  onAdd: () => void
}) {
  const { copy } = useI18n()
  const select = (next: TabId) => {
    if (next !== tab) haptics.selection()
    onChange(next)
  }

  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto grid max-w-lg grid-cols-5 items-end px-2">
        <TabButton
          active={tab === 'home'}
          icon={House}
          label={copy.tabHome}
          onClick={() => select('home')}
        />
        <TabButton
          active={tab === 'month'}
          icon={CalendarDays}
          label={copy.tabMonth}
          onClick={() => select('month')}
        />
        <div className="flex justify-center pb-2">
          <button
            type="button"
            aria-label={copy.addAction}
            onClick={() => {
              haptics.impact('medium')
              onAdd()
            }}
            className="flex size-14 -translate-y-3 items-center justify-center rounded-[20px] bg-primary text-primary-foreground shadow-float transition-transform active:scale-95"
          >
            <Plus className="size-7" strokeWidth={2.5} />
          </button>
        </div>
        <TabButton
          active={tab === 'history'}
          icon={ReceiptText}
          label={copy.tabHistory}
          onClick={() => select('history')}
        />
        <TabButton
          active={tab === 'house'}
          icon={UsersRound}
          label={copy.tabHouse}
          onClick={() => select('house')}
        />
      </div>
    </nav>
  )
}

export function AppHeader() {
  const session = useReadySession()
  const { copy, locale } = useI18n()
  const { testingRolePreview, testingOverridesActive, effectiveTodayOverride } = useDashboard()
  const [testingOpen, setTestingOpen] = useState(false)
  const tapCount = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const testingUnlockable = session.mode === 'demo' || import.meta.env.DEV
  // Demo and test overrides move "today" for the whole app, so the header follows them.
  const todayDate = effectiveTodayOverride
    ? new Date(
        Date.UTC(
          effectiveTodayOverride.year,
          effectiveTodayOverride.month - 1,
          effectiveTodayOverride.day,
          12
        )
      )
    : new Date()
  const today = new Intl.DateTimeFormat(locale === 'ru' ? 'ru-RU' : 'en-US', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(effectiveTodayOverride ? { timeZone: 'UTC' } : {})
  }).format(todayDate)

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
    <header className="mx-auto flex max-w-lg items-end justify-between gap-3 px-5 pb-1 pt-5">
      <div className="min-w-0" onClick={handleTitleTap}>
        <p className="text-[13px] font-medium text-faint first-letter:uppercase">{today}</p>
        <h1 className="mt-0.5 truncate font-display text-[22px] font-bold tracking-tight text-foreground">
          {session.member.householdName || copy.appTitle}
        </h1>
      </div>
      <div className="flex shrink-0 flex-wrap justify-end gap-1.5 pb-1">
        {session.mode === 'demo' ? <Badge tone="routine">{copy.demoBadge}</Badge> : null}
        {testingRolePreview ? (
          <Badge tone="warning">
            {testingRolePreview === 'admin' ? copy.adminTag : copy.residentTag}
          </Badge>
        ) : null}
        {testingOverridesActive ? (
          <Badge tone="warning">{copy.testingTodayOverrideLabel}</Badge>
        ) : null}
      </div>

      {testingUnlockable ? <TestingSheet open={testingOpen} onOpenChange={setTestingOpen} /> : null}
    </header>
  )
}

const SCENARIO_LABELS: Record<string, string> = {
  'utilities-due': 'Utilities due',
  'rent-due': 'Rent due',
  'all-set': 'All paid up',
  overdue: 'Overdue'
}

function TestingSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const session = useReadySession()
  const { copy } = useI18n()
  const {
    testingRolePreview,
    setTestingRolePreview,
    demoScenario,
    setDemoScenario,
    testingPeriodOverride,
    setTestingPeriodOverride,
    testingTodayOverride,
    setTestingTodayOverride
  } = useDashboard()

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={copy.testingSurfaceTitle}>
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-[13px] font-medium text-muted-foreground">
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

        {session.mode === 'demo' && miniAppDemo ? (
          <div className="space-y-2">
            <p className="text-[13px] font-medium text-muted-foreground">
              {copy.testingScenarioLabel}
            </p>
            <div className="flex flex-wrap gap-2">
              {miniAppDemo.demoScenarioIds.map((scenario) => (
                <Button
                  key={scenario}
                  size="sm"
                  variant={demoScenario === scenario ? 'primary' : 'secondary'}
                  onClick={() => {
                    setTestingTodayOverride(null)
                    setDemoScenario(scenario)
                  }}
                >
                  {SCENARIO_LABELS[scenario] ?? scenario}
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

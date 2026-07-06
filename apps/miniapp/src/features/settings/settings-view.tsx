import {
  CalendarRange,
  ChevronRight,
  LayoutList,
  MessagesSquare,
  Receipt,
  UserPlus,
  Users
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession } from '@/app/session-context'
import { useI18n } from '@/i18n/context'
import { formatCyclePeriod } from '@/lib/dates'
import { minorToMajorString } from '@/lib/money'

import { BillingSettingsSheet } from './billing-settings-sheet'
import { CategoriesSheet } from './categories-sheet'
import { CycleSheet } from './cycle-sheet'
import { MembersSheet } from './members-sheet'
import { PendingMembersSheet } from './pending-members-sheet'
import { ProfileCard } from './profile-card'
import { TopicsSheet } from './topics-sheet'

type AdminSheetId = 'billing' | 'members' | 'pending' | 'categories' | 'cycle' | 'topics'

function AdminRow({
  icon,
  title,
  hint,
  badge,
  onClick
}: {
  icon: ReactNode
  title: string
  hint: string
  badge?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors active:bg-field-hover"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="truncate text-xs text-faint">{hint}</p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        {badge}
        <ChevronRight className="size-4 text-faint" />
      </div>
    </button>
  )
}

function AdminArea() {
  const { adminSettings, cycleState, pendingMembers } = useDashboard()
  const { copy, locale } = useI18n()
  const [openSheet, setOpenSheet] = useState<AdminSheetId | null>(null)

  if (!adminSettings) {
    return (
      <Card className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </Card>
    )
  }

  const settings = adminSettings.settings
  const members = adminSettings.members
  const categories = adminSettings.categories
  const topics = adminSettings.topics
  const connectedTopicsCount = topics.filter((topic) => Boolean(topic.telegramThreadId)).length
  const activeCategoriesCount = categories.filter((category) => category.isActive).length
  const cycle = cycleState?.cycle ?? null

  function sheetProps(id: AdminSheetId) {
    return {
      open: openSheet === id,
      onOpenChange: (next: boolean) => setOpenSheet(next ? id : null)
    }
  }

  return (
    <>
      <Card className="p-1">
        <p className="px-3 pb-1 pt-2 text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
          {locale === 'ru' ? 'Управление' : 'Control'}
        </p>
        <div className="divide-y divide-border">
          <AdminRow
            icon={<Receipt className="size-4" />}
            title={copy.billingSettingsTitle}
            hint={`${copy.defaultRentAmount}: ${minorToMajorString(
              BigInt(settings.rentAmountMinor ?? '0')
            )} ${settings.rentCurrency} · ${settings.timezone}`}
            onClick={() => setOpenSheet('billing')}
          />
          <AdminRow
            icon={<Users className="size-4" />}
            title={copy.membersTitle}
            hint={copy.membersBody}
            badge={<Badge tone="neutral">{members.length}</Badge>}
            onClick={() => setOpenSheet('members')}
          />
          <AdminRow
            icon={<UserPlus className="size-4" />}
            title={copy.pendingMembersTitle}
            hint={copy.pendingMembersBody}
            badge={
              pendingMembers.length > 0 ? (
                <Badge tone="primary">{pendingMembers.length}</Badge>
              ) : undefined
            }
            onClick={() => setOpenSheet('pending')}
          />
          <AdminRow
            icon={<LayoutList className="size-4" />}
            title={copy.utilityCategoriesTitle}
            hint={
              locale === 'ru'
                ? `${categories.length} категорий · ${activeCategoriesCount} активны`
                : `${categories.length} categories · ${activeCategoriesCount} active`
            }
            onClick={() => setOpenSheet('categories')}
          />
          <AdminRow
            icon={<CalendarRange className="size-4" />}
            title={copy.billingCycleTitle}
            hint={cycle ? formatCyclePeriod(cycle.period, locale) : copy.billingCycleEmpty}
            onClick={() => setOpenSheet('cycle')}
          />
          <AdminRow
            icon={<MessagesSquare className="size-4" />}
            title={copy.topicBindingsTitle}
            hint={
              locale === 'ru'
                ? `${connectedTopicsCount} из ${topics.length} подключены`
                : `${connectedTopicsCount} of ${topics.length} connected`
            }
            badge={<Badge tone="neutral">{connectedTopicsCount}</Badge>}
            onClick={() => setOpenSheet('topics')}
          />
        </div>
      </Card>

      <BillingSettingsSheet {...sheetProps('billing')} />
      <MembersSheet {...sheetProps('members')} />
      <PendingMembersSheet {...sheetProps('pending')} />
      <CategoriesSheet {...sheetProps('categories')} />
      <CycleSheet {...sheetProps('cycle')} />
      <TopicsSheet {...sheetProps('topics')} />
    </>
  )
}

export function SettingsView() {
  const session = useReadySession()
  const { loading, effectiveIsAdmin } = useDashboard()
  const { copy } = useI18n()

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-display text-lg font-semibold text-foreground">
          {effectiveIsAdmin ? copy.householdSettingsTitle : copy.residentHouseTitle}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {effectiveIsAdmin ? copy.householdSettingsBody : copy.residentHouseBody}
        </p>
      </div>

      <ProfileCard />

      {effectiveIsAdmin ? <AdminArea /> : null}

      <footer className="flex flex-col items-center gap-1.5 pb-2 pt-4 text-center">
        <p className="text-sm font-medium text-muted-foreground">{copy.appTitle}</p>
        <p className="text-xs text-faint">{copy.appSubtitle}</p>
        <Badge tone={session.mode === 'demo' ? 'primary' : 'success'}>
          {session.mode === 'demo' ? copy.demoBadge : copy.liveBadge}
        </Badge>
      </footer>
    </div>
  )
}

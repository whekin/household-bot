import { useMemo, useState } from 'react'

import { useAppNav } from '@/app/app-nav'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession } from '@/app/session-context'
import { Skeleton } from '@/components/ui/skeleton'
import { useI18n } from '@/i18n/context'
import { formatTodayParts } from '@/lib/dates'
import { HeroCard } from './hero-card'
import { buildHomeModel } from './home-model'
import { BuysTile, HouseTile } from './home-tiles'
import { PaySheet } from './pay-sheet'
import { RecentCard } from './recent-card'
import { RoutinesCard } from './routines-card'

/**
 * Home is about the reader: what they pay now (or that they are clear), where they
 * stand on shared buys, today's chores, and what just happened.
 */
export function HomeView() {
  const session = useReadySession()
  const { dashboard, loading, effectiveTodayOverride } = useDashboard()
  const { navigate, openBuys } = useAppNav()
  const { locale } = useI18n()
  const [payOpen, setPayOpen] = useState(false)

  const model = useMemo(() => {
    if (!dashboard) return null
    const today = effectiveTodayOverride ?? formatTodayParts(dashboard.timezone)
    if (!today) return null
    return buildHomeModel({ dashboard, memberId: session.member.id, today })
  }, [dashboard, effectiveTodayOverride, session.member.id])

  if (loading || !dashboard || !model) {
    return (
      <div className="space-y-3" role="status">
        <Skeleton className="h-72 w-full rounded-[28px]" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-48 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {dashboard.balanceUpdatePending ? (
        <p role="status" className="rounded-2xl bg-util-soft p-3 text-sm text-util-ink">
          {locale === 'ru'
            ? 'Платёж сохранён, баланс ещё пересчитывается. Обновите страницу перед следующей оплатой.'
            : 'Payment saved; the balance is still updating. Refresh before paying again.'}
        </p>
      ) : null}

      <HeroCard model={model} currency={dashboard.currency} onPay={() => setPayOpen(true)} />

      <div className="grid animate-rise grid-cols-2 gap-3 [animation-delay:60ms]">
        <BuysTile model={model} currency={dashboard.currency} onClick={() => openBuys()} />
        <HouseTile dashboard={dashboard} onClick={() => navigate('month')} />
      </div>

      <RoutinesCard />

      <RecentCard ledger={dashboard.ledger} onSeeAll={() => navigate('history')} />

      <PaySheet open={payOpen} onOpenChange={setPayOpen} model={model} />
    </div>
  )
}

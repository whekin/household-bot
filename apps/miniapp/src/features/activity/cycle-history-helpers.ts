import type { MiniAppDashboard } from '@/api'
import { majorStringToMinor } from '@/lib/money'

export type CycleHistoryEntry = NonNullable<MiniAppDashboard['cycleHistory']>[number]

export function formatHistoryPeriod(period: string, locale: 'en' | 'ru'): string {
  const [year, month] = period.split('-').map(Number)
  if (!year || !month || month < 1 || month > 12) {
    return period
  }

  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(Date.UTC(year, month - 1, 1)))
}

export function cycleHistoryStatus(
  cycle: Pick<CycleHistoryEntry, 'totalRemainingMajor'>
): 'settled' | 'outstanding' | 'credit' {
  const remainingMinor = majorStringToMinor(cycle.totalRemainingMajor)
  if (remainingMinor === 0n) return 'settled'
  return remainingMinor > 0n ? 'outstanding' : 'credit'
}

export function cyclePaymentProgressPercent(
  cycle: Pick<CycleHistoryEntry, 'totalDueMajor' | 'totalPaidMajor'>
): number {
  const dueMinor = majorStringToMinor(cycle.totalDueMajor)
  const paidMinor = majorStringToMinor(cycle.totalPaidMajor)
  if (dueMinor <= 0n) return 100

  const basisPoints = (paidMinor * 10_000n) / dueMinor
  const clamped = basisPoints < 0n ? 0n : basisPoints > 10_000n ? 10_000n : basisPoints
  return Number(clamped) / 100
}

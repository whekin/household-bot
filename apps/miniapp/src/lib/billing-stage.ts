import type { MiniAppDashboard } from '../api'
import type { CalendarDateParts } from './dates'
import { compareTodayToPeriodDay, parsePeriod } from './dates'
import { majorStringToMinor } from './money'

export function computeEffectiveBillingStage(input: {
  dashboard: MiniAppDashboard | null
  period: string | null
  todayOverride: CalendarDateParts | null
  preferTimelineWindow?: boolean
}): 'utilities' | 'rent' | 'idle' {
  const data = input.dashboard
  const period = input.period
  if (!data || !period) {
    return 'idle'
  }

  const utilitiesReminder = compareTodayToPeriodDay(
    period,
    data.utilitiesReminderDay,
    data.timezone,
    input.todayOverride
  )
  const rentReminder = compareTodayToPeriodDay(
    period,
    data.rentWarningDay,
    data.timezone,
    input.todayOverride
  )
  const utilityPlan = data.utilityBillingPlan
  const utilityPlanOpen =
    utilityPlan !== null &&
    utilityPlan !== undefined &&
    utilityPlan.status !== 'settled' &&
    utilityPlan.memberSummaries.some(
      (member) => majorStringToMinor(member.assignedThisCycleMajor) > 0n
    )
  const rentPlanOpen = data.rentBillingState.memberSummaries.some(
    (member) => majorStringToMinor(member.remainingMajor) > 0n
  )

  if (input.preferTimelineWindow) {
    const today = input.todayOverride
    const parsed = parsePeriod(period)
    const utilityWindowOpen =
      today !== null &&
      parsed !== null &&
      utilityPlanOpen &&
      isDayInsidePaymentWindow({
        periodYear: parsed.year,
        periodMonth: parsed.month,
        startDay: data.utilitiesReminderDay,
        endDay: data.utilitiesDueDay,
        today
      })

    if (utilityWindowOpen) {
      return 'utilities'
    }

    return rentPlanOpen && rentReminder !== null && rentReminder >= 0 ? 'rent' : 'idle'
  }

  const utilitiesOpen =
    utilityPlanOpen &&
    utilitiesReminder !== null &&
    rentReminder !== null &&
    (utilitiesReminder >= 0 || rentReminder >= 0)

  if (utilitiesOpen) {
    return 'utilities'
  }

  const rentOpen = rentPlanOpen && rentReminder !== null && rentReminder >= 0

  return rentOpen ? 'rent' : 'idle'
}

function isDayInsidePaymentWindow(input: {
  periodYear: number
  periodMonth: number
  startDay: number
  endDay: number
  today: CalendarDateParts
}): boolean {
  const startMonthOffset = input.startDay > input.endDay ? -1 : 0
  const startMonthDate = new Date(
    Date.UTC(input.periodYear, input.periodMonth - 1 + startMonthOffset, 1)
  )
  const startSafeDay = Math.max(
    1,
    Math.min(
      input.startDay,
      new Date(
        Date.UTC(startMonthDate.getUTCFullYear(), startMonthDate.getUTCMonth() + 1, 0)
      ).getUTCDate()
    )
  )
  const endSafeDay = Math.max(
    1,
    Math.min(input.endDay, new Date(Date.UTC(input.periodYear, input.periodMonth, 0)).getUTCDate())
  )
  const startValue = Date.UTC(
    startMonthDate.getUTCFullYear(),
    startMonthDate.getUTCMonth(),
    startSafeDay
  )
  const endValue = Date.UTC(input.periodYear, input.periodMonth - 1, endSafeDay)
  const todayValue = Date.UTC(input.today.year, input.today.month - 1, input.today.day)

  return todayValue >= startValue && todayValue <= endValue
}

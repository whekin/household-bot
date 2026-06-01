import type { MiniAppDashboard } from '../../miniapp-api'
import { majorStringToMinor, minorToMajorString } from '../../lib/money'
import { memberEffectivePurchaseBalanceMajor } from '../../lib/ledger-helpers'
import type { CalendarDateParts } from '../../lib/dates'
import { parsePeriod } from '../../lib/dates'
import type { RentPaymentDestination } from './rent-payment-destination'

export type TodayPaymentKind = 'rent' | 'utilities'
export type TodayStage = TodayPaymentKind | 'idle'
export type TodayPeriodSummary = NonNullable<MiniAppDashboard['paymentPeriods']>[number]
export type TodayPeriodKindSummary = TodayPeriodSummary['kinds'][number]

export type TodayMemberCloseLine = {
  memberId: string
  displayName: string
  amountMajor: string
  settled: boolean
  isCurrent: boolean
}

export type TodayViewModel = {
  period: string
  stage: TodayStage
  periodSummary: TodayPeriodSummary | null
  kindSummary: TodayPeriodKindSummary | null
  timelineSegments: {
    key: string
    kind: TodayStage
    startDay: number
    endDay: number
    spanDays: number
    renderSpanDays: number
    label: string
  }[]
  currentTimelineSegmentKey: string | null
  isExtendedPeriod: boolean
  remainingMajor: string
  totalMajor: string
  progressPercent: number
  memberLines: TodayMemberCloseLine[]
  openMemberCount: number
  settledMemberCount: number
  currentMemberUtilityLines: {
    billName: string
    amountMajor: string
  }[]
  currentMemberUtilityBreakdown: {
    shareMajor: string
    purchaseOffsetMajor: string
    carryForwardCreditMajor: string
    targetMajor: string
    hasAdjustment: boolean
  } | null
  rentPaymentDestinations: readonly RentPaymentDestination[]
  currentMemberRentDueDate: string | null
  nextWindow: {
    kind: TodayPaymentKind
    label: string
    rangeLabel: string
  } | null
  purchaseBalanceMajor: string
  purchaseEntries: MiniAppDashboard['ledger']
  purchaseTotalMajor: string
  unresolvedPurchaseCount: number
}

export function activePeriodSummary(data: MiniAppDashboard): TodayPeriodSummary | null {
  return (
    (data.paymentPeriods ?? []).find((summary) => summary.isCurrentPeriod) ??
    (data.paymentPeriods ?? []).find((summary) => summary.period === data.period) ??
    null
  )
}

export function periodKindSummary(
  summary: TodayPeriodSummary | null,
  kind: TodayPaymentKind
): TodayPeriodKindSummary | null {
  return summary?.kinds.find((entry) => entry.kind === kind) ?? null
}

export function chooseTodayStage(input: {
  dashboard: MiniAppDashboard
  effectiveStage: TodayStage
  periodSummary: TodayPeriodSummary | null
}): TodayStage {
  return input.effectiveStage
}

export function memberRemainingMajor(
  data: MiniAppDashboard,
  memberId: string,
  kind: TodayPaymentKind,
  periodSummary: TodayPeriodSummary | null
): string {
  if (kind === 'rent') {
    return (
      data.rentBillingState.memberSummaries.find((summary) => summary.memberId === memberId)
        ?.remainingMajor ?? '0.00'
    )
  }

  if (data.utilityBillingPlan) {
    return minorToMajorString(
      data.utilityBillingPlan.categories
        .filter((category) => category.assignedMemberId === memberId)
        .reduce((sum, category) => sum + majorStringToMinor(category.assignedAmountMajor), 0n)
    )
  }

  return (
    periodKindSummary(periodSummary, 'utilities')?.unresolvedMembers.find(
      (summary) => summary.memberId === memberId
    )?.remainingMajor ?? '0.00'
  )
}

export function purchaseShareForMember(
  entry: MiniAppDashboard['ledger'][number],
  memberId: string
): string | null {
  const explicit = entry.purchaseParticipants?.find(
    (participant) => participant.memberId === memberId
  )
  if (explicit?.shareAmountMajor) return explicit.shareAmountMajor

  const included = (entry.purchaseParticipants ?? []).filter((participant) => participant.included)
  const index = included.findIndex((participant) => participant.memberId === memberId)
  if (index < 0 || included.length === 0) return null

  const amountMinor = majorStringToMinor(entry.displayAmountMajor)
  const base = amountMinor / BigInt(included.length)
  const leftover = amountMinor % BigInt(included.length)
  return minorToMajorString(base + (BigInt(index) < leftover ? 1n : 0n))
}

export function initialsForName(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

function clampDay(day: number, totalDays: number): number {
  if (!Number.isInteger(day)) return 1
  return Math.max(1, Math.min(totalDays, day))
}

function daysInPeriod(period: string): number {
  const parsed = parsePeriod(period)
  if (!parsed) return 30
  return new Date(Date.UTC(parsed.year, parsed.month, 0)).getUTCDate()
}

function circularDistance(startDay: number, endDay: number, totalDays: number): number {
  if (startDay === endDay) return totalDays
  if (startDay < endDay) return endDay - startDay
  return totalDays - startDay + endDay
}

function currentDayParts(timezone: string): CalendarDateParts | null {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date())

    const year = Number.parseInt(parts.find((part) => part.type === 'year')?.value ?? '', 10)
    const month = Number.parseInt(parts.find((part) => part.type === 'month')?.value ?? '', 10)
    const day = Number.parseInt(parts.find((part) => part.type === 'day')?.value ?? '', 10)
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null
    return { year, month, day }
  } catch {
    return null
  }
}

function dayInSegment(day: number, startDay: number, endDay: number, _totalDays: number): boolean {
  if (startDay === endDay) return true
  if (startDay < endDay) {
    return day >= startDay && day < endDay
  }
  return day >= startDay || day < endDay
}

function nextWindowForToday(input: {
  segments: TodayViewModel['timelineSegments']
  period: string
  timezone: string
  todayOverride?: CalendarDateParts | null
}): TodayViewModel['nextWindow'] {
  const totalDays = daysInPeriod(input.period)
  const today = input.todayOverride ?? currentDayParts(input.timezone)
  if (!today) return null

  const currentSegmentIndex = input.segments.findIndex((segment) =>
    dayInSegment(today.day, segment.startDay, segment.endDay, totalDays)
  )
  if (currentSegmentIndex < 0) {
    const firstOpenSegment = input.segments.find(
      (
        segment
      ): segment is TodayViewModel['timelineSegments'][number] & { kind: TodayPaymentKind } =>
        segment.kind !== 'idle'
    )
    return firstOpenSegment
      ? {
          kind: firstOpenSegment.kind,
          label: firstOpenSegment.kind === 'utilities' ? 'utilities' : 'rent',
          rangeLabel: firstOpenSegment.label
        }
      : null
  }

  for (let offset = 1; offset <= input.segments.length; offset += 1) {
    const segment = input.segments[(currentSegmentIndex + offset) % input.segments.length]
    if (segment && segment.kind !== 'idle') {
      return {
        kind: segment.kind,
        label: segment.kind === 'utilities' ? 'utilities' : 'rent',
        rangeLabel: segment.label
      }
    }
  }

  return null
}

function currentTimelineSegmentKey(input: {
  segments: TodayViewModel['timelineSegments']
  period: string
  timezone: string
  todayOverride?: CalendarDateParts | null
}): string | null {
  const totalDays = daysInPeriod(input.period)
  const today = input.todayOverride ?? currentDayParts(input.timezone)
  if (!today) return null

  return (
    input.segments.find((segment) =>
      dayInSegment(today.day, segment.startDay, segment.endDay, totalDays)
    )?.key ?? null
  )
}

function appliedUtilityCarryForwardCreditMajor(input: {
  policy: MiniAppDashboard['paymentBalanceAdjustmentPolicy']
  shareMajor: string
  purchaseOffsetMajor: string
  availableCreditMajor: string
  targetMajor: string
}): string {
  if (input.policy !== 'utilities') {
    return '0.00'
  }

  const availableCreditMinor = majorStringToMinor(input.availableCreditMajor)
  if (availableCreditMinor <= 0n) {
    return '0.00'
  }

  const preCarryForwardMinor =
    majorStringToMinor(input.shareMajor) + majorStringToMinor(input.purchaseOffsetMajor)
  if (preCarryForwardMinor <= 0n) {
    return '0.00'
  }

  const targetMinor = majorStringToMinor(input.targetMajor)
  const appliedMinor = preCarryForwardMinor > targetMinor ? preCarryForwardMinor - targetMinor : 0n
  if (appliedMinor <= 0n) {
    return '0.00'
  }

  return minorToMajorString(
    appliedMinor < availableCreditMinor ? appliedMinor : availableCreditMinor
  )
}

export function buildTodayTimeline(input: {
  period: string
  rentStartDay: number
  rentEndDay: number
  utilitiesStartDay: number
  utilitiesEndDay: number
}): TodayViewModel['timelineSegments'] {
  const totalDays = daysInPeriod(input.period)
  const utilitiesStartDay = clampDay(input.utilitiesStartDay, totalDays)
  const utilitiesEndDay = clampDay(input.utilitiesEndDay, totalDays)
  const rentStartDay = clampDay(input.rentStartDay, totalDays)
  const rentEndDay = clampDay(input.rentEndDay, totalDays)

  const utilitiesSpan = Math.max(1, circularDistance(utilitiesStartDay, utilitiesEndDay, totalDays))
  const utilitiesToRentPause = Math.max(
    1,
    circularDistance(utilitiesEndDay, rentStartDay, totalDays)
  )
  const rentSpan = Math.max(1, circularDistance(rentStartDay, rentEndDay, totalDays))
  const rentToUtilitiesPause = Math.max(
    1,
    circularDistance(rentEndDay, utilitiesStartDay, totalDays)
  )

  return [
    {
      key: 'utilities',
      kind: 'utilities',
      startDay: utilitiesStartDay,
      endDay: utilitiesEndDay,
      spanDays: utilitiesSpan,
      renderSpanDays: Math.max(utilitiesSpan, 5),
      label: `${utilitiesStartDay}-${utilitiesEndDay}`
    },
    {
      key: 'pause-before-rent',
      kind: 'idle',
      startDay: utilitiesEndDay,
      endDay: rentStartDay,
      spanDays: utilitiesToRentPause,
      renderSpanDays: Math.max(utilitiesToRentPause, 5),
      label: `${utilitiesEndDay}-${rentStartDay}`
    },
    {
      key: 'rent',
      kind: 'rent',
      startDay: rentStartDay,
      endDay: rentEndDay,
      spanDays: rentSpan,
      renderSpanDays: Math.max(rentSpan, 5),
      label: `${rentStartDay}-${rentEndDay}`
    },
    {
      key: 'pause-before-utilities',
      kind: 'idle',
      startDay: rentEndDay,
      endDay: utilitiesStartDay,
      spanDays: rentToUtilitiesPause,
      renderSpanDays: Math.max(rentToUtilitiesPause, 5),
      label: `${rentEndDay}-${utilitiesStartDay}`
    }
  ]
}

export function buildTodayViewModel(input: {
  dashboard: MiniAppDashboard
  currentMemberId: string | null
  effectivePeriod: string | null
  effectiveStage: TodayStage
  todayOverride?: CalendarDateParts | null
}): TodayViewModel {
  const periodSummary = activePeriodSummary(input.dashboard)
  const stage = chooseTodayStage({
    dashboard: input.dashboard,
    effectiveStage: input.effectiveStage,
    periodSummary
  })
  const period = input.effectivePeriod ?? input.dashboard.period
  const timelineSegments = buildTodayTimeline({
    period,
    rentStartDay: input.dashboard.rentWarningDay,
    rentEndDay: input.dashboard.rentDueDay,
    utilitiesStartDay: input.dashboard.utilitiesReminderDay,
    utilitiesEndDay: input.dashboard.utilitiesDueDay
  })
  const kindSummary = stage === 'idle' ? null : periodKindSummary(periodSummary, stage)
  const totalMinor = majorStringToMinor(kindSummary?.totalDueMajor ?? '0.00')
  const remainingMinor = majorStringToMinor(kindSummary?.totalRemainingMajor ?? '0.00')
  const paidMinor = totalMinor - remainingMinor
  const allPurchaseEntries = input.dashboard.ledger.filter((entry) => entry.kind === 'purchase')
  const purchaseEntries = allPurchaseEntries
    .filter((entry) => entry.resolutionStatus !== 'resolved')
    .sort((left, right) => {
      const leftRank = left.resolutionStatus === 'unresolved' ? 0 : 1
      const rightRank = right.resolutionStatus === 'unresolved' ? 0 : 1
      if (leftRank !== rightRank) return leftRank - rightRank
      return (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')
    })
  const purchaseTotalMinor = allPurchaseEntries
    .filter((entry) => entry.isCurrentCyclePurchase === true)
    .reduce((sum, entry) => sum + majorStringToMinor(entry.displayAmountMajor), 0n)
  const currentMember = input.dashboard.members.find(
    (member) => member.memberId === input.currentMemberId
  )
  const currentMemberUtilitySummary =
    currentMember && input.dashboard.utilityBillingPlan
      ? input.dashboard.utilityBillingPlan.memberSummaries.find(
          (summary) => summary.memberId === currentMember.memberId
        )
      : null
  const currentMemberCarryForwardCreditMajor =
    currentMember && currentMemberUtilitySummary
      ? appliedUtilityCarryForwardCreditMajor({
          policy: input.dashboard.paymentBalanceAdjustmentPolicy,
          shareMajor: currentMember.utilityShareMajor,
          purchaseOffsetMajor: currentMember.purchaseOffsetMajor,
          availableCreditMajor: currentMember.carryForwardCreditMajor ?? '0.00',
          targetMajor: currentMemberUtilitySummary.fairShareMajor
        })
      : '0.00'

  return {
    period,
    stage,
    periodSummary,
    kindSummary,
    timelineSegments,
    currentTimelineSegmentKey: currentTimelineSegmentKey({
      segments: timelineSegments,
      period,
      timezone: input.dashboard.timezone,
      todayOverride: input.todayOverride ?? null
    }),
    isExtendedPeriod:
      periodSummary?.hasOverdueBalance === true ||
      (periodSummary?.period !== undefined && periodSummary.period !== input.dashboard.period),
    remainingMajor: kindSummary?.totalRemainingMajor ?? '0.00',
    totalMajor: kindSummary?.totalDueMajor ?? '0.00',
    progressPercent:
      totalMinor <= 0n ? 100 : Math.max(0, Math.min(100, Number((paidMinor * 100n) / totalMinor))),
    memberLines:
      stage === 'idle'
        ? []
        : input.dashboard.members
            .filter((member) => member.status !== 'left')
            .map((member) => {
              const amountMajor = memberRemainingMajor(
                input.dashboard,
                member.memberId,
                stage,
                periodSummary
              )
              return {
                memberId: member.memberId,
                displayName: member.displayName,
                amountMajor,
                settled: majorStringToMinor(amountMajor) <= 0n,
                isCurrent: member.memberId === input.currentMemberId
              }
            }),
    openMemberCount:
      stage === 'idle'
        ? 0
        : input.dashboard.members
            .filter((member) => member.status !== 'left')
            .filter(
              (member) =>
                majorStringToMinor(
                  memberRemainingMajor(input.dashboard, member.memberId, stage, periodSummary)
                ) > 0n
            ).length,
    settledMemberCount:
      stage === 'idle'
        ? input.dashboard.members.filter((member) => member.status !== 'left').length
        : input.dashboard.members
            .filter((member) => member.status !== 'left')
            .filter(
              (member) =>
                majorStringToMinor(
                  memberRemainingMajor(input.dashboard, member.memberId, stage, periodSummary)
                ) <= 0n
            ).length,
    currentMemberUtilityLines: currentMember
      ? (input.dashboard.utilityBillingPlan?.categories ?? [])
          .filter((category) => category.assignedMemberId === currentMember.memberId)
          .map((category) => ({
            billName: category.billName,
            amountMajor: category.assignedAmountMajor
          }))
          .sort((left, right) =>
            Number(majorStringToMinor(right.amountMajor) - majorStringToMinor(left.amountMajor))
          )
      : [],
    currentMemberUtilityBreakdown:
      stage === 'utilities' && currentMember && currentMemberUtilitySummary
        ? {
            shareMajor: currentMember.utilityShareMajor,
            purchaseOffsetMajor: currentMember.purchaseOffsetMajor,
            carryForwardCreditMajor: currentMemberCarryForwardCreditMajor,
            targetMajor: currentMemberUtilitySummary.fairShareMajor,
            hasAdjustment:
              majorStringToMinor(currentMember.purchaseOffsetMajor) !== 0n ||
              majorStringToMinor(currentMemberCarryForwardCreditMajor) > 0n
          }
        : null,
    rentPaymentDestinations:
      input.dashboard.rentBillingState.paymentDestinations !== null
        ? input.dashboard.rentBillingState.paymentDestinations
        : (input.dashboard.rentPaymentDestinations ?? []),
    currentMemberRentDueDate: input.dashboard.rentBillingState.dueDate ?? null,
    nextWindow:
      stage === 'idle'
        ? nextWindowForToday({
            segments: timelineSegments,
            period,
            timezone: input.dashboard.timezone,
            todayOverride: input.todayOverride ?? null
          })
        : null,
    purchaseBalanceMajor: currentMember
      ? memberEffectivePurchaseBalanceMajor(currentMember)
      : '0.00',
    purchaseEntries,
    purchaseTotalMajor: minorToMajorString(purchaseTotalMinor),
    unresolvedPurchaseCount: purchaseEntries.length
  }
}

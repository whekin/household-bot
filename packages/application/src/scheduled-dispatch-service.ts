import { BillingPeriod, Temporal, nowInstant, type Instant } from '@household/domain'
import type {
  HouseholdConfigurationRepository,
  ScheduledDispatchKind,
  ScheduledDispatchRecord,
  ScheduledDispatchRepository,
  ScheduledDispatchScheduler
} from '@household/ports'

const BUILT_IN_DISPATCH_KINDS = ['utilities', 'rent_warning', 'rent_due'] as const

function builtInDispatchDay(
  kind: (typeof BUILT_IN_DISPATCH_KINDS)[number],
  settings: Awaited<ReturnType<HouseholdConfigurationRepository['getHouseholdBillingSettings']>>
): number {
  switch (kind) {
    case 'utilities':
      return settings.utilitiesReminderDay
    case 'rent_warning':
      return settings.rentWarningDay
    case 'rent_due':
      return settings.rentDueDay
  }
}

function builtInDispatchHour(): number {
  return 9
}

function clampDay(year: number, month: number, day: number): number {
  const yearMonth = new Temporal.PlainYearMonth(year, month)
  return Math.min(day, yearMonth.daysInMonth)
}

function nextBuiltInDispatch(input: {
  kind: (typeof BUILT_IN_DISPATCH_KINDS)[number]
  timezone: string
  day: number
  asOf: Instant
}): {
  dueAt: Instant
  period: string
} {
  const localNow = input.asOf.toZonedDateTimeISO(input.timezone)
  let year = localNow.year
  let month = localNow.month

  const buildCandidate = (candidateYear: number, candidateMonth: number) => {
    const candidateDay = clampDay(candidateYear, candidateMonth, input.day)
    return new Temporal.PlainDateTime(
      candidateYear,
      candidateMonth,
      candidateDay,
      builtInDispatchHour(),
      0,
      0,
      0
    ).toZonedDateTime(input.timezone)
  }

  let candidate = buildCandidate(year, month)
  if (candidate.epochMilliseconds <= localNow.epochMilliseconds) {
    const nextMonth = new Temporal.PlainYearMonth(localNow.year, localNow.month).add({
      months: 1
    })
    year = nextMonth.year
    month = nextMonth.month
    candidate = buildCandidate(year, month)
  }

  return {
    dueAt: candidate.toInstant(),
    period: BillingPeriod.fromString(
      `${candidate.year}-${String(candidate.month).padStart(2, '0')}`
    ).toString()
  }
}

export interface ScheduledDispatchService {
  scheduleAdHocNotification(input: {
    householdId: string
    notificationId: string
    dueAt: Instant
    timezone: string
  }): Promise<ScheduledDispatchRecord>
  cancelAdHocNotification(notificationId: string, cancelledAt?: Instant): Promise<void>
  reconcileHouseholdBuiltInDispatches(householdId: string, asOf?: Instant): Promise<void>
  reconcileAllBuiltInDispatches(asOf?: Instant): Promise<void>
  getDispatchById(dispatchId: string): Promise<ScheduledDispatchRecord | null>
  claimDispatch(dispatchId: string): Promise<boolean>
  releaseDispatch(dispatchId: string): Promise<void>
  markDispatchSent(dispatchId: string, sentAt?: Instant): Promise<ScheduledDispatchRecord | null>
}

export function createScheduledDispatchService(input: {
  repository: ScheduledDispatchRepository
  scheduler: ScheduledDispatchScheduler
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdBillingSettings' | 'getHouseholdChatByHouseholdId' | 'listReminderTargets'
  >
}): ScheduledDispatchService {
  async function createDispatchRecord(record: {
    householdId: string
    kind: ScheduledDispatchKind
    dueAt: Instant
    timezone: string
    adHocNotificationId?: string | null
    period?: string | null
  }) {
    return input.repository.createScheduledDispatch({
      householdId: record.householdId,
      kind: record.kind,
      dueAt: record.dueAt,
      timezone: record.timezone,
      provider: input.scheduler.provider,
      providerDispatchId: null,
      adHocNotificationId: record.adHocNotificationId ?? null,
      period: record.period ?? null
    })
  }

  async function activateDispatch(
    dispatch: ScheduledDispatchRecord,
    dueAt: Instant,
    timezone: string,
    period?: string | null
  ) {
    const result = await input.scheduler.scheduleOneShotDispatch({
      dispatchId: dispatch.id,
      dueAt
    })

    const updated = await input.repository.updateScheduledDispatch({
      dispatchId: dispatch.id,
      dueAt,
      timezone,
      providerDispatchId: result.providerDispatchId,
      period: period ?? null,
      updatedAt: nowInstant()
    })
    if (!updated) {
      await input.scheduler.cancelDispatch(result.providerDispatchId)
      throw new Error(`Failed to update scheduled dispatch ${dispatch.id}`)
    }
    return updated
  }

  async function ensureBuiltInDispatch(inputValue: {
    householdId: string
    kind: (typeof BUILT_IN_DISPATCH_KINDS)[number]
    dueAt: Instant
    timezone: string
    period: string
    existing: ScheduledDispatchRecord | null
  }) {
    if (
      inputValue.existing &&
      inputValue.existing.status === 'scheduled' &&
      inputValue.existing.dueAt.epochMilliseconds === inputValue.dueAt.epochMilliseconds &&
      inputValue.existing.period === inputValue.period &&
      inputValue.existing.provider === input.scheduler.provider &&
      inputValue.existing.providerDispatchId
    ) {
      return
    }

    if (!inputValue.existing) {
      const created = await createDispatchRecord({
        householdId: inputValue.householdId,
        kind: inputValue.kind,
        dueAt: inputValue.dueAt,
        timezone: inputValue.timezone,
        period: inputValue.period
      })

      try {
        await activateDispatch(created, inputValue.dueAt, inputValue.timezone, inputValue.period)
      } catch (error) {
        await input.repository.cancelScheduledDispatch(created.id, nowInstant())
        throw error
      }
      return
    }

    const previousProviderDispatchId = inputValue.existing.providerDispatchId
    const updated = await activateDispatch(
      inputValue.existing,
      inputValue.dueAt,
      inputValue.timezone,
      inputValue.period
    )

    if (previousProviderDispatchId && previousProviderDispatchId !== updated.providerDispatchId) {
      await input.scheduler.cancelDispatch(previousProviderDispatchId)
    }
  }

  async function reconcileHouseholdBuiltInDispatches(householdId: string, asOf = nowInstant()) {
    const [chat, settings, existingDispatches] = await Promise.all([
      input.householdConfigurationRepository.getHouseholdChatByHouseholdId(householdId),
      input.householdConfigurationRepository.getHouseholdBillingSettings(householdId),
      input.repository.listScheduledDispatchesForHousehold(householdId)
    ])

    const existingByKind = new Map(
      existingDispatches
        .filter((dispatch) =>
          BUILT_IN_DISPATCH_KINDS.includes(
            dispatch.kind as (typeof BUILT_IN_DISPATCH_KINDS)[number]
          )
        )
        .map((dispatch) => [dispatch.kind, dispatch])
    )

    if (!chat) {
      for (const dispatch of existingByKind.values()) {
        if (dispatch.status !== 'scheduled') {
          continue
        }

        if (dispatch.providerDispatchId) {
          await input.scheduler.cancelDispatch(dispatch.providerDispatchId)
        }
        await input.repository.cancelScheduledDispatch(dispatch.id, asOf)
      }
      return
    }

    for (const kind of BUILT_IN_DISPATCH_KINDS) {
      const next = nextBuiltInDispatch({
        kind,
        timezone: settings.timezone,
        day: builtInDispatchDay(kind, settings),
        asOf
      })

      await ensureBuiltInDispatch({
        householdId,
        kind,
        dueAt: next.dueAt,
        timezone: settings.timezone,
        period: next.period,
        existing: existingByKind.get(kind) ?? null
      })
    }
  }

  return {
    async scheduleAdHocNotification(dispatchInput) {
      const existing = await input.repository.getScheduledDispatchByAdHocNotificationId(
        dispatchInput.notificationId
      )
      if (!existing) {
        const created = await createDispatchRecord({
          householdId: dispatchInput.householdId,
          kind: 'ad_hoc_notification',
          dueAt: dispatchInput.dueAt,
          timezone: dispatchInput.timezone,
          adHocNotificationId: dispatchInput.notificationId
        })

        try {
          return await activateDispatch(created, dispatchInput.dueAt, dispatchInput.timezone, null)
        } catch (error) {
          await input.repository.cancelScheduledDispatch(created.id, nowInstant())
          throw error
        }
      }

      const previousProviderDispatchId = existing.providerDispatchId
      const updated = await activateDispatch(
        existing,
        dispatchInput.dueAt,
        dispatchInput.timezone,
        null
      )

      if (previousProviderDispatchId && previousProviderDispatchId !== updated.providerDispatchId) {
        await input.scheduler.cancelDispatch(previousProviderDispatchId)
      }

      return updated
    },

    async cancelAdHocNotification(notificationId, cancelledAt = nowInstant()) {
      const existing =
        await input.repository.getScheduledDispatchByAdHocNotificationId(notificationId)
      if (!existing || existing.status !== 'scheduled') {
        return
      }

      if (existing.providerDispatchId) {
        await input.scheduler.cancelDispatch(existing.providerDispatchId)
      }
      await input.repository.cancelScheduledDispatch(existing.id, cancelledAt)
    },

    reconcileHouseholdBuiltInDispatches,

    async reconcileAllBuiltInDispatches(asOf = nowInstant()) {
      const targets = await input.householdConfigurationRepository.listReminderTargets()
      const householdIds = [...new Set(targets.map((target) => target.householdId))]

      for (const householdId of householdIds) {
        await reconcileHouseholdBuiltInDispatches(householdId, asOf)
      }
    },

    getDispatchById(dispatchId) {
      return input.repository.getScheduledDispatchById(dispatchId)
    },

    async claimDispatch(dispatchId) {
      const result = await input.repository.claimScheduledDispatchDelivery(dispatchId)
      return result.claimed
    },

    releaseDispatch(dispatchId) {
      return input.repository.releaseScheduledDispatchDelivery(dispatchId)
    },

    markDispatchSent(dispatchId, sentAt = nowInstant()) {
      return input.repository.markScheduledDispatchSent(dispatchId, sentAt)
    }
  }
}

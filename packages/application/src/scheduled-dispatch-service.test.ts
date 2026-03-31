import { describe, expect, test } from 'bun:test'

import { Temporal } from '@household/domain'
import type {
  HouseholdBillingSettingsRecord,
  HouseholdTelegramChatRecord,
  ReminderTarget,
  ScheduledDispatchRecord,
  ScheduledDispatchRepository,
  ScheduledDispatchScheduler
} from '@household/ports'

import { createScheduledDispatchService } from './scheduled-dispatch-service'

class ScheduledDispatchRepositoryStub implements ScheduledDispatchRepository {
  dispatches = new Map<string, ScheduledDispatchRecord>()
  nextId = 1
  claims = new Set<string>()

  async createScheduledDispatch(input: {
    householdId: string
    kind: ScheduledDispatchRecord['kind']
    dueAt: Temporal.Instant
    timezone: string
    provider: ScheduledDispatchRecord['provider']
    providerDispatchId?: string | null
    adHocNotificationId?: string | null
    period?: string | null
  }): Promise<ScheduledDispatchRecord> {
    const id = `dispatch-${this.nextId++}`
    const record: ScheduledDispatchRecord = {
      id,
      householdId: input.householdId,
      kind: input.kind,
      dueAt: input.dueAt,
      timezone: input.timezone,
      status: 'scheduled',
      provider: input.provider,
      providerDispatchId: input.providerDispatchId ?? null,
      adHocNotificationId: input.adHocNotificationId ?? null,
      period: input.period ?? null,
      sentAt: null,
      cancelledAt: null,
      createdAt: Temporal.Instant.from('2026-03-24T00:00:00Z'),
      updatedAt: Temporal.Instant.from('2026-03-24T00:00:00Z')
    }
    this.dispatches.set(id, record)
    return record
  }

  async getScheduledDispatchById(dispatchId: string): Promise<ScheduledDispatchRecord | null> {
    return this.dispatches.get(dispatchId) ?? null
  }

  async getScheduledDispatchByAdHocNotificationId(
    notificationId: string
  ): Promise<ScheduledDispatchRecord | null> {
    return (
      [...this.dispatches.values()].find(
        (dispatch) => dispatch.adHocNotificationId === notificationId
      ) ?? null
    )
  }

  async listScheduledDispatchesForHousehold(
    householdId: string
  ): Promise<readonly ScheduledDispatchRecord[]> {
    return [...this.dispatches.values()].filter((dispatch) => dispatch.householdId === householdId)
  }

  async listDueScheduledDispatches(input: {
    dueBefore: Temporal.Instant
    provider?: ScheduledDispatchRecord['provider']
    limit: number
  }): Promise<readonly ScheduledDispatchRecord[]> {
    return [...this.dispatches.values()]
      .filter((dispatch) => dispatch.status === 'scheduled')
      .filter((dispatch) => dispatch.dueAt.epochMilliseconds <= input.dueBefore.epochMilliseconds)
      .filter((dispatch) => (input.provider ? dispatch.provider === input.provider : true))
      .sort((left, right) => left.dueAt.epochMilliseconds - right.dueAt.epochMilliseconds)
      .slice(0, input.limit)
  }

  async updateScheduledDispatch(input: {
    dispatchId: string
    dueAt?: Temporal.Instant
    timezone?: string
    providerDispatchId?: string | null
    period?: string | null
    updatedAt: Temporal.Instant
  }): Promise<ScheduledDispatchRecord | null> {
    const current = this.dispatches.get(input.dispatchId)
    if (!current) {
      return null
    }

    const next: ScheduledDispatchRecord = {
      ...current,
      dueAt: input.dueAt ?? current.dueAt,
      timezone: input.timezone ?? current.timezone,
      providerDispatchId:
        input.providerDispatchId === undefined
          ? current.providerDispatchId
          : input.providerDispatchId,
      period: input.period === undefined ? current.period : input.period,
      updatedAt: input.updatedAt
    }
    this.dispatches.set(input.dispatchId, next)
    return next
  }

  async cancelScheduledDispatch(
    dispatchId: string,
    cancelledAt: Temporal.Instant
  ): Promise<ScheduledDispatchRecord | null> {
    const current = this.dispatches.get(dispatchId)
    if (!current || current.status !== 'scheduled') {
      return null
    }

    const next: ScheduledDispatchRecord = {
      ...current,
      status: 'cancelled',
      cancelledAt
    }
    this.dispatches.set(dispatchId, next)
    return next
  }

  async markScheduledDispatchSent(
    dispatchId: string,
    sentAt: Temporal.Instant
  ): Promise<ScheduledDispatchRecord | null> {
    const current = this.dispatches.get(dispatchId)
    if (!current || current.status !== 'scheduled') {
      return null
    }

    const next: ScheduledDispatchRecord = {
      ...current,
      status: 'sent',
      sentAt
    }
    this.dispatches.set(dispatchId, next)
    return next
  }

  async claimScheduledDispatchDelivery(dispatchId: string) {
    if (this.claims.has(dispatchId)) {
      return { dispatchId, claimed: false }
    }
    this.claims.add(dispatchId)
    return { dispatchId, claimed: true }
  }

  async releaseScheduledDispatchDelivery(dispatchId: string) {
    this.claims.delete(dispatchId)
  }
}

function createSchedulerStub(): ScheduledDispatchScheduler & {
  scheduled: Array<{ dispatchId: string; dueAt: string }>
  cancelled: string[]
} {
  let nextId = 1

  return {
    provider: 'gcp-cloud-tasks',
    scheduled: [],
    cancelled: [],
    async scheduleOneShotDispatch(input) {
      this.scheduled.push({
        dispatchId: input.dispatchId,
        dueAt: input.dueAt.toString()
      })
      return {
        providerDispatchId: `provider-${nextId++}`
      }
    },
    async cancelDispatch(providerDispatchId) {
      this.cancelled.push(providerDispatchId)
    }
  }
}

function billingSettings(
  timezone = 'Asia/Tbilisi'
): HouseholdBillingSettingsRecord & { householdId: string } {
  return {
    householdId: 'household-1',
    settlementCurrency: 'GEL',
    timezone,
    rentDueDay: 5,
    rentWarningDay: 3,
    utilitiesReminderDay: 12,
    utilitiesDueDay: 15,
    rentAmountMinor: null,
    rentCurrency: 'GEL',
    rentPaymentDestinations: null
  }
}

function householdChat(): HouseholdTelegramChatRecord {
  return {
    householdId: 'household-1',
    householdName: 'Kojori',
    telegramChatId: 'chat-1',
    telegramChatType: 'supergroup',
    title: 'Kojori',
    defaultLocale: 'ru'
  }
}

describe('createScheduledDispatchService', () => {
  test('schedules and reschedules ad hoc notifications via provider task', async () => {
    const repository = new ScheduledDispatchRepositoryStub()
    const scheduler = createSchedulerStub()
    const service = createScheduledDispatchService({
      repository,
      scheduler,
      householdConfigurationRepository: {
        async getHouseholdBillingSettings() {
          return billingSettings()
        },
        async getHouseholdChatByHouseholdId() {
          return householdChat()
        },
        async listReminderTargets(): Promise<readonly ReminderTarget[]> {
          return []
        }
      }
    })

    const firstDueAt = Temporal.Instant.from('2026-03-25T08:00:00Z')
    const secondDueAt = Temporal.Instant.from('2026-03-25T09:00:00Z')

    const first = await service.scheduleAdHocNotification({
      householdId: 'household-1',
      notificationId: 'notif-1',
      dueAt: firstDueAt,
      timezone: 'Asia/Tbilisi'
    })
    const second = await service.scheduleAdHocNotification({
      householdId: 'household-1',
      notificationId: 'notif-1',
      dueAt: secondDueAt,
      timezone: 'Asia/Tbilisi'
    })

    expect(first.providerDispatchId).toBe('provider-1')
    expect(second.providerDispatchId).toBe('provider-2')
    expect(scheduler.cancelled).toEqual(['provider-1'])

    await service.cancelAdHocNotification('notif-1', Temporal.Instant.from('2026-03-24T11:00:00Z'))

    expect(scheduler.cancelled).toEqual(['provider-1', 'provider-2'])
    expect((await repository.getScheduledDispatchByAdHocNotificationId('notif-1'))?.status).toBe(
      'cancelled'
    )
  })

  test('reconciles one future built-in dispatch per reminder kind', async () => {
    const repository = new ScheduledDispatchRepositoryStub()
    const scheduler = createSchedulerStub()
    const service = createScheduledDispatchService({
      repository,
      scheduler,
      householdConfigurationRepository: {
        async getHouseholdBillingSettings() {
          return billingSettings()
        },
        async getHouseholdChatByHouseholdId() {
          return householdChat()
        },
        async listReminderTargets(): Promise<readonly ReminderTarget[]> {
          return [
            {
              householdId: 'household-1',
              householdName: 'Kojori',
              telegramChatId: 'chat-1',
              telegramThreadId: '103',
              locale: 'ru',
              timezone: 'Asia/Tbilisi',
              utilitiesReminderDay: 12,
              utilitiesDueDay: 15,
              rentWarningDay: 3,
              rentDueDay: 5
            }
          ]
        }
      }
    })

    await service.reconcileAllBuiltInDispatches(Temporal.Instant.from('2026-03-24T00:00:00Z'))

    const scheduled = [...repository.dispatches.values()].filter(
      (dispatch) => dispatch.status === 'scheduled'
    )
    expect(scheduled.map((dispatch) => dispatch.kind).sort()).toEqual([
      'rent_due',
      'rent_warning',
      'utilities'
    ])
    expect(scheduler.scheduled).toHaveLength(3)
    expect(scheduled.every((dispatch) => dispatch.period === '2026-04')).toBe(true)
  })
})

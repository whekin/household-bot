import { describe, expect, test } from 'bun:test'

import type { ScheduledDispatchService } from '@household/application'
import { Temporal } from '@household/domain'
import type {
  AdHocNotificationRecord,
  HouseholdMemberRecord,
  HouseholdTelegramChatRecord,
  HouseholdTopicBindingRecord,
  ScheduledDispatchRecord
} from '@household/ports'

import { createScheduledDispatchHandler } from './scheduled-dispatch-handler'

function scheduledDispatch(
  input: Partial<ScheduledDispatchRecord> &
    Pick<ScheduledDispatchRecord, 'id' | 'householdId' | 'kind'>
): ScheduledDispatchRecord {
  return {
    id: input.id,
    householdId: input.householdId,
    kind: input.kind,
    dueAt: input.dueAt ?? Temporal.Now.instant().subtract({ minutes: 1 }),
    timezone: input.timezone ?? 'Asia/Tbilisi',
    status: input.status ?? 'scheduled',
    provider: input.provider ?? 'gcp-cloud-tasks',
    providerDispatchId: input.providerDispatchId ?? 'provider-1',
    adHocNotificationId: input.adHocNotificationId ?? null,
    period: input.period ?? null,
    sentAt: input.sentAt ?? null,
    cancelledAt: input.cancelledAt ?? null,
    createdAt: input.createdAt ?? Temporal.Instant.from('2026-03-24T00:00:00Z'),
    updatedAt: input.updatedAt ?? Temporal.Instant.from('2026-03-24T00:00:00Z')
  }
}

function notification(input: Partial<AdHocNotificationRecord> = {}): AdHocNotificationRecord {
  return {
    id: input.id ?? 'notif-1',
    householdId: input.householdId ?? 'household-1',
    creatorMemberId: input.creatorMemberId ?? 'creator',
    assigneeMemberId: input.assigneeMemberId ?? null,
    originalRequestText: 'raw',
    notificationText: input.notificationText ?? 'Reminder text',
    timezone: input.timezone ?? 'Asia/Tbilisi',
    scheduledFor: input.scheduledFor ?? Temporal.Now.instant().subtract({ minutes: 1 }),
    timePrecision: input.timePrecision ?? 'exact',
    deliveryMode: input.deliveryMode ?? 'topic',
    dmRecipientMemberIds: input.dmRecipientMemberIds ?? [],
    friendlyTagAssignee: input.friendlyTagAssignee ?? false,
    status: input.status ?? 'scheduled',
    sourceTelegramChatId: input.sourceTelegramChatId ?? null,
    sourceTelegramThreadId: input.sourceTelegramThreadId ?? null,
    sentAt: input.sentAt ?? null,
    cancelledAt: input.cancelledAt ?? null,
    cancelledByMemberId: input.cancelledByMemberId ?? null,
    createdAt: input.createdAt ?? Temporal.Instant.from('2026-03-24T00:00:00Z'),
    updatedAt: input.updatedAt ?? Temporal.Instant.from('2026-03-24T00:00:00Z')
  }
}

describe('createScheduledDispatchHandler', () => {
  test('delivers ad hoc topic notifications exactly once and marks them sent', async () => {
    const dispatch = scheduledDispatch({
      id: 'dispatch-1',
      householdId: 'household-1',
      kind: 'ad_hoc_notification',
      adHocNotificationId: 'notif-1'
    })
    const sentTopicMessages: string[] = []
    const markedNotifications: string[] = []
    const markedDispatches: string[] = []

    const service: ScheduledDispatchService = {
      scheduleAdHocNotification: async () => dispatch,
      cancelAdHocNotification: async () => {},
      reconcileHouseholdBuiltInDispatches: async () => {},
      reconcileAllBuiltInDispatches: async () => {},
      getDispatchById: async () => dispatch,
      claimDispatch: async () => true,
      releaseDispatch: async () => {},
      markDispatchSent: async (dispatchId) => {
        markedDispatches.push(dispatchId)
        return dispatch
      }
    }

    const handler = createScheduledDispatchHandler({
      scheduledDispatchService: service,
      adHocNotificationRepository: {
        async getNotificationById() {
          return notification({
            id: 'notif-1',
            scheduledFor: dispatch.dueAt,
            notificationText: 'Dima, reminder landed.'
          })
        },
        async markNotificationSent(notificationId) {
          markedNotifications.push(notificationId)
          return null
        }
      },
      householdConfigurationRepository: {
        async getHouseholdChatByHouseholdId(): Promise<HouseholdTelegramChatRecord | null> {
          return {
            householdId: 'household-1',
            householdName: 'Kojori',
            telegramChatId: 'chat-1',
            telegramChatType: 'supergroup',
            title: 'Kojori',
            defaultLocale: 'ru'
          }
        },
        async getHouseholdTopicBinding(): Promise<HouseholdTopicBindingRecord | null> {
          return {
            householdId: 'household-1',
            role: 'reminders',
            telegramThreadId: '103',
            topicName: 'Reminders'
          }
        },
        async getHouseholdBillingSettings() {
          throw new Error('not used')
        },
        async listHouseholdMembers(): Promise<readonly HouseholdMemberRecord[]> {
          return []
        }
      },
      sendTopicMessage: async (input) => {
        sentTopicMessages.push(`${input.chatId}:${input.threadId}:${input.text}`)
      },
      sendDirectMessage: async () => {
        throw new Error('not used')
      }
    })

    const response = await handler.handle(
      new Request('http://localhost/jobs/dispatch/dispatch-1', { method: 'POST' }),
      'dispatch-1'
    )
    const payload = (await response.json()) as { ok: boolean; outcome: string }

    expect(payload.ok).toBe(true)
    expect(payload.outcome).toBe('sent')
    expect(sentTopicMessages).toEqual(['chat-1:103:Dima, reminder landed.'])
    expect(markedNotifications).toEqual(['notif-1'])
    expect(markedDispatches).toEqual(['dispatch-1'])
  })

  test('ignores stale ad hoc dispatch callbacks after a reschedule', async () => {
    const dispatch = scheduledDispatch({
      id: 'dispatch-1',
      householdId: 'household-1',
      kind: 'ad_hoc_notification',
      adHocNotificationId: 'notif-1',
      dueAt: Temporal.Instant.from('2026-03-24T08:00:00Z')
    })
    let released = false

    const service: ScheduledDispatchService = {
      scheduleAdHocNotification: async () => dispatch,
      cancelAdHocNotification: async () => {},
      reconcileHouseholdBuiltInDispatches: async () => {},
      reconcileAllBuiltInDispatches: async () => {},
      getDispatchById: async () => dispatch,
      claimDispatch: async () => true,
      releaseDispatch: async () => {
        released = true
      },
      markDispatchSent: async () => dispatch
    }

    const handler = createScheduledDispatchHandler({
      scheduledDispatchService: service,
      adHocNotificationRepository: {
        async getNotificationById() {
          return notification({
            id: 'notif-1',
            scheduledFor: Temporal.Instant.from('2026-03-24T09:00:00Z')
          })
        },
        async markNotificationSent() {
          throw new Error('not used')
        }
      },
      householdConfigurationRepository: {
        async getHouseholdChatByHouseholdId() {
          return null
        },
        async getHouseholdTopicBinding() {
          return null
        },
        async getHouseholdBillingSettings() {
          throw new Error('not used')
        },
        async listHouseholdMembers(): Promise<readonly HouseholdMemberRecord[]> {
          return []
        }
      },
      sendTopicMessage: async () => {
        throw new Error('should not send')
      },
      sendDirectMessage: async () => {
        throw new Error('should not send')
      }
    })

    const response = await handler.handle(
      new Request('http://localhost/jobs/dispatch/dispatch-1', { method: 'POST' }),
      'dispatch-1'
    )
    const payload = (await response.json()) as { ok: boolean; outcome: string }

    expect(payload.ok).toBe(true)
    expect(payload.outcome).toBe('stale')
    expect(released).toBe(true)
  })
})

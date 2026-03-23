import { describe, expect, test } from 'bun:test'

import { Temporal } from '@household/domain'
import type { AdHocNotificationService, DeliverableAdHocNotification } from '@household/application'

import { createAdHocNotificationJobsHandler } from './ad-hoc-notification-jobs'

function dueNotification(
  input: Partial<DeliverableAdHocNotification['notification']> = {}
): DeliverableAdHocNotification {
  return {
    notification: {
      id: input.id ?? 'notif-1',
      householdId: input.householdId ?? 'household-1',
      creatorMemberId: input.creatorMemberId ?? 'creator',
      assigneeMemberId: input.assigneeMemberId ?? 'assignee',
      originalRequestText: 'raw',
      notificationText:
        input.notificationText ?? 'Dima, time to check whether Georgiy has called already.',
      timezone: input.timezone ?? 'Asia/Tbilisi',
      scheduledFor: input.scheduledFor ?? Temporal.Instant.from('2026-03-23T09:00:00Z'),
      timePrecision: input.timePrecision ?? 'exact',
      deliveryMode: input.deliveryMode ?? 'topic',
      dmRecipientMemberIds: input.dmRecipientMemberIds ?? [],
      friendlyTagAssignee: input.friendlyTagAssignee ?? true,
      status: input.status ?? 'scheduled',
      sourceTelegramChatId: null,
      sourceTelegramThreadId: null,
      sentAt: null,
      cancelledAt: null,
      cancelledByMemberId: null,
      createdAt: Temporal.Instant.from('2026-03-22T09:00:00Z'),
      updatedAt: Temporal.Instant.from('2026-03-22T09:00:00Z')
    },
    creator: {
      memberId: 'creator',
      telegramUserId: '111',
      displayName: 'Dima'
    },
    assignee: {
      memberId: 'assignee',
      telegramUserId: '222',
      displayName: 'Georgiy'
    },
    dmRecipients: [
      {
        memberId: 'recipient',
        telegramUserId: '333',
        displayName: 'Alice'
      }
    ]
  }
}

describe('createAdHocNotificationJobsHandler', () => {
  test('delivers topic notifications and marks them sent', async () => {
    const sentTopicMessages: string[] = []
    const sentNotifications: string[] = []

    const service: AdHocNotificationService = {
      scheduleNotification: async () => {
        throw new Error('not used')
      },
      listUpcomingNotifications: async () => [],
      cancelNotification: async () => ({ status: 'not_found' }),
      updateNotification: async () => ({ status: 'not_found' }),
      listDueNotifications: async () => [dueNotification()],
      claimDueNotification: async () => true,
      releaseDueNotification: async () => {},
      markNotificationSent: async (notificationId) => {
        sentNotifications.push(notificationId)
        return null
      }
    }

    const handler = createAdHocNotificationJobsHandler({
      notificationService: service,
      householdConfigurationRepository: {
        async getHouseholdChatByHouseholdId() {
          return {
            householdId: 'household-1',
            householdName: 'Kojori',
            telegramChatId: '777',
            telegramChatType: 'supergroup',
            title: 'Kojori',
            defaultLocale: 'ru'
          }
        },
        async getHouseholdTopicBinding() {
          return {
            householdId: 'household-1',
            role: 'reminders',
            telegramThreadId: '103',
            topicName: 'Reminders'
          }
        }
      },
      sendTopicMessage: async (input) => {
        sentTopicMessages.push(`${input.chatId}:${input.threadId}:${input.text}`)
      },
      sendDirectMessage: async () => {}
    })

    const response = await handler.handle(
      new Request('http://localhost/jobs/notifications/due', {
        method: 'POST'
      })
    )
    const payload = (await response.json()) as { ok: boolean; notifications: { outcome: string }[] }

    expect(payload.ok).toBe(true)
    expect(payload.notifications[0]?.outcome).toBe('sent')
    expect(sentTopicMessages[0]).toContain(
      'Dima, time to check whether Georgiy has called already.'
    )
    expect(sentNotifications).toEqual(['notif-1'])
  })
})

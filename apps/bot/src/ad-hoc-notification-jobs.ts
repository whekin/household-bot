import type { AdHocNotificationService, DeliverableAdHocNotification } from '@household/application'
import { nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import type { HouseholdConfigurationRepository } from '@household/ports'

import { buildTopicNotificationText } from './ad-hoc-notifications'

interface DueNotificationJobRequestBody {
  dryRun?: boolean
  jobId?: string
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  })
}

async function readBody(request: Request): Promise<DueNotificationJobRequestBody> {
  const text = await request.text()
  if (text.trim().length === 0) {
    return {}
  }

  try {
    return JSON.parse(text) as DueNotificationJobRequestBody
  } catch {
    throw new Error('Invalid JSON body')
  }
}

export function createAdHocNotificationJobsHandler(options: {
  notificationService: AdHocNotificationService
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdChatByHouseholdId' | 'getHouseholdTopicBinding'
  >
  sendTopicMessage: (input: {
    householdId: string
    chatId: string
    threadId: string | null
    text: string
    parseMode?: 'HTML'
  }) => Promise<void>
  sendDirectMessage: (input: { telegramUserId: string; text: string }) => Promise<void>
  logger?: Logger
}): {
  handle: (request: Request) => Promise<Response>
} {
  async function deliver(notification: DeliverableAdHocNotification) {
    switch (notification.notification.deliveryMode) {
      case 'topic': {
        const [chat, reminderTopic] = await Promise.all([
          options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
            notification.notification.householdId
          ),
          options.householdConfigurationRepository.getHouseholdTopicBinding(
            notification.notification.householdId,
            'reminders'
          )
        ])

        if (!chat) {
          throw new Error(
            `Household chat not configured for ${notification.notification.householdId}`
          )
        }

        const content = buildTopicNotificationText({
          notificationText: notification.notification.notificationText,
          assignee: notification.assignee,
          friendlyTagAssignee: notification.notification.friendlyTagAssignee
        })
        await options.sendTopicMessage({
          householdId: notification.notification.householdId,
          chatId: chat.telegramChatId,
          threadId: reminderTopic?.telegramThreadId ?? null,
          text: content.text,
          parseMode: content.parseMode
        })
        return
      }
      case 'dm_all':
      case 'dm_selected': {
        for (const recipient of notification.dmRecipients) {
          await options.sendDirectMessage({
            telegramUserId: recipient.telegramUserId,
            text: notification.notification.notificationText
          })
        }
        return
      }
    }
  }

  return {
    handle: async (request) => {
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'Method Not Allowed' }, 405)
      }

      try {
        const body = await readBody(request)
        const now = nowInstant()
        const due = await options.notificationService.listDueNotifications(now)
        const dispatches: Array<{
          notificationId: string
          householdId: string
          outcome: 'dry-run' | 'sent' | 'duplicate' | 'failed'
          error?: string
        }> = []

        for (const notification of due) {
          if (body.dryRun === true) {
            dispatches.push({
              notificationId: notification.notification.id,
              householdId: notification.notification.householdId,
              outcome: 'dry-run'
            })
            continue
          }

          const claimed = await options.notificationService.claimDueNotification(
            notification.notification.id
          )
          if (!claimed) {
            dispatches.push({
              notificationId: notification.notification.id,
              householdId: notification.notification.householdId,
              outcome: 'duplicate'
            })
            continue
          }

          try {
            await deliver(notification)
            await options.notificationService.markNotificationSent(
              notification.notification.id,
              now
            )
            dispatches.push({
              notificationId: notification.notification.id,
              householdId: notification.notification.householdId,
              outcome: 'sent'
            })
          } catch (error) {
            await options.notificationService.releaseDueNotification(notification.notification.id)
            dispatches.push({
              notificationId: notification.notification.id,
              householdId: notification.notification.householdId,
              outcome: 'failed',
              error: error instanceof Error ? error.message : 'Unknown delivery error'
            })
          }
        }

        options.logger?.info(
          {
            event: 'scheduler.ad_hoc_notifications.dispatch',
            notificationCount: dispatches.length,
            jobId: body.jobId ?? request.headers.get('x-cloudscheduler-jobname') ?? null,
            dryRun: body.dryRun === true
          },
          'Ad hoc notification job completed'
        )

        return json({
          ok: true,
          dryRun: body.dryRun === true,
          notifications: dispatches
        })
      } catch (error) {
        options.logger?.error(
          {
            event: 'scheduler.ad_hoc_notifications.failed',
            error: error instanceof Error ? error.message : String(error)
          },
          'Ad hoc notification job failed'
        )

        return json(
          {
            ok: false,
            error: error instanceof Error ? error.message : 'Unknown error'
          },
          500
        )
      }
    }
  }
}

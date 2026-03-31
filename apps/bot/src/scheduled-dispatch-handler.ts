import type { ScheduledDispatchService } from '@household/application'
import { BillingPeriod, nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import type {
  AdHocNotificationRepository,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord,
  ReminderType
} from '@household/ports'
import type { InlineKeyboardMarkup } from 'grammy/types'

import { buildTopicNotificationText } from './ad-hoc-notifications'
import { buildScheduledReminderMessageContent } from './scheduled-reminder-content'

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  })
}

function builtInReminderType(kind: 'utilities' | 'rent_warning' | 'rent_due'): ReminderType {
  switch (kind) {
    case 'utilities':
      return 'utilities'
    case 'rent_warning':
      return 'rent-warning'
    case 'rent_due':
      return 'rent-due'
  }
}

function parsePositiveInteger(
  value: string | null,
  fallback: number,
  { min, max }: { min: number; max: number }
): number {
  if (!value) {
    return fallback
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed)) {
    return fallback
  }

  return Math.min(Math.max(parsed, min), max)
}

export function createScheduledDispatchHandler(options: {
  scheduledDispatchService: ScheduledDispatchService
  adHocNotificationRepository: Pick<
    AdHocNotificationRepository,
    'getNotificationById' | 'markNotificationSent'
  >
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    | 'getHouseholdChatByHouseholdId'
    | 'getHouseholdTopicBinding'
    | 'getHouseholdBillingSettings'
    | 'listHouseholdMembers'
  >
  sendTopicMessage: (input: {
    householdId: string
    chatId: string
    threadId: string | null
    text: string
    parseMode?: 'HTML'
    replyMarkup?: InlineKeyboardMarkup
  }) => Promise<void>
  sendDirectMessage: (input: { telegramUserId: string; text: string }) => Promise<void>
  miniAppUrl?: string
  botUsername?: string
  logger?: Logger
}): {
  handle: (request: Request, dispatchId: string) => Promise<Response>
  handleDueDispatches: (request: Request) => Promise<Response>
} {
  async function sendAdHocNotification(dispatchId: string) {
    const dispatch = await options.scheduledDispatchService.getDispatchById(dispatchId)
    if (
      !dispatch ||
      dispatch.kind !== 'ad_hoc_notification' ||
      !dispatch.adHocNotificationId ||
      dispatch.status !== 'scheduled'
    ) {
      return { outcome: 'noop' as const }
    }

    const currentNow = nowInstant()
    if (dispatch.dueAt.epochMilliseconds > currentNow.epochMilliseconds) {
      return { outcome: 'not_due' as const }
    }

    const claimed = await options.scheduledDispatchService.claimDispatch(dispatch.id)
    if (!claimed) {
      return { outcome: 'duplicate' as const }
    }

    try {
      const notification = await options.adHocNotificationRepository.getNotificationById(
        dispatch.adHocNotificationId
      )
      if (!notification || notification.status !== 'scheduled') {
        await options.scheduledDispatchService.markDispatchSent(dispatch.id, currentNow)
        return { outcome: 'noop' as const }
      }

      if (notification.scheduledFor.epochMilliseconds !== dispatch.dueAt.epochMilliseconds) {
        await options.scheduledDispatchService.releaseDispatch(dispatch.id)
        return { outcome: 'stale' as const }
      }

      if (notification.deliveryMode === 'topic') {
        const householdChat =
          notification.sourceTelegramChatId ??
          (
            await options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
              notification.householdId
            )
          )?.telegramChatId
        const threadId =
          notification.sourceTelegramThreadId ??
          (
            await options.householdConfigurationRepository.getHouseholdTopicBinding(
              notification.householdId,
              'reminders'
            )
          )?.telegramThreadId ??
          null

        if (!householdChat) {
          throw new Error(`Household chat not configured for ${notification.householdId}`)
        }

        const content = buildTopicNotificationText({
          notificationText: notification.notificationText
        })
        await options.sendTopicMessage({
          householdId: notification.householdId,
          chatId: householdChat,
          threadId,
          text: content.text,
          parseMode: content.parseMode
        })
      } else {
        const members = await options.householdConfigurationRepository.listHouseholdMembers(
          notification.householdId
        )
        const dmRecipients = notification.dmRecipientMemberIds
          .map((memberId) => members.find((member) => member.id === memberId))
          .filter((member): member is HouseholdMemberRecord => Boolean(member))

        for (const recipient of dmRecipients) {
          await options.sendDirectMessage({
            telegramUserId: recipient.telegramUserId,
            text: notification.notificationText
          })
        }
      }

      await options.adHocNotificationRepository.markNotificationSent(notification.id, currentNow)
      await options.scheduledDispatchService.markDispatchSent(dispatch.id, currentNow)
      return { outcome: 'sent' as const }
    } catch (error) {
      await options.scheduledDispatchService.releaseDispatch(dispatch.id)
      throw error
    }
  }

  async function sendBuiltInReminder(dispatchId: string) {
    const dispatch = await options.scheduledDispatchService.getDispatchById(dispatchId)
    if (
      !dispatch ||
      dispatch.status !== 'scheduled' ||
      (dispatch.kind !== 'utilities' &&
        dispatch.kind !== 'rent_warning' &&
        dispatch.kind !== 'rent_due')
    ) {
      return { outcome: 'noop' as const }
    }

    const currentNow = nowInstant()
    if (dispatch.dueAt.epochMilliseconds > currentNow.epochMilliseconds) {
      return { outcome: 'not_due' as const }
    }

    const claimed = await options.scheduledDispatchService.claimDispatch(dispatch.id)
    if (!claimed) {
      return { outcome: 'duplicate' as const }
    }

    try {
      const [chat, reminderTopic] = await Promise.all([
        options.householdConfigurationRepository.getHouseholdChatByHouseholdId(
          dispatch.householdId
        ),
        options.householdConfigurationRepository.getHouseholdTopicBinding(
          dispatch.householdId,
          'reminders'
        )
      ])

      if (!chat) {
        await options.scheduledDispatchService.markDispatchSent(dispatch.id, currentNow)
        return { outcome: 'noop' as const }
      }

      const content = buildScheduledReminderMessageContent({
        locale: chat.defaultLocale,
        reminderType: builtInReminderType(dispatch.kind),
        period:
          dispatch.period ??
          BillingPeriod.fromInstant(
            dispatch.dueAt.toZonedDateTimeISO(dispatch.timezone).toInstant()
          ).toString(),
        ...(options.miniAppUrl
          ? {
              miniAppUrl: options.miniAppUrl
            }
          : {}),
        ...(options.botUsername
          ? {
              botUsername: options.botUsername
            }
          : {})
      })

      await options.sendTopicMessage({
        householdId: dispatch.householdId,
        chatId: chat.telegramChatId,
        threadId: reminderTopic?.telegramThreadId ?? null,
        text: content.text,
        ...(content.replyMarkup
          ? {
              replyMarkup: content.replyMarkup
            }
          : {})
      })

      await options.scheduledDispatchService.markDispatchSent(dispatch.id, currentNow)
      await options.scheduledDispatchService.reconcileHouseholdBuiltInDispatches(
        dispatch.householdId,
        currentNow.add({ seconds: 1 })
      )
      return {
        outcome: 'sent' as const
      }
    } catch (error) {
      await options.scheduledDispatchService.releaseDispatch(dispatch.id)
      throw error
    }
  }

  async function handleDispatch(dispatchId: string) {
    const dispatch = await options.scheduledDispatchService.getDispatchById(dispatchId)
    if (!dispatch) {
      return {
        dispatchId,
        outcome: 'noop' as const,
        householdId: null,
        kind: null
      }
    }

    const result =
      dispatch.kind === 'ad_hoc_notification'
        ? await sendAdHocNotification(dispatchId)
        : await sendBuiltInReminder(dispatchId)

    options.logger?.info(
      {
        event: 'scheduler.scheduled_dispatch.handle',
        dispatchId,
        householdId: dispatch.householdId,
        kind: dispatch.kind,
        outcome: result.outcome
      },
      'Scheduled dispatch handled'
    )

    return {
      dispatchId,
      outcome: result.outcome,
      householdId: dispatch.householdId,
      kind: dispatch.kind
    }
  }

  return {
    handle: async (_request, dispatchId) => {
      try {
        const result = await handleDispatch(dispatchId)

        return json({
          ok: true,
          dispatchId,
          outcome: result.outcome
        })
      } catch (error) {
        options.logger?.error(
          {
            event: 'scheduler.scheduled_dispatch.failed',
            dispatchId,
            error: error instanceof Error ? error.message : String(error)
          },
          'Scheduled dispatch failed'
        )
        return json(
          {
            ok: false,
            dispatchId,
            error: error instanceof Error ? error.message : 'Unknown error'
          },
          500
        )
      }
    },

    handleDueDispatches: async (request) => {
      const url = new URL(request.url)
      const limit = parsePositiveInteger(url.searchParams.get('limit'), 25, {
        min: 1,
        max: 100
      })

      try {
        const dueDispatches = await options.scheduledDispatchService.listDueDispatches({ limit })
        const results: Array<{
          dispatchId: string
          outcome: string
          householdId: string | null
          kind: string | null
        }> = []

        for (const dispatch of dueDispatches) {
          try {
            results.push(await handleDispatch(dispatch.id))
          } catch (error) {
            options.logger?.error(
              {
                event: 'scheduler.scheduled_dispatch.bulk_failed',
                dispatchId: dispatch.id,
                error: error instanceof Error ? error.message : String(error)
              },
              'Scheduled dispatch failed during bulk run'
            )
            results.push({
              dispatchId: dispatch.id,
              outcome: 'error',
              householdId: dispatch.householdId,
              kind: dispatch.kind
            })
          }
        }

        return json({
          ok: true,
          scanned: dueDispatches.length,
          results
        })
      } catch (error) {
        options.logger?.error(
          {
            event: 'scheduler.scheduled_dispatch.bulk_scan_failed',
            error: error instanceof Error ? error.message : String(error)
          },
          'Scheduled dispatch bulk scan failed'
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

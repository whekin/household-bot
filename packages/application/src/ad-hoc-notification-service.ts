import { nowInstant, type Instant } from '@household/domain'
import type {
  AdHocNotificationDeliveryMode,
  AdHocNotificationRecord,
  AdHocNotificationRepository,
  AdHocNotificationTimePrecision,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord
} from '@household/ports'
import type { ScheduledDispatchService } from './scheduled-dispatch-service'

interface NotificationActor {
  memberId: string
  householdId: string
  isAdmin: boolean
}

export interface AdHocNotificationMemberSummary {
  memberId: string
  telegramUserId: string
  displayName: string
}

export interface AdHocNotificationSummary {
  id: string
  notificationText: string
  scheduledFor: Instant
  status: 'scheduled' | 'sent' | 'cancelled'
  deliveryMode: AdHocNotificationDeliveryMode
  dmRecipientMemberIds: readonly string[]
  dmRecipientDisplayNames: readonly string[]
  creatorDisplayName: string
  creatorMemberId: string
  assigneeDisplayName: string | null
  assigneeMemberId: string | null
  canCancel: boolean
  canEdit: boolean
}

export interface DeliverableAdHocNotification {
  notification: AdHocNotificationRecord
  creator: AdHocNotificationMemberSummary
  assignee: AdHocNotificationMemberSummary | null
  dmRecipients: readonly AdHocNotificationMemberSummary[]
}

export type ScheduleAdHocNotificationResult =
  | {
      status: 'scheduled'
      notification: AdHocNotificationRecord
    }
  | {
      status: 'invalid'
      reason:
        | 'creator_not_found'
        | 'assignee_not_found'
        | 'dm_recipients_missing'
        | 'delivery_mode_invalid'
        | 'friendly_assignee_missing'
        | 'scheduled_for_past'
        | 'dispatch_schedule_failed'
    }

export type CancelAdHocNotificationResult =
  | {
      status: 'cancelled'
      notification: AdHocNotificationRecord
    }
  | {
      status: 'not_found' | 'forbidden' | 'already_handled' | 'past_due'
    }

export type UpdateAdHocNotificationResult =
  | {
      status: 'updated'
      notification: AdHocNotificationRecord
    }
  | {
      status: 'not_found' | 'forbidden' | 'already_handled' | 'past_due'
    }
  | {
      status: 'invalid'
      reason:
        | 'delivery_mode_invalid'
        | 'dm_recipients_missing'
        | 'scheduled_for_past'
        | 'dispatch_schedule_failed'
    }

export interface AdHocNotificationService {
  scheduleNotification(input: {
    householdId: string
    creatorMemberId: string
    originalRequestText: string
    notificationText: string
    timezone: string
    scheduledFor: Instant
    timePrecision: AdHocNotificationTimePrecision
    deliveryMode: AdHocNotificationDeliveryMode
    assigneeMemberId?: string | null
    dmRecipientMemberIds?: readonly string[]
    friendlyTagAssignee?: boolean
    sourceTelegramChatId?: string | null
    sourceTelegramThreadId?: string | null
  }): Promise<ScheduleAdHocNotificationResult>
  listUpcomingNotifications(input: {
    householdId: string
    viewerMemberId: string
    asOf?: Instant
  }): Promise<readonly AdHocNotificationSummary[]>
  cancelNotification(input: {
    notificationId: string
    viewerMemberId: string
    asOf?: Instant
  }): Promise<CancelAdHocNotificationResult>
  updateNotification(input: {
    notificationId: string
    viewerMemberId: string
    scheduledFor?: Instant
    timePrecision?: AdHocNotificationTimePrecision
    deliveryMode?: AdHocNotificationDeliveryMode
    dmRecipientMemberIds?: readonly string[]
    asOf?: Instant
  }): Promise<UpdateAdHocNotificationResult>
  listDueNotifications(asOf?: Instant): Promise<readonly DeliverableAdHocNotification[]>
  claimDueNotification(notificationId: string): Promise<boolean>
  releaseDueNotification(notificationId: string): Promise<void>
  markNotificationSent(
    notificationId: string,
    sentAt?: Instant
  ): Promise<AdHocNotificationRecord | null>
}

function summarizeMember(member: HouseholdMemberRecord): AdHocNotificationMemberSummary {
  return {
    memberId: member.id,
    telegramUserId: member.telegramUserId,
    displayName: member.displayName
  }
}

function isActiveMember(member: HouseholdMemberRecord): boolean {
  return member.status === 'active'
}

async function listMemberMap(
  repository: Pick<HouseholdConfigurationRepository, 'listHouseholdMembers'>,
  householdId: string
): Promise<Map<string, HouseholdMemberRecord>> {
  const members = await repository.listHouseholdMembers(householdId)
  return new Map(members.map((member) => [member.id, member]))
}

function canCancelNotification(
  notification: AdHocNotificationRecord,
  actor: NotificationActor
): boolean {
  return actor.isAdmin || notification.creatorMemberId === actor.memberId
}

function canEditNotification(
  notification: AdHocNotificationRecord,
  actor: NotificationActor
): boolean {
  return canCancelNotification(notification, actor)
}

export function createAdHocNotificationService(input: {
  repository: AdHocNotificationRepository
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdMember' | 'listHouseholdMembers'
  >
  scheduledDispatchService?: ScheduledDispatchService
}): AdHocNotificationService {
  async function resolveActor(
    householdId: string,
    memberId: string
  ): Promise<NotificationActor | null> {
    const members = await input.householdConfigurationRepository.listHouseholdMembers(householdId)
    const member = members.find((entry) => entry.id === memberId)
    if (!member) {
      return null
    }

    return {
      memberId: member.id,
      householdId: member.householdId,
      isAdmin: member.isAdmin
    }
  }

  return {
    async scheduleNotification(notificationInput) {
      const memberMap = await listMemberMap(
        input.householdConfigurationRepository,
        notificationInput.householdId
      )
      const creator = memberMap.get(notificationInput.creatorMemberId)
      if (!creator) {
        return {
          status: 'invalid',
          reason: 'creator_not_found'
        }
      }

      const assignee = notificationInput.assigneeMemberId
        ? memberMap.get(notificationInput.assigneeMemberId)
        : null
      if (notificationInput.assigneeMemberId && !assignee) {
        return {
          status: 'invalid',
          reason: 'assignee_not_found'
        }
      }

      const effectiveNow = nowInstant()
      if (notificationInput.scheduledFor.epochMilliseconds <= effectiveNow.epochMilliseconds) {
        return {
          status: 'invalid',
          reason: 'scheduled_for_past'
        }
      }

      const friendlyTagAssignee = notificationInput.friendlyTagAssignee === true
      if (friendlyTagAssignee && !assignee) {
        return {
          status: 'invalid',
          reason: 'friendly_assignee_missing'
        }
      }

      let dmRecipientMemberIds: readonly string[] = []
      switch (notificationInput.deliveryMode) {
        case 'topic':
          dmRecipientMemberIds = []
          break
        case 'dm_all':
          dmRecipientMemberIds = [...memberMap.values()]
            .filter(isActiveMember)
            .map((member) => member.id)
          break
        case 'dm_selected': {
          const selected = (notificationInput.dmRecipientMemberIds ?? [])
            .map((memberId) => memberMap.get(memberId))
            .filter((member): member is HouseholdMemberRecord => Boolean(member))
            .filter(isActiveMember)

          if (selected.length === 0) {
            return {
              status: 'invalid',
              reason: 'dm_recipients_missing'
            }
          }

          dmRecipientMemberIds = selected.map((member) => member.id)
          break
        }
        default:
          return {
            status: 'invalid',
            reason: 'delivery_mode_invalid'
          }
      }

      const notification = await input.repository.createNotification({
        householdId: notificationInput.householdId,
        creatorMemberId: notificationInput.creatorMemberId,
        assigneeMemberId: assignee?.id ?? null,
        originalRequestText: notificationInput.originalRequestText.trim(),
        notificationText: notificationInput.notificationText.trim(),
        timezone: notificationInput.timezone,
        scheduledFor: notificationInput.scheduledFor,
        timePrecision: notificationInput.timePrecision,
        deliveryMode: notificationInput.deliveryMode,
        dmRecipientMemberIds,
        friendlyTagAssignee,
        sourceTelegramChatId: notificationInput.sourceTelegramChatId ?? null,
        sourceTelegramThreadId: notificationInput.sourceTelegramThreadId ?? null
      })

      if (input.scheduledDispatchService) {
        try {
          await input.scheduledDispatchService.scheduleAdHocNotification({
            householdId: notification.householdId,
            notificationId: notification.id,
            dueAt: notification.scheduledFor,
            timezone: notification.timezone
          })
        } catch {
          await input.repository.cancelNotification({
            notificationId: notification.id,
            cancelledByMemberId: notification.creatorMemberId,
            cancelledAt: nowInstant()
          })

          return {
            status: 'invalid',
            reason: 'dispatch_schedule_failed'
          }
        }
      }

      return {
        status: 'scheduled',
        notification
      }
    },

    async listUpcomingNotifications({ householdId, viewerMemberId, asOf = nowInstant() }) {
      const actor = await resolveActor(householdId, viewerMemberId)
      if (!actor) {
        return []
      }

      const memberMap = await listMemberMap(input.householdConfigurationRepository, householdId)
      const notifications = await input.repository.listUpcomingNotificationsForHousehold(
        householdId,
        asOf
      )

      return notifications.map((notification) => ({
        id: notification.id,
        notificationText: notification.notificationText,
        scheduledFor: notification.scheduledFor,
        status: notification.status,
        deliveryMode: notification.deliveryMode,
        dmRecipientMemberIds: notification.dmRecipientMemberIds,
        dmRecipientDisplayNames: notification.dmRecipientMemberIds.map(
          (memberId) => memberMap.get(memberId)?.displayName ?? memberId
        ),
        creatorDisplayName:
          memberMap.get(notification.creatorMemberId)?.displayName ?? notification.creatorMemberId,
        creatorMemberId: notification.creatorMemberId,
        assigneeDisplayName: notification.assigneeMemberId
          ? (memberMap.get(notification.assigneeMemberId)?.displayName ??
            notification.assigneeMemberId)
          : null,
        assigneeMemberId: notification.assigneeMemberId,
        canCancel: canCancelNotification(notification, actor),
        canEdit: canEditNotification(notification, actor)
      }))
    },

    async cancelNotification({ notificationId, viewerMemberId, asOf = nowInstant() }) {
      const notification = await input.repository.getNotificationById(notificationId)
      if (!notification) {
        return {
          status: 'not_found'
        }
      }

      if (notification.status !== 'scheduled') {
        return {
          status: 'already_handled'
        }
      }

      if (notification.scheduledFor.epochMilliseconds <= asOf.epochMilliseconds) {
        return {
          status: 'past_due'
        }
      }

      const actor = await resolveActor(notification.householdId, viewerMemberId)
      if (!actor || !canCancelNotification(notification, actor)) {
        return {
          status: 'forbidden'
        }
      }

      const cancelled = await input.repository.cancelNotification({
        notificationId,
        cancelledByMemberId: actor.memberId,
        cancelledAt: asOf
      })

      if (!cancelled) {
        return {
          status: 'already_handled'
        }
      }

      if (input.scheduledDispatchService) {
        await input.scheduledDispatchService.cancelAdHocNotification(notificationId, asOf)
      }

      return {
        status: 'cancelled',
        notification: cancelled
      }
    },

    async updateNotification({
      notificationId,
      viewerMemberId,
      scheduledFor,
      timePrecision,
      deliveryMode,
      dmRecipientMemberIds,
      asOf = nowInstant()
    }) {
      const notification = await input.repository.getNotificationById(notificationId)
      if (!notification) {
        return {
          status: 'not_found'
        }
      }

      if (notification.status !== 'scheduled') {
        return {
          status: 'already_handled'
        }
      }

      if (notification.scheduledFor.epochMilliseconds <= asOf.epochMilliseconds) {
        return {
          status: 'past_due'
        }
      }

      const actor = await resolveActor(notification.householdId, viewerMemberId)
      if (!actor || !canEditNotification(notification, actor)) {
        return {
          status: 'forbidden'
        }
      }

      const memberMap = await listMemberMap(
        input.householdConfigurationRepository,
        notification.householdId
      )
      const previousScheduledFor = notification.scheduledFor
      const previousTimePrecision = notification.timePrecision
      const previousDeliveryMode = notification.deliveryMode
      const previousDmRecipientMemberIds = notification.dmRecipientMemberIds

      if (scheduledFor && scheduledFor.epochMilliseconds <= asOf.epochMilliseconds) {
        return {
          status: 'invalid',
          reason: 'scheduled_for_past'
        }
      }

      let nextDeliveryMode = deliveryMode ?? notification.deliveryMode
      let nextDmRecipientMemberIds = dmRecipientMemberIds ?? notification.dmRecipientMemberIds

      switch (nextDeliveryMode) {
        case 'topic':
          nextDmRecipientMemberIds = []
          break
        case 'dm_all':
          nextDmRecipientMemberIds = [...memberMap.values()]
            .filter(isActiveMember)
            .map((member) => member.id)
          break
        case 'dm_selected': {
          const selected = nextDmRecipientMemberIds
            .map((memberId) => memberMap.get(memberId))
            .filter((member): member is HouseholdMemberRecord => Boolean(member))
            .filter(isActiveMember)

          if (selected.length === 0) {
            return {
              status: 'invalid',
              reason: 'dm_recipients_missing'
            }
          }

          nextDmRecipientMemberIds = selected.map((member) => member.id)
          break
        }
        default:
          return {
            status: 'invalid',
            reason: 'delivery_mode_invalid'
          }
      }

      const updated = await input.repository.updateNotification({
        notificationId,
        ...(scheduledFor ? { scheduledFor } : {}),
        ...(timePrecision ? { timePrecision } : {}),
        deliveryMode: nextDeliveryMode,
        dmRecipientMemberIds: nextDmRecipientMemberIds,
        updatedAt: asOf
      })

      if (!updated) {
        return {
          status: 'already_handled'
        }
      }

      if (input.scheduledDispatchService) {
        try {
          await input.scheduledDispatchService.scheduleAdHocNotification({
            householdId: updated.householdId,
            notificationId: updated.id,
            dueAt: updated.scheduledFor,
            timezone: updated.timezone
          })
        } catch {
          await input.repository.updateNotification({
            notificationId,
            scheduledFor: previousScheduledFor,
            timePrecision: previousTimePrecision,
            deliveryMode: previousDeliveryMode,
            dmRecipientMemberIds: previousDmRecipientMemberIds,
            updatedAt: nowInstant()
          })

          return {
            status: 'invalid',
            reason: 'dispatch_schedule_failed'
          }
        }
      }

      return {
        status: 'updated',
        notification: updated
      }
    },

    async listDueNotifications(asOf = nowInstant()) {
      const due = await input.repository.listDueNotifications(asOf)
      const groupedMembers = new Map<string, Map<string, HouseholdMemberRecord>>()

      async function membersForHousehold(householdId: string) {
        const existing = groupedMembers.get(householdId)
        if (existing) {
          return existing
        }

        const memberMap = await listMemberMap(input.householdConfigurationRepository, householdId)
        groupedMembers.set(householdId, memberMap)
        return memberMap
      }

      const results: DeliverableAdHocNotification[] = []
      for (const notification of due) {
        const memberMap = await membersForHousehold(notification.householdId)
        const creator = memberMap.get(notification.creatorMemberId)
        if (!creator) {
          continue
        }

        const assignee = notification.assigneeMemberId
          ? (memberMap.get(notification.assigneeMemberId) ?? null)
          : null
        const dmRecipients = notification.dmRecipientMemberIds
          .map((memberId) => memberMap.get(memberId))
          .filter((member): member is HouseholdMemberRecord => Boolean(member))

        results.push({
          notification,
          creator: summarizeMember(creator),
          assignee: assignee ? summarizeMember(assignee) : null,
          dmRecipients: dmRecipients.map(summarizeMember)
        })
      }

      return results
    },

    async claimDueNotification(notificationId) {
      const result = await input.repository.claimNotificationDelivery(notificationId)
      return result.claimed
    },

    releaseDueNotification(notificationId) {
      return input.repository.releaseNotificationDelivery(notificationId)
    },

    markNotificationSent(notificationId, sentAt = nowInstant()) {
      return input.repository.markNotificationSent(notificationId, sentAt)
    }
  }
}

import { nowInstant, type Instant } from '@household/domain'
import type {
  AdHocNotificationDeliveryMode,
  AdHocNotificationRecord,
  AdHocNotificationRepository,
  AdHocNotificationTimePrecision,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord
} from '@household/ports'

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
  deliveryMode: AdHocNotificationDeliveryMode
  friendlyTagAssignee: boolean
  creatorDisplayName: string
  assigneeDisplayName: string | null
  canCancel: boolean
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
    }

export type CancelAdHocNotificationResult =
  | {
      status: 'cancelled'
      notification: AdHocNotificationRecord
    }
  | {
      status: 'not_found' | 'forbidden' | 'already_handled' | 'past_due'
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

export function createAdHocNotificationService(input: {
  repository: AdHocNotificationRepository
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdMember' | 'listHouseholdMembers'
  >
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

      return notifications
        .filter((notification) => actor.isAdmin || notification.creatorMemberId === actor.memberId)
        .map((notification) => ({
          id: notification.id,
          notificationText: notification.notificationText,
          scheduledFor: notification.scheduledFor,
          deliveryMode: notification.deliveryMode,
          friendlyTagAssignee: notification.friendlyTagAssignee,
          creatorDisplayName:
            memberMap.get(notification.creatorMemberId)?.displayName ??
            notification.creatorMemberId,
          assigneeDisplayName: notification.assigneeMemberId
            ? (memberMap.get(notification.assigneeMemberId)?.displayName ??
              notification.assigneeMemberId)
            : null,
          canCancel: canCancelNotification(notification, actor)
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

      return {
        status: 'cancelled',
        notification: cancelled
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

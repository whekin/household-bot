import { describe, expect, test } from 'bun:test'

import { Temporal } from '@household/domain'
import type {
  AdHocNotificationRecord,
  AdHocNotificationRepository,
  CancelAdHocNotificationInput,
  ClaimAdHocNotificationDeliveryResult,
  CreateAdHocNotificationInput,
  HouseholdConfigurationRepository,
  HouseholdMemberRecord
} from '@household/ports'

import { createAdHocNotificationService } from './ad-hoc-notification-service'

class NotificationRepositoryStub implements AdHocNotificationRepository {
  notifications = new Map<string, AdHocNotificationRecord>()
  nextId = 1

  async createNotification(input: CreateAdHocNotificationInput): Promise<AdHocNotificationRecord> {
    const id = `notif-${this.nextId++}`
    const record: AdHocNotificationRecord = {
      id,
      householdId: input.householdId,
      creatorMemberId: input.creatorMemberId,
      assigneeMemberId: input.assigneeMemberId ?? null,
      originalRequestText: input.originalRequestText,
      notificationText: input.notificationText,
      timezone: input.timezone,
      scheduledFor: input.scheduledFor,
      timePrecision: input.timePrecision,
      deliveryMode: input.deliveryMode,
      dmRecipientMemberIds: input.dmRecipientMemberIds ?? [],
      friendlyTagAssignee: input.friendlyTagAssignee,
      status: 'scheduled',
      sourceTelegramChatId: input.sourceTelegramChatId ?? null,
      sourceTelegramThreadId: input.sourceTelegramThreadId ?? null,
      sentAt: null,
      cancelledAt: null,
      cancelledByMemberId: null,
      createdAt: Temporal.Instant.from('2026-03-23T09:00:00Z'),
      updatedAt: Temporal.Instant.from('2026-03-23T09:00:00Z')
    }
    this.notifications.set(id, record)
    return record
  }

  async getNotificationById(notificationId: string): Promise<AdHocNotificationRecord | null> {
    return this.notifications.get(notificationId) ?? null
  }

  async listUpcomingNotificationsForHousehold(
    householdId: string,
    asOf: Temporal.Instant
  ): Promise<readonly AdHocNotificationRecord[]> {
    return [...this.notifications.values()].filter(
      (notification) =>
        notification.householdId === householdId &&
        notification.status === 'scheduled' &&
        notification.scheduledFor.epochMilliseconds > asOf.epochMilliseconds
    )
  }

  async cancelNotification(
    input: CancelAdHocNotificationInput
  ): Promise<AdHocNotificationRecord | null> {
    const record = this.notifications.get(input.notificationId)
    if (!record || record.status !== 'scheduled') {
      return null
    }

    const next = {
      ...record,
      status: 'cancelled' as const,
      cancelledAt: input.cancelledAt,
      cancelledByMemberId: input.cancelledByMemberId
    }
    this.notifications.set(input.notificationId, next)
    return next
  }

  async updateNotification(input: {
    notificationId: string
    scheduledFor?: Temporal.Instant
    timePrecision?: AdHocNotificationRecord['timePrecision']
    deliveryMode?: AdHocNotificationRecord['deliveryMode']
    dmRecipientMemberIds?: readonly string[]
    updatedAt: Temporal.Instant
  }): Promise<AdHocNotificationRecord | null> {
    const record = this.notifications.get(input.notificationId)
    if (!record || record.status !== 'scheduled') {
      return null
    }

    const next = {
      ...record,
      scheduledFor: input.scheduledFor ?? record.scheduledFor,
      timePrecision: input.timePrecision ?? record.timePrecision,
      deliveryMode: input.deliveryMode ?? record.deliveryMode,
      dmRecipientMemberIds: input.dmRecipientMemberIds ?? record.dmRecipientMemberIds,
      updatedAt: input.updatedAt
    }
    this.notifications.set(input.notificationId, next)
    return next
  }

  async listDueNotifications(asOf: Temporal.Instant): Promise<readonly AdHocNotificationRecord[]> {
    return [...this.notifications.values()].filter(
      (notification) =>
        notification.status === 'scheduled' &&
        notification.scheduledFor.epochMilliseconds <= asOf.epochMilliseconds
    )
  }

  async markNotificationSent(
    notificationId: string,
    sentAt: Temporal.Instant
  ): Promise<AdHocNotificationRecord | null> {
    const record = this.notifications.get(notificationId)
    if (!record || record.status !== 'scheduled') {
      return null
    }

    const next = {
      ...record,
      status: 'sent' as const,
      sentAt
    }
    this.notifications.set(notificationId, next)
    return next
  }

  async claimNotificationDelivery(
    notificationId: string
  ): Promise<ClaimAdHocNotificationDeliveryResult> {
    return {
      notificationId,
      claimed: true
    }
  }

  async releaseNotificationDelivery(): Promise<void> {}
}

function member(
  input: Partial<HouseholdMemberRecord> & Pick<HouseholdMemberRecord, 'id'>
): HouseholdMemberRecord {
  return {
    id: input.id,
    householdId: input.householdId ?? 'household-1',
    telegramUserId: input.telegramUserId ?? `${input.id}-tg`,
    displayName: input.displayName ?? input.id,
    status: input.status ?? 'active',
    preferredLocale: input.preferredLocale ?? 'ru',
    householdDefaultLocale: input.householdDefaultLocale ?? 'ru',
    rentShareWeight: input.rentShareWeight ?? 1,
    isAdmin: input.isAdmin ?? false
  }
}

function createHouseholdRepository(
  members: readonly HouseholdMemberRecord[]
): Pick<HouseholdConfigurationRepository, 'getHouseholdMember' | 'listHouseholdMembers'> {
  return {
    async getHouseholdMember(householdId, telegramUserId) {
      return (
        members.find(
          (member) => member.householdId === householdId && member.telegramUserId === telegramUserId
        ) ?? null
      )
    },
    async listHouseholdMembers(householdId) {
      return members.filter((member) => member.householdId === householdId)
    }
  }
}

describe('createAdHocNotificationService', () => {
  test('defaults date-only reminder to scheduled notification with topic delivery', async () => {
    const repository = new NotificationRepositoryStub()
    const members = [member({ id: 'creator' }), member({ id: 'assignee', displayName: 'Georgiy' })]
    const service = createAdHocNotificationService({
      repository,
      householdConfigurationRepository: createHouseholdRepository(members)
    })

    const result = await service.scheduleNotification({
      householdId: 'household-1',
      creatorMemberId: 'creator',
      assigneeMemberId: 'assignee',
      originalRequestText: 'Напомни Георгию завтра',
      notificationText: 'пошпынять Георгия о том, позвонил ли он',
      timezone: 'Asia/Tbilisi',
      scheduledFor: Temporal.Instant.from('2026-03-25T08:00:00Z'),
      timePrecision: 'date_only_defaulted',
      deliveryMode: 'topic'
    })

    expect(result.status).toBe('scheduled')
    if (result.status === 'scheduled') {
      expect(result.notification.deliveryMode).toBe('topic')
      expect(result.notification.assigneeMemberId).toBe('assignee')
    }
  })

  test('expands dm_all to all active members', async () => {
    const repository = new NotificationRepositoryStub()
    const members = [
      member({ id: 'creator' }),
      member({ id: 'alice' }),
      member({ id: 'bob', status: 'away' }),
      member({ id: 'carol' })
    ]
    const service = createAdHocNotificationService({
      repository,
      householdConfigurationRepository: createHouseholdRepository(members)
    })

    const result = await service.scheduleNotification({
      householdId: 'household-1',
      creatorMemberId: 'creator',
      originalRequestText: 'remind everyone tomorrow',
      notificationText: 'pay rent',
      timezone: 'Asia/Tbilisi',
      scheduledFor: Temporal.Instant.from('2026-03-25T08:00:00Z'),
      timePrecision: 'date_only_defaulted',
      deliveryMode: 'dm_all'
    })

    expect(result.status).toBe('scheduled')
    if (result.status === 'scheduled') {
      expect(result.notification.dmRecipientMemberIds).toEqual(['creator', 'alice', 'carol'])
    }
  })

  test('rejects friendly mode without assignee', async () => {
    const repository = new NotificationRepositoryStub()
    const service = createAdHocNotificationService({
      repository,
      householdConfigurationRepository: createHouseholdRepository([member({ id: 'creator' })])
    })

    const result = await service.scheduleNotification({
      householdId: 'household-1',
      creatorMemberId: 'creator',
      originalRequestText: 'remind tomorrow',
      notificationText: 'check rent',
      timezone: 'Asia/Tbilisi',
      scheduledFor: Temporal.Instant.from('2026-03-25T08:00:00Z'),
      timePrecision: 'date_only_defaulted',
      deliveryMode: 'topic',
      friendlyTagAssignee: true
    })

    expect(result).toEqual({
      status: 'invalid',
      reason: 'friendly_assignee_missing'
    })
  })

  test('allows admin to cancel someone else notification', async () => {
    const repository = new NotificationRepositoryStub()
    const creator = member({ id: 'creator', telegramUserId: 'creator-tg' })
    const admin = member({ id: 'admin', telegramUserId: 'admin-tg', isAdmin: true })
    const service = createAdHocNotificationService({
      repository,
      householdConfigurationRepository: createHouseholdRepository([creator, admin])
    })

    const created = await repository.createNotification({
      householdId: 'household-1',
      creatorMemberId: 'creator',
      originalRequestText: 'remind tomorrow',
      notificationText: 'call landlord',
      timezone: 'Asia/Tbilisi',
      scheduledFor: Temporal.Instant.from('2026-03-25T08:00:00Z'),
      timePrecision: 'date_only_defaulted',
      deliveryMode: 'topic',
      friendlyTagAssignee: false
    })

    const result = await service.cancelNotification({
      notificationId: created.id,
      viewerMemberId: 'admin',
      asOf: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(result.status).toBe('cancelled')
    if (result.status === 'cancelled') {
      expect(result.notification.cancelledByMemberId).toBe('admin')
    }
  })

  test('lists upcoming notifications for all household members with permission flags', async () => {
    const repository = new NotificationRepositoryStub()
    const creator = member({ id: 'creator' })
    const viewer = member({ id: 'viewer' })
    const service = createAdHocNotificationService({
      repository,
      householdConfigurationRepository: createHouseholdRepository([creator, viewer])
    })

    await repository.createNotification({
      householdId: 'household-1',
      creatorMemberId: 'creator',
      originalRequestText: 'remind tomorrow',
      notificationText: 'call landlord',
      timezone: 'Asia/Tbilisi',
      scheduledFor: Temporal.Instant.from('2026-03-25T08:00:00Z'),
      timePrecision: 'date_only_defaulted',
      deliveryMode: 'topic',
      friendlyTagAssignee: false
    })

    const items = await service.listUpcomingNotifications({
      householdId: 'household-1',
      viewerMemberId: 'viewer',
      asOf: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      creatorDisplayName: 'creator',
      canCancel: false,
      canEdit: false
    })
  })

  test('allows creator to reschedule and update delivery', async () => {
    const repository = new NotificationRepositoryStub()
    const creator = member({ id: 'creator' })
    const alice = member({ id: 'alice' })
    const bob = member({ id: 'bob' })
    const service = createAdHocNotificationService({
      repository,
      householdConfigurationRepository: createHouseholdRepository([creator, alice, bob])
    })

    const created = await repository.createNotification({
      householdId: 'household-1',
      creatorMemberId: 'creator',
      originalRequestText: 'remind tomorrow',
      notificationText: 'call landlord',
      timezone: 'Asia/Tbilisi',
      scheduledFor: Temporal.Instant.from('2026-03-25T08:00:00Z'),
      timePrecision: 'date_only_defaulted',
      deliveryMode: 'topic',
      friendlyTagAssignee: false
    })

    const result = await service.updateNotification({
      notificationId: created.id,
      viewerMemberId: 'creator',
      scheduledFor: Temporal.Instant.from('2026-03-25T09:00:00Z'),
      timePrecision: 'exact',
      deliveryMode: 'dm_selected',
      dmRecipientMemberIds: ['alice', 'bob'],
      asOf: Temporal.Instant.from('2026-03-23T09:00:00Z')
    })

    expect(result.status).toBe('updated')
    if (result.status === 'updated') {
      expect(result.notification.scheduledFor.toString()).toBe('2026-03-25T09:00:00Z')
      expect(result.notification.deliveryMode).toBe('dm_selected')
      expect(result.notification.dmRecipientMemberIds).toEqual(['alice', 'bob'])
    }
  })
})

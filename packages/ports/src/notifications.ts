import type { Instant } from '@household/domain'

export const AD_HOC_NOTIFICATION_TIME_PRECISIONS = ['exact', 'date_only_defaulted'] as const
export const AD_HOC_NOTIFICATION_DELIVERY_MODES = ['topic', 'dm_all', 'dm_selected'] as const
export const AD_HOC_NOTIFICATION_STATUSES = ['scheduled', 'sent', 'cancelled'] as const

export type AdHocNotificationTimePrecision = (typeof AD_HOC_NOTIFICATION_TIME_PRECISIONS)[number]
export type AdHocNotificationDeliveryMode = (typeof AD_HOC_NOTIFICATION_DELIVERY_MODES)[number]
export type AdHocNotificationStatus = (typeof AD_HOC_NOTIFICATION_STATUSES)[number]

export interface AdHocNotificationRecord {
  id: string
  householdId: string
  creatorMemberId: string
  assigneeMemberId: string | null
  originalRequestText: string
  notificationText: string
  timezone: string
  scheduledFor: Instant
  timePrecision: AdHocNotificationTimePrecision
  deliveryMode: AdHocNotificationDeliveryMode
  dmRecipientMemberIds: readonly string[]
  friendlyTagAssignee: boolean
  status: AdHocNotificationStatus
  sourceTelegramChatId: string | null
  sourceTelegramThreadId: string | null
  sentAt: Instant | null
  cancelledAt: Instant | null
  cancelledByMemberId: string | null
  createdAt: Instant
  updatedAt: Instant
}

export interface CreateAdHocNotificationInput {
  householdId: string
  creatorMemberId: string
  assigneeMemberId?: string | null
  originalRequestText: string
  notificationText: string
  timezone: string
  scheduledFor: Instant
  timePrecision: AdHocNotificationTimePrecision
  deliveryMode: AdHocNotificationDeliveryMode
  dmRecipientMemberIds?: readonly string[]
  friendlyTagAssignee: boolean
  sourceTelegramChatId?: string | null
  sourceTelegramThreadId?: string | null
}

export interface CancelAdHocNotificationInput {
  notificationId: string
  cancelledByMemberId: string
  cancelledAt: Instant
}

export interface UpdateAdHocNotificationInput {
  notificationId: string
  scheduledFor?: Instant
  timePrecision?: AdHocNotificationTimePrecision
  deliveryMode?: AdHocNotificationDeliveryMode
  dmRecipientMemberIds?: readonly string[]
  updatedAt: Instant
}

export interface ClaimAdHocNotificationDeliveryResult {
  notificationId: string
  claimed: boolean
}

export interface AdHocNotificationRepository {
  createNotification(input: CreateAdHocNotificationInput): Promise<AdHocNotificationRecord>
  getNotificationById(notificationId: string): Promise<AdHocNotificationRecord | null>
  listUpcomingNotificationsForHousehold(
    householdId: string,
    asOf: Instant
  ): Promise<readonly AdHocNotificationRecord[]>
  cancelNotification(input: CancelAdHocNotificationInput): Promise<AdHocNotificationRecord | null>
  updateNotification(input: UpdateAdHocNotificationInput): Promise<AdHocNotificationRecord | null>
  listDueNotifications(asOf: Instant): Promise<readonly AdHocNotificationRecord[]>
  markNotificationSent(
    notificationId: string,
    sentAt: Instant
  ): Promise<AdHocNotificationRecord | null>
  claimNotificationDelivery(notificationId: string): Promise<ClaimAdHocNotificationDeliveryResult>
  releaseNotificationDelivery(notificationId: string): Promise<void>
}

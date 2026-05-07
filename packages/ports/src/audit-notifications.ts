import type { Instant } from '@household/domain'

export const HOUSEHOLD_AUDIT_NOTIFICATION_CATEGORIES = [
  'period_events',
  'plan_events',
  'purchase_events',
  'payment_events'
] as const

export const HOUSEHOLD_AUDIT_DELIVERY_STATUSES = ['pending', 'sent', 'skipped', 'failed'] as const

export type HouseholdAuditNotificationCategory =
  (typeof HOUSEHOLD_AUDIT_NOTIFICATION_CATEGORIES)[number]
export type HouseholdAuditDeliveryStatus = (typeof HOUSEHOLD_AUDIT_DELIVERY_STATUSES)[number]

export interface HouseholdNotificationSettingsRecord {
  householdId: string
  periodEvents: boolean
  planEvents: boolean
  purchaseEvents: boolean
  paymentEvents: boolean
  createdAt: Instant
  updatedAt: Instant
}

export interface HouseholdAuditEventRecord {
  id: string
  householdId: string
  actorMemberId: string | null
  actorDisplayName: string
  eventType: string
  category: HouseholdAuditNotificationCategory
  summaryText: string
  metadata: Record<string, unknown>
  deliveryStatus: HouseholdAuditDeliveryStatus
  deliveredTelegramChatId: string | null
  deliveredTelegramThreadId: string | null
  deliveredTelegramMessageId: string | null
  deliveryError: string | null
  createdAt: Instant
}

export interface CreateHouseholdAuditEventInput {
  householdId: string
  actorMemberId?: string | null
  actorDisplayName: string
  eventType: string
  category: HouseholdAuditNotificationCategory
  summaryText: string
  metadata?: Record<string, unknown>
  deliveryStatus?: HouseholdAuditDeliveryStatus
  createdAt: Instant
}

export interface UpdateHouseholdNotificationSettingsInput {
  householdId: string
  periodEvents?: boolean
  planEvents?: boolean
  purchaseEvents?: boolean
  paymentEvents?: boolean
  updatedAt: Instant
}

export interface UpdateHouseholdAuditEventDeliveryInput {
  eventId: string
  deliveryStatus: HouseholdAuditDeliveryStatus
  deliveredTelegramChatId?: string | null
  deliveredTelegramThreadId?: string | null
  deliveredTelegramMessageId?: string | null
  deliveryError?: string | null
}

export interface HouseholdAuditNotificationRepository {
  createAuditEvent(input: CreateHouseholdAuditEventInput): Promise<HouseholdAuditEventRecord>
  getAuditEventById(eventId: string): Promise<HouseholdAuditEventRecord | null>
  getNotificationSettings(householdId: string): Promise<HouseholdNotificationSettingsRecord>
  updateNotificationSettings(
    input: UpdateHouseholdNotificationSettingsInput
  ): Promise<HouseholdNotificationSettingsRecord>
  updateAuditEventDelivery(
    input: UpdateHouseholdAuditEventDeliveryInput
  ): Promise<HouseholdAuditEventRecord | null>
  listAuditEventsForHousehold(
    householdId: string,
    limit: number
  ): Promise<readonly HouseholdAuditEventRecord[]>
}

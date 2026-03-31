import type { Instant } from '@household/domain'

export const SCHEDULED_DISPATCH_KINDS = [
  'ad_hoc_notification',
  'utilities',
  'rent_warning',
  'rent_due'
] as const
export const SCHEDULED_DISPATCH_STATUSES = ['scheduled', 'sent', 'cancelled'] as const
export const SCHEDULED_DISPATCH_PROVIDERS = [
  'gcp-cloud-tasks',
  'aws-eventbridge',
  'self-hosted'
] as const

export type ScheduledDispatchKind = (typeof SCHEDULED_DISPATCH_KINDS)[number]
export type ScheduledDispatchStatus = (typeof SCHEDULED_DISPATCH_STATUSES)[number]
export type ScheduledDispatchProvider = (typeof SCHEDULED_DISPATCH_PROVIDERS)[number]

export interface ScheduledDispatchRecord {
  id: string
  householdId: string
  kind: ScheduledDispatchKind
  dueAt: Instant
  timezone: string
  status: ScheduledDispatchStatus
  provider: ScheduledDispatchProvider
  providerDispatchId: string | null
  adHocNotificationId: string | null
  period: string | null
  sentAt: Instant | null
  cancelledAt: Instant | null
  createdAt: Instant
  updatedAt: Instant
}

export interface CreateScheduledDispatchInput {
  householdId: string
  kind: ScheduledDispatchKind
  dueAt: Instant
  timezone: string
  provider: ScheduledDispatchProvider
  providerDispatchId?: string | null
  adHocNotificationId?: string | null
  period?: string | null
}

export interface UpdateScheduledDispatchInput {
  dispatchId: string
  dueAt?: Instant
  timezone?: string
  providerDispatchId?: string | null
  period?: string | null
  updatedAt: Instant
}

export interface ClaimScheduledDispatchDeliveryResult {
  dispatchId: string
  claimed: boolean
}

export interface ScheduledDispatchRepository {
  createScheduledDispatch(input: CreateScheduledDispatchInput): Promise<ScheduledDispatchRecord>
  getScheduledDispatchById(dispatchId: string): Promise<ScheduledDispatchRecord | null>
  getScheduledDispatchByAdHocNotificationId(
    notificationId: string
  ): Promise<ScheduledDispatchRecord | null>
  listScheduledDispatchesForHousehold(
    householdId: string
  ): Promise<readonly ScheduledDispatchRecord[]>
  listDueScheduledDispatches(input: {
    dueBefore: Instant
    provider?: ScheduledDispatchProvider
    limit: number
  }): Promise<readonly ScheduledDispatchRecord[]>
  updateScheduledDispatch(
    input: UpdateScheduledDispatchInput
  ): Promise<ScheduledDispatchRecord | null>
  cancelScheduledDispatch(
    dispatchId: string,
    cancelledAt: Instant
  ): Promise<ScheduledDispatchRecord | null>
  markScheduledDispatchSent(
    dispatchId: string,
    sentAt: Instant
  ): Promise<ScheduledDispatchRecord | null>
  claimScheduledDispatchDelivery(dispatchId: string): Promise<ClaimScheduledDispatchDeliveryResult>
  releaseScheduledDispatchDelivery(dispatchId: string): Promise<void>
}

export interface ScheduleOneShotDispatchInput {
  dispatchId: string
  dueAt: Instant
}

export interface ScheduleOneShotDispatchResult {
  providerDispatchId: string
}

export interface ScheduledDispatchScheduler {
  readonly provider: ScheduledDispatchProvider
  scheduleOneShotDispatch(
    input: ScheduleOneShotDispatchInput
  ): Promise<ScheduleOneShotDispatchResult>
  cancelDispatch(providerDispatchId: string): Promise<void>
}

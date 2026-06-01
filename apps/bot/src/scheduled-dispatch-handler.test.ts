import { describe, expect, test } from 'bun:test'

import type {
  HouseholdAuditNotificationService,
  ScheduledDispatchService
} from '@household/application'
import { Money, Temporal } from '@household/domain'
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

function createAuditNotificationServiceStub() {
  const events: Parameters<HouseholdAuditNotificationService['recordEvent']>[0][] = []
  const service: HouseholdAuditNotificationService = {
    recordEvent: async (input) => {
      events.push(input)
      return {
        id: `audit-${events.length}`,
        householdId: input.householdId,
        actorMemberId: input.actorMemberId ?? null,
        actorDisplayName: input.actorDisplayName,
        eventType: input.eventType,
        category: input.category,
        summaryText: input.summaryText,
        metadata: input.metadata ?? {},
        deliveryStatus: 'pending',
        deliveredTelegramChatId: null,
        deliveredTelegramThreadId: null,
        deliveredTelegramMessageId: null,
        deliveryError: null,
        createdAt: Temporal.Instant.from('2026-03-24T00:00:00Z')
      }
    }
  }
  return { service, events }
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
      listDueDispatches: async () => [dispatch],
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
    const payload = (await response.json()) as { ok: boolean; dispatchId: string; outcome: string }

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
      listDueDispatches: async () => [dispatch],
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
    const payload = (await response.json()) as { ok: boolean; dispatchId: string; outcome: string }

    expect(payload.ok).toBe(true)
    expect(payload.outcome).toBe('stale')
    expect(released).toBe(true)
  })

  test('routes built-in due dispatches through audit notifications and reconciles schedule', async () => {
    const dispatch = scheduledDispatch({
      id: 'dispatch-utilities',
      householdId: 'household-1',
      kind: 'utilities',
      period: '2026-03'
    })
    const audit = createAuditNotificationServiceStub()
    const markedDispatches: string[] = []
    const reconciledHouseholds: string[] = []

    const service: ScheduledDispatchService = {
      scheduleAdHocNotification: async () => dispatch,
      cancelAdHocNotification: async () => {},
      reconcileHouseholdBuiltInDispatches: async (householdId) => {
        reconciledHouseholds.push(householdId)
      },
      reconcileAllBuiltInDispatches: async () => {},
      listDueDispatches: async () => [dispatch],
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
          throw new Error('not used')
        },
        async markNotificationSent() {
          throw new Error('not used')
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
            defaultLocale: 'en'
          }
        },
        async getHouseholdTopicBinding(): Promise<HouseholdTopicBindingRecord | null> {
          return {
            householdId: 'household-1',
            role: 'notifications',
            telegramThreadId: '501',
            topicName: 'Notifications'
          }
        },
        async getHouseholdBillingSettings() {
          throw new Error('not used')
        },
        async listHouseholdMembers(): Promise<readonly HouseholdMemberRecord[]> {
          return []
        }
      },
      auditNotificationService: audit.service,
      sendTopicMessage: async () => {
        throw new Error('direct topic send should be delegated to audit service')
      },
      sendDirectMessage: async () => {
        throw new Error('not used')
      }
    })

    const response = await handler.handleDueDispatches(
      new Request('http://localhost/jobs/dispatch-due?limit=10', { method: 'POST' })
    )
    const payload = (await response.json()) as {
      ok: boolean
      scanned: number
      results: Array<{
        dispatchId: string
        householdId: string | null
        kind: string | null
        outcome: string
      }>
    }

    expect(payload.ok).toBe(true)
    expect(payload.scanned).toBe(1)
    expect(payload.results).toEqual([
      {
        dispatchId: 'dispatch-utilities',
        householdId: 'household-1',
        kind: 'utilities',
        outcome: 'sent'
      }
    ])
    expect(audit.events).toMatchObject([
      {
        householdId: 'household-1',
        actorMemberId: null,
        actorDisplayName: 'System',
        category: 'period_events',
        eventType: 'period.utilities',
        metadata: {
          dispatchId: 'dispatch-utilities',
          kind: 'utilities',
          period: '2026-03'
        }
      }
    ])
    expect(audit.events[0]?.summaryText).toContain('Utilities')
    expect(markedDispatches).toEqual(['dispatch-utilities'])
    expect(reconciledHouseholds).toEqual(['household-1'])
  })

  test('publishes payment instructions for utilities dispatches when a plan exists', async () => {
    const dispatch = scheduledDispatch({
      id: 'dispatch-utilities',
      householdId: 'household-1',
      kind: 'utilities',
      period: '2026-06'
    })
    const paymentInstructions: string[] = []
    const gel = (minor: bigint) => Money.fromMinor(minor, 'GEL')
    const service: ScheduledDispatchService = {
      scheduleAdHocNotification: async () => dispatch,
      cancelAdHocNotification: async () => {},
      reconcileHouseholdBuiltInDispatches: async () => {},
      reconcileAllBuiltInDispatches: async () => {},
      listDueDispatches: async () => [dispatch],
      getDispatchById: async () => dispatch,
      claimDispatch: async () => true,
      releaseDispatch: async () => {},
      markDispatchSent: async () => dispatch
    }

    const handler = createScheduledDispatchHandler({
      scheduledDispatchService: service,
      adHocNotificationRepository: {
        async getNotificationById() {
          throw new Error('not used')
        },
        async markNotificationSent() {
          throw new Error('not used')
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
            defaultLocale: 'en'
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
      financeServiceForHousehold: () =>
        ({
          generateDashboard: async () => ({
            period: '2026-06',
            currency: 'GEL',
            timezone: 'Asia/Tbilisi',
            rentWarningDay: 1,
            rentDueDay: 5,
            utilitiesReminderDay: 1,
            utilitiesDueDay: 5,
            paymentBalanceAdjustmentPolicy: 'utilities',
            rentPaymentDestinations: null,
            totalDue: gel(1000n),
            totalPaid: gel(0n),
            totalRemaining: gel(1000n),
            billingStage: 'utilities',
            rentSourceAmount: gel(0n),
            rentDisplayAmount: gel(0n),
            rentFxRateMicros: null,
            rentFxEffectiveDate: null,
            utilityBillingPlan: {
              id: 'plan-1',
              version: 1,
              status: 'active',
              dueDate: '2026-06-05',
              updatedFromVersion: null,
              reason: null,
              categories: [
                {
                  utilityBillId: 'electricity',
                  billName: 'Electricity',
                  billTotal: gel(1000n),
                  assignedAmount: gel(1000n),
                  assignedMemberId: 'member-1',
                  assignedDisplayName: 'Mia',
                  paidAmount: gel(0n),
                  isFullAssignment: true,
                  splitGroupId: null
                }
              ],
              memberSummaries: []
            },
            rentBillingState: {
              dueDate: '2026-06-05',
              paymentDestinations: null,
              memberSummaries: []
            },
            members: [],
            paymentPeriods: [],
            ledger: []
          })
        }) as never,
      paymentInstructionPublisher: {
        sendPaymentInstruction: async (input) => {
          paymentInstructions.push(`${input.householdId}:${input.kind}:${input.period}`)
          return { status: 'sent' }
        }
      },
      sendTopicMessage: async () => {},
      sendDirectMessage: async () => {
        throw new Error('not used')
      }
    })

    await handler.handle(
      new Request('http://localhost/jobs/dispatch/dispatch-utilities', { method: 'POST' }),
      'dispatch-utilities'
    )

    expect(paymentInstructions).toEqual(['household-1:utilities:2026-06'])
  })

  test('still sends the reminder when payment instruction publishing fails', async () => {
    const dispatch = scheduledDispatch({
      id: 'dispatch-rent',
      householdId: 'household-1',
      kind: 'rent_due',
      period: '2026-06'
    })
    const sentTopicMessages: string[] = []
    const markedDispatches: string[] = []
    const gel = (minor: bigint) => Money.fromMinor(minor, 'GEL')
    const service: ScheduledDispatchService = {
      scheduleAdHocNotification: async () => dispatch,
      cancelAdHocNotification: async () => {},
      reconcileHouseholdBuiltInDispatches: async () => {},
      reconcileAllBuiltInDispatches: async () => {},
      listDueDispatches: async () => [dispatch],
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
          throw new Error('not used')
        },
        async markNotificationSent() {
          throw new Error('not used')
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
            defaultLocale: 'en'
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
      financeServiceForHousehold: () =>
        ({
          generateDashboard: async () => ({
            period: '2026-06',
            currency: 'GEL',
            timezone: 'Asia/Tbilisi',
            rentWarningDay: 1,
            rentDueDay: 5,
            utilitiesReminderDay: 1,
            utilitiesDueDay: 5,
            paymentBalanceAdjustmentPolicy: 'utilities',
            rentPaymentDestinations: null,
            totalDue: gel(1000n),
            totalPaid: gel(0n),
            totalRemaining: gel(1000n),
            billingStage: 'rent',
            rentSourceAmount: gel(1000n),
            rentDisplayAmount: gel(1000n),
            rentFxRateMicros: null,
            rentFxEffectiveDate: null,
            utilityBillingPlan: null,
            rentBillingState: {
              dueDate: '2026-06-05',
              paymentDestinations: null,
              memberSummaries: []
            },
            members: [],
            paymentPeriods: [],
            ledger: []
          })
        }) as never,
      paymentInstructionPublisher: {
        sendPaymentInstruction: async () => {
          throw new Error('payments topic unavailable')
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
      new Request('http://localhost/jobs/dispatch/dispatch-rent', { method: 'POST' }),
      'dispatch-rent'
    )
    const payload = (await response.json()) as { ok: boolean; dispatchId: string; outcome: string }

    expect(payload).toEqual({ ok: true, dispatchId: 'dispatch-rent', outcome: 'sent' })
    expect(sentTopicMessages).toHaveLength(1)
    expect(markedDispatches).toEqual(['dispatch-rent'])
  })
})

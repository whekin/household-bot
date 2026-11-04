import type { Instant } from '@household/domain'
import { nowInstant } from '@household/domain'
import type { HouseholdAuditNotificationService } from '@household/application'
import type { Logger } from '@household/observability'

import type { PurchaseAutoConfirmRepository } from './adapters/purchase-message-repository'
import type { PurchaseTopicNoticeService } from './purchase-topic-notices'

export const PURCHASE_AUTO_CONFIRM_AFTER_MS = 24 * 60 * 60_000
// Proposals older than this are left alone: nobody is waiting on them any more.
const PURCHASE_AUTO_CONFIRM_MAX_AGE_MS = 7 * 24 * 60 * 60_000
const SWEEP_INTERVAL_MS = 60_000

export interface PurchaseAutoConfirmSweeper {
  /** Confirms proposals left unanswered for a day. Resolves to how many were confirmed. */
  sweep(): Promise<number>
}

export function createPurchaseAutoConfirmSweeper(options: {
  repository: PurchaseAutoConfirmRepository
  purchaseTopicNoticeService?: Pick<PurchaseTopicNoticeService, 'syncPurchase'>
  auditNotificationService?: HouseholdAuditNotificationService
  logger?: Logger
  now?: () => Instant
  confirmAfterMs?: number
}): PurchaseAutoConfirmSweeper {
  const now = options.now ?? nowInstant
  const confirmAfterMs = options.confirmAfterMs ?? PURCHASE_AUTO_CONFIRM_AFTER_MS
  let lastSweepAt = 0
  let running = false

  return {
    async sweep() {
      const clock = Date.now()
      if (running || clock - lastSweepAt < SWEEP_INTERVAL_MS) {
        return 0
      }
      running = true
      lastSweepAt = clock

      try {
        const current = now()
        const confirmed = await options.repository.autoConfirmStale({
          olderThan: current.subtract({ milliseconds: confirmAfterMs }),
          notOlderThan: current.subtract({ milliseconds: PURCHASE_AUTO_CONFIRM_MAX_AGE_MS })
        })

        for (const purchase of confirmed) {
          await options.purchaseTopicNoticeService
            ?.syncPurchase({
              householdId: purchase.householdId,
              purchaseId: purchase.purchaseMessageId
            })
            .catch(() => undefined)

          if (options.auditNotificationService) {
            const payerName = purchase.payerDisplayName ?? 'Someone'
            await options.auditNotificationService
              .recordEvent({
                householdId: purchase.householdId,
                actorMemberId: purchase.payerMemberId ?? null,
                actorDisplayName: payerName,
                eventType: 'purchase.confirmed',
                category: 'purchase_events',
                summaryText: `${payerName} purchase confirmed automatically: ${
                  purchase.parsedItemDescription ?? 'shared purchase'
                }`,
                metadata: {
                  purchaseMessageId: purchase.purchaseMessageId,
                  autoConfirmed: true,
                  amountMinor: purchase.parsedAmountMinor?.toString() ?? null,
                  currency: purchase.parsedCurrency,
                  description: purchase.parsedItemDescription,
                  payerDisplayName: purchase.payerDisplayName ?? null,
                  participants: purchase.participants.map((participant) => ({
                    memberId: participant.memberId,
                    displayName: participant.displayName,
                    included: participant.included
                  }))
                }
              })
              .catch((error) => {
                options.logger?.warn(
                  { event: 'purchase.auto_confirm_audit_failed', error },
                  'Could not record the auto-confirmed purchase'
                )
              })
          }

          options.logger?.info(
            {
              event: 'purchase.auto_confirmed',
              householdId: purchase.householdId,
              purchaseMessageId: purchase.purchaseMessageId
            },
            'Unanswered purchase proposal confirmed automatically'
          )
        }

        return confirmed.length
      } catch (error) {
        options.logger?.error(
          { event: 'purchase.auto_confirm_failed', error },
          'Purchase auto-confirm sweep failed'
        )
        return 0
      } finally {
        running = false
      }
    }
  }
}

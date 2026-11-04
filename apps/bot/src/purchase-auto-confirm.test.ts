import { describe, expect, test } from 'bun:test'

import { instantFromIso } from '@household/domain'

import type {
  AutoConfirmedPurchase,
  PurchaseAutoConfirmRepository
} from './adapters/purchase-message-repository'
import { createPurchaseAutoConfirmSweeper } from './purchase-auto-confirm'

const confirmedPurchase: AutoConfirmedPurchase = {
  status: 'confirmed',
  purchaseMessageId: 'purchase-1',
  householdId: 'household-1',
  participants: [
    { id: 'p1', memberId: 'member-1', displayName: 'Стас', included: true, memberStatus: 'active' },
    { id: 'p2', memberId: 'member-2', displayName: 'Ион', included: true, memberStatus: 'active' }
  ],
  parsedAmountMinor: 1700n,
  parsedCurrency: 'GEL',
  parsedItemDescription: 'Стиральный порошок',
  payerMemberId: 'member-1',
  payerDisplayName: 'Стас',
  amountSource: null,
  calculationExplanation: null,
  parserConfidence: 90,
  parserMode: 'llm'
}

function setup(confirmed: readonly AutoConfirmedPurchase[] = [confirmedPurchase]) {
  const windows: Array<{ olderThan: string; notOlderThan: string }> = []
  const synced: string[] = []
  const events: Array<Record<string, unknown>> = []
  const repository: PurchaseAutoConfirmRepository = {
    async autoConfirmStale(input) {
      windows.push({
        olderThan: input.olderThan.toString(),
        notOlderThan: input.notOlderThan.toString()
      })
      return confirmed
    }
  }
  const sweeper = createPurchaseAutoConfirmSweeper({
    repository,
    now: () => instantFromIso('2026-11-05T12:00:00Z'),
    purchaseTopicNoticeService: {
      async syncPurchase({ purchaseId }) {
        synced.push(purchaseId)
      }
    },
    auditNotificationService: {
      async recordEvent(input: Record<string, unknown>) {
        events.push(input)
        return null
      }
    } as never
  })

  return { sweeper, windows, synced, events }
}

describe('createPurchaseAutoConfirmSweeper', () => {
  test('confirms proposals left for a day and ignores ones older than a week', async () => {
    const { sweeper, windows } = setup()

    await sweeper.sweep()

    expect(windows).toEqual([
      {
        olderThan: '2026-11-04T12:00:00Z',
        notOlderThan: '2026-10-29T12:00:00Z'
      }
    ])
  })

  test('edits the proposal into the saved card and records who paid', async () => {
    const { sweeper, synced, events } = setup()

    await expect(sweeper.sweep()).resolves.toBe(1)

    expect(synced).toEqual(['purchase-1'])
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({
      householdId: 'household-1',
      actorMemberId: 'member-1',
      actorDisplayName: 'Стас',
      eventType: 'purchase.confirmed',
      category: 'purchase_events',
      metadata: {
        purchaseMessageId: 'purchase-1',
        autoConfirmed: true,
        amountMinor: '1700',
        currency: 'GEL',
        payerDisplayName: 'Стас'
      }
    })
  })

  test('does nothing and stays quiet when no proposal is due', async () => {
    const { sweeper, synced, events } = setup([])

    await expect(sweeper.sweep()).resolves.toBe(0)

    expect(synced).toEqual([])
    expect(events).toEqual([])
  })

  test('does not sweep again within a minute', async () => {
    const { sweeper, windows } = setup([])

    await sweeper.sweep()
    await sweeper.sweep()

    expect(windows).toHaveLength(1)
  })

  test('survives a failing repository', async () => {
    const sweeper = createPurchaseAutoConfirmSweeper({
      repository: {
        async autoConfirmStale() {
          throw new Error('db down')
        }
      }
    })

    await expect(sweeper.sweep()).resolves.toBe(0)
  })
})

/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import {
  buildQuickPurchasePreview,
  purchaseDraftWithSelectedPayer,
  type QuickPurchasePreviewMember
} from './purchase-draft'
import type { PurchaseDraft } from './ledger-helpers'

const members: QuickPurchasePreviewMember[] = [
  {
    memberId: 'alisa',
    displayName: 'Alisa',
    remainingMajor: '0.00',
    purchaseBalanceMajor: '0.00'
  },
  {
    memberId: 'dima',
    displayName: 'Dima',
    remainingMajor: '0.00',
    purchaseBalanceMajor: '0.00'
  },
  {
    memberId: 'ion',
    displayName: 'Ion',
    remainingMajor: '0.00',
    purchaseBalanceMajor: '0.00'
  },
  {
    memberId: 'stas',
    displayName: 'Stas',
    remainingMajor: '0.00',
    purchaseBalanceMajor: '0.00'
  }
]

function equalSplitDraft(payerMemberId: string): PurchaseDraft {
  return {
    description: 'Shared supplies',
    amountMajor: '34.00',
    currency: 'GEL',
    occurredOn: '2026-05-10',
    payerMemberId,
    splitMode: 'equal',
    splitInputMode: 'equal',
    participants: members.map((member) => ({
      memberId: member.memberId,
      included: true,
      shareAmountMajor: '',
      sharePercentage: ''
    }))
  }
}

describe('buildQuickPurchasePreview', () => {
  test('credits the selected payer for an equal quick purchase split', () => {
    const rows = buildQuickPurchasePreview(equalSplitDraft('alisa'), members)
    const deltaByMemberId = new Map(rows.map((row) => [row.memberId, row.deltaMajor]))
    const projectedBalanceByMemberId = new Map(
      rows.map((row) => [row.memberId, row.projectedPurchaseBalanceMajor])
    )

    expect(deltaByMemberId.get('alisa')).toBe('-25.50')
    expect(projectedBalanceByMemberId.get('alisa')).toBe('-25.50')
    expect(deltaByMemberId.get('stas')).toBe('8.50')
  })

  test('recomputes payer credit from the selected draft payer', () => {
    const beforeRows = buildQuickPurchasePreview(equalSplitDraft('stas'), members)
    const rows = buildQuickPurchasePreview(
      purchaseDraftWithSelectedPayer(equalSplitDraft('stas'), 'alisa'),
      members
    )
    const beforeDeltaByMemberId = new Map(beforeRows.map((row) => [row.memberId, row.deltaMajor]))
    const deltaByMemberId = new Map(rows.map((row) => [row.memberId, row.deltaMajor]))

    expect(beforeDeltaByMemberId.get('stas')).toBe('-25.50')
    expect(deltaByMemberId.get('alisa')).toBe('-25.50')
    expect(deltaByMemberId.get('stas')).toBe('8.50')
  })
})

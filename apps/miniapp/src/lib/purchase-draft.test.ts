/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import {
  buildEmptyPurchaseDraft,
  buildQuickPurchasePreview,
  purchaseDraftWithSelectedPayer,
  type QuickPurchasePreviewMember
} from './purchase-draft'
import type { PurchaseDraft } from './ledger-helpers'
import type { MiniAppDashboard } from '../api'

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

  test('uses exact custom shares instead of previewing a false equal split', () => {
    const rows = buildQuickPurchasePreview(
      {
        ...equalSplitDraft('alisa'),
        splitMode: 'custom_amounts',
        splitInputMode: 'exact',
        participants: [
          {
            memberId: 'alisa',
            included: true,
            shareAmountMajor: '10.00',
            sharePercentage: ''
          },
          {
            memberId: 'dima',
            included: true,
            shareAmountMajor: '24.00',
            sharePercentage: ''
          },
          {
            memberId: 'ion',
            included: false,
            shareAmountMajor: '',
            sharePercentage: ''
          },
          {
            memberId: 'stas',
            included: false,
            shareAmountMajor: '',
            sharePercentage: ''
          }
        ]
      },
      members
    )
    const deltaByMemberId = new Map(rows.map((row) => [row.memberId, row.deltaMajor]))

    expect(deltaByMemberId.get('alisa')).toBe('-24.00')
    expect(deltaByMemberId.get('dima')).toBe('24.00')
    expect(deltaByMemberId.has('ion')).toBe(false)
    expect(deltaByMemberId.has('stas')).toBe(false)
  })

  test('does not preview an unbalanced custom split as if it were safe', () => {
    const rows = buildQuickPurchasePreview(
      {
        ...equalSplitDraft('alisa'),
        splitMode: 'custom_amounts',
        splitInputMode: 'exact',
        participants: [
          {
            memberId: 'alisa',
            included: true,
            shareAmountMajor: '10.00',
            sharePercentage: ''
          },
          {
            memberId: 'dima',
            included: true,
            shareAmountMajor: '10.00',
            sharePercentage: ''
          }
        ]
      },
      members
    )

    expect(rows).toEqual([])
  })
})

describe('buildEmptyPurchaseDraft', () => {
  test('defaults purchase participants to active members only', () => {
    const dashboard = {
      currency: 'GEL',
      members: [
        {
          memberId: 'alisa',
          displayName: 'Alisa',
          status: 'active'
        },
        {
          memberId: 'dima',
          displayName: 'Dima',
          status: 'away'
        },
        {
          memberId: 'ion',
          displayName: 'Ion',
          status: 'left'
        }
      ]
    } as unknown as MiniAppDashboard

    const draft = buildEmptyPurchaseDraft(dashboard, 'alisa')

    expect(draft.participants.map((participant) => participant.memberId)).toEqual(['alisa'])
  })

  test('does not default the payer to an inactive current member', () => {
    const dashboard = {
      currency: 'GEL',
      members: [
        {
          memberId: 'alisa',
          displayName: 'Alisa',
          status: 'active'
        },
        {
          memberId: 'dima',
          displayName: 'Dima',
          status: 'away'
        }
      ]
    } as unknown as MiniAppDashboard

    const draft = buildEmptyPurchaseDraft(dashboard, 'dima')

    expect(draft.payerMemberId).toBeUndefined()
    expect(draft.participants.map((participant) => participant.memberId)).toEqual(['alisa'])
  })
})

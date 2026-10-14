/// <reference types="bun" />

import { describe, expect, test } from 'bun:test'

import { buildEmptyPurchaseDraft } from './purchase-draft'
import type { MiniAppDashboard } from '../api'

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

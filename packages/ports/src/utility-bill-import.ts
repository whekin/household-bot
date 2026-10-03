import type { CurrencyCode } from '@household/domain'
import type { HouseholdUtilityCategoryRecord } from './household-config'

export interface UtilityImageBill {
  provider: string
  customerNumber: string | null
  category: string | null
  amountMajor: string | null
  currency: string | null
  confidence: number
}

export interface UtilityImageRecognition {
  kind: 'utility_balances' | 'payment_receipt' | 'unrelated' | 'unreadable'
  bills: readonly UtilityImageBill[]
}

export type UtilityImageRecognizer = (image: {
  data: Uint8Array
  mimeType: 'image/png' | 'image/jpeg'
}) => Promise<UtilityImageRecognition>

export interface UtilityBillImportEntry {
  billName: string
  amountMajor: string
  provider?: string
  customerNumber?: string | null
}

export interface UtilityBillImportSnapshot {
  revision: string
  closed: boolean
  hasPayments: boolean
  paidByBillId: Readonly<Record<string, string>>
  categories: readonly HouseholdUtilityCategoryRecord[]
  bills: readonly {
    id: string
    billName: string
    amountMinor: string
    currency: CurrencyCode
  }[]
}

export interface UtilityBillImportChange {
  billId: string | null
  billName: string
  amountMinor: string
}

export interface UtilityBillImportRepository {
  getSnapshot(period: string): Promise<UtilityBillImportSnapshot>
  /** Apply all changes or none, only if the exact reviewed snapshot still holds. */
  apply(input: {
    period: string
    expectedRevision: string
    changes: readonly UtilityBillImportChange[]
    createdByMemberId: string
    /** A separately confirmed, attributed rounding payment; never inferred automatically. */
    additionalPayment?: {
      utilityBillId: string
      payerMemberId: string
      amountMinor: string
    }
  }): Promise<'applied' | 'stale'>
}

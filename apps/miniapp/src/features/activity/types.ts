import type { MiniAppDashboard } from '@/api'

export type LedgerEntry = MiniAppDashboard['ledger'][number]

export type ActivityFilter = 'all' | 'purchases' | 'utilities' | 'payments'

export type PurchaseScope = 'active' | 'resolved'

export type PaymentPrefill = {
  memberId: string
  kind: 'rent' | 'utilities'
  period: string
}

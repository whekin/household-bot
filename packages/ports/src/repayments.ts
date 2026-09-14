import type { CurrencyCode } from '@household/domain'

export interface MemberRepayment {
  id: string
  kind: 'request' | 'transfer'
  fromMemberId: string | null
  toMemberId: string
  amountMinor: bigint
  currency: CurrencyCode
  occurredOn: string
  status: 'open' | 'pending' | 'confirmed' | 'cancelled' | 'closed'
  requestId: string | null
  createdAt: string
}

export interface RepaymentRepository {
  listRepayments(): Promise<readonly MemberRepayment[]>
  addRepayment(input: Omit<MemberRepayment, 'createdAt'>): Promise<MemberRepayment>
  transitionRepayment(
    id: string,
    expected: MemberRepayment['status'],
    next: MemberRepayment['status']
  ): Promise<boolean>
}

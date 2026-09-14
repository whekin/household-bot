import { miniAppApiError, postMiniApp } from './client'

export interface Repayment {
  id: string
  kind: 'request' | 'transfer'
  fromMemberId: string | null
  toMemberId: string
  amountMinor: string
  currency: 'USD' | 'GEL'
  occurredOn: string
  status: 'open' | 'pending' | 'confirmed' | 'cancelled' | 'closed'
  requestId: string | null
  createdAt: string
}
export type RepaymentCommand =
  | { action: 'list' }
  | { action: 'request'; id: string; amountMajor: string }
  | {
      action: 'transfer'
      id: string
      toMemberId: string
      amountMajor: string
      occurredOn: string
      requestId?: string
    }
  | { action: 'confirm' | 'cancel' | 'close'; id: string }
export async function executeRepayment(
  initData: string,
  command: RepaymentCommand
): Promise<Repayment[]> {
  const { response, payload } = await postMiniApp<{
    authorized?: boolean
    repayments?: Repayment[]
    error?: string
  }>('/api/miniapp/repayments', { initData, ...command })
  if (!response.ok || !payload.authorized || !payload.repayments)
    throw miniAppApiError(response, payload, 'Unable to load repayments')
  return payload.repayments
}

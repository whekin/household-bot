import { miniAppApiError, postMiniApp } from './client'
import type { MiniAppAdminCycleState, MiniAppDashboard } from './types'

export async function fetchMiniAppBillingCycle(initData: string): Promise<MiniAppAdminCycleState> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }>('/api/miniapp/admin/billing-cycle', {
    initData
  })

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw miniAppApiError(response, payload, 'Failed to load billing cycle')
  }

  return payload.cycleState
}

export async function openMiniAppBillingCycle(
  initData: string,
  input: {
    period: string
    currency: 'USD' | 'GEL'
  }
): Promise<MiniAppAdminCycleState> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }>('/api/miniapp/admin/billing-cycle/open', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw miniAppApiError(response, payload, 'Failed to open billing cycle')
  }

  return payload.cycleState
}

export async function closeMiniAppBillingCycle(
  initData: string,
  period?: string
): Promise<MiniAppAdminCycleState> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }>('/api/miniapp/admin/billing-cycle/close', {
    initData,
    ...(period
      ? {
          period
        }
      : {})
  })

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw miniAppApiError(response, payload, 'Failed to close billing cycle')
  }

  return payload.cycleState
}

export async function updateMiniAppCycleRent(
  initData: string,
  input: {
    amountMajor: string
    currency: 'USD' | 'GEL'
    period?: string
    fxRateMicros?: string
  }
): Promise<MiniAppAdminCycleState> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }>('/api/miniapp/admin/rent/update', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw miniAppApiError(response, payload, 'Failed to update rent')
  }

  return payload.cycleState
}

export async function addMiniAppUtilityBill(
  initData: string,
  input: {
    billName: string
    amountMajor: string
    currency: 'USD' | 'GEL'
  }
): Promise<MiniAppAdminCycleState> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }>('/api/miniapp/admin/utility-bills/add', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw miniAppApiError(response, payload, 'Failed to add utility bill')
  }

  return payload.cycleState
}

export async function submitMiniAppUtilityBill(
  initData: string,
  input: {
    billName: string
    amountMajor: string
    currency: 'USD' | 'GEL'
  }
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/utility-bills/add', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to submit utility bill')
  }
}

export async function updateMiniAppUtilityBill(
  initData: string,
  input: {
    billId: string
    billName: string
    amountMajor: string
    currency: 'USD' | 'GEL'
  }
): Promise<MiniAppAdminCycleState> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }>('/api/miniapp/admin/utility-bills/update', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw miniAppApiError(response, payload, 'Failed to update utility bill')
  }

  return payload.cycleState
}

export async function deleteMiniAppUtilityBill(
  initData: string,
  billId: string
): Promise<MiniAppAdminCycleState> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    cycleState?: MiniAppAdminCycleState
    error?: string
  }>('/api/miniapp/admin/utility-bills/delete', {
    initData,
    billId
  })

  if (!response.ok || !payload.authorized || !payload.cycleState) {
    throw miniAppApiError(response, payload, 'Failed to delete utility bill')
  }

  return payload.cycleState
}

export async function addMiniAppPurchase(
  initData: string,
  input: {
    description: string
    amountMajor: string
    currency: 'USD' | 'GEL'
    occurredOn?: string
    payerMemberId?: string
    split?: {
      mode: 'equal' | 'custom_amounts'
      participants: readonly {
        memberId: string
        included?: boolean
        shareAmountMajor?: string
      }[]
    }
  }
): Promise<MiniAppDashboard> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    dashboard?: MiniAppDashboard
    error?: string
  }>('/api/miniapp/admin/purchases/add', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized || !payload.dashboard) {
    throw miniAppApiError(response, payload, 'Failed to add purchase')
  }

  return payload.dashboard
}

export async function updateMiniAppPurchase(
  initData: string,
  input: {
    purchaseId: string
    description: string
    amountMajor: string
    currency: 'USD' | 'GEL'
    occurredOn?: string
    payerMemberId?: string
    split?: {
      mode: 'equal' | 'custom_amounts'
      participants: readonly {
        memberId: string
        included?: boolean
        shareAmountMajor?: string
      }[]
    }
  }
): Promise<MiniAppDashboard> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    dashboard?: MiniAppDashboard
    error?: string
  }>('/api/miniapp/admin/purchases/update', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized || !payload.dashboard) {
    throw miniAppApiError(response, payload, 'Failed to update purchase')
  }

  return payload.dashboard
}

export async function deleteMiniAppPurchase(
  initData: string,
  purchaseId: string
): Promise<MiniAppDashboard> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    dashboard?: MiniAppDashboard
    error?: string
  }>('/api/miniapp/admin/purchases/delete', {
    initData,
    purchaseId
  })

  if (!response.ok || !payload.authorized || !payload.dashboard) {
    throw miniAppApiError(response, payload, 'Failed to delete purchase')
  }

  return payload.dashboard
}

export async function addMiniAppPayment(
  initData: string,
  input: {
    memberId: string
    kind: 'rent' | 'utilities'
    amountMajor: string
    currency: 'USD' | 'GEL'
    period?: string
  }
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/admin/payments/add', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to add payment')
  }
}

export async function closeMiniAppPaymentPeriod(
  initData: string,
  input: {
    period: string
    kind: 'rent' | 'utilities'
    memberIds?: readonly string[]
    allMembers?: boolean
  }
): Promise<{
  dashboard: MiniAppDashboard
  closeSummary: {
    period: string
    kind: 'rent' | 'utilities'
    closedMembers: readonly {
      memberId: string
      displayName: string
      amountMajor: string
      currency: 'USD' | 'GEL'
    }[]
    skippedMembers: readonly {
      memberId: string
      displayName: string
      reason: 'already_settled' | 'not_found'
    }[]
  }
}> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    dashboard?: MiniAppDashboard
    closeSummary?: {
      period: string
      kind: 'rent' | 'utilities'
      closedMembers: {
        memberId: string
        displayName: string
        amountMajor: string
        currency: 'USD' | 'GEL'
      }[]
      skippedMembers: {
        memberId: string
        displayName: string
        reason: 'already_settled' | 'not_found'
      }[]
    }
    error?: string
  }>('/api/miniapp/billing/periods/close', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized || !payload.dashboard || !payload.closeSummary) {
    throw miniAppApiError(response, payload, 'Failed to close payment period')
  }

  return {
    dashboard: payload.dashboard,
    closeSummary: payload.closeSummary
  }
}

export async function resolveMiniAppUtilityPlan(
  initData: string,
  input: {
    memberId?: string
    allMembers?: boolean
    period?: string
  } = {}
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/billing/utilities/resolve-planned', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to resolve planned utility bills')
  }
}

export async function recordMiniAppUtilityVendorPayment(
  initData: string,
  input: {
    utilityBillId: string
    payerMemberId?: string
    amountMajor?: string
    currency?: 'USD' | 'GEL'
    period?: string
  }
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/billing/utilities/vendor-payment', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to record utility vendor payment')
  }
}

export async function updateMiniAppPayment(
  initData: string,
  input: {
    paymentId: string
    memberId: string
    kind: 'rent' | 'utilities'
    amountMajor: string
    currency: 'USD' | 'GEL'
  }
): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/admin/payments/update', {
    initData,
    ...input
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to update payment')
  }
}

export async function deleteMiniAppPayment(initData: string, paymentId: string): Promise<void> {
  const { response, payload } = await postMiniApp<{
    ok: boolean
    authorized?: boolean
    error?: string
  }>('/api/miniapp/admin/payments/delete', {
    initData,
    paymentId
  })

  if (!response.ok || !payload.authorized) {
    throw miniAppApiError(response, payload, 'Failed to delete payment')
  }
}

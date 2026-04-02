export interface BotWebhookServerOptions {
  webhookPath: string
  webhookSecret: string
  webhookHandler: (request: Request) => Promise<Response> | Response
  miniAppAuth?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppDashboard?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdateNotification?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppCancelNotification?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppJoin?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppPendingMembers?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppApproveMember?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppRejectMember?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppSettings?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdateSettings?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpsertUtilityCategory?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppPromoteMember?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppDemoteMember?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdateOwnDisplayName?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdateMemberDisplayName?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdateMemberRentWeight?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdateMemberStatus?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdateMemberPresenceDays?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppBillingCycle?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppOpenCycle?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppCloseCycle?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppRentUpdate?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppAddUtilityBill?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppSubmitUtilityBill?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdateUtilityBill?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppDeleteUtilityBill?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppAddPurchase?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdatePurchase?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppDeletePurchase?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppAddPayment?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppSubmitPayment?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppUpdatePayment?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppDeletePayment?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppResolveUtilityPlan?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppRecordUtilityVendorPayment?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  miniAppLocalePreference?:
    | {
        path?: string
        handler: (request: Request) => Promise<Response>
      }
    | undefined
  scheduler?:
    | {
        pathPrefix?: string
        authorize: (request: Request) => Promise<boolean>
        handler: (request: Request, reminderType: string) => Promise<Response>
      }
    | undefined
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  })
}

function isAuthorized(request: Request, expectedSecret: string): boolean {
  const secretHeader = request.headers.get('x-telegram-bot-api-secret-token')

  return secretHeader === expectedSecret
}

export function createBotWebhookServer(options: BotWebhookServerOptions): {
  fetch: (request: Request) => Promise<Response>
} {
  const normalizedWebhookPath = options.webhookPath.startsWith('/')
    ? options.webhookPath
    : `/${options.webhookPath}`
  const miniAppAuthPath = options.miniAppAuth?.path ?? '/api/miniapp/session'
  const miniAppDashboardPath = options.miniAppDashboard?.path ?? '/api/miniapp/dashboard'
  const miniAppUpdateNotificationPath =
    options.miniAppUpdateNotification?.path ?? '/api/miniapp/notifications/update'
  const miniAppCancelNotificationPath =
    options.miniAppCancelNotification?.path ?? '/api/miniapp/notifications/cancel'
  const miniAppJoinPath = options.miniAppJoin?.path ?? '/api/miniapp/join'
  const miniAppPendingMembersPath =
    options.miniAppPendingMembers?.path ?? '/api/miniapp/admin/pending-members'
  const miniAppApproveMemberPath =
    options.miniAppApproveMember?.path ?? '/api/miniapp/admin/approve-member'
  const miniAppRejectMemberPath =
    options.miniAppRejectMember?.path ?? '/api/miniapp/admin/reject-member'
  const miniAppSettingsPath = options.miniAppSettings?.path ?? '/api/miniapp/admin/settings'
  const miniAppUpdateSettingsPath =
    options.miniAppUpdateSettings?.path ?? '/api/miniapp/admin/settings/update'
  const miniAppUpsertUtilityCategoryPath =
    options.miniAppUpsertUtilityCategory?.path ?? '/api/miniapp/admin/utility-categories/upsert'
  const miniAppPromoteMemberPath =
    options.miniAppPromoteMember?.path ?? '/api/miniapp/admin/members/promote'
  const miniAppDemoteMemberPath =
    options.miniAppDemoteMember?.path ?? '/api/miniapp/admin/members/demote'
  const miniAppUpdateOwnDisplayNamePath =
    options.miniAppUpdateOwnDisplayName?.path ?? '/api/miniapp/member/display-name'
  const miniAppUpdateMemberDisplayNamePath =
    options.miniAppUpdateMemberDisplayName?.path ?? '/api/miniapp/admin/members/display-name'
  const miniAppUpdateMemberRentWeightPath =
    options.miniAppUpdateMemberRentWeight?.path ?? '/api/miniapp/admin/members/rent-weight'
  const miniAppUpdateMemberStatusPath =
    options.miniAppUpdateMemberStatus?.path ?? '/api/miniapp/admin/members/status'
  const miniAppUpdateMemberPresenceDaysPath =
    options.miniAppUpdateMemberPresenceDays?.path ?? '/api/miniapp/admin/members/presence-days'
  const miniAppBillingCyclePath =
    options.miniAppBillingCycle?.path ?? '/api/miniapp/admin/billing-cycle'
  const miniAppOpenCyclePath =
    options.miniAppOpenCycle?.path ?? '/api/miniapp/admin/billing-cycle/open'
  const miniAppCloseCyclePath =
    options.miniAppCloseCycle?.path ?? '/api/miniapp/admin/billing-cycle/close'
  const miniAppRentUpdatePath = options.miniAppRentUpdate?.path ?? '/api/miniapp/admin/rent/update'
  const miniAppAddUtilityBillPath =
    options.miniAppAddUtilityBill?.path ?? '/api/miniapp/admin/utility-bills/add'
  const miniAppSubmitUtilityBillPath =
    options.miniAppSubmitUtilityBill?.path ?? '/api/miniapp/utility-bills/add'
  const miniAppUpdateUtilityBillPath =
    options.miniAppUpdateUtilityBill?.path ?? '/api/miniapp/admin/utility-bills/update'
  const miniAppDeleteUtilityBillPath =
    options.miniAppDeleteUtilityBill?.path ?? '/api/miniapp/admin/utility-bills/delete'
  const miniAppAddPurchasePath =
    options.miniAppAddPurchase?.path ?? '/api/miniapp/admin/purchases/add'
  const miniAppUpdatePurchasePath =
    options.miniAppUpdatePurchase?.path ?? '/api/miniapp/admin/purchases/update'
  const miniAppDeletePurchasePath =
    options.miniAppDeletePurchase?.path ?? '/api/miniapp/admin/purchases/delete'
  const miniAppAddPaymentPath = options.miniAppAddPayment?.path ?? '/api/miniapp/admin/payments/add'
  const miniAppSubmitPaymentPath = options.miniAppSubmitPayment?.path ?? '/api/miniapp/payments/add'
  const miniAppUpdatePaymentPath =
    options.miniAppUpdatePayment?.path ?? '/api/miniapp/admin/payments/update'
  const miniAppDeletePaymentPath =
    options.miniAppDeletePayment?.path ?? '/api/miniapp/admin/payments/delete'
  const miniAppResolveUtilityPlanPath =
    options.miniAppResolveUtilityPlan?.path ?? '/api/miniapp/billing/utilities/resolve-planned'
  const miniAppRecordUtilityVendorPaymentPath =
    options.miniAppRecordUtilityVendorPayment?.path ??
    '/api/miniapp/billing/utilities/vendor-payment'
  const miniAppLocalePreferencePath =
    options.miniAppLocalePreference?.path ?? '/api/miniapp/preferences/locale'
  const schedulerPathPrefix = options.scheduler ? (options.scheduler.pathPrefix ?? '/jobs') : null

  return {
    fetch: async (request: Request) => {
      const url = new URL(request.url)

      if (url.pathname === '/healthz') {
        return json({ ok: true })
      }

      if (options.miniAppAuth && url.pathname === miniAppAuthPath) {
        return await options.miniAppAuth.handler(request)
      }

      if (options.miniAppDashboard && url.pathname === miniAppDashboardPath) {
        return await options.miniAppDashboard.handler(request)
      }

      if (options.miniAppUpdateNotification && url.pathname === miniAppUpdateNotificationPath) {
        return await options.miniAppUpdateNotification.handler(request)
      }

      if (options.miniAppCancelNotification && url.pathname === miniAppCancelNotificationPath) {
        return await options.miniAppCancelNotification.handler(request)
      }

      if (options.miniAppJoin && url.pathname === miniAppJoinPath) {
        return await options.miniAppJoin.handler(request)
      }

      if (options.miniAppPendingMembers && url.pathname === miniAppPendingMembersPath) {
        return await options.miniAppPendingMembers.handler(request)
      }

      if (options.miniAppApproveMember && url.pathname === miniAppApproveMemberPath) {
        return await options.miniAppApproveMember.handler(request)
      }

      if (options.miniAppRejectMember && url.pathname === miniAppRejectMemberPath) {
        return await options.miniAppRejectMember.handler(request)
      }

      if (options.miniAppSettings && url.pathname === miniAppSettingsPath) {
        return await options.miniAppSettings.handler(request)
      }

      if (options.miniAppUpdateSettings && url.pathname === miniAppUpdateSettingsPath) {
        return await options.miniAppUpdateSettings.handler(request)
      }

      if (
        options.miniAppUpsertUtilityCategory &&
        url.pathname === miniAppUpsertUtilityCategoryPath
      ) {
        return await options.miniAppUpsertUtilityCategory.handler(request)
      }

      if (options.miniAppPromoteMember && url.pathname === miniAppPromoteMemberPath) {
        return await options.miniAppPromoteMember.handler(request)
      }

      if (options.miniAppDemoteMember && url.pathname === miniAppDemoteMemberPath) {
        return await options.miniAppDemoteMember.handler(request)
      }

      if (options.miniAppUpdateOwnDisplayName && url.pathname === miniAppUpdateOwnDisplayNamePath) {
        return await options.miniAppUpdateOwnDisplayName.handler(request)
      }

      if (
        options.miniAppUpdateMemberDisplayName &&
        url.pathname === miniAppUpdateMemberDisplayNamePath
      ) {
        return await options.miniAppUpdateMemberDisplayName.handler(request)
      }

      if (
        options.miniAppUpdateMemberRentWeight &&
        url.pathname === miniAppUpdateMemberRentWeightPath
      ) {
        return await options.miniAppUpdateMemberRentWeight.handler(request)
      }

      if (options.miniAppUpdateMemberStatus && url.pathname === miniAppUpdateMemberStatusPath) {
        return await options.miniAppUpdateMemberStatus.handler(request)
      }

      if (
        options.miniAppUpdateMemberPresenceDays &&
        url.pathname === miniAppUpdateMemberPresenceDaysPath
      ) {
        return await options.miniAppUpdateMemberPresenceDays.handler(request)
      }

      if (options.miniAppBillingCycle && url.pathname === miniAppBillingCyclePath) {
        return await options.miniAppBillingCycle.handler(request)
      }

      if (options.miniAppOpenCycle && url.pathname === miniAppOpenCyclePath) {
        return await options.miniAppOpenCycle.handler(request)
      }

      if (options.miniAppCloseCycle && url.pathname === miniAppCloseCyclePath) {
        return await options.miniAppCloseCycle.handler(request)
      }

      if (options.miniAppRentUpdate && url.pathname === miniAppRentUpdatePath) {
        return await options.miniAppRentUpdate.handler(request)
      }

      if (options.miniAppAddUtilityBill && url.pathname === miniAppAddUtilityBillPath) {
        return await options.miniAppAddUtilityBill.handler(request)
      }

      if (options.miniAppSubmitUtilityBill && url.pathname === miniAppSubmitUtilityBillPath) {
        return await options.miniAppSubmitUtilityBill.handler(request)
      }

      if (options.miniAppUpdateUtilityBill && url.pathname === miniAppUpdateUtilityBillPath) {
        return await options.miniAppUpdateUtilityBill.handler(request)
      }

      if (options.miniAppDeleteUtilityBill && url.pathname === miniAppDeleteUtilityBillPath) {
        return await options.miniAppDeleteUtilityBill.handler(request)
      }

      if (options.miniAppAddPurchase && url.pathname === miniAppAddPurchasePath) {
        return await options.miniAppAddPurchase.handler(request)
      }

      if (options.miniAppUpdatePurchase && url.pathname === miniAppUpdatePurchasePath) {
        return await options.miniAppUpdatePurchase.handler(request)
      }

      if (options.miniAppDeletePurchase && url.pathname === miniAppDeletePurchasePath) {
        return await options.miniAppDeletePurchase.handler(request)
      }

      if (options.miniAppAddPayment && url.pathname === miniAppAddPaymentPath) {
        return await options.miniAppAddPayment.handler(request)
      }

      if (options.miniAppSubmitPayment && url.pathname === miniAppSubmitPaymentPath) {
        return await options.miniAppSubmitPayment.handler(request)
      }

      if (options.miniAppUpdatePayment && url.pathname === miniAppUpdatePaymentPath) {
        return await options.miniAppUpdatePayment.handler(request)
      }

      if (options.miniAppDeletePayment && url.pathname === miniAppDeletePaymentPath) {
        return await options.miniAppDeletePayment.handler(request)
      }

      if (options.miniAppResolveUtilityPlan && url.pathname === miniAppResolveUtilityPlanPath) {
        return await options.miniAppResolveUtilityPlan.handler(request)
      }

      if (
        options.miniAppRecordUtilityVendorPayment &&
        url.pathname === miniAppRecordUtilityVendorPaymentPath
      ) {
        return await options.miniAppRecordUtilityVendorPayment.handler(request)
      }

      if (options.miniAppLocalePreference && url.pathname === miniAppLocalePreferencePath) {
        return await options.miniAppLocalePreference.handler(request)
      }

      if (url.pathname !== normalizedWebhookPath) {
        if (schedulerPathPrefix && url.pathname.startsWith(`${schedulerPathPrefix}/`)) {
          if (request.method !== 'POST') {
            return new Response('Method Not Allowed', { status: 405 })
          }

          if (!(await options.scheduler!.authorize(request))) {
            return new Response('Unauthorized', { status: 401 })
          }

          const reminderType = url.pathname.slice(`${schedulerPathPrefix}/`.length)
          return await options.scheduler!.handler(request, reminderType)
        }

        return new Response('Not Found', { status: 404 })
      }

      if (request.method !== 'POST') {
        return new Response('Method Not Allowed', { status: 405 })
      }

      if (!isAuthorized(request, options.webhookSecret)) {
        return new Response('Unauthorized', { status: 401 })
      }

      return await options.webhookHandler(request)
    }
  }
}

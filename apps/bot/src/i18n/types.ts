export type BotLocale = 'en' | 'ru'

export type TelegramCommandName =
  | 'help'
  | 'household_status'
  | 'anon'
  | 'cancel'
  | 'setup'
  | 'unsetup'
  | 'bind_purchase_topic'
  | 'bind_feedback_topic'
  | 'bind_reminders_topic'
  | 'bind_payments_topic'
  | 'invite'
  | 'payment_add'
  | 'pending_members'
  | 'approve_member'

export interface BotCommandDescriptions {
  help: string
  household_status: string
  anon: string
  cancel: string
  setup: string
  unsetup: string
  bind_purchase_topic: string
  bind_feedback_topic: string
  bind_reminders_topic: string
  bind_payments_topic: string
  invite: string
  payment_add: string
  pending_members: string
  approve_member: string
}

export interface PendingMemberSummary {
  telegramUserId: string
  displayName: string
  username?: string | null
}

export interface BotTranslationCatalog {
  localeName: string
  commands: BotCommandDescriptions
  help: {
    intro: string
    privateChatHeading: string
    groupHeading: string
    groupAdminsHeading: string
  }
  common: {
    unableToIdentifySender: string
    useHelp: string
  }
  setup: {
    onlyTelegramAdmins: string
    useSetupInGroup: string
    onlyTelegramAdminsBindTopics: string
    householdNotConfigured: string
    useCommandInTopic: string
    onlyHouseholdAdmins: string
    pendingNotFound: string
    pendingMembersHeading: (householdName: string) => string
    pendingMembersHint: string
    pendingMembersEmpty: (householdName: string) => string
    pendingMemberLine: (member: PendingMemberSummary, index: number) => string
    openMiniAppButton: string
    joinHouseholdButton: string
    approveMemberButton: (displayName: string) => string
    telegramIdentityRequired: string
    invalidJoinLink: string
    joinLinkInvalidOrExpired: string
    alreadyActiveMember: (displayName: string) => string
    joinRequestSent: (householdName: string) => string
    setupSummary: (params: {
      householdName: string
      telegramChatId: string
      created: boolean
    }) => string
    setupTopicsHeading: string
    setupTopicBound: (role: string, topic: string) => string
    setupTopicMissing: (role: string) => string
    setupTopicCreateButton: (role: string) => string
    setupTopicBindButton: (role: string) => string
    setupTopicCreateFailed: string
    setupTopicCreateForbidden: string
    setupTopicCreated: (role: string, topicName: string) => string
    setupTopicBindPending: (role: string) => string
    setupTopicBindCancelled: string
    setupTopicBindNotAvailable: string
    setupTopicBindRoleName: (role: 'purchase' | 'feedback' | 'reminders' | 'payments') => string
    setupTopicSuggestedName: (role: 'purchase' | 'feedback' | 'reminders' | 'payments') => string
    onlyTelegramAdminsUnsetup: string
    useUnsetupInGroup: string
    unsetupComplete: (householdName: string) => string
    unsetupNoop: string
    useBindPurchaseTopicInGroup: string
    purchaseTopicSaved: (householdName: string, threadId: string) => string
    useBindFeedbackTopicInGroup: string
    feedbackTopicSaved: (householdName: string, threadId: string) => string
    useBindRemindersTopicInGroup: string
    remindersTopicSaved: (householdName: string, threadId: string) => string
    useBindPaymentsTopicInGroup: string
    paymentsTopicSaved: (householdName: string, threadId: string) => string
    usePendingMembersInGroup: string
    useApproveMemberInGroup: string
    approveMemberUsage: string
    useInviteInGroup: string
    onlyInviteAdmins: string
    inviteUsage: string
    inviteTargetInvalid: string
    inviteAlreadyMember: (displayName: string, householdName: string) => string
    inviteAlreadyPending: (displayName: string, householdName: string) => string
    invitePrepared: (displayName: string, householdName: string) => string
    invitePreparedToast: (displayName: string) => string
    inviteJoinWrongUser: string
    inviteJoinExpired: string
    inviteJoinCompleted: (displayName: string, householdName: string) => string
    inviteJoinRequestSent: (displayName: string, householdName: string) => string
    approvedMember: (displayName: string, householdName: string) => string
    useButtonInGroup: string
    unableToIdentifySelectedMember: string
    approvedMemberToast: (displayName: string) => string
  }
  anonymousFeedback: {
    title: string
    cancelButton: string
    unableToStart: string
    prompt: string
    unableToIdentifyMessage: string
    notMember: string
    multipleHouseholds: string
    feedbackTopicMissing: string
    duplicate: string
    delivered: string
    savedButPostFailed: string
    nothingToCancel: string
    cancelled: string
    cancelledMessage: string
    useInPrivateChat: string
    useThisInPrivateChat: string
    tooShort: string
    tooLong: string
    cooldown: (retryDelay: string) => string
    dailyCap: (retryDelay: string) => string
    blocklisted: string
    submitFailed: string
    keepPromptSuffix: string
    retryNow: string
    retryInLessThanMinute: string
    retryIn: (parts: string) => string
    day: (count: number) => string
    hour: (count: number) => string
    minute: (count: number) => string
  }
  assistant: {
    unavailable: string
    noHousehold: string
    multipleHouseholds: string
    rateLimited: (retryDelay: string) => string
    retryInLessThanMinute: string
    retryIn: (parts: string) => string
    hour: (count: number) => string
    minute: (count: number) => string
    paymentProposal: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    paymentClarification: string
    paymentUnsupportedCurrency: string
    paymentNoBalance: string
    paymentConfirmButton: string
    paymentCancelButton: string
    paymentConfirmed: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    paymentCancelled: string
    paymentAlreadyHandled: string
    paymentUnavailable: string
  }
  finance: {
    useInGroup: string
    householdNotConfigured: string
    unableToIdentifySender: string
    notMember: string
    adminOnly: string
    cycleOpenUsage: string
    cycleOpened: (period: string, currency: string) => string
    cycleOpenFailed: (message: string) => string
    noCycleToClose: string
    cycleClosed: (period: string) => string
    cycleCloseFailed: (message: string) => string
    rentSetUsage: string
    rentNoPeriod: string
    rentSaved: (amount: string, currency: string, period: string) => string
    rentSaveFailed: (message: string) => string
    utilityAddUsage: string
    utilityNoOpenCycle: string
    utilityAdded: (name: string, amount: string, currency: string, period: string) => string
    utilityAddFailed: (message: string) => string
    paymentAddUsage: string
    paymentNoCycle: string
    paymentNoBalance: string
    paymentAdded: (
      kind: 'rent' | 'utilities',
      amount: string,
      currency: string,
      period: string
    ) => string
    paymentAddFailed: (message: string) => string
    noStatementCycle: string
    householdStatusTitle: (period: string) => string
    householdStatusDueDate: (dueDate: string) => string
    householdStatusChargesHeading: string
    householdStatusRentDirect: (amount: string, currency: string) => string
    householdStatusRentConverted: (
      sourceAmount: string,
      sourceCurrency: string,
      displayAmount: string,
      displayCurrency: string
    ) => string
    householdStatusUtilities: (amount: string, currency: string) => string
    householdStatusPurchases: (amount: string, currency: string) => string
    householdStatusSettlementHeading: string
    householdStatusSettlementBalance: (amount: string, currency: string) => string
    householdStatusSettlementPaid: (amount: string, currency: string) => string
    householdStatusSettlementRemaining: (amount: string, currency: string) => string
    householdStatusMembersHeading: string
    householdStatusMemberCompact: (
      displayName: string,
      remaining: string,
      currency: string
    ) => string
    householdStatusMemberDetailed: (
      displayName: string,
      remaining: string,
      balance: string,
      paid: string,
      currency: string
    ) => string
    statementTitle: (period: string) => string
    statementLine: (displayName: string, amount: string, currency: string) => string
    statementTotal: (amount: string, currency: string) => string
    statementFailed: (message: string) => string
  }
  reminders: {
    utilities: (period: string) => string
    rentWarning: (period: string) => string
    rentDue: (period: string) => string
  }
  purchase: {
    sharedPurchaseFallback: string
    processing: string
    proposal: (summary: string, participants: string | null) => string
    clarification: (question: string) => string
    clarificationMissingAmountAndCurrency: string
    clarificationMissingAmount: string
    clarificationMissingCurrency: string
    clarificationMissingItem: string
    clarificationLowConfidence: string
    participantsHeading: string
    participantIncluded: (displayName: string) => string
    participantExcluded: (displayName: string) => string
    participantToggleIncluded: (displayName: string) => string
    participantToggleExcluded: (displayName: string) => string
    confirmButton: string
    cancelButton: string
    confirmed: (summary: string) => string
    cancelled: (summary: string) => string
    confirmedToast: string
    cancelledToast: string
    alreadyConfirmed: string
    alreadyCancelled: string
    atLeastOneParticipant: string
    notYourProposal: string
    proposalUnavailable: string
    parseFailed: string
  }
  payments: {
    topicMissing: string
    balanceReply: (kind: 'rent' | 'utilities') => string
    recorded: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    proposal: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    clarification: string
    unsupportedCurrency: string
    noBalance: string
    breakdownBase: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    breakdownPurchaseBalance: (amount: string, currency: string) => string
    breakdownSuggestedTotal: (amount: string, currency: string, policy: string) => string
    breakdownRecordingAmount: (amount: string, currency: string) => string
    breakdownRemaining: (amount: string, currency: string) => string
    adjustmentPolicy: (policy: 'utilities' | 'rent' | 'separate') => string
    timingBeforeWindow: (
      kind: 'rent' | 'utilities',
      reminderDate: string,
      dueDate: string
    ) => string
    timingDueNow: (kind: 'rent' | 'utilities', dueDate: string) => string
    confirmButton: string
    cancelButton: string
    cancelled: string
    proposalUnavailable: string
    notYourProposal: string
    savedForReview: string
    duplicate: string
  }
}

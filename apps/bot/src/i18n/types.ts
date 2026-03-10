export type BotLocale = 'en' | 'ru'

export type TelegramCommandName =
  | 'help'
  | 'household_status'
  | 'anon'
  | 'cancel'
  | 'setup'
  | 'bind_purchase_topic'
  | 'bind_feedback_topic'
  | 'bind_reminders_topic'
  | 'bind_payments_topic'
  | 'payment_add'
  | 'pending_members'
  | 'approve_member'

export interface BotCommandDescriptions {
  help: string
  household_status: string
  anon: string
  cancel: string
  setup: string
  bind_purchase_topic: string
  bind_feedback_topic: string
  bind_reminders_topic: string
  bind_payments_topic: string
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
  bot: {
    householdStatusPending: string
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
    recorded: (summary: string) => string
    savedForReview: (summary: string) => string
    parseFailed: string
  }
  payments: {
    topicMissing: string
    recorded: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    savedForReview: string
    duplicate: string
  }
}

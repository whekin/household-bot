export type BotLocale = 'en' | 'ru'

export type TelegramCommandName =
  | 'start'
  | 'help'
  | 'settings'
  | 'home'
  | 'bill'
  | 'bill_full'
  | 'my_bill'
  | 'my_bill_full'
  | 'bill_json'
  | 'household_status'
  | 'balance'
  | 'utilities'
  | 'anon'
  | 'cancel'
  | 'setup'
  | 'unsetup'
  | 'bind'
  | 'join_link'
  | 'payment_add'
  | 'pending_members'
  | 'approve_member'
  | 'app'
  | 'dashboard'
  | 'keyboard'

export interface BotCommandDescriptions {
  start: string
  help: string
  settings: string
  home: string
  bill: string
  bill_full: string
  my_bill: string
  my_bill_full: string
  bill_json: string
  household_status: string
  balance: string
  utilities: string
  anon: string
  cancel: string
  setup: string
  unsetup: string
  bind: string
  join_link: string
  payment_add: string
  pending_members: string
  approve_member: string
  app: string
  dashboard: string
  keyboard: string
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
    introWithoutHome: string
    tasksHeading: string
    checkMyBill: string
    checkHouseholdStatus: string
    checkBalances: string
    recordPurchase: string
    recordPayment: string
    openDashboard: string
    setupHousehold: string
    manageMembers: string
    advancedHeading: string
    privateChatHeading: string
    groupHeading: string
    groupAdminsHeading: string
  }
  home: {
    title: string
    introPrivate: string
    introGroup: string
    myBillButton: string
    householdStatusButton: string
    balancesButton: string
    fullBillButton: string
    menuButton: string
    miniAppButton: string
    setupButton: string
    feedbackButton: string
    helpButton: string
    setupMenuTitle: string
    setupMenuBody: string
    feedbackMenuTitle: string
    feedbackMenuBody: string
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
    openMiniAppFromPrivateChat: string
    openMiniAppUnavailable: string
    joinHouseholdButton: string
    approveMemberButton: (displayName: string) => string
    telegramIdentityRequired: string
    invalidJoinLink: string
    joinLinkInvalidOrExpired: string
    alreadyActiveMember: (displayName: string) => string
    joinRequestSent: (householdName: string) => string
    setupSummary: (params: { householdName: string; created: boolean }) => string
    setupTopicsHeading: (configured: number, total: number) => string
    setupTopicBound: (role: string) => string
    setupTopicMissing: (role: string) => string
    setupTopicCreateButton: (role: string) => string
    setupTopicBindButton: (role: string) => string
    setupTopicCreateFailed: string
    setupTopicCreateForbidden: string
    setupTopicCreated: (role: string, topicName: string) => string
    setupTopicBindPending: string
    setupTopicBindCancelled: string
    setupTopicBindNotAvailable: string
    setupTopicBindRoleName: (
      role: 'chat' | 'purchase' | 'feedback' | 'reminders' | 'payments' | 'notifications'
    ) => string
    setupTopicSuggestedName: (
      role: 'chat' | 'purchase' | 'feedback' | 'reminders' | 'payments' | 'notifications'
    ) => string
    onlyTelegramAdminsUnsetup: string
    useUnsetupInGroup: string
    unsetupComplete: (householdName: string) => string
    unsetupNoop: string
    useBindInTopic: string
    topicAlreadyBound: (role: string) => string
    bindSelectRole: string
    topicBoundSuccess: (role: string, householdName: string) => string
    allRolesConfigured: string
    usePendingMembersInGroup: string
    useApproveMemberInGroup: string
    approveMemberUsage: string
    onlyInviteAdmins: string
    approvedMember: (displayName: string, householdName: string) => string
    useButtonInGroup: string
    unableToIdentifySelectedMember: string
    approvedMemberToast: (displayName: string) => string
    useJoinLinkInGroup: string
    joinLinkUnavailable: string
    joinLinkReady: (link: string, householdName: string) => string
  }
  keyboard: {
    dashboardButton: string
    enabled: string
    disabled: string
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
    noHousehold: string
    multipleHouseholds: string
    temporarilyUnavailable: string
    rateLimited: (retryDelay: string) => string
    retryInLessThanMinute: string
    retryIn: (parts: string) => string
    hour: (count: number) => string
    minute: (count: number) => string
    paymentProposal: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
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
    utilitiesTopicRequired: string
    utilitiesNotLinked: string
    chooseHouseholdForBalances: string
  }
  reminders: {
    utilities: (period: string) => string
    rentWarning: (period: string) => string
    rentDue: (period: string) => string
    guidedEntryButton: string
    copyTemplateButton: string
    openDashboardButton: string
    noActiveCategories: string
    startToast: string
    templateToast: string
    promptAmount: (categoryName: string, currency: string, remainingCount: number) => string
    invalidAmount: (categoryName: string, currency: string) => string
    templateIntro: (currency: string) => string
    templateInstruction: string
    templateInvalid: string
    summaryTitle: (period: string) => string
    summaryLine: (categoryName: string, amount: string, currency: string) => string
    confirmPrompt: string
    confirmButton: string
    cancelButton: string
    cancelled: string
    saved: (count: number, period: string) => string
    paymentInstructionSent: string
    proposalUnavailable: string
    onlyOriginalSender: string
    detailsButton: string
    hideDetailsButton: string
    paidButton: string
    paidUtilitiesButton: string
    closeUnpaidButton: string
    confirmCloseButton: string
    fullyPaid: (kind: 'rent' | 'utilities', month: string) => string
    alreadyPaid: string
    notMember: string
    adminOnly: string
    paymentRecordedToast: string
    reminderUnavailable: string
    noRentDestinations: string
    everyonePaid: string
    noUtilityPlan: string
  }
  purchase: {
    sharedPurchaseFallback: string
    clarificationPhotoOnly: string
    proposal: (
      summary: string,
      payer: string | null,
      calculationNote: string | null,
      participants: string | null
    ) => string
    calculatedAmountNote: (explanation: string | null) => string
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
    payerHeading: string
    payerSelected: (displayName: string) => string
    payerQuestion: string
    payerFallbackQuestion: string
    payerButton: (displayName: string) => string
    payerSelectedToast: (displayName: string) => string
    confirmButton: string
    calculatedConfirmButton: string
    calculatedFixAmountButton: string
    cancelButton: string
    calculatedFixAmountPrompt: string
    calculatedFixAmountRequestedToast: string
    calculatedFixAmountAlreadyRequested: string
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
  agent: {
    confirmButton: string
    cancelButton: string
    actionPrompt: (summary: string) => string
    actionConfirmed: (summary: string) => string
    actionCancelled: string
    actionUnavailable: string
    notYourAction: string
    actionFailed: string
    pendingProposalCancelled: string
    nothingToCancel: string
    summarizeUpdatePayment: (
      displayName: string,
      kind: 'rent' | 'utilities',
      amount: string,
      currency: string
    ) => string
    summarizeDeletePayment: (
      displayName: string,
      kind: 'rent' | 'utilities',
      amount: string,
      currency: string
    ) => string
    summarizeUpdatePurchase: (description: string, amount: string, currency: string) => string
    summarizeDeletePurchase: (description: string, amount: string, currency: string) => string
    summarizeSetPurchaseParticipants: (description: string, names: string) => string
  }
  payments: {
    topicMissing: string
    balanceReply: (kind: 'rent' | 'utilities') => string
    recorded: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    recordedReported: (
      displayName: string,
      kind: 'rent' | 'utilities',
      amount: string,
      currency: string
    ) => string
    proposal: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    proposalReported: (
      displayName: string,
      kind: 'rent' | 'utilities',
      amount: string,
      currency: string
    ) => string
    clarification: string
    unsupportedCurrency: string
    noBalance: string
    alreadySettled: (kind: 'rent' | 'utilities', displayName?: string | null) => string
    purchaseRedirect: string
    breakdownBase: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
    breakdownPlannedBase: (kind: 'rent' | 'utilities', amount: string, currency: string) => string
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
    confirmSelectedButton: string
    cancelButton: string
    multiProposal: (kind: 'rent' | 'utilities', period: string) => string
    multiMemberLine: (
      displayName: string,
      paymentStatus: 'paid' | 'unpaid',
      selected: boolean
    ) => string
    multiRecorded: (kind: 'rent' | 'utilities', names: string) => string
    multiAlreadyPaid: (kind: 'rent' | 'utilities', names: string) => string
    multiPartiallyRecorded: (
      kind: 'rent' | 'utilities',
      recordedNames: string,
      failedNames: string
    ) => string
    fullyPaid: (kind: 'rent' | 'utilities', period: string) => string
    noMembersSelected: string
    cancelled: string
    proposalUnavailable: string
    notYourProposal: string
    multiNotYourProposal: string
    savedForReview: string
    duplicate: string
  }
}

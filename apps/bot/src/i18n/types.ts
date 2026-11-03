export type BotLocale = 'en' | 'ru'

export type TelegramCommandName =
  | 'start'
  | 'help'
  | 'home'
  | 'bill'
  | 'app'
  | 'anon'
  | 'cancel'
  | 'setup'
  | 'bind'
  | 'invite'

export type BotCommandDescriptions = Record<TelegramCommandName, string>

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
    purchases: string
    payments: string
    bill: string
    app: string
    setup: string
    commandsHeading: string
  }
  home: {
    title: string
    introPrivate: string
    introGroup: string
    myBillButton: string
    householdStatusButton: string
    balancesButton: string
    fullBillButton: string
    routinesButton: string
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
  setup: {
    onlyTelegramAdmins: string
    useSetupInGroup: string
    onlyTelegramAdminsBindTopics: string
    householdNotConfigured: string
    useCommandInTopic: string
    onlyHouseholdAdmins: string
    pendingNotFound: string
    inviteHeading: (householdName: string) => string
    pendingMembersHeading: string
    pendingMembersEmpty: string
    pendingMemberLine: (member: PendingMemberSummary) => string
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
    setupTopicCreateFailed: string
    setupTopicCreateForbidden: string
    setupTopicCreated: (role: string, topicName: string) => string
    setupTopicBindRoleName: (
      role: 'chat' | 'purchase' | 'feedback' | 'reminders' | 'payments' | 'notifications'
    ) => string
    setupTopicSuggestedName: (
      role: 'chat' | 'purchase' | 'feedback' | 'reminders' | 'payments' | 'notifications'
    ) => string
    bindSelectRole: string
    topicBoundSuccess: (role: string, householdName: string) => string
    allRolesConfigured: string
    onlyInviteAdmins: string
    approvedMember: (displayName: string, householdName: string) => string
    useButtonInGroup: string
    unableToIdentifySelectedMember: string
    approvedMemberToast: (displayName: string) => string
    joinLinkUnavailable: string
    useInviteInGroup: string
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
  }
  finance: {
    useInGroup: string
    householdNotConfigured: string
    unableToIdentifySender: string
    notMember: string
  }
  reminders: {
    utilities: (period: string) => string
    rentWarning: (period: string) => string
    rentDue: (period: string) => string
    openDashboardButton: string
    invalidAmount: (categoryName: string, currency: string) => string
    templateIntro: (currency: string) => string
    templateInvalid: string
    summaryLine: (categoryName: string, amount: string, currency: string) => string
    confirmButton: string
    cancelButton: string
    cancelled: string
    saved: (count: number, period: string) => string
    paymentInstructionSent: string
    proposalUnavailable: string
    paidButton: string
    paidUtilitiesButton: string
    fullyPaid: (kind: 'rent' | 'utilities', month: string) => string
    alreadyPaid: string
    notMember: string
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
    summary: (description: string, amount: string) => string
    savedCardHeadline: (summary: string) => string
    participantBalanceChange: (displayName: string, change: string) => string
    participantPayerWithoutShare: (displayName: string, change: string) => string
    participantExcluded: (displayName: string) => string
    participantToggleIncluded: (displayName: string) => string
    participantToggleExcluded: (displayName: string) => string
    splitEqualLine: (participantCount: number, perHead: string | null) => string
    splitCustomLine: string
    payerLine: (displayName: string) => string
    payerSplitLine: (displayName: string, split: string) => string
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
    removed: string
    confirmedToast: string
    cancelledToast: string
    alreadyConfirmed: string
    alreadyCancelled: string
    atLeastOneParticipant: string
    notYourProposal: string
    participantChangeForbidden: string
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
    summarizeSetPeriodRent: (amount: string, currency: string, periods: readonly string[]) => string
    summarizeSetHouseholdFact: (
      title: string,
      body: string | null,
      previousBody: string | null
    ) => string
    summarizeDeleteHouseholdFact: (title: string) => string
  }
  payments: {
    recorded: (
      kind: 'rent' | 'utilities',
      amount: string,
      currency: string,
      period: string | null
    ) => string
    recordedReported: (
      displayName: string,
      kind: 'rent' | 'utilities',
      amount: string,
      currency: string,
      period: string | null
    ) => string
    proposal: (input: {
      kind: 'rent' | 'utilities'
      amount: string
      currency: string
      period: string | null
      displayName: string | null
      billName: string | null
    }) => string
    clarification: string
    unsupportedCurrency: string
    alreadySettled: (kind: 'rent' | 'utilities', displayName?: string | null) => string
    settledPeriod: (
      kind: 'rent' | 'utilities',
      period: string,
      askPeriod: boolean,
      displayName?: string | null
    ) => string
    breakdownHeading: string
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
    balanceUpdatePendingReminder: string
    balanceUpdatePending: string
    retryBalanceButton: string
    confirmSelectedButton: string
    cancelButton: string
    multiProposal: (kind: 'rent' | 'utilities', period: string) => string
    multiMemberLine: (
      displayName: string,
      paymentStatus: 'paid' | 'unpaid',
      selected: boolean
    ) => string
    multiMemberButton: (displayName: string, selected: boolean) => string
    multiRecorded: (kind: 'rent' | 'utilities', period: string, names: string) => string
    multiAlreadyPaid: (names: string) => string
    multiPartiallyRecorded: (recordedNames: string | null, failedNames: string | null) => string
    noMembersSelected: string
    cancelled: string
    proposalUnavailable: string
    notYourProposal: string
    multiNotYourProposal: string
    duplicate: string
  }
}

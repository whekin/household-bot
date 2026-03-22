import type { BotTranslationCatalog } from '../types'

export const enBotTranslations: BotTranslationCatalog = {
  localeName: 'English',
  commands: {
    help: 'Show command list',
    household_status: 'Show current household status',
    anon: 'Send anonymous household feedback',
    cancel: 'Cancel the current prompt',
    setup: 'Register this group as a household',
    unsetup: 'Reset topic setup for this group',
    bind: 'Bind current topic to a specific role',
    join_link: 'Get a shareable link for new members to join',
    payment_add: 'Record your rent or utilities payment',
    pending_members: 'List pending household join requests',
    approve_member: 'Approve a pending household member',
    app: 'Open the Kojori mini app',
    dashboard: 'Open the household dashboard',
    keyboard: 'Toggle persistent dashboard button'
  },
  help: {
    intro: 'Household bot is live.',
    privateChatHeading: 'Private chat:',
    groupHeading: 'Group chat:',
    groupAdminsHeading: 'Group admins:'
  },
  common: {
    unableToIdentifySender: 'Unable to identify sender for this command.',
    useHelp: 'Send /help to see available commands.'
  },
  setup: {
    onlyTelegramAdmins: 'Only Telegram group admins can run /setup.',
    useSetupInGroup: 'Use /setup inside the household group.',
    onlyTelegramAdminsBindTopics: 'Only Telegram group admins can bind household topics.',
    householdNotConfigured: 'Household is not configured for this chat yet. Run /setup first.',
    useCommandInTopic: 'Run this command inside the target topic thread.',
    onlyHouseholdAdmins: 'Only household admins can manage pending members.',
    pendingNotFound: 'Pending member not found. Use /pending_members to inspect the queue.',
    pendingMembersHeading: (householdName) => `Pending members for ${householdName}:`,
    pendingMembersHint: 'Tap a button below to approve, or use /approve_member <telegram_user_id>.',
    pendingMembersEmpty: (householdName) => `No pending members for ${householdName}.`,
    pendingMemberLine: (member, index) =>
      `${index + 1}. ${member.displayName} (${member.telegramUserId})${member.username ? ` @${member.username}` : ''}`,
    openMiniAppButton: 'Open mini app',
    openMiniAppFromPrivateChat: 'Open the mini app from the button below.',
    openMiniAppUnavailable: 'The mini app is not configured right now.',
    joinHouseholdButton: 'Join household',
    approveMemberButton: (displayName) => `Approve ${displayName}`,
    telegramIdentityRequired: 'Telegram user identity is required to join a household.',
    invalidJoinLink: 'Invalid household invite link.',
    joinLinkInvalidOrExpired: 'This household invite link is invalid or expired.',
    alreadyActiveMember: (displayName) =>
      `You are already an active member. Open the mini app to view ${displayName}.`,
    joinRequestSent: (householdName) =>
      `Join request sent for ${householdName}. Wait for a household admin to confirm you.`,
    setupSummary: ({ householdName, created }) =>
      `🏡 ${created ? 'New household!' : 'Household active!'} **${householdName}** is ready.\n\n` +
      `I've set up the basic configuration. Now, let's organize your communication by linking topics for specific roles.`,
    setupTopicsHeading: (configured, total) =>
      `Current setup progress: ${configured}/${total}\n\n` +
      `Tap buttons below to create new topics automatically, or go to any existing topic and use /bind to link it manually.`,
    setupTopicBound: (role) => `✅ ${role}`,
    setupTopicMissing: (role) => `⚪ ${role}`,
    setupTopicCreateButton: (role) => `Create ${role}`,
    setupTopicBindButton: (role) => `Bind ${role}`,
    useBindInTopic: 'Run /bind inside a topic to link it to a role.',
    topicAlreadyBound: (role) => `This topic is already linked to ${role}.`,
    bindSelectRole: 'Link this topic to:',
    topicBoundSuccess: (role, householdName) =>
      `Successfully linked as ${role} for ${householdName}.`,
    allRolesConfigured: 'All topic roles are already configured.',
    setupTopicCreateFailed:
      'I could not create that topic. Check bot admin permissions and forum settings.',
    setupTopicCreateForbidden:
      'I need permission to manage topics in this group before I can create one automatically.',
    setupTopicCreated: (role, topicName) => `${role} topic created and bound: ${topicName}.`,
    setupTopicBindPending: '',
    setupTopicBindCancelled: 'Topic binding mode cleared.',
    setupTopicBindNotAvailable: 'That topic-binding action is no longer available.',
    setupTopicBindRoleName: (role) => {
      switch (role) {
        case 'chat':
          return 'Discussions'
        case 'purchase':
          return 'Purchases'
        case 'feedback':
          return 'Feedback'
        case 'reminders':
          return 'Reminders'
        case 'payments':
          return 'Payments'
      }
    },
    setupTopicSuggestedName: (role) => {
      switch (role) {
        case 'chat':
          return 'Chat'
        case 'purchase':
          return 'Shared purchases'
        case 'feedback':
          return 'Anonymous feedback'
        case 'reminders':
          return 'Reminders'
        case 'payments':
          return 'Payments'
      }
    },
    onlyTelegramAdminsUnsetup: 'Only Telegram group admins can run /unsetup.',
    useUnsetupInGroup: 'Use /unsetup inside the household group.',
    unsetupComplete: (householdName) =>
      `Setup state reset for ${householdName}. Run /setup again to configure topics from scratch.`,
    unsetupNoop: 'Nothing to reset for this group yet. Run /setup when you are ready.',
    usePendingMembersInGroup: 'Use /pending_members inside the household group.',
    useApproveMemberInGroup: 'Use /approve_member inside the household group.',
    approveMemberUsage: 'Usage: /approve_member <telegram_user_id>',
    onlyInviteAdmins: 'Only Telegram group admins or household admins can invite members.',
    approvedMember: (displayName, householdName) =>
      `Approved ${displayName} as an active member of ${householdName}.`,
    useButtonInGroup: 'Use this button in the household group.',
    unableToIdentifySelectedMember: 'Unable to identify the selected member.',
    approvedMemberToast: (displayName) => `Approved ${displayName}.`,
    useJoinLinkInGroup: 'Use /join_link inside the household group.',
    joinLinkUnavailable: 'Could not generate join link.',
    joinLinkReady: (link, householdName) =>
      `Join link for ${householdName}:\n${link}\n\nAnyone with this link can join the household. Share it carefully.`
  },
  keyboard: {
    dashboardButton: '🏡 Dashboard',
    enabled: 'Persistent dashboard button enabled.',
    disabled: 'Persistent dashboard button disabled.'
  },
  anonymousFeedback: {
    title: 'Anonymous household note',
    cancelButton: 'Cancel',
    unableToStart: 'Unable to start anonymous feedback right now.',
    prompt: 'Send me the anonymous message in your next reply, or tap Cancel.',
    unableToIdentifyMessage: 'Unable to identify this message for anonymous feedback.',
    notMember: 'You are not a member of this household.',
    multipleHouseholds:
      'You belong to multiple households. Open the target household from its group until household selection is added.',
    feedbackTopicMissing:
      'Anonymous feedback is not configured for your household yet. Ask an admin to run /setup and create a feedback topic.',
    duplicate: 'This anonymous feedback message was already processed.',
    delivered: 'Anonymous feedback delivered.',
    savedButPostFailed: 'Anonymous feedback was saved, but posting failed. Try again later.',
    nothingToCancel: 'Nothing to cancel right now.',
    cancelled: 'Cancelled.',
    cancelledMessage: 'Anonymous feedback cancelled.',
    useInPrivateChat: 'Use /anon in a private chat with the bot.',
    useThisInPrivateChat: 'Use this in a private chat with the bot.',
    tooShort: 'Anonymous feedback is too short. Add a little more detail.',
    tooLong: 'Anonymous feedback is too long. Keep it under 500 characters.',
    cooldown: (retryDelay) =>
      `Anonymous feedback cooldown is active. You can send the next message ${retryDelay}.`,
    dailyCap: (retryDelay) =>
      `Daily anonymous feedback limit reached. You can send the next message ${retryDelay}.`,
    blocklisted: 'Message rejected by moderation. Rewrite it in calmer, non-abusive language.',
    submitFailed: 'Anonymous feedback could not be submitted.',
    keepPromptSuffix: 'Send a revised message, or tap Cancel.',
    retryNow: 'now',
    retryInLessThanMinute: 'in less than a minute',
    retryIn: (parts) => `in ${parts}`,
    day: (count) => `${count} day${count === 1 ? '' : 's'}`,
    hour: (count) => `${count} hour${count === 1 ? '' : 's'}`,
    minute: (count) => `${count} minute${count === 1 ? '' : 's'}`
  },
  assistant: {
    unavailable: 'The assistant is temporarily unavailable. Try again in a moment.',
    noHousehold:
      'I can help after your Telegram account is linked to a household. Open the household group and complete the join flow first.',
    multipleHouseholds:
      'You belong to multiple households. Open the target household from its group until direct household selection is added.',
    rateLimited: (retryDelay) => `Assistant rate limit reached. Try again ${retryDelay}.`,
    retryInLessThanMinute: 'in less than a minute',
    retryIn: (parts) => `in ${parts}`,
    hour: (count) => `${count} hour${count === 1 ? '' : 's'}`,
    minute: (count) => `${count} minute${count === 1 ? '' : 's'}`,
    paymentProposal: (kind, amount, currency) =>
      `I can record this ${kind === 'rent' ? 'rent' : 'utilities'} payment: ${amount} ${currency}. Confirm or cancel below.`,
    paymentClarification:
      'I can help record that payment, but I need a clearer message. Mention whether it was rent or utilities, and include the amount if you did not pay the full current balance.',
    paymentUnsupportedCurrency:
      'I can only auto-confirm payment proposals in the current household billing currency for now. Use /payment_add if you need a different currency.',
    paymentNoBalance: 'There is no payable balance to confirm for that payment type right now.',
    paymentConfirmButton: 'Confirm payment',
    paymentCancelButton: 'Cancel',
    paymentConfirmed: (kind, amount, currency) =>
      `Recorded ${kind === 'rent' ? 'rent' : 'utilities'} payment: ${amount} ${currency}`,
    paymentCancelled: 'Payment proposal cancelled.',
    paymentAlreadyHandled: 'That payment proposal was already handled.',
    paymentUnavailable: 'That payment proposal is no longer available.'
  },
  finance: {
    useInGroup: 'Use this command inside a household group.',
    householdNotConfigured: 'Household is not configured for this chat yet. Run /setup first.',
    unableToIdentifySender: 'Unable to identify sender for this command.',
    notMember: 'You are not a member of this household.',
    adminOnly: 'Only household admins can use this command.',
    cycleOpenUsage: 'Usage: /cycle_open <YYYY-MM> [USD|GEL]',
    cycleOpened: (period, currency) => `Cycle opened: ${period} (${currency})`,
    cycleOpenFailed: (message) => `Failed to open cycle: ${message}`,
    noCycleToClose: 'No cycle found to close.',
    cycleClosed: (period) => `Cycle closed: ${period}`,
    cycleCloseFailed: (message) => `Failed to close cycle: ${message}`,
    rentSetUsage: 'Usage: /rent_set <amount> [USD|GEL] [YYYY-MM]',
    rentNoPeriod: 'No period provided and no open cycle found.',
    rentSaved: (amount, currency, period) =>
      `Rent rule saved: ${amount} ${currency} starting ${period}`,
    rentSaveFailed: (message) => `Failed to save rent rule: ${message}`,
    utilityAddUsage: 'Usage: /utility_add <name> <amount> [USD|GEL]',
    utilityNoOpenCycle: 'No open cycle found. Use /cycle_open first.',
    utilityAdded: (name, amount, currency, period) =>
      `Utility bill added: ${name} ${amount} ${currency} for ${period}`,
    utilityAddFailed: (message) => `Failed to add utility bill: ${message}`,
    paymentAddUsage: 'Usage: /payment_add <rent|utilities> [amount] [USD|GEL]',
    paymentNoCycle: 'No billing cycle is ready yet.',
    paymentNoBalance: 'There is no payable balance for that payment type right now.',
    paymentAdded: (kind, amount, currency, period) =>
      `Payment recorded: ${kind === 'rent' ? 'rent' : 'utilities'} ${amount} ${currency} for ${period}`,
    paymentAddFailed: (message) => `Failed to record payment: ${message}`,
    noStatementCycle: 'No cycle found for statement.',
    householdStatusTitle: (period) => `Household status for ${period}`,
    householdStatusDueDate: (dueDate) => `Rent due by ${dueDate}`,
    householdStatusChargesHeading: 'Charges',
    householdStatusRentDirect: (amount, currency) => `Rent: ${amount} ${currency}`,
    householdStatusRentConverted: (sourceAmount, sourceCurrency, displayAmount, displayCurrency) =>
      `Rent: ${sourceAmount} ${sourceCurrency} (~${displayAmount} ${displayCurrency})`,
    householdStatusUtilities: (amount, currency) => `Utilities: ${amount} ${currency}`,
    householdStatusPurchases: (amount, currency) => `Shared purchases: ${amount} ${currency}`,
    householdStatusSettlementHeading: 'Settlement',
    householdStatusSettlementBalance: (amount, currency) => `Gross balance: ${amount} ${currency}`,
    householdStatusSettlementPaid: (amount, currency) => `Paid so far: ${amount} ${currency}`,
    householdStatusSettlementRemaining: (amount, currency) => `Remaining: ${amount} ${currency}`,
    householdStatusMembersHeading: 'Members',
    householdStatusMemberCompact: (displayName, remaining, currency) =>
      `- ${displayName}: remaining ${remaining} ${currency}`,
    householdStatusMemberDetailed: (displayName, remaining, balance, paid, currency) =>
      `- ${displayName}: remaining ${remaining} ${currency} (${balance} balance, ${paid} paid)`,
    statementTitle: (period) => `Statement for ${period}`,
    statementLine: (displayName, amount, currency) => `- ${displayName}: ${amount} ${currency}`,
    statementTotal: (amount, currency) => `Total: ${amount} ${currency}`,
    statementFailed: (message) => `Failed to generate statement: ${message}`
  },
  reminders: {
    utilities: (period) => `Utilities reminder for ${period}`,
    rentWarning: (period) => `Rent reminder for ${period}: payment is coming up soon.`,
    rentDue: (period) => `Rent is due for period ${period}. Request sent to the reminders topic.`,
    guidedEntryButton: 'Guided entry',
    copyTemplateButton: 'Copy template',
    openDashboardButton: 'Open dashboard',
    noActiveCategories:
      'This household has no active utility categories yet. Use the dashboard to add them first.',
    startToast: 'Guided utility entry started.',
    templateToast: 'Utility template sent.',
    promptAmount: (categoryName, currency, remainingCount) =>
      `Reply with the amount for ${categoryName} in ${currency}. Send 0 or "skip" to leave it out.${remainingCount > 0 ? ` ${remainingCount} categories remain after this.` : ''}`,
    invalidAmount: (categoryName, currency) =>
      `I could not read that amount for ${categoryName}. Reply with a number in ${currency}, or send 0 / "skip".`,
    templateIntro: (currency) =>
      `Fill in the utility amounts below in ${currency}, then send the completed message back in this topic.`,
    templateInstruction:
      'For any category you do not want to add, leave it blank, remove the line entirely, or send 0 / "skip".',
    templateInvalid:
      'I could not read any utility amounts from that template. Send the filled template back with at least one amount.',
    summaryTitle: (period) => `Utility charges for ${period}`,
    summaryLine: (categoryName, amount, currency) => `- ${categoryName}: ${amount} ${currency}`,
    confirmPrompt: 'Confirm or cancel below.',
    confirmButton: 'Save utility charges',
    cancelButton: 'Cancel',
    cancelled: 'Utility submission cancelled.',
    saved: (count, period) =>
      `Saved ${count} utility ${count === 1 ? 'charge' : 'charges'} for ${period}.`,
    proposalUnavailable: 'This utility submission is no longer available.',
    onlyOriginalSender: 'Only the person who started this utility submission can confirm it.'
  },
  purchase: {
    sharedPurchaseFallback: 'shared purchase',
    processing: 'Checking that purchase...',
    proposal: (
      summary: string,
      payer: string | null,
      calculationNote: string | null,
      participants: string | null
    ) =>
      `I think this shared purchase was: ${summary}.${payer ? `\n${payer}` : ''}${calculationNote ? `\n${calculationNote}` : ''}${participants ? `\n\n${participants}` : ''}\nConfirm or cancel below.`,
    calculatedAmountNote: (explanation: string | null) =>
      explanation
        ? `I calculated the total as ${explanation}. Is that right?`
        : 'I calculated the total for this purchase. Is that right?',
    clarification: (question) => question,
    clarificationMissingAmountAndCurrency:
      'What amount and currency should I record for this shared purchase?',
    clarificationMissingAmount: 'What amount should I record for this shared purchase?',
    clarificationMissingCurrency: 'Which currency was this purchase in?',
    clarificationMissingItem: 'What exactly was purchased?',
    clarificationLowConfidence:
      'I am not confident I understood this. Please restate the shared purchase with item, amount, and currency.',
    participantsHeading: 'Participants:',
    participantIncluded: (displayName) => `- ${displayName}`,
    participantExcluded: (displayName) => `- ${displayName} (excluded)`,
    participantToggleIncluded: (displayName) => `✅ ${displayName}`,
    participantToggleExcluded: (displayName) => `⬜ ${displayName}`,
    payerHeading: 'Paid by:',
    payerSelected: (displayName) => `Paid by: ${displayName}`,
    payerQuestion: 'Who actually bought this?',
    payerFallbackQuestion: 'I could not tell who bought this. Pick the payer below.',
    payerButton: (displayName) => `${displayName} paid`,
    payerSelectedToast: (displayName) => `Set payer to ${displayName}.`,
    confirmButton: 'Confirm',
    calculatedConfirmButton: 'Looks right',
    calculatedFixAmountButton: 'Fix amount',
    cancelButton: 'Cancel',
    calculatedFixAmountPrompt:
      'Reply with the corrected total and currency in this topic, and I will re-check the purchase.',
    calculatedFixAmountRequestedToast: 'Reply with the corrected total.',
    calculatedFixAmountAlreadyRequested: 'Waiting for the corrected total.',
    confirmed: (summary) => `Purchase confirmed: ${summary}`,
    cancelled: (summary) => `Purchase proposal cancelled: ${summary}`,
    confirmedToast: 'Purchase confirmed.',
    cancelledToast: 'Purchase cancelled.',
    alreadyConfirmed: 'This purchase was already confirmed.',
    alreadyCancelled: 'This purchase was already cancelled.',
    atLeastOneParticipant: 'Keep at least one participant in the purchase split.',
    notYourProposal: 'Only the original sender can confirm or cancel this purchase.',
    proposalUnavailable: 'This purchase proposal is no longer available.',
    parseFailed:
      "I couldn't understand this as a shared purchase yet. Please restate it with item, amount, and currency."
  },
  payments: {
    topicMissing:
      'Payments topic is not configured for this household yet. Ask an admin to run /setup and create a payments topic.',
    balanceReply: (kind) =>
      kind === 'rent' ? 'Current rent payment guidance:' : 'Current utilities payment guidance:',
    proposal: (kind, amount, currency) =>
      `I can record this ${kind === 'rent' ? 'rent' : 'utilities'} payment: ${amount} ${currency}. Confirm or cancel below.`,
    clarification:
      'I could not confirm this payment yet. Please clarify whether this was rent or utilities and include the amount/currency if needed.',
    unsupportedCurrency:
      'I can only record payments in the household settlement currency for this topic right now.',
    noBalance: 'There is no payable balance for that payment type right now.',
    breakdownBase: (kind, amount, currency) =>
      `${kind === 'rent' ? 'Rent due' : 'Utilities due'}: ${amount} ${currency}`,
    breakdownPurchaseBalance: (amount, currency) => `Purchase balance: ${amount} ${currency}`,
    breakdownSuggestedTotal: (amount, currency, policy) =>
      `Suggested payment under ${policy}: ${amount} ${currency}`,
    breakdownRecordingAmount: (amount, currency) =>
      `Amount from your message: ${amount} ${currency}`,
    breakdownRemaining: (amount, currency) => `Total remaining balance: ${amount} ${currency}`,
    adjustmentPolicy: (policy) =>
      policy === 'utilities'
        ? 'utilities adjustment'
        : policy === 'rent'
          ? 'rent adjustment'
          : 'separate purchase settlement',
    timingBeforeWindow: (kind, reminderDate, dueDate) =>
      `${kind === 'rent' ? 'Rent' : 'Utilities'} are not due yet. Next reminder: ${reminderDate}. Due date: ${dueDate}.`,
    timingDueNow: (kind, dueDate) =>
      `${kind === 'rent' ? 'Rent' : 'Utilities'} are due now. Due date: ${dueDate}.`,
    confirmButton: 'Confirm payment',
    cancelButton: 'Cancel',
    recorded: (kind, amount, currency) =>
      `Recorded ${kind === 'rent' ? 'rent' : 'utilities'} payment: ${amount} ${currency}`,
    cancelled: 'Payment proposal cancelled.',
    proposalUnavailable: 'This payment proposal is no longer available.',
    notYourProposal: 'Only the original sender can confirm or cancel this payment.',
    savedForReview: 'Saved this payment confirmation for review.',
    duplicate: 'This payment confirmation was already processed.'
  }
}

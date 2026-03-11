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
    bind_purchase_topic: 'Bind the current topic as purchases',
    bind_feedback_topic: 'Bind the current topic as feedback',
    bind_reminders_topic: 'Bind the current topic as reminders',
    bind_payments_topic: 'Bind the current topic as payments',
    invite: 'Invite the replied user into this household',
    payment_add: 'Record your rent or utilities payment',
    pending_members: 'List pending household join requests',
    approve_member: 'Approve a pending household member'
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
    setupSummary: ({ householdName, telegramChatId, created }) =>
      [
        `Household ${created ? 'created' : 'already registered'}: ${householdName}`,
        `Chat ID: ${telegramChatId}`,
        'Use the buttons below to finish topic setup. For an existing topic, tap Bind and then send any message inside that topic.',
        'Members should open the bot chat from the button below and confirm the join request there.'
      ].join('\n'),
    setupTopicsHeading: 'Topic setup:',
    setupTopicBound: (role, topic) => `- ${role}: bound to ${topic}`,
    setupTopicMissing: (role) => `- ${role}: not configured`,
    setupTopicCreateButton: (role) => `Create ${role} topic`,
    setupTopicBindButton: (role) => `Bind ${role} topic`,
    setupTopicCreateFailed:
      'I could not create that topic. Check bot admin permissions and forum settings.',
    setupTopicCreateForbidden:
      'I need permission to manage topics in this group before I can create one automatically.',
    setupTopicCreated: (role, topicName) => `${role} topic created and bound: ${topicName}.`,
    setupTopicBindPending: (role) =>
      `Binding mode is on for ${role}. Open the target topic and send any message there within 10 minutes.`,
    setupTopicBindCancelled: 'Topic binding mode cleared.',
    setupTopicBindNotAvailable: 'That topic-binding action is no longer available.',
    setupTopicBindRoleName: (role) => {
      switch (role) {
        case 'purchase':
          return 'purchases'
        case 'feedback':
          return 'feedback'
        case 'reminders':
          return 'reminders'
        case 'payments':
          return 'payments'
      }
    },
    setupTopicSuggestedName: (role) => {
      switch (role) {
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
      `Setup state reset for ${householdName}. Run /setup again to bind topics from scratch.`,
    unsetupNoop: 'Nothing to reset for this group yet. Run /setup when you are ready.',
    useBindPurchaseTopicInGroup: 'Use /bind_purchase_topic inside the household group topic.',
    purchaseTopicSaved: (householdName, threadId) =>
      `Purchase topic saved for ${householdName} (thread ${threadId}).`,
    useBindFeedbackTopicInGroup: 'Use /bind_feedback_topic inside the household group topic.',
    feedbackTopicSaved: (householdName, threadId) =>
      `Feedback topic saved for ${householdName} (thread ${threadId}).`,
    useBindRemindersTopicInGroup: 'Use /bind_reminders_topic inside the household group topic.',
    remindersTopicSaved: (householdName, threadId) =>
      `Reminders topic saved for ${householdName} (thread ${threadId}).`,
    useBindPaymentsTopicInGroup: 'Use /bind_payments_topic inside the household group topic.',
    paymentsTopicSaved: (householdName, threadId) =>
      `Payments topic saved for ${householdName} (thread ${threadId}).`,
    usePendingMembersInGroup: 'Use /pending_members inside the household group.',
    useApproveMemberInGroup: 'Use /approve_member inside the household group.',
    approveMemberUsage: 'Usage: /approve_member <telegram_user_id>',
    useInviteInGroup: 'Use /invite as a reply inside the household group.',
    onlyInviteAdmins: 'Only Telegram group admins or household admins can invite members.',
    inviteUsage: 'Reply to a real user message with /invite.',
    inviteTargetInvalid: 'I can only prepare invites for real group members.',
    inviteAlreadyMember: (displayName, householdName) =>
      `${displayName} is already an active member of ${householdName}.`,
    inviteAlreadyPending: (displayName, householdName) =>
      `${displayName} already has a pending join request for ${householdName}.`,
    invitePrepared: (displayName, householdName) =>
      `Invitation prepared for ${displayName}. Tap below to join ${householdName}.`,
    invitePreparedToast: (displayName) => `Invite prepared for ${displayName}.`,
    inviteJoinWrongUser: 'This invite is for a different Telegram user.',
    inviteJoinExpired: 'This invite is no longer available.',
    inviteJoinCompleted: (displayName, householdName) =>
      `${displayName} completed the join flow for ${householdName}.`,
    inviteJoinRequestSent: (displayName, householdName) =>
      `${displayName} sent a join request for ${householdName}.`,
    approvedMember: (displayName, householdName) =>
      `Approved ${displayName} as an active member of ${householdName}.`,
    useButtonInGroup: 'Use this button in the household group.',
    unableToIdentifySelectedMember: 'Unable to identify the selected member.',
    approvedMemberToast: (displayName) => `Approved ${displayName}.`
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
      'Anonymous feedback is not configured for your household yet. Ask an admin to run /bind_feedback_topic.',
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
    rentDue: (period) => `Rent due reminder for ${period}: please settle payment today.`,
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
    templateInstruction: 'Use 0 or skip for any category you want to leave empty.',
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
    proposal: (summary, participants) =>
      `I think this shared purchase was: ${summary}.${participants ? `\n\n${participants}` : ''}\nConfirm or cancel below.`,
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
    confirmButton: 'Confirm',
    cancelButton: 'Cancel',
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
      'Payments topic is not configured for this household yet. Ask an admin to run /bind_payments_topic.',
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

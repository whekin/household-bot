import type { BotTranslationCatalog } from '../types'

export const enBotTranslations: BotTranslationCatalog = {
  localeName: 'English',
  commands: {
    help: 'Show command list',
    household_status: 'Show current household status',
    anon: 'Send anonymous household feedback',
    cancel: 'Cancel the current prompt',
    setup: 'Register this group as a household',
    bind_purchase_topic: 'Bind the current topic as purchases',
    bind_feedback_topic: 'Bind the current topic as feedback',
    pending_members: 'List pending household join requests',
    approve_member: 'Approve a pending household member'
  },
  help: {
    intro: 'Household bot is live.',
    privateChatHeading: 'Private chat:',
    groupAdminsHeading: 'Group admins:'
  },
  bot: {
    householdStatusPending: 'Household status is not connected yet. Data integration is next.'
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
        'Next: open the purchase topic and run /bind_purchase_topic, then open the feedback topic and run /bind_feedback_topic.',
        'Members should open the bot chat from the button below and confirm the join request there.'
      ].join('\n'),
    useBindPurchaseTopicInGroup: 'Use /bind_purchase_topic inside the household group topic.',
    purchaseTopicSaved: (householdName, threadId) =>
      `Purchase topic saved for ${householdName} (thread ${threadId}).`,
    useBindFeedbackTopicInGroup: 'Use /bind_feedback_topic inside the household group topic.',
    feedbackTopicSaved: (householdName, threadId) =>
      `Feedback topic saved for ${householdName} (thread ${threadId}).`,
    usePendingMembersInGroup: 'Use /pending_members inside the household group.',
    useApproveMemberInGroup: 'Use /approve_member inside the household group.',
    approveMemberUsage: 'Usage: /approve_member <telegram_user_id>',
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
    noStatementCycle: 'No cycle found for statement.',
    statementTitle: (period) => `Statement for ${period}`,
    statementLine: (displayName, amount, currency) => `- ${displayName}: ${amount} ${currency}`,
    statementTotal: (amount, currency) => `Total: ${amount} ${currency}`,
    statementFailed: (message) => `Failed to generate statement: ${message}`
  },
  purchase: {
    sharedPurchaseFallback: 'shared purchase',
    recorded: (summary) => `Recorded purchase: ${summary}`,
    savedForReview: (summary) => `Saved for review: ${summary}`,
    parseFailed: "Saved for review: I couldn't parse this purchase yet."
  }
}

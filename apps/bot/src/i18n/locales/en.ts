import { formatMonthDisplay } from '@household/domain'

import type { BotTranslationCatalog } from '../types'
import { formatUserFacingMoney } from '../money'

const money = (amount: string, currency: string) => formatUserFacingMoney(amount, currency, 'en')
const month = (period: string) => formatMonthDisplay(period, 'en')
const months = (periods: readonly string[]) =>
  new Intl.ListFormat('en', { type: 'conjunction' }).format(periods.map(month))
const kindNoun = (kind: 'rent' | 'utilities') => (kind === 'rent' ? 'rent' : 'utilities')
const kindTitle = (kind: 'rent' | 'utilities') => (kind === 'rent' ? 'Rent' : 'Utilities')
const kindEmoji = (kind: 'rent' | 'utilities') => (kind === 'rent' ? '🏠' : '💡')
const forMonth = (period: string | null) => (period ? ` for ${month(period)}` : '')
const capitalize = (value: string) => value.charAt(0).toUpperCase() + value.slice(1)
const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

export const enBotTranslations: BotTranslationCatalog = {
  localeName: 'English',
  commands: {
    start: 'Start',
    help: 'What the bot can do',
    home: 'Household menu',
    bill: 'What to pay this month',
    app: 'Open the app',
    anon: 'Anonymous message',
    cancel: 'Cancel the current input',
    setup: 'Connect this group',
    bind: 'Bind this topic',
    invite: 'Invite to the household'
  },
  help: {
    intro: '🏠 What the bot can do',
    purchases: '🛒 Purchase — write in the purchases topic what you bought and for how much.',
    payments: '✅ Payment — write in the payments topic, for example "rent paid".',
    bill: '💸 What to pay — /bill',
    app: '📱 Everything in detail — in the app: /app',
    setup: '⚙️ Household setup — /setup, /bind, /invite',
    commandsHeading: 'Commands:'
  },
  home: {
    title: '🏠 <b>Household menu</b>',
    introPrivate: 'What would you like to see?',
    introGroup: 'Bills, payments and purchases — all in one place.',
    myBillButton: '💸 My bill',
    householdStatusButton: '🏠 Household',
    balancesButton: '🛒 Purchases',
    fullBillButton: '🔎 Details',
    routinesButton: '🧹 Chores',
    menuButton: '‹ Menu',
    miniAppButton: '📱 App',
    setupButton: '⚙️ Setup',
    feedbackButton: '🕶 Anonymous',
    helpButton: '❔ Help',
    setupMenuTitle: '⚙️ <b>Household setup</b>',
    setupMenuBody: [
      'In the household group:',
      '/setup — connect the group and create topics',
      '/bind — bind the current topic',
      '/invite — invite link and join requests'
    ].join('\n'),
    feedbackMenuTitle: '🕶 <b>Anonymous message</b>',
    feedbackMenuBody:
      'Send /anon here in this private chat — it goes to the shared topic without your name.'
  },
  setup: {
    onlyTelegramAdmins: '🔒 Only group admins can run /setup.',
    useSetupInGroup: 'This command works in the household group.',
    onlyTelegramAdminsBindTopics: '🔒 Only group admins can bind topics.',
    householdNotConfigured: '⚠️ This group is not connected yet. Start with /setup.',
    useCommandInTopic: 'Run this command inside the topic you mean.',
    onlyHouseholdAdmins: '🔒 Only household admins can do this.',
    pendingNotFound: 'Request not found — it may already be approved.',
    inviteHeading: (householdName) => `🔗 <b>Invite to ${householdName}</b>`,
    pendingMembersHeading: 'Waiting for approval:',
    pendingMembersEmpty: 'No new requests.',
    pendingMemberLine: (member) =>
      `• <b>${member.displayName}</b>${member.username ? ` · @${member.username}` : ''}`,
    openMiniAppButton: '📱 Open the app',
    openMiniAppFromPrivateChat: '📱 The app opens with the button below.',
    openMiniAppUnavailable: '⚠️ The app is not connected yet.',
    joinHouseholdButton: 'Join the household',
    approveMemberButton: (displayName) => `✅ ${displayName}`,
    telegramIdentityRequired: '⚠️ Could not identify your Telegram account.',
    invalidJoinLink: '⚠️ This invite link does not work.',
    joinLinkInvalidOrExpired: '⚠️ This link has expired — ask an admin for a new one.',
    alreadyActiveMember: (displayName) =>
      `✅ You are already in as <b>${displayName}</b>. Everything else is in the app.`,
    joinRequestSent: (householdName) =>
      `⏳ Request to join <b>${householdName}</b> sent — now an admin just needs to approve it.`,
    setupSummary: ({ householdName, created }) =>
      `${created ? `🎉 <b>${householdName}</b> — your new household is ready!` : `🏠 <b>${householdName}</b> is already connected.`}\n\n` +
      'Next, give each conversation its topic.',
    setupTopicsHeading: (configured, total) =>
      `<b>Topics: ${configured} of ${total}</b>\n` +
      'Create the missing ones below or bind your own: /bind inside a topic.',
    setupTopicBound: (role) => `✅ ${role}`,
    setupTopicMissing: (role) => `⬜ ${role}`,
    setupTopicCreateButton: (role) => `+ ${role}`,
    bindSelectRole: 'What is this topic for?',
    topicBoundSuccess: (role) => `✅ Topic bound: "${role}".`,
    allRolesConfigured: '✅ All topics are in place.',
    setupTopicCreateFailed:
      '⚠️ Could not create the topic. Check the bot permissions and that topics are enabled.',
    setupTopicCreateForbidden: '🔒 The bot needs permission to manage topics to create one.',
    setupTopicCreated: (role, topicName) => `✅ Topic "${topicName}" created: ${role}.`,
    setupTopicBindRoleName: (role) => {
      switch (role) {
        case 'chat':
          return 'Chat'
        case 'purchase':
          return 'Purchases'
        case 'feedback':
          return 'Anonymous'
        case 'reminders':
          return 'Reminders'
        case 'payments':
          return 'Payments'
        case 'notifications':
          return 'Notifications'
      }
    },
    setupTopicSuggestedName: (role) => {
      switch (role) {
        case 'chat':
          return 'Chat'
        case 'purchase':
          return 'Shared purchases'
        case 'feedback':
          return 'Anonymous'
        case 'reminders':
          return 'Reminders'
        case 'payments':
          return 'Payments'
        case 'notifications':
          return 'Notifications'
      }
    },
    onlyInviteAdmins: '🔒 Only admins can invite people.',
    useInviteInGroup: 'Send /invite in the household group.',
    approvedMember: (displayName, householdName) =>
      `🎉 <b>${displayName}</b> is now part of <b>${householdName}</b>!`,
    useButtonInGroup: 'This button works in the household group.',
    unableToIdentifySelectedMember: 'Could not find that member.',
    approvedMemberToast: (displayName) => `✅ ${displayName} is in`,
    joinLinkUnavailable: '⚠️ Could not create an invite link.'
  },
  anonymousFeedback: {
    title: '🕶 <b>Anonymous message</b>',
    cancelButton: 'Cancel',
    unableToStart: '⚠️ Cannot start right now. Try again a bit later.',
    prompt: '🕶 Write your message — it goes to the shared topic without your name.',
    unableToIdentifyMessage: '⚠️ Could not read that message.',
    notMember: '🔒 You are not a member of this household.',
    multipleHouseholds:
      'You belong to several households. Start from the group of the one you mean.',
    feedbackTopicMissing:
      '⚠️ The anonymous topic is not set up yet — an admin can create it with /setup.',
    duplicate: 'This message was already sent.',
    delivered: '✅ Sent anonymously.',
    savedButPostFailed: '⚠️ Saved, but posting failed. Try again later.',
    nothingToCancel: 'Nothing to cancel.',
    cancelled: 'Cancelled',
    cancelledMessage: 'Anonymous message cancelled.',
    useInPrivateChat: '/anon works in a private chat with the bot.',
    useThisInPrivateChat: 'This works in a private chat with the bot.',
    tooShort: 'Too short — add a couple of details.',
    tooLong: 'Too long — keep it under 500 characters.',
    cooldown: (retryDelay) => `⏳ A short pause. Next message ${retryDelay}.`,
    dailyCap: (retryDelay) => `⏳ That is today's limit. Next message ${retryDelay}.`,
    blocklisted: '⚠️ The message did not pass moderation. Try a calmer wording.',
    submitFailed: '⚠️ Could not send it.',
    keepPromptSuffix: 'Send the corrected text or tap "Cancel".',
    retryNow: 'now',
    retryInLessThanMinute: 'in less than a minute',
    retryIn: (parts) => `in ${parts}`,
    day: (count) => `${count} ${plural(count, 'day', 'days')}`,
    hour: (count) => `${count} ${plural(count, 'hour', 'hours')}`,
    minute: (count) => `${count} ${plural(count, 'minute', 'minutes')}`
  },
  assistant: {
    noHousehold: 'I can help once you join a household — start from the household group.',
    multipleHouseholds:
      'You belong to several households. Start from the group of the one you mean.',
    temporarilyUnavailable: '⚠️ Cannot answer right now. Try again in a minute.',
    rateLimited: (retryDelay) => `⏳ Too many questions in a row. Let's continue ${retryDelay}.`,
    retryInLessThanMinute: 'in less than a minute',
    retryIn: (parts) => `in ${parts}`,
    hour: (count) => `${count} ${plural(count, 'hour', 'hours')}`,
    minute: (count) => `${count} ${plural(count, 'minute', 'minutes')}`
  },
  finance: {
    useInGroup: 'ℹ️ Use this command inside a household group.',
    householdNotConfigured: '⚠️ Household is not configured for this chat yet. Run /setup first.',
    unableToIdentifySender: '⚠️ Unable to identify sender for this command.',
    notMember: '🔒 You are not a member of this household.'
  },
  reminders: {
    utilities: (period) => `💡 Time to enter utilities for ${month(period)}`,
    rentWarning: (period) => `🏠 ${month(period)} rent is coming up`,
    rentDue: (period) => `🏠 ${month(period)} rent is due today`,
    openDashboardButton: '📱 App',
    invalidAmount: (categoryName, currency) =>
      `Could not read the amount for "${categoryName}". Send a number in ${currency}, or 0 / "skip".`,
    templateIntro: (currency) =>
      `Fill in the amounts in ${currency} and send the message back here.`,
    templateInvalid: 'No amounts found in the template. Fill in at least one.',
    summaryLine: (categoryName, amount, currency) =>
      `• ${categoryName}: ${money(amount, currency)}`,
    confirmButton: '✅ Save',
    cancelButton: 'Cancel',
    cancelled: 'Cancelled.',
    saved: (count, period) =>
      `✅ Saved ${count} ${plural(count, 'bill', 'bills')} for ${month(period)}.`,
    paymentInstructionSent: 'Payment details sent to the payments topic.',
    proposalUnavailable: 'This is no longer available',
    paidButton: '✅ Mark as paid',
    paidUtilitiesButton: '✅ Mark as paid',
    fullyPaid: (kind, monthLabel) => `${kindTitle(kind)} for ${monthLabel} is paid`,
    alreadyPaid: 'Already paid',
    notMember: 'Could not find you among the household members',
    paymentRecordedToast: 'Payment marked',
    reminderUnavailable: 'This reminder is no longer available',
    noRentDestinations: 'No rent payment details yet.',
    everyonePaid: 'Everyone paid',
    noUtilityPlan: 'The utilities plan is not ready yet.'
  },
  purchase: {
    sharedPurchaseFallback: 'shared purchase',
    clarificationPhotoOnly: 'Got the photo — what did you buy and for how much?',
    proposal: (summary, payer, calculationNote, participants) =>
      [
        `🛒 ${summary}`,
        ...(payer ? [payer] : []),
        ...(calculationNote ? ['', calculationNote] : []),
        ...(participants ? ['', participants] : [])
      ].join('\n'),
    calculatedAmountNote: (explanation) =>
      explanation
        ? `Total worked out as ${explanation}. Right?`
        : 'Total worked out automatically. Right?',
    clarification: (question) => question,
    clarificationMissingAmountAndCurrency: 'How much was it, and in which currency?',
    clarificationMissingAmount: 'How much was it?',
    clarificationMissingCurrency: 'Which currency?',
    clarificationMissingItem: 'What did you buy?',
    clarificationLowConfidence:
      'Could not make that out. Write what you bought, the amount and the currency.',
    summary: (description, amount) => `<b>${description} · ${amount}</b>`,
    savedCardHeadline: (summary) => `🛒 ${summary}`,
    participantBalanceChange: (displayName, change) => `${displayName} ${change}`,
    participantPayerWithoutShare: (displayName, change) => `${displayName} ${change} (no share)`,
    participantExcluded: (displayName) => `<s>${displayName}</s>`,
    participantToggleIncluded: (displayName) => `✅ ${displayName}`,
    participantToggleExcluded: (displayName) => `⬜ ${displayName}`,
    splitEqualLine: (participantCount, perHead) =>
      participantCount === 1
        ? 'for one person'
        : `split ${participantCount} ways${perHead ? `, ${perHead} each` : ''}`,
    splitCustomLine: 'custom amounts',
    payerLine: (displayName) => `💳 ${displayName}`,
    payerSplitLine: (displayName, split) => `💳 ${displayName} · ${split}`,
    payerFallbackQuestion: 'Not sure who paid. Pick below.',
    payerButton: (displayName) => displayName,
    payerSelectedToast: (displayName) => `${displayName} paid`,
    confirmButton: '✅ Save',
    calculatedConfirmButton: '✅ Right',
    calculatedFixAmountButton: 'Fix amount',
    cancelButton: 'Cancel',
    calculatedFixAmountPrompt: '✏️ Reply with the correct total and currency — I will recalculate.',
    calculatedFixAmountRequestedToast: 'Waiting for the amount',
    calculatedFixAmountAlreadyRequested: 'Already waiting for the amount',
    confirmed: (summary) => `✅ ${summary}`,
    cancelled: (summary) => `Cancelled: ${summary}`,
    removed: '🗑 Purchase removed',
    confirmedToast: 'Saved',
    cancelledToast: 'Cancelled',
    alreadyConfirmed: 'Already saved',
    alreadyCancelled: 'Already cancelled',
    atLeastOneParticipant: 'Someone has to keep a share',
    notYourProposal: 'Only the sender or the payer can confirm this',
    participantChangeForbidden: 'Only household members can change this',
    proposalUnavailable: 'This proposal is no longer available',
    parseFailed:
      'Could not read that as a purchase. Write what you bought, the amount and the currency.'
  },
  agent: {
    confirmButton: '✅ Confirm',
    cancelButton: 'Cancel',
    actionPrompt: (summary) => `🤖 ${capitalize(summary)}?`,
    actionConfirmed: (summary) => `✅ Done: ${summary}`,
    actionCancelled: 'Cancelled',
    actionUnavailable: 'This action is no longer available',
    notYourAction: '🔒 Only the requester or an admin can confirm this',
    actionFailed: '⚠️ That did not work — nothing changed.',
    pendingProposalCancelled: 'Payment proposal cancelled.',
    nothingToCancel: 'Nothing to cancel.',
    summarizeUpdatePayment: (displayName, kind, amount, currency) =>
      `change ${displayName}'s ${kindNoun(kind)} payment to ${money(amount, currency)}`,
    summarizeDeletePayment: (displayName, kind, amount, currency) =>
      `delete ${displayName}'s ${kindNoun(kind)} payment (${money(amount, currency)})`,
    summarizeUpdatePurchase: (description, amount, currency) =>
      `change "${description}" to ${money(amount, currency)}`,
    summarizeDeletePurchase: (description, amount, currency) =>
      `delete "${description}" (${money(amount, currency)})`,
    summarizeSetPurchaseParticipants: (description, names) =>
      `change who shares "${description}": ${names}`,
    summarizeSetPeriodRent: (amount, currency, periods) =>
      `set rent to ${money(amount, currency)} for ${months(periods)}`,
    summarizeSetHouseholdFact: (title, body, previousBody) =>
      body === null
        ? `remember "${title}"`
        : previousBody === null
          ? `remember "${title}": ${body}`
          : `update "${title}": ${body} (was: ${previousBody})`,
    summarizeDeleteHouseholdFact: (title) => `forget "${title}"`
  },
  payments: {
    recorded: (kind, amount, currency, period) =>
      `✅ ${kindTitle(kind)}${forMonth(period)} recorded · ${money(amount, currency)}`,
    recordedReported: (displayName, kind, amount, currency, period) =>
      `✅ ${kindTitle(kind)}${forMonth(period)} recorded · ${displayName} · ${money(amount, currency)}`,
    proposal: ({ kind, amount, currency, period, displayName, billName }) =>
      `${kindEmoji(kind)} Record ${kindNoun(kind)}${forMonth(period)}?\n<b>${[
        displayName,
        billName,
        money(amount, currency)
      ]
        .filter(Boolean)
        .join(' · ')}</b>`,
    clarification: 'Is this rent or utilities? Add the amount if you can.',
    unsupportedCurrency: '⚠️ Payments here are recorded in the household currency only.',
    alreadySettled: (kind, displayName) =>
      displayName
        ? `✅ ${displayName}: ${kindNoun(kind)} already paid`
        : `✅ ${kindTitle(kind)} already paid`,
    settledPeriod: (kind, period, askPeriod, displayName) =>
      `${kindTitle(kind)} for ${month(period)}${displayName ? ` (${displayName})` : ''} is already paid.${askPeriod ? ' Which month is this payment for?' : ''}`,
    breakdownHeading: '<b>How it adds up</b>',
    breakdownBase: (kind, amount, currency) =>
      `• ${kindTitle(kind)}: <b>${money(amount, currency)}</b>`,
    breakdownPlannedBase: (kind, amount, currency) =>
      `• ${kind === 'rent' ? 'Rent' : 'Utilities plan'}: <b>${money(amount, currency)}</b>`,
    breakdownPurchaseBalance: (amount, currency) =>
      `• Purchase balance: <b>${money(amount, currency)}</b>`,
    breakdownSuggestedTotal: (amount, currency, policy) =>
      `• Suggested (${policy}): <b>${money(amount, currency)}</b>`,
    breakdownRecordingAmount: (amount, currency) =>
      `• In your message: <b>${money(amount, currency)}</b>`,
    breakdownRemaining: (amount, currency) =>
      `• Left for everyone: <b>${money(amount, currency)}</b>`,
    adjustmentPolicy: (policy) =>
      policy === 'utilities'
        ? 'offset through utilities'
        : policy === 'rent'
          ? 'offset through rent'
          : 'purchases settled separately',
    timingBeforeWindow: (kind, reminderDate, dueDate) =>
      `⏳ Too early for ${kindNoun(kind)}: reminder on ${reminderDate}, due ${dueDate}.`,
    timingDueNow: (kind, dueDate) => `⏰ ${kindTitle(kind)} is due — by ${dueDate}.`,
    confirmButton: '✅ Record',
    balanceUpdatePendingReminder:
      '⚠️ Balances are still updating — check the app before the next payment.',
    balanceUpdatePending:
      '⚠️ Payment saved, but balances are not updated yet. Tap "Retry" — it will not be recorded twice.',
    retryBalanceButton: 'Retry',
    confirmSelectedButton: '✅ Record',
    cancelButton: 'Cancel',
    multiProposal: (kind, period) =>
      `${kindEmoji(kind)} <b>${kindTitle(kind)} for ${month(period)}</b> — for whom?`,
    multiMemberLine: (displayName, paymentStatus, selected) =>
      paymentStatus === 'paid'
        ? `✅ <s>${displayName}</s> · already paid`
        : `${selected ? '☑️' : '⬜'} ${selected ? `<b>${displayName}</b>` : displayName}`,
    multiMemberButton: (displayName, selected) => `${selected ? '☑️' : '⬜'} ${displayName}`,
    multiRecorded: (kind, period, names) =>
      `✅ <b>${kindTitle(kind)} for ${month(period)} recorded</b>: ${names}`,
    multiAlreadyPaid: (names) => `Already paid: ${names}`,
    multiPartiallyRecorded: (recordedNames, failedNames) =>
      [
        '⚠️ <b>Not everything was recorded</b>',
        ...(recordedNames ? [`Done: ${recordedNames}`] : []),
        ...(failedNames ? [`Failed: ${failedNames}`] : [])
      ].join('\n'),
    noMembersSelected: 'Pick at least one person',
    cancelled: 'Cancelled',
    proposalUnavailable: 'This proposal is no longer available',
    notYourProposal: '🔒 Only the sender or the person paying can confirm this',
    multiNotYourProposal: '🔒 Only the sender can change this list',
    duplicate: 'This payment is already recorded'
  }
}

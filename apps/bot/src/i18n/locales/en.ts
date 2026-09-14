import type { BotTranslationCatalog } from '../types'
import { formatUserFacingMoney } from '../money'

export const enBotTranslations: BotTranslationCatalog = {
  localeName: 'English',
  commands: {
    start: 'Open the household start menu',
    help: 'Show task-based guidance',
    settings: 'Open household settings and shortcuts',
    home: 'Open the household control center',
    bill: 'Show the household bill view',
    bill_full: 'Show the household bill with all purchase impact',
    my_bill: 'Show your personal finance summary',
    my_bill_full: 'Show your detailed personal bill',
    bill_json: 'Export the current billing calculation audit as JSON',
    household_status: 'Show current household status',
    balance: 'Show purchase balances for all members',
    utilities: 'Post the utility entry template for this topic',
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
    keyboard: 'Show a persistent dashboard button'
  },
  help: {
    intro:
      '🏡 /home opens the main menu. Use it first; the command list below is for quick access.',
    introWithoutHome:
      '🏡 I can guide household finance tasks here. The command list below shows what is available right now.',
    tasksHeading: 'Common tasks:',
    checkMyBill: '• 💸 Check what you owe: /home → My bill',
    checkHouseholdStatus: '• 🏠 See household status: /home → Status',
    checkBalances: '• 🛒 Review purchase balances: /home → Balances',
    recordPurchase: '• 🧾 Record a shared purchase: send the receipt text in the purchases topic',
    recordPayment: '• ✅ Confirm a payment: send the payment note in the payments topic',
    openDashboard: '• 📱 Open the dashboard: /home → Mini app',
    setupHousehold: '• 🧰 Set up or maintain a household: /home → Setup/Admin',
    manageMembers: '• 👥 Invite and approve members: /home → Setup/Admin',
    advancedHeading: 'Command shortcuts:',
    privateChatHeading: 'Private chat:',
    groupHeading: 'Group chat:',
    groupAdminsHeading: 'Group admins:'
  },
  home: {
    title: '🏡 <b>Household control center</b>',
    introPrivate: 'Pick a task. I will keep the command list out of your way.',
    introGroup: 'Navigate household finance without leaving Telegram.',
    myBillButton: '💸 My bill',
    householdStatusButton: '🏠 Status',
    balancesButton: '🛒 Balances',
    fullBillButton: '🔎 Full bill',
    menuButton: '🏡 Menu',
    miniAppButton: '📱 Mini app',
    setupButton: '🧰 Setup/Admin',
    feedbackButton: '🕶 Anonymous note',
    helpButton: '❔ Help',
    setupMenuTitle: '🧰 <b>Setup/Admin</b>',
    setupMenuBody:
      'Use /setup in the household group to register it, /bind inside a topic to link it, /join_link to invite members, and /pending_members to approve requests.',
    feedbackMenuTitle: '🕶 <b>Anonymous note</b>',
    feedbackMenuBody: 'Use /anon in this private chat to send a household note anonymously.'
  },
  common: {
    unableToIdentifySender: '⚠️ Unable to identify sender for this command.',
    useHelp: 'ℹ️ Send /help to see available commands.'
  },
  setup: {
    onlyTelegramAdmins: '🔒 Only Telegram group admins can run /setup.',
    useSetupInGroup: 'ℹ️ Use /setup inside the household group.',
    onlyTelegramAdminsBindTopics: '🔒 Only Telegram group admins can bind household topics.',
    householdNotConfigured: '⚠️ Household is not configured for this chat yet. Run /setup first.',
    useCommandInTopic: 'ℹ️ Run this command inside the target topic thread.',
    onlyHouseholdAdmins: '🔒 Only household admins can manage pending members.',
    pendingNotFound: '🤷 Pending member not found. Use /pending_members to inspect the queue.',
    pendingMembersHeading: (householdName) => `👥 <b>Pending members · ${householdName}</b>`,
    pendingMembersHint:
      '<i>Tap a button below to approve, or use /approve_member &lt;telegram_user_id&gt;.</i>',
    pendingMembersEmpty: (householdName) => `🤷 No pending members for <b>${householdName}</b>.`,
    pendingMemberLine: (member, index) =>
      `${index + 1}. <b>${member.displayName}</b> · <code>${member.telegramUserId}</code>${member.username ? ` · @${member.username}` : ''}`,
    openMiniAppButton: '📱 Open mini app',
    openMiniAppFromPrivateChat: '📱 Open the mini app from the button below.',
    openMiniAppUnavailable: '⚠️ The mini app is not configured right now.',
    joinHouseholdButton: '🤝 Join household',
    approveMemberButton: (displayName) => `✅ ${displayName}`,
    telegramIdentityRequired: '⚠️ Telegram user identity is required to join a household.',
    invalidJoinLink: '🚫 Invalid household invite link.',
    joinLinkInvalidOrExpired: '⌛ This household invite link is invalid or expired.',
    alreadyActiveMember: (displayName) =>
      `✅ You are already an active member. Open the mini app to view <b>${displayName}</b>.`,
    joinRequestSent: (householdName) =>
      `📨 Join request sent for <b>${householdName}</b>. Wait for a household admin to confirm you.`,
    setupSummary: ({ householdName, created }) =>
      `🏡 <b>${created ? 'New household' : 'Household active'}: ${householdName}</b>\n\n` +
      `I've set up the basic configuration. Now, let's organize your communication by linking topics for specific roles.`,
    setupTopicsHeading: (configured, total) =>
      `🧩 <b>Setup progress: ${configured}/${total}</b>\n\n` +
      `Tap buttons below to create new topics automatically, or go to any existing topic and use /bind to link it manually.`,
    setupTopicBound: (role) => `✅ ${role}`,
    setupTopicMissing: (role) => `⚪ ${role}`,
    setupTopicCreateButton: (role) => `➕ ${role}`,
    setupTopicBindButton: (role) => `🔗 ${role}`,
    useBindInTopic: 'ℹ️ Run /bind inside a topic to link it to a role.',
    topicAlreadyBound: (role) => `ℹ️ This topic is already linked to ${role}.`,
    bindSelectRole: '🔗 Link this topic to:',
    topicBoundSuccess: (role, householdName) => `✅ Linked as ${role} for ${householdName}.`,
    allRolesConfigured: '✅ All topic roles are already configured.',
    setupTopicCreateFailed:
      '⚠️ I could not create that topic. Check bot admin permissions and forum settings.',
    setupTopicCreateForbidden:
      '🔒 I need permission to manage topics in this group before I can create one automatically.',
    setupTopicCreated: (role, topicName) => `✅ ${role} topic created and bound: ${topicName}.`,
    setupTopicBindPending: '',
    setupTopicBindCancelled: '🧹 Topic binding mode cleared.',
    setupTopicBindNotAvailable: '⏳ That topic-binding action is no longer available.',
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
          return 'Anonymous feedback'
        case 'reminders':
          return 'Reminders'
        case 'payments':
          return 'Payments'
        case 'notifications':
          return 'Notifications'
      }
    },
    onlyTelegramAdminsUnsetup: '🔒 Only Telegram group admins can run /unsetup.',
    useUnsetupInGroup: 'ℹ️ Use /unsetup inside the household group.',
    unsetupComplete: (householdName) =>
      `🧹 Setup state reset for <b>${householdName}</b>. Run /setup again to configure topics from scratch.`,
    unsetupNoop: 'ℹ️ Nothing to reset for this group yet. Run /setup when you are ready.',
    usePendingMembersInGroup: 'ℹ️ Use /pending_members inside the household group.',
    useApproveMemberInGroup: 'ℹ️ Use /approve_member inside the household group.',
    approveMemberUsage: 'ℹ️ Usage: /approve_member <telegram_user_id>',
    onlyInviteAdmins: '🔒 Only Telegram group admins or household admins can invite members.',
    approvedMember: (displayName, householdName) =>
      `✅ Approved <b>${displayName}</b> as an active member of <b>${householdName}</b>.`,
    useButtonInGroup: 'ℹ️ Use this button in the household group.',
    unableToIdentifySelectedMember: '⚠️ Unable to identify the selected member.',
    approvedMemberToast: (displayName) => `✅ Approved ${displayName}.`,
    useJoinLinkInGroup: 'ℹ️ Use /join_link inside the household group.',
    joinLinkUnavailable: '⚠️ Could not generate join link.',
    joinLinkReady: (link, householdName) =>
      `🔗 <b>Join link · ${householdName}</b>\n\n<code>${link}</code>\n\n<i>Anyone with this link can join the household. Share it carefully.</i>`
  },
  keyboard: {
    dashboardButton: '🏡 Dashboard',
    enabled: 'Persistent dashboard button enabled.',
    disabled: 'Persistent dashboard button disabled.'
  },
  anonymousFeedback: {
    title: '🕶 <b>Anonymous household note</b>',
    cancelButton: '🚫 Cancel',
    unableToStart: '⚠️ Unable to start anonymous feedback right now.',
    prompt: '🕶 Send me the anonymous message in your next reply, or tap Cancel.',
    unableToIdentifyMessage: '⚠️ Unable to identify this message for anonymous feedback.',
    notMember: '🔒 You are not a member of this household.',
    multipleHouseholds:
      'ℹ️ You belong to multiple households. Open the target household from its group until household selection is added.',
    feedbackTopicMissing:
      '⚠️ Anonymous feedback is not configured for your household yet. Ask an admin to run /setup and create a feedback topic.',
    duplicate: '♻️ This anonymous feedback message was already processed.',
    delivered: '✅ Anonymous feedback delivered.',
    savedButPostFailed: '⚠️ Anonymous feedback was saved, but posting failed. Try again later.',
    nothingToCancel: 'ℹ️ Nothing to cancel right now.',
    cancelled: '🚫 Cancelled.',
    cancelledMessage: '🚫 Anonymous feedback cancelled.',
    useInPrivateChat: 'ℹ️ Use /anon in a private chat with the bot.',
    useThisInPrivateChat: 'ℹ️ Use this in a private chat with the bot.',
    tooShort: '✂️ Anonymous feedback is too short. Add a little more detail.',
    tooLong: '✂️ Anonymous feedback is too long. Keep it under 500 characters.',
    cooldown: (retryDelay) =>
      `⏳ Anonymous feedback cooldown is active. You can send the next message ${retryDelay}.`,
    dailyCap: (retryDelay) =>
      `⏳ Daily anonymous feedback limit reached. You can send the next message ${retryDelay}.`,
    blocklisted: '🚫 Message rejected by moderation. Rewrite it in calmer, non-abusive language.',
    submitFailed: '⚠️ Anonymous feedback could not be submitted.',
    keepPromptSuffix: 'Send a revised message, or tap Cancel.',
    retryNow: 'now',
    retryInLessThanMinute: 'in less than a minute',
    retryIn: (parts) => `in ${parts}`,
    day: (count) => `${count} day${count === 1 ? '' : 's'}`,
    hour: (count) => `${count} hour${count === 1 ? '' : 's'}`,
    minute: (count) => `${count} minute${count === 1 ? '' : 's'}`
  },
  assistant: {
    noHousehold:
      'ℹ️ I can help after your Telegram account is linked to a household. Open the household group and complete the join flow first.',
    multipleHouseholds:
      'ℹ️ You belong to multiple households. Open the target household from its group until direct household selection is added.',
    temporarilyUnavailable: '⚠️ I cannot answer right now. Please try again in a minute.',
    rateLimited: (retryDelay) => `⏳ Assistant rate limit reached. Try again ${retryDelay}.`,
    retryInLessThanMinute: 'in less than a minute',
    retryIn: (parts) => `in ${parts}`,
    hour: (count) => `${count} hour${count === 1 ? '' : 's'}`,
    minute: (count) => `${count} minute${count === 1 ? '' : 's'}`,
    paymentProposal: (kind, amount, currency) =>
      `I can record this ${kind === 'rent' ? 'rent' : 'utilities'} payment: ${formatUserFacingMoney(amount, currency)}. Confirm or cancel below.`
  },
  finance: {
    useInGroup: 'ℹ️ Use this command inside a household group.',
    householdNotConfigured: '⚠️ Household is not configured for this chat yet. Run /setup first.',
    unableToIdentifySender: '⚠️ Unable to identify sender for this command.',
    notMember: '🔒 You are not a member of this household.',
    adminOnly: '🔒 Only household admins can use this command.',
    cycleOpenUsage: 'ℹ️ Usage: /cycle_open <YYYY-MM> [USD|GEL]',
    cycleOpened: (period, currency) => `✅ Cycle opened: ${period} (${currency})`,
    cycleOpenFailed: (message) => `⚠️ Failed to open cycle: ${message}`,
    noCycleToClose: '🤷 No cycle found to close.',
    cycleClosed: (period) => `✅ Cycle closed: ${period}`,
    cycleCloseFailed: (message) => `⚠️ Failed to close cycle: ${message}`,
    rentSetUsage: 'ℹ️ Usage: /rent_set <amount> [USD|GEL] [YYYY-MM]',
    rentNoPeriod: '🤷 No period provided and no open cycle found.',
    rentSaved: (amount, currency, period) =>
      `✅ Rent rule saved: ${formatUserFacingMoney(amount, currency)} starting ${period}`,
    rentSaveFailed: (message) => `⚠️ Failed to save rent rule: ${message}`,
    utilityAddUsage: 'ℹ️ Usage: /utility_add <name> <amount> [USD|GEL]',
    utilityNoOpenCycle: '🤷 No open cycle found. Use /cycle_open first.',
    utilityAdded: (name, amount, currency, period) =>
      `✅ Utility bill added: ${name} ${formatUserFacingMoney(amount, currency)} for ${period}`,
    utilityAddFailed: (message) => `⚠️ Failed to add utility bill: ${message}`,
    paymentAddUsage: 'ℹ️ Usage: /payment_add <rent|utilities> [amount] [USD|GEL]',
    paymentNoCycle: '🤷 No billing cycle is ready yet.',
    paymentNoBalance: 'ℹ️ There is no payable balance for that payment type right now.',
    paymentAdded: (kind, amount, currency, period) =>
      `✅ Payment recorded: ${kind === 'rent' ? 'rent' : 'utilities'} ${formatUserFacingMoney(amount, currency)} for ${period}`,
    paymentAddFailed: (message) => `⚠️ Failed to record payment: ${message}`,
    noStatementCycle: '🤷 No cycle found for statement.',
    statementTitle: (period) => `🧾 <b>Statement · ${period}</b>`,
    statementLine: (displayName, amount, currency) =>
      `👤 ${displayName} — <b>${formatUserFacingMoney(amount, currency)}</b>`,
    statementTotal: (amount, currency) =>
      `💰 <b>Total: ${formatUserFacingMoney(amount, currency)}</b>`,
    statementFailed: (message) => `⚠️ Failed to generate statement: ${message}`,
    utilitiesTopicRequired: 'ℹ️ This command must be used inside a topic.',
    utilitiesNotLinked: '⚠️ This topic is not linked to a household.',
    chooseHouseholdForBalances: '🏠 Choose a household for balances:'
  },
  reminders: {
    utilities: (period) => `Utilities reminder for ${period}`,
    rentWarning: (period) => `Rent reminder for ${period}: payment is coming up soon.`,
    rentDue: (period) => `Rent is due for period ${period}. Request sent to the reminders topic.`,
    guidedEntryButton: 'Guided entry',
    copyTemplateButton: 'Copy template',
    openDashboardButton: 'Open dashboard',
    dashboardDetailsHint: 'Details and payment history are available in the dashboard.',
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
    summaryLine: (categoryName, amount, currency) =>
      `- ${categoryName}: ${formatUserFacingMoney(amount, currency)}`,
    confirmPrompt: 'Confirm or cancel below.',
    confirmButton: 'Save utility charges',
    cancelButton: 'Cancel',
    cancelled: 'Utility submission cancelled.',
    saved: (count, period) =>
      `Saved ${count} utility ${count === 1 ? 'charge' : 'charges'} for ${period}.`,
    paymentInstructionSent: 'Payment instructions were sent to the payments topic.',
    proposalUnavailable: 'This utility submission is no longer available.',
    onlyOriginalSender: 'Only the person who started this utility submission can confirm it.',
    paidButton: 'I paid',
    paidUtilitiesButton: 'I paid my bills',
    closeUnpaidButton: 'Close unpaid',
    confirmCloseButton: 'Confirm close',
    fullyPaid: (kind, month) =>
      `${kind === 'rent' ? 'Rent' : 'Utilities'} for ${month} is fully paid.`,
    alreadyPaid: 'Already marked as paid.',
    notMember: 'I could not match you to a household member.',
    adminOnly: 'Only household admins can do that.',
    paymentRecordedToast: 'Payment marked as paid.',
    reminderUnavailable: 'This reminder is no longer available.',
    noRentDestinations: 'No rent requisites are configured yet.',
    everyonePaid: 'Everyone is paid',
    noUtilityPlan: 'No utility plan is ready yet.'
  },
  purchase: {
    sharedPurchaseFallback: 'shared purchase',
    clarificationPhotoOnly:
      'I can see the photo, but I still need the item and total. What exactly was bought and for how much?',
    proposal: (
      summary: string,
      payer: string | null,
      calculationNote: string | null,
      participants: string | null
    ) =>
      [
        '🛒 <b>Looks like a shared purchase</b>',
        '',
        `🧾 ${summary}`,
        ...(payer ? [payer] : []),
        ...(calculationNote ? ['', `🤔 ${calculationNote}`] : []),
        ...(participants ? ['', participants] : []),
        '',
        '<i>Confirm or cancel below 👇</i>'
      ].join('\n'),
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
    summary: (description, amount) => `<b>${description}</b> — <b>${amount}</b>`,
    savedCardHeadline: (summary) => `🧾 ${summary}`,
    participantsHeading: '👥 <b>Participants</b>',
    participantIncluded: (displayName) => `• ${displayName}`,
    participantIncludedWithShare: (displayName, amount) => `• ${displayName} — <b>${amount}</b>`,
    participantExcluded: (displayName) => `• <s>${displayName}</s> · excluded`,
    participantToggleIncluded: (displayName) => `✅ ${displayName}`,
    participantToggleExcluded: (displayName) => `⬜ ${displayName}`,
    splitEqualLine: (perHead) =>
      perHead ? `➗ Split equally · ${perHead} each` : '➗ Split equally',
    splitCustomLine: '🧮 Custom amounts',
    payerLine: (displayName) => `💳 Paid by: <b>${displayName}</b>`,
    payerQuestion: 'Who actually bought this?',
    payerFallbackQuestion: 'I could not tell who bought this. Pick the payer below.',
    payerButton: (displayName) => `${displayName} paid`,
    payerSelectedToast: (displayName) => `Set payer to ${displayName}.`,
    confirmButton: 'Confirm',
    calculatedConfirmButton: 'Looks right',
    calculatedFixAmountButton: 'Fix amount',
    cancelButton: 'Cancel',
    calculatedFixAmountPrompt:
      '✏️ Reply with the corrected total and currency in this topic, and I will re-check the purchase.',
    calculatedFixAmountRequestedToast: 'Reply with the corrected total.',
    calculatedFixAmountAlreadyRequested: 'Waiting for the corrected total.',
    confirmed: (summary) => `✅ <b>Purchase recorded</b>\n\n🧾 ${summary}`,
    cancelled: (summary) => `🚫 <b>Proposal cancelled</b>\n\n🧾 ${summary}`,
    removed: '🗑 <b>Purchase removed</b>',
    confirmedToast: 'Purchase confirmed.',
    cancelledToast: 'Purchase cancelled.',
    alreadyConfirmed: 'This purchase was already confirmed.',
    alreadyCancelled: 'This purchase was already cancelled.',
    atLeastOneParticipant: 'Keep at least one participant in the purchase split.',
    notYourProposal:
      'Only the original sender or the named buyer can confirm or cancel this purchase.',
    proposalUnavailable: 'This purchase proposal is no longer available.',
    parseFailed:
      "I couldn't understand this as a shared purchase yet. Please restate it with item, amount, and currency."
  },
  agent: {
    confirmButton: '✅ Confirm',
    cancelButton: '🚫 Cancel',
    actionPrompt: (summary) => `🤖 ${summary}\n\nConfirm or cancel below 👇`,
    actionConfirmed: (summary) => `✅ Done: ${summary}`,
    actionCancelled: '🚫 Action cancelled.',
    actionUnavailable: '⏳ This action is no longer available.',
    notYourAction:
      '🔒 Only the person who requested this action or an admin can confirm or cancel it.',
    actionFailed: '⚠️ Could not complete this action. Nothing was changed.',
    pendingProposalCancelled: '🚫 Pending payment proposal cancelled.',
    nothingToCancel: 'ℹ️ There is nothing pending to cancel.',
    summarizeUpdatePayment: (displayName, kind, amount, currency) =>
      `update ${displayName}'s ${kind === 'rent' ? 'rent' : 'utilities'} payment to ${formatUserFacingMoney(amount, currency)}`,
    summarizeDeletePayment: (displayName, kind, amount, currency) =>
      `delete ${displayName}'s ${kind === 'rent' ? 'rent' : 'utilities'} payment of ${formatUserFacingMoney(amount, currency)}`,
    summarizeUpdatePurchase: (description, amount, currency) =>
      `update purchase "${description}" to ${formatUserFacingMoney(amount, currency)}`,
    summarizeDeletePurchase: (description, amount, currency) =>
      `delete purchase "${description}" (${formatUserFacingMoney(amount, currency)})`,
    summarizeSetPurchaseParticipants: (description, names) =>
      `set participants of "${description}" to: ${names}`,
    summarizeSetPeriodRent: (amount, currency, periods) =>
      `set rent to ${formatUserFacingMoney(amount, currency)} for ${periods.join(', ')}`,
    summarizeSetHouseholdFact: (title, body, previousBody) =>
      previousBody === null
        ? `remember "${title}": ${body}`
        : `replace "${title}" (was: ${previousBody}) with: ${body}`,
    summarizeDeleteHouseholdFact: (title) => `forget "${title}"`
  },
  payments: {
    topicMissing:
      '⚠️ Payments topic is not configured for this household yet. Ask an admin to run /setup and create a payments topic.',
    balanceReply: (kind) =>
      kind === 'rent' ? '📊 <b>Rent payment guidance</b>' : '📊 <b>Utilities payment guidance</b>',
    proposal: (kind, amount, currency) =>
      `${kind === 'rent' ? '🏠' : '💡'} <b>${kind === 'rent' ? 'Rent' : 'Utilities'} payment</b>\n💰 Amount: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    proposalReported: (displayName, kind, amount, currency) =>
      `${kind === 'rent' ? '🏠' : '💡'} <b>${kind === 'rent' ? 'Rent' : 'Utilities'} payment</b>\n👤 Paid by: <b>${displayName}</b>\n💰 Amount: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    confirmHint: '<i>Confirm or cancel below 👇</i>',
    clarification:
      '❓ I could not confirm this payment yet. Please clarify whether this was rent or utilities and include the amount/currency if needed.',
    unsupportedCurrency:
      '🚫 I can only record payments in the household settlement currency for this topic right now.',
    noBalance: 'ℹ️ There is no payable balance for that payment type right now.',
    alreadySettled: (kind, displayName) =>
      displayName
        ? `✅ ${displayName} already has ${kind === 'rent' ? 'rent' : 'utilities'} settled.`
        : `✅ ${kind === 'rent' ? 'Rent' : 'Utilities'} are already settled.`,
    settledPeriod: (kind, period, askPeriod, displayName) =>
      `${kind === 'rent' ? 'Rent' : 'Utilities'} for ${period}${displayName ? ` for ${displayName}` : ''} is already settled.${askPeriod ? ' Which billing period does this new payment cover?' : ''}`,
    purchaseRedirect:
      '🛒 That looks like a shared purchase, but this thread is for payments. Toss it into the purchases topic and I will confirm it there.',
    breakdownHeading: '📊 <b>How this adds up</b>',
    breakdownBase: (kind, amount, currency) =>
      `${kind === 'rent' ? '🏠 Rent due' : '💡 Utilities due'}: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownPlannedBase: (kind, amount, currency) =>
      `${kind === 'rent' ? '🏠 Rent due' : '💡 Utilities plan amount'}: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownPurchaseBalance: (amount, currency) =>
      `🛒 Purchase balance: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownSuggestedTotal: (amount, currency, policy) =>
      `🧮 Suggested payment (${policy}): <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownRecordingAmount: (amount, currency) =>
      `✍️ Amount from your message: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    breakdownRemaining: (amount, currency) =>
      `📉 Total remaining balance: <b>${formatUserFacingMoney(amount, currency)}</b>`,
    adjustmentPolicy: (policy) =>
      policy === 'utilities'
        ? 'utilities adjustment'
        : policy === 'rent'
          ? 'rent adjustment'
          : 'separate purchase settlement',
    timingBeforeWindow: (kind, reminderDate, dueDate) =>
      `⏳ ${kind === 'rent' ? 'Rent' : 'Utilities'} are not due yet. Next reminder: ${reminderDate}. Due date: ${dueDate}.`,
    timingDueNow: (kind, dueDate) =>
      `⚠️ ${kind === 'rent' ? 'Rent' : 'Utilities'} are due now. Due date: ${dueDate}.`,
    confirmButton: '✅ Confirm payment',
    confirmSelectedButton: '✅ Confirm selected',
    cancelButton: '🚫 Cancel',
    multiProposal: (kind, period) =>
      `${kind === 'rent' ? '🏠' : '💡'} <b>${kind === 'rent' ? 'Rent' : 'Utilities'} payments · ${period}</b>`,
    multiMemberLine: (displayName, paymentStatus, selected) =>
      paymentStatus === 'paid'
        ? `✅ <s>${displayName}</s> · already paid`
        : `${selected ? '☑️' : '⬜'} <b>${displayName}</b> · unpaid`,
    multiRecorded: (kind, names) =>
      `✅ <b>${kind === 'rent' ? 'Rent' : 'Utilities'} payments recorded</b>\n👥 ${names}`,
    multiAlreadyPaid: (kind, names) =>
      `☑️ ${kind === 'rent' ? 'Rent' : 'Utilities'} already paid: ${names}`,
    multiPartiallyRecorded: (kind, recordedNames, failedNames) =>
      `⚠️ <b>${kind === 'rent' ? 'Rent' : 'Utilities'} payments partly recorded</b>\n✅ Recorded: ${recordedNames}\n❌ Could not record: ${failedNames}`,
    fullyPaid: (kind, period) =>
      `${kind === 'rent' ? 'Rent' : 'Utilities'} for ${period} is fully paid.`,
    noMembersSelected: '⚠️ Select at least one person first.',
    recorded: (kind, amount, currency) =>
      `✅ <b>${kind === 'rent' ? 'Rent' : 'Utilities'} payment recorded</b>\n💰 <b>${formatUserFacingMoney(amount, currency)}</b>`,
    recordedReported: (displayName, kind, amount, currency) =>
      `✅ <b>${kind === 'rent' ? 'Rent' : 'Utilities'} payment recorded</b>\n👤 <b>${displayName}</b> · <b>${formatUserFacingMoney(amount, currency)}</b>`,
    cancelled: '🚫 Payment proposal cancelled.',
    proposalUnavailable: '⏳ This payment proposal is no longer available.',
    notYourProposal:
      '🔒 Only the original sender or the named payer can confirm or cancel this payment.',
    multiNotYourProposal: '🔒 Only the original sender can manage this payment proposal.',
    savedForReview: '📝 Saved this payment confirmation for review.',
    duplicate: '♻️ This payment confirmation was already processed.'
  }
}

import { sql } from 'drizzle-orm'
import {
  bigint,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid
} from 'drizzle-orm/pg-core'

export const households = pgTable('households', {
  id: uuid('id').defaultRandom().primaryKey(),
  name: text('name').notNull(),
  defaultLocale: text('default_locale').default('ru').notNull(),
  assistantContext: text('assistant_context'),
  assistantTone: text('assistant_tone'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const householdBillingSettings = pgTable(
  'household_billing_settings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    settlementCurrency: text('settlement_currency').default('GEL').notNull(),
    paymentBalanceAdjustmentPolicy: text('payment_balance_adjustment_policy')
      .default('utilities')
      .notNull(),
    rentAmountMinor: bigint('rent_amount_minor', { mode: 'bigint' }),
    rentCurrency: text('rent_currency').default('USD').notNull(),
    rentDueDay: integer('rent_due_day').default(20).notNull(),
    rentWarningDay: integer('rent_warning_day').default(17).notNull(),
    utilitiesDueDay: integer('utilities_due_day').default(4).notNull(),
    utilitiesReminderDay: integer('utilities_reminder_day').default(3).notNull(),
    timezone: text('timezone').default('Asia/Tbilisi').notNull(),
    rentPaymentDestinations: jsonb('rent_payment_destinations'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdUnique: uniqueIndex('household_billing_settings_household_unique').on(
      table.householdId
    )
  })
)

export const householdUtilityCategories = pgTable(
  'household_utility_categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    slug: text('slug').notNull(),
    name: text('name').notNull(),
    sortOrder: integer('sort_order').default(0).notNull(),
    isActive: integer('is_active').default(1).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdSlugUnique: uniqueIndex('household_utility_categories_household_slug_unique').on(
      table.householdId,
      table.slug
    ),
    householdSortIdx: index('household_utility_categories_household_sort_idx').on(
      table.householdId,
      table.sortOrder
    )
  })
)

export const householdTelegramChats = pgTable(
  'household_telegram_chats',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramChatType: text('telegram_chat_type').notNull(),
    title: text('title'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdUnique: uniqueIndex('household_telegram_chats_household_unique').on(table.householdId),
    chatUnique: uniqueIndex('household_telegram_chats_chat_unique').on(table.telegramChatId)
  })
)

export const householdTopicBindings = pgTable(
  'household_topic_bindings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    telegramThreadId: text('telegram_thread_id').notNull(),
    topicName: text('topic_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdRoleUnique: uniqueIndex('household_topic_bindings_household_role_unique').on(
      table.householdId,
      table.role
    ),
    householdThreadUnique: uniqueIndex('household_topic_bindings_household_thread_unique').on(
      table.householdId,
      table.telegramThreadId
    ),
    householdRoleIdx: index('household_topic_bindings_household_role_idx').on(
      table.householdId,
      table.role
    )
  })
)

export const householdJoinTokens = pgTable(
  'household_join_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    token: text('token').notNull(),
    createdByTelegramUserId: text('created_by_telegram_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdUnique: uniqueIndex('household_join_tokens_household_unique').on(table.householdId),
    tokenUnique: uniqueIndex('household_join_tokens_token_unique').on(table.token)
  })
)

export const householdPendingMembers = pgTable(
  'household_pending_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    telegramUserId: text('telegram_user_id').notNull(),
    displayName: text('display_name').notNull(),
    username: text('username'),
    languageCode: text('language_code'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdUserUnique: uniqueIndex('household_pending_members_household_user_unique').on(
      table.householdId,
      table.telegramUserId
    ),
    telegramUserIdx: index('household_pending_members_telegram_user_idx').on(table.telegramUserId)
  })
)

export const telegramPendingActions = pgTable(
  'telegram_pending_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    telegramUserId: text('telegram_user_id').notNull(),
    telegramChatId: text('telegram_chat_id').notNull(),
    action: text('action').notNull(),
    payload: jsonb('payload')
      .default(sql`'{}'::jsonb`)
      .notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    chatUserUnique: uniqueIndex('telegram_pending_actions_chat_user_unique').on(
      table.telegramChatId,
      table.telegramUserId
    ),
    userActionIdx: index('telegram_pending_actions_user_action_idx').on(
      table.telegramUserId,
      table.action
    )
  })
)

export const members = pgTable(
  'members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    telegramUserId: text('telegram_user_id').notNull(),
    displayName: text('display_name').notNull(),
    lifecycleStatus: text('lifecycle_status').default('active').notNull(),
    preferredLocale: text('preferred_locale'),
    rentShareWeight: integer('rent_share_weight').default(1).notNull(),
    isAdmin: integer('is_admin').default(0).notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdIdx: index('members_household_idx').on(table.householdId),
    householdTgUserUnique: uniqueIndex('members_household_tg_user_unique').on(
      table.householdId,
      table.telegramUserId
    )
  })
)

export const memberAbsencePolicies = pgTable(
  'member_absence_policies',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    effectiveFromPeriod: text('effective_from_period').notNull(),
    policy: text('policy').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdMemberPeriodUnique: uniqueIndex(
      'member_absence_policies_household_member_period_unique'
    ).on(table.householdId, table.memberId, table.effectiveFromPeriod),
    householdMemberIdx: index('member_absence_policies_household_member_idx').on(
      table.householdId,
      table.memberId
    )
  })
)

export const billingCycles = pgTable(
  'billing_cycles',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    period: text('period').notNull(),
    currency: text('currency').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdPeriodUnique: uniqueIndex('billing_cycles_household_period_unique').on(
      table.householdId,
      table.period
    ),
    householdPeriodIdx: index('billing_cycles_household_period_idx').on(
      table.householdId,
      table.period
    )
  })
)

export const rentRules = pgTable(
  'rent_rules',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    effectiveFromPeriod: text('effective_from_period').notNull(),
    effectiveToPeriod: text('effective_to_period'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdFromPeriodUnique: uniqueIndex('rent_rules_household_from_period_unique').on(
      table.householdId,
      table.effectiveFromPeriod
    ),
    householdFromPeriodIdx: index('rent_rules_household_from_period_idx').on(
      table.householdId,
      table.effectiveFromPeriod
    )
  })
)

export const billingCycleExchangeRates = pgTable(
  'billing_cycle_exchange_rates',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => billingCycles.id, { onDelete: 'cascade' }),
    sourceCurrency: text('source_currency').notNull(),
    targetCurrency: text('target_currency').notNull(),
    rateMicros: bigint('rate_micros', { mode: 'bigint' }).notNull(),
    effectiveDate: date('effective_date').notNull(),
    source: text('source').default('nbg').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    cyclePairUnique: uniqueIndex('billing_cycle_exchange_rates_cycle_pair_unique').on(
      table.cycleId,
      table.sourceCurrency,
      table.targetCurrency
    ),
    cycleIdx: index('billing_cycle_exchange_rates_cycle_idx').on(table.cycleId)
  })
)

export const utilityBills = pgTable(
  'utility_bills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => billingCycles.id, { onDelete: 'cascade' }),
    billName: text('bill_name').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    dueDate: date('due_date'),
    source: text('source').default('manual').notNull(),
    createdByMemberId: uuid('created_by_member_id').references(() => members.id, {
      onDelete: 'set null'
    }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    cycleIdx: index('utility_bills_cycle_idx').on(table.cycleId),
    householdCycleIdx: index('utility_bills_household_cycle_idx').on(
      table.householdId,
      table.cycleId
    )
  })
)

export const presenceOverrides = pgTable(
  'presence_overrides',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => billingCycles.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    utilityDays: integer('utility_days').notNull(),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    cycleMemberUnique: uniqueIndex('presence_overrides_cycle_member_unique').on(
      table.cycleId,
      table.memberId
    ),
    cycleIdx: index('presence_overrides_cycle_idx').on(table.cycleId)
  })
)

export const purchaseEntries = pgTable(
  'purchase_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').references(() => billingCycles.id, {
      onDelete: 'set null'
    }),
    payerMemberId: uuid('payer_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    rawText: text('raw_text').notNull(),
    normalizedText: text('normalized_text'),
    parserMode: text('parser_mode').notNull(),
    parserConfidence: integer('parser_confidence').notNull(),
    telegramChatId: text('telegram_chat_id'),
    telegramMessageId: text('telegram_message_id'),
    telegramThreadId: text('telegram_thread_id'),
    messageSentAt: timestamp('message_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdCycleIdx: index('purchase_entries_household_cycle_idx').on(
      table.householdId,
      table.cycleId
    ),
    payerIdx: index('purchase_entries_payer_idx').on(table.payerMemberId),
    tgMessageUnique: uniqueIndex('purchase_entries_household_tg_message_unique').on(
      table.householdId,
      table.telegramChatId,
      table.telegramMessageId
    )
  })
)

export const purchaseMessages = pgTable(
  'purchase_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    senderMemberId: uuid('sender_member_id').references(() => members.id, {
      onDelete: 'set null'
    }),
    payerMemberId: uuid('payer_member_id').references(() => members.id, {
      onDelete: 'set null'
    }),
    senderTelegramUserId: text('sender_telegram_user_id').notNull(),
    senderDisplayName: text('sender_display_name'),
    rawText: text('raw_text').notNull(),
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramMessageId: text('telegram_message_id').notNull(),
    telegramThreadId: text('telegram_thread_id').notNull(),
    telegramUpdateId: text('telegram_update_id').notNull(),
    messageSentAt: timestamp('message_sent_at', { withTimezone: true }),
    parsedAmountMinor: bigint('parsed_amount_minor', { mode: 'bigint' }),
    parsedCurrency: text('parsed_currency'),
    parsedItemDescription: text('parsed_item_description'),
    participantSplitMode: text('participant_split_mode').default('equal').notNull(),
    parserMode: text('parser_mode'),
    parserConfidence: integer('parser_confidence'),
    needsReview: integer('needs_review').default(1).notNull(),
    parserError: text('parser_error'),
    processingStatus: text('processing_status').default('pending').notNull(),
    ingestedAt: timestamp('ingested_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdThreadIdx: index('purchase_messages_household_thread_idx').on(
      table.householdId,
      table.telegramThreadId
    ),
    senderIdx: index('purchase_messages_sender_idx').on(table.senderTelegramUserId),
    tgMessageUnique: uniqueIndex('purchase_messages_household_tg_message_unique').on(
      table.householdId,
      table.telegramChatId,
      table.telegramMessageId
    ),
    tgUpdateUnique: uniqueIndex('purchase_messages_household_tg_update_unique').on(
      table.householdId,
      table.telegramUpdateId
    )
  })
)

export const purchaseMessageParticipants = pgTable(
  'purchase_message_participants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    purchaseMessageId: uuid('purchase_message_id')
      .notNull()
      .references(() => purchaseMessages.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'cascade' }),
    included: integer('included').default(1).notNull(),
    shareAmountMinor: bigint('share_amount_minor', { mode: 'bigint' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    purchaseMemberUnique: uniqueIndex('purchase_message_participants_purchase_member_unique').on(
      table.purchaseMessageId,
      table.memberId
    ),
    purchaseIdx: index('purchase_message_participants_purchase_idx').on(table.purchaseMessageId),
    memberIdx: index('purchase_message_participants_member_idx').on(table.memberId)
  })
)

export const processedBotMessages = pgTable(
  'processed_bot_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    sourceMessageKey: text('source_message_key').notNull(),
    payloadHash: text('payload_hash'),
    processedAt: timestamp('processed_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    sourceMessageUnique: uniqueIndex('processed_bot_messages_source_message_unique').on(
      table.householdId,
      table.source,
      table.sourceMessageKey
    )
  })
)

export const topicMessages = pgTable(
  'topic_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramThreadId: text('telegram_thread_id'),
    telegramMessageId: text('telegram_message_id'),
    telegramUpdateId: text('telegram_update_id'),
    senderTelegramUserId: text('sender_telegram_user_id'),
    senderDisplayName: text('sender_display_name'),
    isBot: integer('is_bot').default(0).notNull(),
    rawText: text('raw_text').notNull(),
    messageSentAt: timestamp('message_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdThreadSentIdx: index('topic_messages_household_thread_sent_idx').on(
      table.householdId,
      table.telegramChatId,
      table.telegramThreadId,
      table.messageSentAt
    ),
    householdChatSentIdx: index('topic_messages_household_chat_sent_idx').on(
      table.householdId,
      table.telegramChatId,
      table.messageSentAt
    ),
    householdMessageUnique: uniqueIndex('topic_messages_household_tg_message_unique').on(
      table.householdId,
      table.telegramChatId,
      table.telegramMessageId
    ),
    householdUpdateUnique: uniqueIndex('topic_messages_household_tg_update_unique').on(
      table.householdId,
      table.telegramUpdateId
    )
  })
)

export const anonymousMessages = pgTable(
  'anonymous_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    submittedByMemberId: uuid('submitted_by_member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    rawText: text('raw_text').notNull(),
    sanitizedText: text('sanitized_text'),
    moderationStatus: text('moderation_status').notNull(),
    moderationReason: text('moderation_reason'),
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramMessageId: text('telegram_message_id').notNull(),
    telegramUpdateId: text('telegram_update_id').notNull(),
    postedChatId: text('posted_chat_id'),
    postedThreadId: text('posted_thread_id'),
    postedMessageId: text('posted_message_id'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true })
  },
  (table) => ({
    householdUpdateUnique: uniqueIndex('anonymous_messages_household_tg_update_unique').on(
      table.householdId,
      table.telegramUpdateId
    ),
    memberCreatedIdx: index('anonymous_messages_member_created_idx').on(
      table.submittedByMemberId,
      table.createdAt
    ),
    statusCreatedIdx: index('anonymous_messages_status_created_idx').on(
      table.moderationStatus,
      table.createdAt
    )
  })
)

export const paymentConfirmations = pgTable(
  'payment_confirmations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id').references(() => billingCycles.id, { onDelete: 'set null' }),
    memberId: uuid('member_id').references(() => members.id, { onDelete: 'set null' }),
    senderTelegramUserId: text('sender_telegram_user_id').notNull(),
    rawText: text('raw_text').notNull(),
    normalizedText: text('normalized_text').notNull(),
    detectedKind: text('detected_kind'),
    explicitAmountMinor: bigint('explicit_amount_minor', { mode: 'bigint' }),
    explicitCurrency: text('explicit_currency'),
    resolvedAmountMinor: bigint('resolved_amount_minor', { mode: 'bigint' }),
    resolvedCurrency: text('resolved_currency'),
    status: text('status').notNull(),
    reviewReason: text('review_reason'),
    attachmentCount: integer('attachment_count').default(0).notNull(),
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramMessageId: text('telegram_message_id').notNull(),
    telegramThreadId: text('telegram_thread_id').notNull(),
    telegramUpdateId: text('telegram_update_id').notNull(),
    messageSentAt: timestamp('message_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    householdMessageUnique: uniqueIndex('payment_confirmations_household_tg_message_unique').on(
      table.householdId,
      table.telegramChatId,
      table.telegramMessageId
    ),
    householdUpdateUnique: uniqueIndex('payment_confirmations_household_tg_update_unique').on(
      table.householdId,
      table.telegramUpdateId
    ),
    householdStatusIdx: index('payment_confirmations_household_status_idx').on(
      table.householdId,
      table.status
    ),
    memberCreatedIdx: index('payment_confirmations_member_created_idx').on(
      table.memberId,
      table.createdAt
    )
  })
)

export const paymentRecords = pgTable(
  'payment_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => billingCycles.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    kind: text('kind').notNull(),
    amountMinor: bigint('amount_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    confirmationId: uuid('confirmation_id').references(() => paymentConfirmations.id, {
      onDelete: 'set null'
    }),
    recordedAt: timestamp('recorded_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    cycleMemberIdx: index('payment_records_cycle_member_idx').on(table.cycleId, table.memberId),
    cycleKindIdx: index('payment_records_cycle_kind_idx').on(table.cycleId, table.kind),
    confirmationUnique: uniqueIndex('payment_records_confirmation_unique').on(table.confirmationId)
  })
)

export const settlements = pgTable(
  'settlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    cycleId: uuid('cycle_id')
      .notNull()
      .references(() => billingCycles.id, { onDelete: 'cascade' }),
    inputHash: text('input_hash').notNull(),
    totalDueMinor: bigint('total_due_minor', { mode: 'bigint' }).notNull(),
    currency: text('currency').notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).defaultNow().notNull(),
    metadata: jsonb('metadata')
      .default(sql`'{}'::jsonb`)
      .notNull()
  },
  (table) => ({
    cycleUnique: uniqueIndex('settlements_cycle_unique').on(table.cycleId),
    householdComputedIdx: index('settlements_household_computed_idx').on(
      table.householdId,
      table.computedAt
    )
  })
)

export const settlementLines = pgTable(
  'settlement_lines',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    settlementId: uuid('settlement_id')
      .notNull()
      .references(() => settlements.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id')
      .notNull()
      .references(() => members.id, { onDelete: 'restrict' }),
    rentShareMinor: bigint('rent_share_minor', { mode: 'bigint' }).notNull(),
    utilityShareMinor: bigint('utility_share_minor', { mode: 'bigint' }).notNull(),
    purchaseOffsetMinor: bigint('purchase_offset_minor', { mode: 'bigint' }).notNull(),
    netDueMinor: bigint('net_due_minor', { mode: 'bigint' }).notNull(),
    explanations: jsonb('explanations')
      .default(sql`'[]'::jsonb`)
      .notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    settlementMemberUnique: uniqueIndex('settlement_lines_settlement_member_unique').on(
      table.settlementId,
      table.memberId
    ),
    settlementIdx: index('settlement_lines_settlement_idx').on(table.settlementId)
  })
)

export type Household = typeof households.$inferSelect
export type HouseholdBillingSettings = typeof householdBillingSettings.$inferSelect
export type HouseholdTelegramChat = typeof householdTelegramChats.$inferSelect
export type HouseholdTopicBinding = typeof householdTopicBindings.$inferSelect
export type HouseholdUtilityCategory = typeof householdUtilityCategories.$inferSelect
export type Member = typeof members.$inferSelect
export type BillingCycle = typeof billingCycles.$inferSelect
export type BillingCycleExchangeRate = typeof billingCycleExchangeRates.$inferSelect
export type UtilityBill = typeof utilityBills.$inferSelect
export type PurchaseEntry = typeof purchaseEntries.$inferSelect
export type PurchaseMessage = typeof purchaseMessages.$inferSelect
export type TopicMessage = typeof topicMessages.$inferSelect
export type AnonymousMessage = typeof anonymousMessages.$inferSelect
export type PaymentConfirmation = typeof paymentConfirmations.$inferSelect
export type PaymentRecord = typeof paymentRecords.$inferSelect
export type Settlement = typeof settlements.$inferSelect

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
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull()
})

export const members = pgTable(
  'members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    telegramUserId: text('telegram_user_id').notNull(),
    displayName: text('display_name').notNull(),
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
    senderTelegramUserId: text('sender_telegram_user_id').notNull(),
    senderDisplayName: text('sender_display_name'),
    rawText: text('raw_text').notNull(),
    telegramChatId: text('telegram_chat_id').notNull(),
    telegramMessageId: text('telegram_message_id').notNull(),
    telegramThreadId: text('telegram_thread_id').notNull(),
    telegramUpdateId: text('telegram_update_id').notNull(),
    messageSentAt: timestamp('message_sent_at', { withTimezone: true }),
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
export type Member = typeof members.$inferSelect
export type BillingCycle = typeof billingCycles.$inferSelect
export type UtilityBill = typeof utilityBills.$inferSelect
export type PurchaseEntry = typeof purchaseEntries.$inferSelect
export type PurchaseMessage = typeof purchaseMessages.$inferSelect
export type Settlement = typeof settlements.$inferSelect

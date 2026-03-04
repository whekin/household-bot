import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core'

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

import { and, asc, eq, sql } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import {
  instantToDate,
  normalizeSupportedLocale,
  nowInstant,
  type CurrencyCode
} from '@household/domain'
import {
  HOUSEHOLD_MEMBER_ABSENCE_POLICIES,
  HOUSEHOLD_MEMBER_LIFECYCLE_STATUSES,
  HOUSEHOLD_PAYMENT_BALANCE_ADJUSTMENT_POLICIES,
  HOUSEHOLD_TOPIC_ROLES,
  type HouseholdAssistantConfigRecord,
  type HouseholdMemberAbsencePolicy,
  type HouseholdMemberAbsencePolicyRecord,
  type HouseholdBillingSettingsRecord,
  type HouseholdConfigurationRepository,
  type HouseholdJoinTokenRecord,
  type HouseholdMemberLifecycleStatus,
  type HouseholdMemberRecord,
  type HouseholdPaymentBalanceAdjustmentPolicy,
  type HouseholdPendingMemberRecord,
  type HouseholdRentPaymentDestination,
  type HouseholdTelegramChatRecord,
  type HouseholdTopicBindingRecord,
  type HouseholdTopicRole,
  type HouseholdUtilityCategoryRecord,
  type ReminderTarget,
  type RegisterTelegramHouseholdChatResult
} from '@household/ports'

function normalizeTopicRole(role: string): HouseholdTopicRole {
  const normalized = role.trim().toLowerCase()

  if ((HOUSEHOLD_TOPIC_ROLES as readonly string[]).includes(normalized)) {
    return normalized as HouseholdTopicRole
  }

  throw new Error(`Unsupported household topic role: ${role}`)
}

function normalizeMemberLifecycleStatus(raw: string): HouseholdMemberLifecycleStatus {
  const normalized = raw.trim().toLowerCase()

  if ((HOUSEHOLD_MEMBER_LIFECYCLE_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as HouseholdMemberLifecycleStatus
  }

  throw new Error(`Unsupported household member lifecycle status: ${raw}`)
}

function normalizePaymentBalanceAdjustmentPolicy(
  raw: string
): HouseholdPaymentBalanceAdjustmentPolicy {
  const normalized = raw.trim().toLowerCase()

  if ((HOUSEHOLD_PAYMENT_BALANCE_ADJUSTMENT_POLICIES as readonly string[]).includes(normalized)) {
    return normalized as HouseholdPaymentBalanceAdjustmentPolicy
  }

  return 'utilities'
}

function normalizeMemberAbsencePolicy(raw: string): HouseholdMemberAbsencePolicy {
  const normalized = raw.trim().toLowerCase()

  if ((HOUSEHOLD_MEMBER_ABSENCE_POLICIES as readonly string[]).includes(normalized)) {
    return normalized as HouseholdMemberAbsencePolicy
  }

  throw new Error(`Unsupported household member absence policy: ${raw}`)
}

function toHouseholdTelegramChatRecord(row: {
  householdId: string
  householdName: string
  telegramChatId: string
  telegramChatType: string
  title: string | null
  defaultLocale: string
}): HouseholdTelegramChatRecord {
  const defaultLocale = normalizeSupportedLocale(row.defaultLocale)
  if (!defaultLocale) {
    throw new Error(`Unsupported household default locale: ${row.defaultLocale}`)
  }

  return {
    householdId: row.householdId,
    householdName: row.householdName,
    telegramChatId: row.telegramChatId,
    telegramChatType: row.telegramChatType,
    title: row.title,
    defaultLocale
  }
}

function toHouseholdTopicBindingRecord(row: {
  householdId: string
  role: string
  telegramThreadId: string
  topicName: string | null
}): HouseholdTopicBindingRecord {
  return {
    householdId: row.householdId,
    role: normalizeTopicRole(row.role),
    telegramThreadId: row.telegramThreadId,
    topicName: row.topicName
  }
}

function toHouseholdJoinTokenRecord(row: {
  householdId: string
  householdName: string
  token: string
  createdByTelegramUserId: string | null
}): HouseholdJoinTokenRecord {
  return {
    householdId: row.householdId,
    householdName: row.householdName,
    token: row.token,
    createdByTelegramUserId: row.createdByTelegramUserId
  }
}

function toHouseholdPendingMemberRecord(row: {
  householdId: string
  householdName: string
  telegramUserId: string
  displayName: string
  username: string | null
  languageCode: string | null
  defaultLocale: string
}): HouseholdPendingMemberRecord {
  const householdDefaultLocale = normalizeSupportedLocale(row.defaultLocale)
  if (!householdDefaultLocale) {
    throw new Error(`Unsupported household default locale: ${row.defaultLocale}`)
  }

  return {
    householdId: row.householdId,
    householdName: row.householdName,
    telegramUserId: row.telegramUserId,
    displayName: row.displayName,
    username: row.username,
    languageCode: row.languageCode,
    householdDefaultLocale
  }
}

function toHouseholdMemberRecord(row: {
  id: string
  householdId: string
  telegramUserId: string
  displayName: string
  lifecycleStatus: string
  preferredLocale: string | null
  defaultLocale: string
  rentShareWeight: number
  isAdmin: number
}): HouseholdMemberRecord {
  const householdDefaultLocale = normalizeSupportedLocale(row.defaultLocale)
  if (!householdDefaultLocale) {
    throw new Error(`Unsupported household default locale: ${row.defaultLocale}`)
  }

  return {
    id: row.id,
    householdId: row.householdId,
    telegramUserId: row.telegramUserId,
    displayName: row.displayName,
    status: normalizeMemberLifecycleStatus(row.lifecycleStatus),
    preferredLocale: normalizeSupportedLocale(row.preferredLocale),
    householdDefaultLocale,
    rentShareWeight: row.rentShareWeight,
    isAdmin: row.isAdmin === 1
  }
}

function toReminderTarget(row: {
  householdId: string
  householdName: string
  telegramChatId: string
  reminderThreadId: string | null
  defaultLocale: string
  timezone: string
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
}): ReminderTarget {
  const locale = normalizeSupportedLocale(row.defaultLocale)
  if (!locale) {
    throw new Error(`Unsupported household default locale: ${row.defaultLocale}`)
  }

  return {
    householdId: row.householdId,
    householdName: row.householdName,
    telegramChatId: row.telegramChatId,
    telegramThreadId: row.reminderThreadId,
    locale,
    timezone: row.timezone,
    rentDueDay: row.rentDueDay,
    rentWarningDay: row.rentWarningDay,
    utilitiesDueDay: row.utilitiesDueDay,
    utilitiesReminderDay: row.utilitiesReminderDay
  }
}

function toCurrencyCode(raw: string): CurrencyCode {
  const normalized = raw.trim().toUpperCase()

  if (normalized !== 'USD' && normalized !== 'GEL') {
    throw new Error(`Unsupported household billing currency: ${raw}`)
  }

  return normalized
}

function normalizeOptionalString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function parseRentPaymentDestinations(
  value: unknown
): readonly HouseholdRentPaymentDestination[] | null {
  if (value === null || value === undefined) return null
  if (!Array.isArray(value)) return null

  return value
    .map((entry): HouseholdRentPaymentDestination | null => {
      if (!entry || typeof entry !== 'object') return null
      const record = entry as Record<string, unknown>
      const label = normalizeOptionalString(record.label) ?? ''
      const account = normalizeOptionalString(record.account) ?? ''
      if (!label || !account) return null

      return {
        label,
        recipientName: normalizeOptionalString(record.recipientName),
        bankName: normalizeOptionalString(record.bankName),
        account,
        note: normalizeOptionalString(record.note),
        link: normalizeOptionalString(record.link)
      }
    })
    .filter((entry): entry is HouseholdRentPaymentDestination => Boolean(entry))
}

function toHouseholdBillingSettingsRecord(row: {
  householdId: string
  settlementCurrency: string
  paymentBalanceAdjustmentPolicy: string
  rentAmountMinor: bigint | null
  rentCurrency: string
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  timezone: string
  rentPaymentDestinations: unknown
}): HouseholdBillingSettingsRecord {
  return {
    householdId: row.householdId,
    settlementCurrency: toCurrencyCode(row.settlementCurrency),
    paymentBalanceAdjustmentPolicy: normalizePaymentBalanceAdjustmentPolicy(
      row.paymentBalanceAdjustmentPolicy
    ),
    rentAmountMinor: row.rentAmountMinor,
    rentCurrency: toCurrencyCode(row.rentCurrency),
    rentDueDay: row.rentDueDay,
    rentWarningDay: row.rentWarningDay,
    utilitiesDueDay: row.utilitiesDueDay,
    utilitiesReminderDay: row.utilitiesReminderDay,
    timezone: row.timezone,
    rentPaymentDestinations: parseRentPaymentDestinations(row.rentPaymentDestinations)
  }
}

function toHouseholdAssistantConfigRecord(row: {
  householdId: string
  assistantContext: string | null
  assistantTone: string | null
}): HouseholdAssistantConfigRecord {
  return {
    householdId: row.householdId,
    assistantContext: row.assistantContext,
    assistantTone: row.assistantTone
  }
}

function toHouseholdUtilityCategoryRecord(row: {
  id: string
  householdId: string
  slug: string
  name: string
  sortOrder: number
  isActive: number
}): HouseholdUtilityCategoryRecord {
  return {
    id: row.id,
    householdId: row.householdId,
    slug: row.slug,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive === 1
  }
}

function toHouseholdMemberAbsencePolicyRecord(row: {
  householdId: string
  memberId: string
  effectiveFromPeriod: string
  policy: string
}): HouseholdMemberAbsencePolicyRecord {
  return {
    householdId: row.householdId,
    memberId: row.memberId,
    effectiveFromPeriod: row.effectiveFromPeriod,
    policy: normalizeMemberAbsencePolicy(row.policy)
  }
}

function utilityCategorySlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48)
}

export function createDbHouseholdConfigurationRepository(databaseUrl: string): {
  repository: HouseholdConfigurationRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  const defaultUtilityCategories = [
    { slug: 'internet', name: 'Internet', sortOrder: 0 },
    { slug: 'gas_water', name: 'Gas (Water)', sortOrder: 1 },
    { slug: 'cleaning', name: 'Cleaning', sortOrder: 2 },
    { slug: 'electricity', name: 'Electricity', sortOrder: 3 }
  ] as const

  async function ensureBillingSettings(householdId: string): Promise<void> {
    await db
      .insert(schema.householdBillingSettings)
      .values({
        householdId
      })
      .onConflictDoNothing({
        target: [schema.householdBillingSettings.householdId]
      })
  }

  async function ensureUtilityCategories(householdId: string): Promise<void> {
    await db
      .insert(schema.householdUtilityCategories)
      .values(
        defaultUtilityCategories.map((category) => ({
          householdId,
          slug: category.slug,
          name: category.name,
          sortOrder: category.sortOrder
        }))
      )
      .onConflictDoNothing({
        target: [
          schema.householdUtilityCategories.householdId,
          schema.householdUtilityCategories.slug
        ]
      })
  }

  const repository: HouseholdConfigurationRepository = {
    async registerTelegramHouseholdChat(input) {
      return await db.transaction(async (tx): Promise<RegisterTelegramHouseholdChatResult> => {
        const existingRows = await tx
          .select({
            householdId: schema.householdTelegramChats.householdId,
            householdName: schema.households.name,
            telegramChatId: schema.householdTelegramChats.telegramChatId,
            telegramChatType: schema.householdTelegramChats.telegramChatType,
            title: schema.householdTelegramChats.title,
            defaultLocale: schema.households.defaultLocale
          })
          .from(schema.householdTelegramChats)
          .innerJoin(
            schema.households,
            eq(schema.householdTelegramChats.householdId, schema.households.id)
          )
          .where(eq(schema.householdTelegramChats.telegramChatId, input.telegramChatId))
          .limit(1)

        const existing = existingRows[0]
        if (existing) {
          const nextTitle = input.title?.trim() || existing.title

          await tx
            .update(schema.householdTelegramChats)
            .set({
              telegramChatType: input.telegramChatType,
              title: nextTitle,
              updatedAt: instantToDate(nowInstant())
            })
            .where(eq(schema.householdTelegramChats.telegramChatId, input.telegramChatId))

          return {
            status: 'existing',
            household: toHouseholdTelegramChatRecord({
              ...existing,
              telegramChatType: input.telegramChatType,
              title: nextTitle
            })
          }
        }

        const insertedHouseholds = await tx
          .insert(schema.households)
          .values({
            name: input.householdName
          })
          .returning({
            id: schema.households.id,
            name: schema.households.name,
            defaultLocale: schema.households.defaultLocale
          })

        const household = insertedHouseholds[0]
        if (!household) {
          throw new Error('Failed to create household record')
        }

        const insertedChats = await tx
          .insert(schema.householdTelegramChats)
          .values({
            householdId: household.id,
            telegramChatId: input.telegramChatId,
            telegramChatType: input.telegramChatType,
            title: input.title?.trim() || null
          })
          .returning({
            householdId: schema.householdTelegramChats.householdId,
            telegramChatId: schema.householdTelegramChats.telegramChatId,
            telegramChatType: schema.householdTelegramChats.telegramChatType,
            title: schema.householdTelegramChats.title
          })

        const chat = insertedChats[0]
        if (!chat) {
          throw new Error('Failed to create Telegram household chat binding')
        }

        return {
          status: 'created',
          household: toHouseholdTelegramChatRecord({
            householdId: chat.householdId,
            householdName: household.name,
            telegramChatId: chat.telegramChatId,
            telegramChatType: chat.telegramChatType,
            title: chat.title,
            defaultLocale: household.defaultLocale
          })
        }
      })
    },

    async getTelegramHouseholdChat(telegramChatId) {
      const rows = await db
        .select({
          householdId: schema.householdTelegramChats.householdId,
          householdName: schema.households.name,
          telegramChatId: schema.householdTelegramChats.telegramChatId,
          telegramChatType: schema.householdTelegramChats.telegramChatType,
          title: schema.householdTelegramChats.title,
          defaultLocale: schema.households.defaultLocale
        })
        .from(schema.householdTelegramChats)
        .innerJoin(
          schema.households,
          eq(schema.householdTelegramChats.householdId, schema.households.id)
        )
        .where(eq(schema.householdTelegramChats.telegramChatId, telegramChatId))
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdTelegramChatRecord(row) : null
    },

    async getHouseholdChatByHouseholdId(householdId) {
      const rows = await db
        .select({
          householdId: schema.householdTelegramChats.householdId,
          householdName: schema.households.name,
          telegramChatId: schema.householdTelegramChats.telegramChatId,
          telegramChatType: schema.householdTelegramChats.telegramChatType,
          title: schema.householdTelegramChats.title,
          defaultLocale: schema.households.defaultLocale
        })
        .from(schema.householdTelegramChats)
        .innerJoin(
          schema.households,
          eq(schema.householdTelegramChats.householdId, schema.households.id)
        )
        .where(eq(schema.householdTelegramChats.householdId, householdId))
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdTelegramChatRecord(row) : null
    },

    async bindHouseholdTopic(input) {
      const rows = await db
        .insert(schema.householdTopicBindings)
        .values({
          householdId: input.householdId,
          role: input.role,
          telegramThreadId: input.telegramThreadId,
          topicName: input.topicName?.trim() || null
        })
        .onConflictDoUpdate({
          target: [schema.householdTopicBindings.householdId, schema.householdTopicBindings.role],
          set: {
            telegramThreadId: input.telegramThreadId,
            topicName: input.topicName?.trim() || null,
            updatedAt: instantToDate(nowInstant())
          }
        })
        .returning({
          householdId: schema.householdTopicBindings.householdId,
          role: schema.householdTopicBindings.role,
          telegramThreadId: schema.householdTopicBindings.telegramThreadId,
          topicName: schema.householdTopicBindings.topicName
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to bind household topic')
      }

      return toHouseholdTopicBindingRecord(row)
    },

    async getHouseholdTopicBinding(householdId, role) {
      const rows = await db
        .select({
          householdId: schema.householdTopicBindings.householdId,
          role: schema.householdTopicBindings.role,
          telegramThreadId: schema.householdTopicBindings.telegramThreadId,
          topicName: schema.householdTopicBindings.topicName
        })
        .from(schema.householdTopicBindings)
        .where(
          and(
            eq(schema.householdTopicBindings.householdId, householdId),
            eq(schema.householdTopicBindings.role, role)
          )
        )
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdTopicBindingRecord(row) : null
    },

    async findHouseholdTopicByTelegramContext(input) {
      const rows = await db
        .select({
          householdId: schema.householdTopicBindings.householdId,
          role: schema.householdTopicBindings.role,
          telegramThreadId: schema.householdTopicBindings.telegramThreadId,
          topicName: schema.householdTopicBindings.topicName
        })
        .from(schema.householdTopicBindings)
        .innerJoin(
          schema.householdTelegramChats,
          eq(schema.householdTopicBindings.householdId, schema.householdTelegramChats.householdId)
        )
        .where(
          and(
            eq(schema.householdTelegramChats.telegramChatId, input.telegramChatId),
            eq(schema.householdTopicBindings.telegramThreadId, input.telegramThreadId)
          )
        )
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdTopicBindingRecord(row) : null
    },

    async listHouseholdTopicBindings(householdId) {
      const rows = await db
        .select({
          householdId: schema.householdTopicBindings.householdId,
          role: schema.householdTopicBindings.role,
          telegramThreadId: schema.householdTopicBindings.telegramThreadId,
          topicName: schema.householdTopicBindings.topicName
        })
        .from(schema.householdTopicBindings)
        .where(eq(schema.householdTopicBindings.householdId, householdId))
        .orderBy(schema.householdTopicBindings.role)

      return rows.map(toHouseholdTopicBindingRecord)
    },

    async clearHouseholdTopicBindings(householdId) {
      await db
        .delete(schema.householdTopicBindings)
        .where(eq(schema.householdTopicBindings.householdId, householdId))
    },

    async listReminderTargets() {
      const rows = await db
        .select({
          householdId: schema.householdTelegramChats.householdId,
          householdName: schema.households.name,
          telegramChatId: schema.householdTelegramChats.telegramChatId,
          reminderThreadId: schema.householdTopicBindings.telegramThreadId,
          defaultLocale: schema.households.defaultLocale,
          timezone:
            sql<string>`coalesce(${schema.householdBillingSettings.timezone}, 'Asia/Tbilisi')`.as(
              'timezone'
            ),
          rentDueDay: sql<number>`coalesce(${schema.householdBillingSettings.rentDueDay}, 20)`.as(
            'rent_due_day'
          ),
          rentWarningDay:
            sql<number>`coalesce(${schema.householdBillingSettings.rentWarningDay}, 17)`.as(
              'rent_warning_day'
            ),
          utilitiesDueDay:
            sql<number>`coalesce(${schema.householdBillingSettings.utilitiesDueDay}, 4)`.as(
              'utilities_due_day'
            ),
          utilitiesReminderDay:
            sql<number>`coalesce(${schema.householdBillingSettings.utilitiesReminderDay}, 3)`.as(
              'utilities_reminder_day'
            )
        })
        .from(schema.householdTelegramChats)
        .innerJoin(
          schema.households,
          eq(schema.householdTelegramChats.householdId, schema.households.id)
        )
        .leftJoin(
          schema.householdBillingSettings,
          eq(schema.householdBillingSettings.householdId, schema.householdTelegramChats.householdId)
        )
        .leftJoin(
          schema.householdTopicBindings,
          and(
            eq(
              schema.householdTopicBindings.householdId,
              schema.householdTelegramChats.householdId
            ),
            eq(schema.householdTopicBindings.role, 'reminders')
          )
        )
        .orderBy(asc(schema.householdTelegramChats.telegramChatId), asc(schema.households.name))

      return rows.map(toReminderTarget)
    },

    async upsertHouseholdJoinToken(input) {
      const rows = await db
        .insert(schema.householdJoinTokens)
        .values({
          householdId: input.householdId,
          token: input.token,
          createdByTelegramUserId: input.createdByTelegramUserId ?? null
        })
        .onConflictDoUpdate({
          target: [schema.householdJoinTokens.householdId],
          set: {
            token: input.token,
            createdByTelegramUserId: input.createdByTelegramUserId ?? null,
            updatedAt: instantToDate(nowInstant())
          }
        })
        .returning({
          householdId: schema.householdJoinTokens.householdId,
          token: schema.householdJoinTokens.token,
          createdByTelegramUserId: schema.householdJoinTokens.createdByTelegramUserId
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to save household join token')
      }

      const householdRows = await db
        .select({
          householdId: schema.households.id,
          householdName: schema.households.name
        })
        .from(schema.households)
        .where(eq(schema.households.id, row.householdId))
        .limit(1)

      const household = householdRows[0]
      if (!household) {
        throw new Error('Failed to resolve household for join token')
      }

      return toHouseholdJoinTokenRecord({
        householdId: row.householdId,
        householdName: household.householdName,
        token: row.token,
        createdByTelegramUserId: row.createdByTelegramUserId
      })
    },

    async getHouseholdJoinToken(householdId) {
      const rows = await db
        .select({
          householdId: schema.householdJoinTokens.householdId,
          householdName: schema.households.name,
          token: schema.householdJoinTokens.token,
          createdByTelegramUserId: schema.householdJoinTokens.createdByTelegramUserId
        })
        .from(schema.householdJoinTokens)
        .innerJoin(
          schema.households,
          eq(schema.householdJoinTokens.householdId, schema.households.id)
        )
        .where(eq(schema.householdJoinTokens.householdId, householdId))
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdJoinTokenRecord(row) : null
    },

    async getHouseholdByJoinToken(token) {
      const rows = await db
        .select({
          householdId: schema.householdJoinTokens.householdId,
          householdName: schema.households.name,
          telegramChatId: schema.householdTelegramChats.telegramChatId,
          telegramChatType: schema.householdTelegramChats.telegramChatType,
          title: schema.householdTelegramChats.title,
          defaultLocale: schema.households.defaultLocale
        })
        .from(schema.householdJoinTokens)
        .innerJoin(
          schema.households,
          eq(schema.householdJoinTokens.householdId, schema.households.id)
        )
        .innerJoin(
          schema.householdTelegramChats,
          eq(schema.householdJoinTokens.householdId, schema.householdTelegramChats.householdId)
        )
        .where(eq(schema.householdJoinTokens.token, token))
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdTelegramChatRecord(row) : null
    },

    async upsertPendingHouseholdMember(input) {
      const rows = await db
        .insert(schema.householdPendingMembers)
        .values({
          householdId: input.householdId,
          telegramUserId: input.telegramUserId,
          displayName: input.displayName,
          username: input.username?.trim() || null,
          languageCode: input.languageCode?.trim() || null
        })
        .onConflictDoUpdate({
          target: [
            schema.householdPendingMembers.householdId,
            schema.householdPendingMembers.telegramUserId
          ],
          set: {
            displayName: input.displayName,
            username: input.username?.trim() || null,
            languageCode: input.languageCode?.trim() || null,
            updatedAt: instantToDate(nowInstant())
          }
        })
        .returning({
          householdId: schema.householdPendingMembers.householdId,
          telegramUserId: schema.householdPendingMembers.telegramUserId,
          displayName: schema.householdPendingMembers.displayName,
          username: schema.householdPendingMembers.username,
          languageCode: schema.householdPendingMembers.languageCode
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to save pending household member')
      }

      const householdRows = await db
        .select({
          householdId: schema.households.id,
          householdName: schema.households.name,
          defaultLocale: schema.households.defaultLocale
        })
        .from(schema.households)
        .where(eq(schema.households.id, row.householdId))
        .limit(1)

      const household = householdRows[0]
      if (!household) {
        throw new Error('Failed to resolve household for pending member')
      }

      return toHouseholdPendingMemberRecord({
        householdId: row.householdId,
        householdName: household.householdName,
        telegramUserId: row.telegramUserId,
        displayName: row.displayName,
        username: row.username,
        languageCode: row.languageCode,
        defaultLocale: household.defaultLocale
      })
    },

    async getPendingHouseholdMember(householdId, telegramUserId) {
      const rows = await db
        .select({
          householdId: schema.householdPendingMembers.householdId,
          householdName: schema.households.name,
          telegramUserId: schema.householdPendingMembers.telegramUserId,
          displayName: schema.householdPendingMembers.displayName,
          username: schema.householdPendingMembers.username,
          languageCode: schema.householdPendingMembers.languageCode,
          defaultLocale: schema.households.defaultLocale
        })
        .from(schema.householdPendingMembers)
        .innerJoin(
          schema.households,
          eq(schema.householdPendingMembers.householdId, schema.households.id)
        )
        .where(
          and(
            eq(schema.householdPendingMembers.householdId, householdId),
            eq(schema.householdPendingMembers.telegramUserId, telegramUserId)
          )
        )
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdPendingMemberRecord(row) : null
    },

    async findPendingHouseholdMemberByTelegramUserId(telegramUserId) {
      const rows = await db
        .select({
          householdId: schema.householdPendingMembers.householdId,
          householdName: schema.households.name,
          telegramUserId: schema.householdPendingMembers.telegramUserId,
          displayName: schema.householdPendingMembers.displayName,
          username: schema.householdPendingMembers.username,
          languageCode: schema.householdPendingMembers.languageCode,
          defaultLocale: schema.households.defaultLocale
        })
        .from(schema.householdPendingMembers)
        .innerJoin(
          schema.households,
          eq(schema.householdPendingMembers.householdId, schema.households.id)
        )
        .where(eq(schema.householdPendingMembers.telegramUserId, telegramUserId))
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdPendingMemberRecord(row) : null
    },

    async ensureHouseholdMember(input) {
      const rows = await db
        .insert(schema.members)
        .values({
          householdId: input.householdId,
          telegramUserId: input.telegramUserId,
          displayName: input.displayName,
          lifecycleStatus: input.status ?? 'active',
          preferredLocale: input.preferredLocale ?? null,
          rentShareWeight: input.rentShareWeight ?? 1,
          isAdmin: input.isAdmin ? 1 : 0
        })
        .onConflictDoUpdate({
          target: [schema.members.householdId, schema.members.telegramUserId],
          set: {
            displayName: input.displayName,
            lifecycleStatus: input.status ?? schema.members.lifecycleStatus,
            preferredLocale: input.preferredLocale ?? schema.members.preferredLocale,
            rentShareWeight: input.rentShareWeight ?? schema.members.rentShareWeight,
            ...(input.isAdmin
              ? {
                  isAdmin: 1
                }
              : {})
          }
        })
        .returning({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to ensure household member')
      }

      const household = await this.getHouseholdChatByHouseholdId(row.householdId)
      if (!household) {
        throw new Error('Failed to resolve household for member')
      }

      return toHouseholdMemberRecord({
        ...row,
        defaultLocale: household.defaultLocale
      })
    },

    async getHouseholdMember(householdId, telegramUserId) {
      const rows = await db
        .select({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          defaultLocale: schema.households.defaultLocale,
          isAdmin: schema.members.isAdmin
        })
        .from(schema.members)
        .innerJoin(schema.households, eq(schema.members.householdId, schema.households.id))
        .where(
          and(
            eq(schema.members.householdId, householdId),
            eq(schema.members.telegramUserId, telegramUserId)
          )
        )
        .limit(1)

      const row = rows[0]
      return row ? toHouseholdMemberRecord(row) : null
    },

    async listHouseholdMembers(householdId) {
      const rows = await db
        .select({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          defaultLocale: schema.households.defaultLocale,
          isAdmin: schema.members.isAdmin
        })
        .from(schema.members)
        .innerJoin(schema.households, eq(schema.members.householdId, schema.households.id))
        .where(eq(schema.members.householdId, householdId))
        .orderBy(schema.members.displayName, schema.members.telegramUserId)

      return rows.map(toHouseholdMemberRecord)
    },

    async getHouseholdBillingSettings(householdId) {
      await ensureBillingSettings(householdId)

      const rows = await db
        .select({
          householdId: schema.householdBillingSettings.householdId,
          settlementCurrency: schema.householdBillingSettings.settlementCurrency,
          paymentBalanceAdjustmentPolicy:
            schema.householdBillingSettings.paymentBalanceAdjustmentPolicy,
          rentAmountMinor: schema.householdBillingSettings.rentAmountMinor,
          rentCurrency: schema.householdBillingSettings.rentCurrency,
          rentDueDay: schema.householdBillingSettings.rentDueDay,
          rentWarningDay: schema.householdBillingSettings.rentWarningDay,
          utilitiesDueDay: schema.householdBillingSettings.utilitiesDueDay,
          utilitiesReminderDay: schema.householdBillingSettings.utilitiesReminderDay,
          timezone: schema.householdBillingSettings.timezone,
          rentPaymentDestinations: schema.householdBillingSettings.rentPaymentDestinations
        })
        .from(schema.householdBillingSettings)
        .where(eq(schema.householdBillingSettings.householdId, householdId))
        .limit(1)

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to load household billing settings')
      }

      return toHouseholdBillingSettingsRecord(row)
    },

    async getHouseholdAssistantConfig(householdId) {
      const rows = await db
        .select({
          householdId: schema.households.id,
          assistantContext: schema.households.assistantContext,
          assistantTone: schema.households.assistantTone
        })
        .from(schema.households)
        .where(eq(schema.households.id, householdId))
        .limit(1)

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to load household assistant config')
      }

      return toHouseholdAssistantConfigRecord(row)
    },

    async updateHouseholdBillingSettings(input) {
      await ensureBillingSettings(input.householdId)

      const rows = await db
        .update(schema.householdBillingSettings)
        .set({
          ...(input.settlementCurrency
            ? {
                settlementCurrency: input.settlementCurrency
              }
            : {}),
          ...(input.paymentBalanceAdjustmentPolicy
            ? {
                paymentBalanceAdjustmentPolicy: input.paymentBalanceAdjustmentPolicy
              }
            : {}),
          ...(input.rentAmountMinor !== undefined
            ? {
                rentAmountMinor: input.rentAmountMinor
              }
            : {}),
          ...(input.rentCurrency
            ? {
                rentCurrency: input.rentCurrency
              }
            : {}),
          ...(input.rentDueDay !== undefined
            ? {
                rentDueDay: input.rentDueDay
              }
            : {}),
          ...(input.rentWarningDay !== undefined
            ? {
                rentWarningDay: input.rentWarningDay
              }
            : {}),
          ...(input.utilitiesDueDay !== undefined
            ? {
                utilitiesDueDay: input.utilitiesDueDay
              }
            : {}),
          ...(input.utilitiesReminderDay !== undefined
            ? {
                utilitiesReminderDay: input.utilitiesReminderDay
              }
            : {}),
          ...(input.timezone
            ? {
                timezone: input.timezone
              }
            : {}),
          ...(input.rentPaymentDestinations !== undefined
            ? {
                rentPaymentDestinations: input.rentPaymentDestinations
              }
            : {}),
          updatedAt: instantToDate(nowInstant())
        })
        .where(eq(schema.householdBillingSettings.householdId, input.householdId))
        .returning({
          householdId: schema.householdBillingSettings.householdId,
          settlementCurrency: schema.householdBillingSettings.settlementCurrency,
          paymentBalanceAdjustmentPolicy:
            schema.householdBillingSettings.paymentBalanceAdjustmentPolicy,
          rentAmountMinor: schema.householdBillingSettings.rentAmountMinor,
          rentCurrency: schema.householdBillingSettings.rentCurrency,
          rentDueDay: schema.householdBillingSettings.rentDueDay,
          rentWarningDay: schema.householdBillingSettings.rentWarningDay,
          utilitiesDueDay: schema.householdBillingSettings.utilitiesDueDay,
          utilitiesReminderDay: schema.householdBillingSettings.utilitiesReminderDay,
          timezone: schema.householdBillingSettings.timezone,
          rentPaymentDestinations: schema.householdBillingSettings.rentPaymentDestinations
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to update household billing settings')
      }

      return toHouseholdBillingSettingsRecord(row)
    },

    async updateHouseholdAssistantConfig(input) {
      const rows = await db
        .update(schema.households)
        .set({
          ...(input.assistantContext !== undefined
            ? {
                assistantContext: input.assistantContext
              }
            : {}),
          ...(input.assistantTone !== undefined
            ? {
                assistantTone: input.assistantTone
              }
            : {})
        })
        .where(eq(schema.households.id, input.householdId))
        .returning({
          householdId: schema.households.id,
          assistantContext: schema.households.assistantContext,
          assistantTone: schema.households.assistantTone
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to update household assistant config')
      }

      return toHouseholdAssistantConfigRecord(row)
    },

    async listHouseholdUtilityCategories(householdId) {
      await ensureUtilityCategories(householdId)

      const rows = await db
        .select({
          id: schema.householdUtilityCategories.id,
          householdId: schema.householdUtilityCategories.householdId,
          slug: schema.householdUtilityCategories.slug,
          name: schema.householdUtilityCategories.name,
          sortOrder: schema.householdUtilityCategories.sortOrder,
          isActive: schema.householdUtilityCategories.isActive
        })
        .from(schema.householdUtilityCategories)
        .where(eq(schema.householdUtilityCategories.householdId, householdId))
        .orderBy(
          asc(schema.householdUtilityCategories.sortOrder),
          asc(schema.householdUtilityCategories.name)
        )

      return rows.map(toHouseholdUtilityCategoryRecord)
    },

    async upsertHouseholdUtilityCategory(input) {
      const slug = utilityCategorySlug(input.slug ?? input.name)
      if (!slug) {
        throw new Error('Utility category slug cannot be empty')
      }

      const rows = await db
        .insert(schema.householdUtilityCategories)
        .values({
          householdId: input.householdId,
          slug,
          name: input.name.trim(),
          sortOrder: input.sortOrder,
          isActive: input.isActive ? 1 : 0
        })
        .onConflictDoUpdate({
          target: [
            schema.householdUtilityCategories.householdId,
            schema.householdUtilityCategories.slug
          ],
          set: {
            name: input.name.trim(),
            sortOrder: input.sortOrder,
            isActive: input.isActive ? 1 : 0,
            updatedAt: instantToDate(nowInstant())
          }
        })
        .returning({
          id: schema.householdUtilityCategories.id,
          householdId: schema.householdUtilityCategories.householdId,
          slug: schema.householdUtilityCategories.slug,
          name: schema.householdUtilityCategories.name,
          sortOrder: schema.householdUtilityCategories.sortOrder,
          isActive: schema.householdUtilityCategories.isActive
        })

      const row = rows[0]
      if (!row) {
        throw new Error('Failed to upsert household utility category')
      }

      return toHouseholdUtilityCategoryRecord(row)
    },

    async listHouseholdMembersByTelegramUserId(telegramUserId) {
      const rows = await db
        .select({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          defaultLocale: schema.households.defaultLocale,
          isAdmin: schema.members.isAdmin
        })
        .from(schema.members)
        .innerJoin(schema.households, eq(schema.members.householdId, schema.households.id))
        .where(eq(schema.members.telegramUserId, telegramUserId))
        .orderBy(schema.members.householdId, schema.members.displayName)

      return rows.map(toHouseholdMemberRecord)
    },

    async listPendingHouseholdMembers(householdId) {
      const rows = await db
        .select({
          householdId: schema.householdPendingMembers.householdId,
          householdName: schema.households.name,
          telegramUserId: schema.householdPendingMembers.telegramUserId,
          displayName: schema.householdPendingMembers.displayName,
          username: schema.householdPendingMembers.username,
          languageCode: schema.householdPendingMembers.languageCode,
          defaultLocale: schema.households.defaultLocale
        })
        .from(schema.householdPendingMembers)
        .innerJoin(
          schema.households,
          eq(schema.householdPendingMembers.householdId, schema.households.id)
        )
        .where(eq(schema.householdPendingMembers.householdId, householdId))
        .orderBy(schema.householdPendingMembers.createdAt)

      return rows.map(toHouseholdPendingMemberRecord)
    },

    async approvePendingHouseholdMember(input) {
      return await db.transaction(async (tx) => {
        const pendingRows = await tx
          .select({
            householdId: schema.householdPendingMembers.householdId,
            householdName: schema.households.name,
            telegramUserId: schema.householdPendingMembers.telegramUserId,
            displayName: schema.householdPendingMembers.displayName,
            username: schema.householdPendingMembers.username,
            languageCode: schema.householdPendingMembers.languageCode,
            defaultLocale: schema.households.defaultLocale
          })
          .from(schema.householdPendingMembers)
          .innerJoin(
            schema.households,
            eq(schema.householdPendingMembers.householdId, schema.households.id)
          )
          .where(
            and(
              eq(schema.householdPendingMembers.householdId, input.householdId),
              eq(schema.householdPendingMembers.telegramUserId, input.telegramUserId)
            )
          )
          .limit(1)

        const pending = pendingRows[0]
        if (!pending) {
          return null
        }

        const memberRows = await tx
          .insert(schema.members)
          .values({
            householdId: pending.householdId,
            telegramUserId: pending.telegramUserId,
            displayName: pending.displayName,
            lifecycleStatus: 'active',
            preferredLocale: normalizeSupportedLocale(pending.languageCode),
            rentShareWeight: 1,
            isAdmin: input.isAdmin ? 1 : 0
          })
          .onConflictDoUpdate({
            target: [schema.members.householdId, schema.members.telegramUserId],
            set: {
              displayName: pending.displayName,
              lifecycleStatus: 'active',
              preferredLocale:
                normalizeSupportedLocale(pending.languageCode) ?? schema.members.preferredLocale,
              ...(input.isAdmin
                ? {
                    isAdmin: 1
                  }
                : {})
            }
          })
          .returning({
            id: schema.members.id,
            householdId: schema.members.householdId,
            telegramUserId: schema.members.telegramUserId,
            displayName: schema.members.displayName,
            lifecycleStatus: schema.members.lifecycleStatus,
            preferredLocale: schema.members.preferredLocale,
            rentShareWeight: schema.members.rentShareWeight,
            isAdmin: schema.members.isAdmin
          })

        await tx
          .delete(schema.householdPendingMembers)
          .where(
            and(
              eq(schema.householdPendingMembers.householdId, input.householdId),
              eq(schema.householdPendingMembers.telegramUserId, input.telegramUserId)
            )
          )

        const member = memberRows[0]
        if (!member) {
          throw new Error('Failed to approve pending household member')
        }

        return toHouseholdMemberRecord({
          ...member,
          defaultLocale: pending.defaultLocale
        })
      })
    },

    async rejectPendingHouseholdMember(input) {
      const rows = await db
        .delete(schema.householdPendingMembers)
        .where(
          and(
            eq(schema.householdPendingMembers.householdId, input.householdId),
            eq(schema.householdPendingMembers.telegramUserId, input.telegramUserId)
          )
        )
        .returning({ telegramUserId: schema.householdPendingMembers.telegramUserId })

      return rows.length > 0
    },

    async updateHouseholdDefaultLocale(householdId, locale) {
      const updatedHouseholds = await db
        .update(schema.households)
        .set({
          defaultLocale: locale
        })
        .where(eq(schema.households.id, householdId))
        .returning({
          id: schema.households.id,
          name: schema.households.name,
          defaultLocale: schema.households.defaultLocale
        })

      const household = updatedHouseholds[0]
      if (!household) {
        throw new Error('Failed to update household default locale')
      }

      const chat = await this.getHouseholdChatByHouseholdId(householdId)
      if (!chat) {
        throw new Error('Failed to resolve household chat after locale update')
      }

      return {
        ...chat,
        defaultLocale: normalizeSupportedLocale(household.defaultLocale) ?? chat.defaultLocale
      }
    },

    async updateHouseholdName(householdId, householdName) {
      const updatedHouseholds = await db
        .update(schema.households)
        .set({
          name: householdName
        })
        .where(eq(schema.households.id, householdId))
        .returning({
          id: schema.households.id,
          name: schema.households.name,
          defaultLocale: schema.households.defaultLocale
        })

      const household = updatedHouseholds[0]
      if (!household) {
        throw new Error('Failed to update household name')
      }

      const chat = await this.getHouseholdChatByHouseholdId(householdId)
      if (!chat) {
        throw new Error('Failed to resolve household chat after name update')
      }

      return {
        ...chat,
        householdName: household.name
      }
    },

    async updateMemberPreferredLocale(householdId, telegramUserId, locale) {
      const rows = await db
        .update(schema.members)
        .set({
          preferredLocale: locale
        })
        .where(
          and(
            eq(schema.members.householdId, householdId),
            eq(schema.members.telegramUserId, telegramUserId)
          )
        )
        .returning({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })

      const row = rows[0]
      if (!row) {
        return null
      }

      const household = await this.getHouseholdChatByHouseholdId(householdId)
      if (!household) {
        throw new Error('Failed to resolve household chat after member locale update')
      }

      return toHouseholdMemberRecord({
        ...row,
        defaultLocale: household.defaultLocale
      })
    },

    async updateHouseholdMemberDisplayName(householdId, memberId, displayName) {
      const rows = await db
        .update(schema.members)
        .set({
          displayName
        })
        .where(and(eq(schema.members.householdId, householdId), eq(schema.members.id, memberId)))
        .returning({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })

      const row = rows[0]
      if (!row) {
        return null
      }

      const household = await this.getHouseholdChatByHouseholdId(householdId)
      if (!household) {
        throw new Error('Failed to resolve household chat after member display name update')
      }

      return toHouseholdMemberRecord({
        ...row,
        defaultLocale: household.defaultLocale
      })
    },

    async promoteHouseholdAdmin(householdId, memberId) {
      const rows = await db
        .update(schema.members)
        .set({
          isAdmin: 1
        })
        .where(and(eq(schema.members.householdId, householdId), eq(schema.members.id, memberId)))
        .returning({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })

      const row = rows[0]
      if (!row) {
        return null
      }

      const household = await this.getHouseholdChatByHouseholdId(householdId)
      if (!household) {
        throw new Error('Failed to resolve household chat after admin promotion')
      }

      return toHouseholdMemberRecord({
        ...row,
        defaultLocale: household.defaultLocale
      })
    },

    async demoteHouseholdAdmin(householdId, memberId) {
      const rows = await db
        .update(schema.members)
        .set({
          isAdmin: 0
        })
        .where(and(eq(schema.members.householdId, householdId), eq(schema.members.id, memberId)))
        .returning({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })

      const row = rows[0]
      if (!row) {
        return null
      }

      const household = await this.getHouseholdChatByHouseholdId(householdId)
      if (!household) {
        throw new Error('Failed to resolve household chat after household admin demotion')
      }

      return toHouseholdMemberRecord({
        ...row,
        defaultLocale: household.defaultLocale
      })
    },

    async updateHouseholdMemberRentShareWeight(householdId, memberId, rentShareWeight) {
      const rows = await db
        .update(schema.members)
        .set({
          rentShareWeight
        })
        .where(and(eq(schema.members.householdId, householdId), eq(schema.members.id, memberId)))
        .returning({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })

      const row = rows[0]
      if (!row) {
        return null
      }

      const household = await this.getHouseholdChatByHouseholdId(householdId)
      if (!household) {
        throw new Error('Failed to resolve household chat after rent weight update')
      }

      return toHouseholdMemberRecord({
        ...row,
        defaultLocale: household.defaultLocale
      })
    },

    async updateHouseholdMemberStatus(householdId, memberId, status) {
      const rows = await db
        .update(schema.members)
        .set({
          lifecycleStatus: status
        })
        .where(and(eq(schema.members.householdId, householdId), eq(schema.members.id, memberId)))
        .returning({
          id: schema.members.id,
          householdId: schema.members.householdId,
          telegramUserId: schema.members.telegramUserId,
          displayName: schema.members.displayName,
          lifecycleStatus: schema.members.lifecycleStatus,
          preferredLocale: schema.members.preferredLocale,
          rentShareWeight: schema.members.rentShareWeight,
          isAdmin: schema.members.isAdmin
        })

      const row = rows[0]
      if (!row) {
        return null
      }

      const household = await this.getHouseholdChatByHouseholdId(householdId)
      if (!household) {
        throw new Error('Failed to resolve household chat after member status update')
      }

      return toHouseholdMemberRecord({
        ...row,
        defaultLocale: household.defaultLocale
      })
    },

    async listHouseholdMemberAbsencePolicies(householdId) {
      const rows = await db
        .select({
          householdId: schema.memberAbsencePolicies.householdId,
          memberId: schema.memberAbsencePolicies.memberId,
          effectiveFromPeriod: schema.memberAbsencePolicies.effectiveFromPeriod,
          policy: schema.memberAbsencePolicies.policy
        })
        .from(schema.memberAbsencePolicies)
        .where(eq(schema.memberAbsencePolicies.householdId, householdId))
        .orderBy(
          asc(schema.memberAbsencePolicies.memberId),
          asc(schema.memberAbsencePolicies.effectiveFromPeriod)
        )

      return rows.map(toHouseholdMemberAbsencePolicyRecord)
    },

    async upsertHouseholdMemberAbsencePolicy(input) {
      const rows = await db
        .insert(schema.memberAbsencePolicies)
        .values({
          householdId: input.householdId,
          memberId: input.memberId,
          effectiveFromPeriod: input.effectiveFromPeriod,
          policy: input.policy
        })
        .onConflictDoUpdate({
          target: [
            schema.memberAbsencePolicies.householdId,
            schema.memberAbsencePolicies.memberId,
            schema.memberAbsencePolicies.effectiveFromPeriod
          ],
          set: {
            policy: input.policy,
            updatedAt: instantToDate(nowInstant())
          }
        })
        .returning({
          householdId: schema.memberAbsencePolicies.householdId,
          memberId: schema.memberAbsencePolicies.memberId,
          effectiveFromPeriod: schema.memberAbsencePolicies.effectiveFromPeriod,
          policy: schema.memberAbsencePolicies.policy
        })

      const row = rows[0]
      return row ? toHouseholdMemberAbsencePolicyRecord(row) : null
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}

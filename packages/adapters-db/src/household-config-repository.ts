import { and, eq } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import {
  HOUSEHOLD_TOPIC_ROLES,
  type HouseholdConfigurationRepository,
  type HouseholdTelegramChatRecord,
  type HouseholdTopicBindingRecord,
  type HouseholdTopicRole,
  type RegisterTelegramHouseholdChatResult
} from '@household/ports'

function normalizeTopicRole(role: string): HouseholdTopicRole {
  const normalized = role.trim().toLowerCase()

  if ((HOUSEHOLD_TOPIC_ROLES as readonly string[]).includes(normalized)) {
    return normalized as HouseholdTopicRole
  }

  throw new Error(`Unsupported household topic role: ${role}`)
}

function toHouseholdTelegramChatRecord(row: {
  householdId: string
  householdName: string
  telegramChatId: string
  telegramChatType: string
  title: string | null
}): HouseholdTelegramChatRecord {
  return {
    householdId: row.householdId,
    householdName: row.householdName,
    telegramChatId: row.telegramChatId,
    telegramChatType: row.telegramChatType,
    title: row.title
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

export function createDbHouseholdConfigurationRepository(databaseUrl: string): {
  repository: HouseholdConfigurationRepository
  close: () => Promise<void>
} {
  const { db, queryClient } = createDbClient(databaseUrl, {
    max: 5,
    prepare: false
  })

  const repository: HouseholdConfigurationRepository = {
    async registerTelegramHouseholdChat(input) {
      return await db.transaction(async (tx): Promise<RegisterTelegramHouseholdChatResult> => {
        const existingRows = await tx
          .select({
            householdId: schema.householdTelegramChats.householdId,
            householdName: schema.households.name,
            telegramChatId: schema.householdTelegramChats.telegramChatId,
            telegramChatType: schema.householdTelegramChats.telegramChatType,
            title: schema.householdTelegramChats.title
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
              updatedAt: new Date()
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
            name: schema.households.name
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
            title: chat.title
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
          title: schema.householdTelegramChats.title
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
            updatedAt: new Date()
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
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}

import { and, eq } from 'drizzle-orm'

import { createDbClient, schema } from '@household/db'
import {
  HOUSEHOLD_TOPIC_ROLES,
  type HouseholdConfigurationRepository,
  type HouseholdJoinTokenRecord,
  type HouseholdPendingMemberRecord,
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
}): HouseholdPendingMemberRecord {
  return {
    householdId: row.householdId,
    householdName: row.householdName,
    telegramUserId: row.telegramUserId,
    displayName: row.displayName,
    username: row.username,
    languageCode: row.languageCode
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
            updatedAt: new Date()
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
          title: schema.householdTelegramChats.title
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
            updatedAt: new Date()
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
          householdName: schema.households.name
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
        languageCode: row.languageCode
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
          languageCode: schema.householdPendingMembers.languageCode
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
          languageCode: schema.householdPendingMembers.languageCode
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
    }
  }

  return {
    repository,
    close: async () => {
      await queryClient.end({ timeout: 5 })
    }
  }
}

export interface AssistantConversationTurn {
  role: 'user' | 'assistant'
  text: string
}

interface AssistantConversationState {
  summary: string | null
  turns: AssistantConversationTurn[]
}

const MEMORY_SUMMARY_MAX_CHARS = 1200

export interface AssistantConversationMemoryStore {
  get(key: string): AssistantConversationState
  appendTurn(key: string, turn: AssistantConversationTurn): AssistantConversationState
}

export interface AssistantRateLimitResult {
  allowed: boolean
  retryAfterMs: number
}

export interface AssistantRateLimiter {
  consume(key: string): AssistantRateLimitResult
}

export interface AssistantUsageSnapshot {
  householdId: string
  telegramUserId: string
  displayName: string
  requestCount: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  updatedAt: string
}

export interface AssistantUsageTracker {
  record(input: {
    householdId: string
    telegramUserId: string
    displayName: string
    usage: {
      inputTokens: number
      outputTokens: number
      totalTokens: number
    }
  }): void
  listHouseholdUsage(householdId: string): readonly AssistantUsageSnapshot[]
}

function summarizeTurns(
  summary: string | null,
  turns: readonly AssistantConversationTurn[]
): string {
  const next = [summary, ...turns.map((turn) => `${turn.role}: ${turn.text}`)]
    .filter(Boolean)
    .join('\n')

  return next.length <= MEMORY_SUMMARY_MAX_CHARS
    ? next
    : next.slice(next.length - MEMORY_SUMMARY_MAX_CHARS)
}

export function conversationMemoryKey(input: {
  telegramUserId: string
  telegramChatId: string
  isPrivateChat: boolean
}): string {
  return input.isPrivateChat
    ? input.telegramUserId
    : `group:${input.telegramChatId}:${input.telegramUserId}`
}

export function createInMemoryAssistantConversationMemoryStore(
  maxTurns: number
): AssistantConversationMemoryStore {
  const memory = new Map<string, AssistantConversationState>()

  return {
    get(key) {
      return memory.get(key) ?? { summary: null, turns: [] }
    },

    appendTurn(key, turn) {
      const current = memory.get(key) ?? { summary: null, turns: [] }
      const nextTurns = [...current.turns, turn]

      if (nextTurns.length <= maxTurns) {
        const nextState = {
          summary: current.summary,
          turns: nextTurns
        }
        memory.set(key, nextState)
        return nextState
      }

      const overflowCount = nextTurns.length - maxTurns
      const overflow = nextTurns.slice(0, overflowCount)
      const retained = nextTurns.slice(overflowCount)
      const nextState = {
        summary: summarizeTurns(current.summary, overflow),
        turns: retained
      }
      memory.set(key, nextState)
      return nextState
    }
  }
}

export function createInMemoryAssistantRateLimiter(config: {
  burstLimit: number
  burstWindowMs: number
  rollingLimit: number
  rollingWindowMs: number
}): AssistantRateLimiter {
  const timestamps = new Map<string, number[]>()

  return {
    consume(key) {
      const now = Date.now()
      const events = (timestamps.get(key) ?? []).filter(
        (timestamp) => now - timestamp < config.rollingWindowMs
      )
      const burstEvents = events.filter((timestamp) => now - timestamp < config.burstWindowMs)

      if (burstEvents.length >= config.burstLimit) {
        const oldestBurstEvent = burstEvents[0] ?? now
        return {
          allowed: false,
          retryAfterMs: Math.max(1, config.burstWindowMs - (now - oldestBurstEvent))
        }
      }

      if (events.length >= config.rollingLimit) {
        const oldestEvent = events[0] ?? now
        return {
          allowed: false,
          retryAfterMs: Math.max(1, config.rollingWindowMs - (now - oldestEvent))
        }
      }

      events.push(now)
      timestamps.set(key, events)

      return {
        allowed: true,
        retryAfterMs: 0
      }
    }
  }
}

export function createInMemoryAssistantUsageTracker(): AssistantUsageTracker {
  const usage = new Map<string, AssistantUsageSnapshot>()

  return {
    record(input) {
      const key = `${input.householdId}:${input.telegramUserId}`
      const current = usage.get(key)

      usage.set(key, {
        householdId: input.householdId,
        telegramUserId: input.telegramUserId,
        displayName: input.displayName,
        requestCount: (current?.requestCount ?? 0) + 1,
        inputTokens: (current?.inputTokens ?? 0) + input.usage.inputTokens,
        outputTokens: (current?.outputTokens ?? 0) + input.usage.outputTokens,
        totalTokens: (current?.totalTokens ?? 0) + input.usage.totalTokens,
        updatedAt: new Date().toISOString()
      })
    },

    listHouseholdUsage(householdId) {
      return [...usage.values()]
        .filter((entry) => entry.householdId === householdId)
        .sort((left, right) => right.totalTokens - left.totalTokens)
    }
  }
}

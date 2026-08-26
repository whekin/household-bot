import type { BotLocale } from './i18n'

export interface CachedHouseholdFact {
  key: string
  title: string
}

export interface CachedHouseholdContext {
  householdContext: string | null
  assistantTone: string | null
  factIndex?: readonly CachedHouseholdFact[]
  defaultCurrency: 'GEL' | 'USD'
  timezone: string
  locale: BotLocale
  cachedAt: number
}

interface CacheEntry {
  context: CachedHouseholdContext
  expiresAt: number
}

export class HouseholdContextCache {
  private cache = new Map<string, CacheEntry>()

  constructor(private ttlMs: number = 5 * 60_000) {}

  async get(
    householdId: string,
    loader: () => Promise<CachedHouseholdContext>
  ): Promise<CachedHouseholdContext> {
    const now = Date.now()
    const entry = this.cache.get(householdId)

    if (entry && entry.expiresAt > now) {
      return entry.context
    }

    const context = await loader()
    this.cache.set(householdId, {
      context,
      expiresAt: now + this.ttlMs
    })

    return context
  }

  invalidate(householdId: string): void {
    this.cache.delete(householdId)
  }

  clear(): void {
    this.cache.clear()
  }
}

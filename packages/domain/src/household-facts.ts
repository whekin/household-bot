export const HOUSEHOLD_FACT_KEY_MAX_LENGTH = 48
export const HOUSEHOLD_FACT_TITLE_MAX_LENGTH = 120
export const HOUSEHOLD_FACT_BODY_MAX_LENGTH = 2000
export const HOUSEHOLD_FACT_LIMIT = 100

/**
 * Fact keys are ASCII slugs so the agent can address a fact reliably; titles keep
 * the original wording (including Cyrillic) for humans.
 */
export function householdFactKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, HOUSEHOLD_FACT_KEY_MAX_LENGTH)
    .replace(/-+$/g, '')
}

export interface NormalizedHouseholdFact {
  key: string
  title: string
  body: string
}

/**
 * Titles are frequently non-ASCII, so a title alone cannot always produce a key.
 * Callers must then supply an explicit key.
 */
export function normalizeHouseholdFact(input: {
  key?: string | null
  title: string
  body: string
}): NormalizedHouseholdFact | null {
  const title = input.title.trim().slice(0, HOUSEHOLD_FACT_TITLE_MAX_LENGTH)
  const body = input.body.trim().slice(0, HOUSEHOLD_FACT_BODY_MAX_LENGTH)
  const key = householdFactKey(input.key?.trim() ? input.key : title)

  if (!key || !title || !body) {
    return null
  }

  return { key, title, body }
}

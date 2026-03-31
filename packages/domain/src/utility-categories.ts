export const UTILITY_CATEGORIES = [
  'Electricity',
  'Water',
  'Gas',
  'Internet',
  'Heating',
  'Trash',
  'HOA',
  'Other'
] as const

export type UtilityCategory = (typeof UTILITY_CATEGORIES)[number]

export function isUtilityCategory(value: string): value is UtilityCategory {
  return UTILITY_CATEGORIES.includes(value as UtilityCategory)
}

export function normalizeUtilityCategory(value: string): UtilityCategory | null {
  const normalized = value.trim()
  const match = UTILITY_CATEGORIES.find((cat) => cat.toLowerCase() === normalized.toLowerCase())
  return match ?? null
}

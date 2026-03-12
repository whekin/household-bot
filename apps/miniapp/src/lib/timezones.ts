const CURATED_TIMEZONES = [
  'Asia/Tbilisi',
  'Europe/Berlin',
  'Europe/London',
  'Europe/Paris',
  'Europe/Warsaw',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'Asia/Dubai',
  'Asia/Bangkok',
  'Asia/Tokyo',
  'Australia/Sydney'
] as const

const CURATED_TIMEZONE_SET = new Set<string>(CURATED_TIMEZONES)

type IntlWithSupportedValues = typeof Intl & {
  supportedValuesOf?: (key: 'timeZone') => readonly string[]
}

function supportedTimezones(): readonly string[] {
  const withSupportedValues = Intl as IntlWithSupportedValues

  if (typeof withSupportedValues.supportedValuesOf === 'function') {
    try {
      const supported = withSupportedValues.supportedValuesOf('timeZone')
      if (supported.length > 0) {
        return supported
      }
    } catch {
      // Ignore and fall back to the curated list below.
    }
  }

  return CURATED_TIMEZONES
}

const TIMEZONES = [
  ...CURATED_TIMEZONES,
  ...supportedTimezones()
    .filter((timezone) => !CURATED_TIMEZONE_SET.has(timezone))
    .sort((left, right) => left.localeCompare(right))
]

export function canonicalizeTimezone(value: string): string | null {
  const trimmed = value.trim()

  if (trimmed.length === 0) {
    return null
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: trimmed
    }).resolvedOptions().timeZone
  } catch {
    return null
  }
}

export function isValidTimezone(value: string): boolean {
  return canonicalizeTimezone(value) !== null
}

export function searchTimezones(query: string, limit = 10): readonly string[] {
  const trimmed = query.trim()

  if (trimmed.length === 0) {
    return TIMEZONES.slice(0, limit)
  }

  const normalized = trimmed.toLowerCase()
  const matches = TIMEZONES.filter((timezone) => timezone.toLowerCase().includes(normalized))

  if (matches.length === 0) {
    return TIMEZONES.slice(0, limit)
  }

  matches.sort((left, right) => {
    const leftStartsWith = left.toLowerCase().startsWith(normalized)
    const rightStartsWith = right.toLowerCase().startsWith(normalized)

    if (leftStartsWith !== rightStartsWith) {
      return leftStartsWith ? -1 : 1
    }

    return left.localeCompare(right)
  })

  return matches.slice(0, limit)
}

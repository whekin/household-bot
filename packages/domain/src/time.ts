import { Temporal } from '@js-temporal/polyfill'

export { Temporal }

export type Instant = Temporal.Instant

export function nowInstant(): Instant {
  return Temporal.Now.instant()
}

export function instantFromEpochSeconds(epochSeconds: number): Instant {
  return Temporal.Instant.fromEpochMilliseconds(epochSeconds * 1000)
}

export function instantToEpochSeconds(instant: Instant): number {
  return Math.floor(instant.epochMilliseconds / 1000)
}

export function instantFromDate(date: Date): Instant {
  return Temporal.Instant.fromEpochMilliseconds(date.getTime())
}

export function instantToDate(instant: Instant): Date {
  return new Date(instant.epochMilliseconds)
}

export function instantFromIso(value: string): Instant {
  return Temporal.Instant.from(value)
}

export function instantFromDatabaseValue(value: Date | string | null): Instant | null {
  if (value instanceof Date) {
    return instantFromDate(value)
  }

  if (typeof value === 'string') {
    return instantFromIso(value)
  }

  return null
}

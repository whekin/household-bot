import type { ExchangeRateProvider, FinanceRepository } from '@household/ports'
import { BillingPeriod, Temporal, nowInstant, type CurrencyCode } from '@household/domain'

export interface ResolvedCycleExchangeRate {
  rateMicros: bigint
  effectiveDate: string
  /** True when the provider was unreachable and an older stored rate was reused. */
  stale: boolean
}

export type CycleExchangeRateRepository = Pick<
  FinanceRepository,
  'getCycleExchangeRate' | 'saveCycleExchangeRate' | 'getLatestExchangeRate'
>

export function billingPeriodLockDate(period: BillingPeriod, day: number): Temporal.PlainDate {
  const firstDay = Temporal.PlainDate.from({
    year: period.year,
    month: period.month,
    day: 1
  })
  const clampedDay = Math.min(day, firstDay.daysInMonth)

  return Temporal.PlainDate.from({
    year: period.year,
    month: period.month,
    day: clampedDay
  })
}

export function localDateInTimezone(timezone: string): Temporal.PlainDate {
  return nowInstant().toZonedDateTimeISO(timezone).toPlainDate()
}

/**
 * Resolves the cycle's source→settlement rate: the rate locked on the cycle, else a live
 * quote, else the newest rate the household already stored. The fallback keeps rent math
 * working while the rate provider is down instead of failing every payment and dashboard;
 * a stale rate is never written to the cycle, so the next call retries the provider.
 */
export async function resolveCycleExchangeRate(input: {
  repository: CycleExchangeRateRepository
  exchangeRateProvider: ExchangeRateProvider
  cycleId: string
  sourceCurrency: CurrencyCode
  targetCurrency: CurrencyCode
  period: BillingPeriod
  lockDay: number
  timezone: string
}): Promise<ResolvedCycleExchangeRate> {
  const existingRate = await input.repository.getCycleExchangeRate(
    input.cycleId,
    input.sourceCurrency,
    input.targetCurrency
  )

  if (existingRate) {
    return {
      rateMicros: existingRate.rateMicros,
      effectiveDate: existingRate.effectiveDate,
      stale: false
    }
  }

  const lockDate = billingPeriodLockDate(input.period, input.lockDay)
  const shouldPersist =
    Temporal.PlainDate.compare(localDateInTimezone(input.timezone), lockDate) >= 0

  try {
    const quote = await input.exchangeRateProvider.getRate({
      baseCurrency: input.sourceCurrency,
      quoteCurrency: input.targetCurrency,
      effectiveDate: lockDate.toString()
    })

    if (shouldPersist) {
      await input.repository.saveCycleExchangeRate({
        cycleId: input.cycleId,
        sourceCurrency: quote.baseCurrency,
        targetCurrency: quote.quoteCurrency,
        rateMicros: quote.rateMicros,
        effectiveDate: quote.effectiveDate,
        source: quote.source
      })
    }

    return {
      rateMicros: quote.rateMicros,
      effectiveDate: quote.effectiveDate,
      stale: false
    }
  } catch (error) {
    const lastKnownRate = await input.repository.getLatestExchangeRate(
      input.sourceCurrency,
      input.targetCurrency
    )
    if (!lastKnownRate) {
      throw error
    }

    return {
      rateMicros: lastKnownRate.rateMicros,
      effectiveDate: lastKnownRate.effectiveDate,
      stale: true
    }
  }
}

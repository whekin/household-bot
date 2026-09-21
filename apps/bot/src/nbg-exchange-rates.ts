import { FX_RATE_SCALE_MICROS, type CurrencyCode } from '@household/domain'
import type { ExchangeRateProvider } from '@household/ports'
import type { Logger } from '@household/observability'

interface NbgCurrencyPayload {
  code: string
  quantity: number
  rateFormated?: string
  rate?: number
  validFromDate?: string
}

interface NbgDayPayload {
  date?: string
  currencies?: NbgCurrencyPayload[]
}

function parseScaledDecimal(value: string, scale: number): bigint {
  const trimmed = value.trim()
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(trimmed)
  if (!match) {
    throw new Error(`Invalid decimal value: ${value}`)
  }

  const [, sign, whole, fraction = ''] = match
  const normalizedFraction = fraction.padEnd(scale, '0').slice(0, scale)
  const digits = `${whole}${normalizedFraction}`
  const parsed = BigInt(digits)

  return sign === '-' ? -parsed : parsed
}

function divideRoundedHalfUp(dividend: bigint, divisor: bigint): bigint {
  if (divisor === 0n) {
    throw new Error('Division by zero')
  }

  const quotient = dividend / divisor
  const remainder = dividend % divisor
  if (remainder * 2n >= divisor) {
    return quotient + 1n
  }

  return quotient
}

/** A published rate never changes, but the cache must not outlive a long-running process. */
const RATE_CACHE_TTL_MS = 12 * 60 * 60_000
const REQUEST_TIMEOUT_MS = 5_000
const REQUEST_ATTEMPTS = 3
const RETRY_DELAY_MS = 300

interface GelRate {
  gelRateMicros: bigint
  effectiveDate: string
}

type NbgFetch = (url: URL, init: { signal: AbortSignal }) => Promise<Response>

class RetryableNbgError extends Error {}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export function createNbgExchangeRateProvider(
  options: {
    fetchImpl?: NbgFetch
    logger?: Logger
    now?: () => number
    requestTimeoutMs?: number
    maxAttempts?: number
    retryDelayMs?: number
  } = {}
): ExchangeRateProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  const maxAttempts = options.maxAttempts ?? REQUEST_ATTEMPTS
  const retryDelayMs = options.retryDelayMs ?? RETRY_DELAY_MS
  // Only settled rates are cached: a failed lookup must never poison the next one.
  const cache = new Map<string, { value: GelRate; expiresAt: number }>()
  const inFlight = new Map<string, Promise<GelRate>>()

  async function fetchGelRate(currency: CurrencyCode, effectiveDate: string): Promise<GelRate> {
    const url = new URL('https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/')
    url.searchParams.set('currencies', currency)
    url.searchParams.set('date', effectiveDate)

    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), requestTimeoutMs)
    let response: Response
    try {
      response = await fetchImpl(url, { signal: abortController.signal })
    } catch (error) {
      throw new RetryableNbgError(`NBG request failed: ${(error as Error).message}`)
    } finally {
      clearTimeout(timeout)
    }

    if (!response.ok) {
      const message = `NBG request failed: ${response.status}`
      throw response.status >= 500 || response.status === 429
        ? new RetryableNbgError(message)
        : new Error(message)
    }

    const payload = (await response.json()) as NbgDayPayload[]
    const day = payload[0]
    const currencyPayload = day?.currencies?.find((entry) => entry.code === currency)
    if (!currencyPayload) {
      throw new Error(`NBG rate missing for ${currency} on ${effectiveDate}`)
    }

    const quantity = Number(currencyPayload.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Invalid NBG quantity for ${currency}: ${currencyPayload.quantity}`)
    }

    const rateString =
      currencyPayload.rateFormated ??
      (typeof currencyPayload.rate === 'number' ? currencyPayload.rate.toFixed(6) : null)
    if (!rateString) {
      throw new Error(`Invalid NBG rate for ${currency} on ${effectiveDate}`)
    }

    const effective =
      currencyPayload.validFromDate?.slice(0, 10) ?? day?.date?.slice(0, 10) ?? effectiveDate
    const gelRateMicros = divideRoundedHalfUp(parseScaledDecimal(rateString, 6), BigInt(quantity))

    options.logger?.debug(
      {
        event: 'fx.nbg_fetched',
        currency,
        requestedDate: effectiveDate,
        effectiveDate: effective,
        gelRateMicros: gelRateMicros.toString()
      },
      'Fetched NBG exchange rate'
    )

    return {
      gelRateMicros,
      effectiveDate: effective
    }
  }

  async function fetchGelRateWithRetries(
    currency: CurrencyCode,
    effectiveDate: string
  ): Promise<GelRate> {
    let lastError: unknown

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        return await fetchGelRate(currency, effectiveDate)
      } catch (error) {
        lastError = error
        if (!(error instanceof RetryableNbgError) || attempt === maxAttempts) {
          break
        }

        options.logger?.warn(
          {
            event: 'fx.nbg_retry',
            currency,
            requestedDate: effectiveDate,
            attempt,
            err: error
          },
          'Retrying NBG exchange rate request'
        )
        await delay(retryDelayMs * attempt)
      }
    }

    options.logger?.error(
      {
        event: 'fx.nbg_failed',
        currency,
        requestedDate: effectiveDate,
        err: lastError
      },
      'NBG exchange rate lookup failed'
    )
    throw lastError
  }

  async function getGelRate(currency: CurrencyCode, effectiveDate: string): Promise<GelRate> {
    if (currency === 'GEL') {
      return {
        gelRateMicros: FX_RATE_SCALE_MICROS,
        effectiveDate
      }
    }

    const cacheKey = `${currency}:${effectiveDate}`
    const cached = cache.get(cacheKey)
    if (cached && cached.expiresAt > now()) {
      return cached.value
    }

    const pending = inFlight.get(cacheKey)
    if (pending) {
      return pending
    }

    const request = fetchGelRateWithRetries(currency, effectiveDate)
      .then((value) => {
        cache.set(cacheKey, { value, expiresAt: now() + RATE_CACHE_TTL_MS })
        return value
      })
      .finally(() => {
        inFlight.delete(cacheKey)
      })

    inFlight.set(cacheKey, request)
    return request
  }

  return {
    async getRate(input) {
      if (input.baseCurrency === input.quoteCurrency) {
        return {
          baseCurrency: input.baseCurrency,
          quoteCurrency: input.quoteCurrency,
          rateMicros: FX_RATE_SCALE_MICROS,
          effectiveDate: input.effectiveDate,
          source: 'nbg'
        }
      }

      const [base, quote] = await Promise.all([
        getGelRate(input.baseCurrency, input.effectiveDate),
        getGelRate(input.quoteCurrency, input.effectiveDate)
      ])

      const rateMicros = divideRoundedHalfUp(
        base.gelRateMicros * FX_RATE_SCALE_MICROS,
        quote.gelRateMicros
      )
      const effectiveDate =
        base.effectiveDate > quote.effectiveDate ? base.effectiveDate : quote.effectiveDate

      return {
        baseCurrency: input.baseCurrency,
        quoteCurrency: input.quoteCurrency,
        rateMicros,
        effectiveDate,
        source: 'nbg'
      }
    }
  }
}

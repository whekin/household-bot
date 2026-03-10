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

export function createNbgExchangeRateProvider(
  options: {
    fetchImpl?: typeof fetch
    logger?: Logger
  } = {}
): ExchangeRateProvider {
  const fetchImpl = options.fetchImpl ?? fetch
  const cache = new Map<string, Promise<{ gelRateMicros: bigint; effectiveDate: string }>>()

  async function getGelRate(currency: CurrencyCode, effectiveDate: string) {
    if (currency === 'GEL') {
      return {
        gelRateMicros: FX_RATE_SCALE_MICROS,
        effectiveDate
      }
    }

    const cacheKey = `${currency}:${effectiveDate}`
    const existing = cache.get(cacheKey)
    if (existing) {
      return existing
    }

    const request = (async () => {
      const url = new URL('https://nbg.gov.ge/gw/api/ct/monetarypolicy/currencies/en/json/')
      url.searchParams.set('currencies', currency)
      url.searchParams.set('date', effectiveDate)

      const response = await fetchImpl(url)
      if (!response.ok) {
        throw new Error(`NBG request failed: ${response.status}`)
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
    })()

    cache.set(cacheKey, request)
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

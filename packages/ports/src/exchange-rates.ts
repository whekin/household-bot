import type { CurrencyCode } from '@household/domain'

export interface ExchangeRateQuote {
  baseCurrency: CurrencyCode
  quoteCurrency: CurrencyCode
  rateMicros: bigint
  effectiveDate: string
  source: 'nbg'
}

export interface ExchangeRateProvider {
  getRate(input: {
    baseCurrency: CurrencyCode
    quoteCurrency: CurrencyCode
    effectiveDate: string
  }): Promise<ExchangeRateQuote>
}

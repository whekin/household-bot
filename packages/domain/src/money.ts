import { DOMAIN_ERROR_CODE, DomainError } from './errors'

export const CURRENCIES = ['GEL', 'USD'] as const

export type CurrencyCode = (typeof CURRENCIES)[number]

const MAJOR_MONEY_PATTERN = /^([+-]?)(\d+)(?:\.(\d{1,2}))?$/

function isIntegerNumber(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value)
}

function parseMinorUnits(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') {
    return value
  }

  if (typeof value === 'number') {
    if (!isIntegerNumber(value)) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_MONEY_AMOUNT,
        'Money minor amount must be an integer'
      )
    }

    return BigInt(value)
  }

  if (!/^[+-]?\d+$/.test(value)) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_MONEY_AMOUNT,
      'Money minor amount string must contain only integer digits'
    )
  }

  return BigInt(value)
}

function parseMajorUnits(value: string): bigint {
  const trimmed = value.trim()
  const match = MAJOR_MONEY_PATTERN.exec(trimmed)

  if (!match) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_MONEY_MAJOR_FORMAT,
      `Invalid money major format: ${value}`
    )
  }

  const [, sign, wholePart, fractionalPart = ''] = match
  const normalizedFraction = fractionalPart.padEnd(2, '0')
  const composed = `${wholePart}${normalizedFraction}`
  const signPrefix = sign === '-' ? '-' : ''

  return BigInt(`${signPrefix}${composed}`)
}

function ensureSupportedCurrency(currency: string): CurrencyCode {
  if ((CURRENCIES as readonly string[]).includes(currency)) {
    return currency as CurrencyCode
  }

  throw new DomainError(DOMAIN_ERROR_CODE.INVALID_MONEY_AMOUNT, `Unsupported currency: ${currency}`)
}

function formatMajorUnits(minor: bigint): string {
  const sign = minor < 0n ? '-' : ''
  const absolute = minor < 0n ? -minor : minor
  const whole = absolute / 100n
  const fraction = absolute % 100n
  const fractionString = fraction.toString().padStart(2, '0')

  return `${sign}${whole.toString()}.${fractionString}`
}

export class Money {
  readonly amountMinor: bigint
  readonly currency: CurrencyCode

  private constructor(amountMinor: bigint, currency: CurrencyCode) {
    this.amountMinor = amountMinor
    this.currency = currency
  }

  static fromMinor(amountMinor: bigint | number | string, currency: CurrencyCode = 'GEL'): Money {
    const supportedCurrency = ensureSupportedCurrency(currency)

    return new Money(parseMinorUnits(amountMinor), supportedCurrency)
  }

  static fromMajor(amountMajor: string, currency: CurrencyCode = 'GEL'): Money {
    const supportedCurrency = ensureSupportedCurrency(currency)

    return new Money(parseMajorUnits(amountMajor), supportedCurrency)
  }

  static zero(currency: CurrencyCode = 'GEL'): Money {
    return Money.fromMinor(0n, currency)
  }

  add(other: Money): Money {
    this.assertSameCurrency(other)

    return new Money(this.amountMinor + other.amountMinor, this.currency)
  }

  subtract(other: Money): Money {
    this.assertSameCurrency(other)

    return new Money(this.amountMinor - other.amountMinor, this.currency)
  }

  multiplyBy(multiplier: bigint | number): Money {
    const parsedMultiplier = typeof multiplier === 'number' ? BigInt(multiplier) : multiplier

    if (typeof multiplier === 'number' && !isIntegerNumber(multiplier)) {
      throw new DomainError(DOMAIN_ERROR_CODE.INVALID_MONEY_AMOUNT, 'Multiplier must be an integer')
    }

    return new Money(this.amountMinor * parsedMultiplier, this.currency)
  }

  splitEvenly(parts: number): readonly Money[] {
    if (!isIntegerNumber(parts) || parts <= 0) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SPLIT_PARTS,
        'Split parts must be a positive integer'
      )
    }

    return this.splitByWeights(Array.from({ length: parts }, () => 1n))
  }

  splitByWeights(weightsInput: readonly (bigint | number)[]): readonly Money[] {
    if (weightsInput.length === 0) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SPLIT_WEIGHTS,
        'At least one weight is required'
      )
    }

    const weights = weightsInput.map((weight) => {
      const parsed = typeof weight === 'number' ? BigInt(weight) : weight

      if (typeof weight === 'number' && !isIntegerNumber(weight)) {
        throw new DomainError(
          DOMAIN_ERROR_CODE.INVALID_SPLIT_WEIGHTS,
          'Split weights must be integers'
        )
      }

      if (parsed <= 0n) {
        throw new DomainError(
          DOMAIN_ERROR_CODE.INVALID_SPLIT_WEIGHTS,
          'Split weights must be positive'
        )
      }

      return parsed
    })

    const totalWeight = weights.reduce((sum, current) => sum + current, 0n)

    if (totalWeight <= 0n) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SPLIT_WEIGHTS,
        'Total split weight must be positive'
      )
    }

    const isNegative = this.amountMinor < 0n
    const absoluteAmount = isNegative ? -this.amountMinor : this.amountMinor

    const baseAllocations = weights.map((weight) => (absoluteAmount * weight) / totalWeight)
    const remainders = weights.map((weight, index) => ({
      index,
      remainder: (absoluteAmount * weight) % totalWeight
    }))

    const allocatedBase = baseAllocations.reduce((sum, current) => sum + current, 0n)
    const leftover = absoluteAmount - allocatedBase

    remainders.sort((left, right) => {
      if (left.remainder === right.remainder) {
        return left.index - right.index
      }

      return left.remainder > right.remainder ? -1 : 1
    })

    const finalAllocations = [...baseAllocations]
    for (let offset = 0n; offset < leftover; offset += 1n) {
      const target = remainders[Number(offset)]
      if (!target) {
        break
      }

      const currentAllocation = finalAllocations[target.index]
      if (currentAllocation === undefined) {
        throw new DomainError(
          DOMAIN_ERROR_CODE.INVALID_SPLIT_WEIGHTS,
          'Unexpected split allocation index state'
        )
      }

      finalAllocations[target.index] = currentAllocation + 1n
    }

    return finalAllocations.map(
      (allocatedMinor) => new Money(isNegative ? -allocatedMinor : allocatedMinor, this.currency)
    )
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.amountMinor === other.amountMinor
  }

  isNegative(): boolean {
    return this.amountMinor < 0n
  }

  isZero(): boolean {
    return this.amountMinor === 0n
  }

  compare(other: Money): -1 | 0 | 1 {
    this.assertSameCurrency(other)

    if (this.amountMinor < other.amountMinor) {
      return -1
    }

    if (this.amountMinor > other.amountMinor) {
      return 1
    }

    return 0
  }

  toMajorString(): string {
    return formatMajorUnits(this.amountMinor)
  }

  toJSON(): { amountMinor: string; currency: CurrencyCode } {
    return {
      amountMinor: this.amountMinor.toString(),
      currency: this.currency
    }
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.CURRENCY_MISMATCH,
        `Money operation currency mismatch: ${this.currency} vs ${other.currency}`
      )
    }
  }
}

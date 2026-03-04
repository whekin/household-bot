import { DOMAIN_ERROR_CODE, DomainError } from './errors'

const BILLING_PERIOD_PATTERN = /^(\d{4})-(\d{2})$/

function isIntegerInRange(value: number, min: number, max: number): boolean {
  return Number.isInteger(value) && value >= min && value <= max
}

export class BillingPeriod {
  readonly year: number
  readonly month: number

  private constructor(year: number, month: number) {
    this.year = year
    this.month = month
  }

  static from(year: number, month: number): BillingPeriod {
    if (!isIntegerInRange(year, 1970, 9999)) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_BILLING_PERIOD,
        `Invalid billing year: ${year}`
      )
    }

    if (!isIntegerInRange(month, 1, 12)) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_BILLING_PERIOD,
        `Invalid billing month: ${month}`
      )
    }

    return new BillingPeriod(year, month)
  }

  static fromString(value: string): BillingPeriod {
    const match = BILLING_PERIOD_PATTERN.exec(value)

    if (!match) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_BILLING_PERIOD,
        `Billing period must match YYYY-MM: ${value}`
      )
    }

    const [, yearString, monthString] = match

    return BillingPeriod.from(Number(yearString), Number(monthString))
  }

  static fromDate(date: Date): BillingPeriod {
    return BillingPeriod.from(date.getUTCFullYear(), date.getUTCMonth() + 1)
  }

  next(): BillingPeriod {
    if (this.month === 12) {
      return BillingPeriod.from(this.year + 1, 1)
    }

    return BillingPeriod.from(this.year, this.month + 1)
  }

  previous(): BillingPeriod {
    if (this.month === 1) {
      return BillingPeriod.from(this.year - 1, 12)
    }

    return BillingPeriod.from(this.year, this.month - 1)
  }

  compare(other: BillingPeriod): -1 | 0 | 1 {
    if (this.year < other.year) {
      return -1
    }

    if (this.year > other.year) {
      return 1
    }

    if (this.month < other.month) {
      return -1
    }

    if (this.month > other.month) {
      return 1
    }

    return 0
  }

  equals(other: BillingPeriod): boolean {
    return this.year === other.year && this.month === other.month
  }

  toString(): string {
    return `${this.year.toString().padStart(4, '0')}-${this.month.toString().padStart(2, '0')}`
  }
}

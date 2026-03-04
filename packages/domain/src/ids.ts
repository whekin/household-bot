import { DOMAIN_ERROR_CODE, DomainError } from './errors'

const ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,127}$/

function normalizeId(raw: string, label: string): string {
  const value = raw.trim()

  if (!value) {
    throw new DomainError(DOMAIN_ERROR_CODE.INVALID_ENTITY_ID, `${label} cannot be empty`)
  }

  if (!ID_PATTERN.test(value)) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_ENTITY_ID,
      `${label} contains invalid characters: ${value}`
    )
  }

  return value
}

abstract class BaseId {
  readonly value: string

  protected constructor(value: string) {
    this.value = value
  }

  equals(other: BaseId): boolean {
    return this.value === other.value && this.constructor === other.constructor
  }

  toString(): string {
    return this.value
  }
}

export class HouseholdId extends BaseId {
  static from(value: string): HouseholdId {
    return new HouseholdId(normalizeId(value, 'HouseholdId'))
  }
}

export class MemberId extends BaseId {
  static from(value: string): MemberId {
    return new MemberId(normalizeId(value, 'MemberId'))
  }
}

export class BillingCycleId extends BaseId {
  static from(value: string): BillingCycleId {
    return new BillingCycleId(normalizeId(value, 'BillingCycleId'))
  }
}

export class PurchaseEntryId extends BaseId {
  static from(value: string): PurchaseEntryId {
    return new PurchaseEntryId(normalizeId(value, 'PurchaseEntryId'))
  }
}

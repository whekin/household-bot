import { DomainError, DOMAIN_ERROR_CODE } from './errors'
import type { Money } from './money'

/** Stable member IDs decide who receives remainder units, independent of row order. */
export function splitEvenlyByMember(
  amount: Money,
  memberIds: readonly string[]
): ReadonlyMap<string, Money> {
  if (new Set(memberIds).size !== memberIds.length) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      'Split members must be unique'
    )
  }
  const orderedIds = [...memberIds].sort()
  const shares = amount.splitEvenly(orderedIds.length)
  return new Map(orderedIds.map((id, index) => [id, shares[index]!]))
}

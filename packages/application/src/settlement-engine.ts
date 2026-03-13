import {
  DOMAIN_ERROR_CODE,
  DomainError,
  Money,
  type SettlementInput,
  type SettlementMemberInput,
  type SettlementMemberLine,
  type SettlementResult
} from '@household/domain'

interface ComputationMember {
  input: SettlementMemberInput
  rentShare: Money
  utilityShare: Money
  purchaseSharedCost: Money
  purchasePaid: Money
}

function createMemberState(
  input: SettlementMemberInput,
  currency: 'GEL' | 'USD'
): ComputationMember {
  return {
    input,
    rentShare: Money.zero(currency),
    utilityShare: Money.zero(currency),
    purchaseSharedCost: Money.zero(currency),
    purchasePaid: Money.zero(currency)
  }
}

function ensureActiveMembers(
  members: readonly SettlementMemberInput[]
): readonly SettlementMemberInput[] {
  const active = members.filter((member) => member.active)

  if (active.length === 0) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      'Settlement must include at least one active member'
    )
  }

  return active
}

function rentParticipants(
  members: readonly SettlementMemberInput[]
): readonly SettlementMemberInput[] {
  const participants = members.filter((member) => member.participatesInRent !== false)

  if (participants.length === 0) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      'Settlement must include at least one rent participant'
    )
  }

  return participants
}

function utilityParticipants(
  members: readonly SettlementMemberInput[],
  utilities: Money
): readonly SettlementMemberInput[] {
  const participants = members.filter((member) => member.participatesInUtilities !== false)

  if (participants.length === 0 && utilities.amountMinor > 0n) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      'Settlement must include at least one utilities participant when utilities are present'
    )
  }

  return participants
}

function purchaseParticipants(
  members: readonly SettlementMemberInput[],
  amount: Money
): readonly SettlementMemberInput[] {
  const participants = members.filter((member) => member.participatesInPurchases !== false)

  if (participants.length === 0 && amount.amountMinor > 0n) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      'Settlement must include at least one purchase participant when purchases are present'
    )
  }

  return participants
}

function purchaseParticipantMembers(
  activeMembers: readonly SettlementMemberInput[],
  purchase: SettlementInput['purchases'][number]
): readonly SettlementMemberInput[] {
  if (!purchase.participants || purchase.participants.length === 0) {
    return purchaseParticipants(activeMembers, purchase.amount)
  }

  const membersById = new Map(activeMembers.map((member) => [member.memberId.toString(), member]))
  const participants = purchase.participants.map((participant) => {
    const matched = membersById.get(participant.memberId.toString())
    if (!matched) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
        `Purchase participant is not an active member: ${participant.memberId.toString()}`
      )
    }

    return matched
  })

  if (participants.length === 0 && purchase.amount.amountMinor > 0n) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      'Settlement must include at least one purchase participant when purchases are present'
    )
  }

  return participants
}

function ensureNonNegativeMoney(label: string, value: Money): void {
  if (value.isNegative()) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      `${label} must be non-negative`
    )
  }
}

function sumMoney(values: readonly Money[], currency: 'GEL' | 'USD'): Money {
  return values.reduce((sum, current) => sum.add(current), Money.zero(currency))
}

function validateWeightedUtilityDays(members: readonly SettlementMemberInput[]): readonly bigint[] {
  const weights = members.map((member) => {
    const days = member.utilityDays

    if (days === undefined || !Number.isInteger(days) || days <= 0) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
        `utilityDays must be a positive integer for member ${member.memberId.toString()}`
      )
    }

    return BigInt(days)
  })

  const total = weights.reduce((sum, current) => sum + current, 0n)
  if (total <= 0n) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      'Total utility day weights must be positive'
    )
  }

  return weights
}

function validateRentWeights(members: readonly SettlementMemberInput[]): readonly bigint[] {
  const weights = members.map((member) => {
    const raw = member.rentWeight ?? 1

    if (!Number.isInteger(raw) || raw <= 0) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
        `rentWeight must be a positive integer for member ${member.memberId.toString()}`
      )
    }

    return BigInt(raw)
  })

  const total = weights.reduce((sum, current) => sum + current, 0n)
  if (total <= 0n) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
      'Total rent weights must be positive'
    )
  }

  return weights
}

function validateCurrencyConsistency(input: SettlementInput): void {
  const currency = input.rent.currency

  if (input.utilities.currency !== currency) {
    throw new DomainError(
      DOMAIN_ERROR_CODE.CURRENCY_MISMATCH,
      `Money operation currency mismatch: ${currency} vs ${input.utilities.currency}`
    )
  }

  for (const purchase of input.purchases) {
    if (purchase.amount.currency !== currency) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.CURRENCY_MISMATCH,
        `Money operation currency mismatch: ${currency} vs ${purchase.amount.currency}`
      )
    }
  }
}

export function calculateMonthlySettlement(input: SettlementInput): SettlementResult {
  validateCurrencyConsistency(input)
  ensureNonNegativeMoney('Rent', input.rent)
  ensureNonNegativeMoney('Utilities', input.utilities)

  const currency = input.rent.currency
  const activeMembers = ensureActiveMembers(input.members)
  const rentMembers = rentParticipants(activeMembers)
  const utilityMembers = utilityParticipants(activeMembers, input.utilities)

  const membersById = new Map<string, ComputationMember>(
    activeMembers.map((member) => [member.memberId.toString(), createMemberState(member, currency)])
  )

  const rentShares = input.rent.splitByWeights(validateRentWeights(rentMembers))
  for (const [index, member] of rentMembers.entries()) {
    const state = membersById.get(member.memberId.toString())
    if (!state) {
      continue
    }

    state.rentShare = rentShares[index] ?? Money.zero(currency)
  }

  if (utilityMembers.length > 0) {
    const utilityShares =
      input.utilitySplitMode === 'equal'
        ? input.utilities.splitEvenly(utilityMembers.length)
        : input.utilities.splitByWeights(validateWeightedUtilityDays(utilityMembers))

    for (const [index, member] of utilityMembers.entries()) {
      const state = membersById.get(member.memberId.toString())
      if (!state) {
        continue
      }

      state.utilityShare = utilityShares[index] ?? Money.zero(currency)
    }
  }

  for (const purchase of input.purchases) {
    ensureNonNegativeMoney('Purchase amount', purchase.amount)

    const payer = membersById.get(purchase.payerId.toString())
    if (!payer) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
        `Purchase payer is not an active member: ${purchase.payerId.toString()}`
      )
    }

    payer.purchasePaid = payer.purchasePaid.add(purchase.amount)

    const participants = purchaseParticipantMembers(activeMembers, purchase)

    // Identify participants with explicit share amounts (lenient read path for legacy data)
    const explicitShares =
      purchase.participants
        ?.filter((p) => p.shareAmount !== undefined)
        .map((p) => ({
          memberId: p.memberId,
          shareAmount: p.shareAmount!
        })) ?? []

    if (explicitShares.length > 0) {
      const shares = explicitShares.map((p) => p.shareAmount)
      const shareTotal = sumMoney(shares, currency)
      if (!shareTotal.equals(purchase.amount)) {
        throw new DomainError(
          DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
          `Purchase custom split must add up to the full amount: ${purchase.purchaseId.toString()}`
        )
      }

      for (const participant of explicitShares) {
        const state = membersById.get(participant.memberId.toString())
        if (!state) {
          continue
        }

        state.purchaseSharedCost = state.purchaseSharedCost.add(participant.shareAmount)
      }

      continue
    }

    const purchaseShares = purchase.amount.splitEvenly(participants.length)
    for (const [index, member] of participants.entries()) {
      const state = membersById.get(member.memberId.toString())
      if (!state) {
        continue
      }

      state.purchaseSharedCost = state.purchaseSharedCost.add(
        purchaseShares[index] ?? Money.zero(currency)
      )
    }
  }

  const lines: SettlementMemberLine[] = activeMembers.map((member) => {
    const state = membersById.get(member.memberId.toString())
    if (!state) {
      throw new DomainError(
        DOMAIN_ERROR_CODE.INVALID_SETTLEMENT_INPUT,
        `Missing member state: ${member.memberId.toString()}`
      )
    }

    const purchaseOffset = state.purchaseSharedCost.subtract(state.purchasePaid)
    const netDue = state.rentShare.add(state.utilityShare).add(purchaseOffset)

    return {
      memberId: member.memberId,
      rentShare: state.rentShare,
      utilityShare: state.utilityShare,
      purchaseOffset,
      netDue,
      explanations: [
        `rent_share_minor=${state.rentShare.amountMinor.toString()}`,
        `utility_share_minor=${state.utilityShare.amountMinor.toString()}`,
        `purchase_paid_minor=${state.purchasePaid.amountMinor.toString()}`,
        `purchase_shared_minor=${state.purchaseSharedCost.amountMinor.toString()}`
      ]
    }
  })

  const totalDue = sumMoney(
    lines.map((line) => line.netDue),
    currency
  )

  return {
    cycleId: input.cycleId,
    period: input.period,
    lines,
    totalDue
  }
}

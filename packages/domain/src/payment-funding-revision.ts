import { Money, convertMoney, type CurrencyCode } from './money'

export interface PaymentFundingContext {
  inputRevision?: string
  policy: 'utilities' | 'rent' | 'separate'
  currency: CurrencyCode
  rateMicros: string
  baseMinor: string
  targetMinor: string | null
  planId: string | null
  debts: readonly { purchaseId: string; sourceKind: 'purchase' | 'transfer'; amountMinor: string }[]
}

export function parsePaymentFundingContext(value: unknown): PaymentFundingContext | undefined {
  if (!value || typeof value !== 'object') return undefined
  const c = value as Record<string, unknown>
  if (
    !['utilities', 'rent', 'separate'].includes(String(c.policy)) ||
    !['GEL', 'USD'].includes(String(c.currency)) ||
    typeof c.baseMinor !== 'string' ||
    !/^\d+$/.test(c.baseMinor) ||
    typeof c.rateMicros !== 'string' ||
    !/^\d+$/.test(c.rateMicros) ||
    BigInt(String(c.rateMicros)) <= 0n ||
    (c.targetMinor !== null &&
      (typeof c.targetMinor !== 'string' || !/^\d+$/.test(c.targetMinor))) ||
    (c.planId !== null && typeof c.planId !== 'string') ||
    (c.inputRevision !== undefined && typeof c.inputRevision !== 'string') ||
    !Array.isArray(c.debts)
  )
    return undefined
  if (
    c.debts.some(
      (d) =>
        !d ||
        typeof d !== 'object' ||
        typeof d.purchaseId !== 'string' ||
        !['purchase', 'transfer'].includes(d.sourceKind) ||
        typeof d.amountMinor !== 'string' ||
        !/^\d+$/.test(d.amountMinor)
    )
  )
    return undefined
  return {
    ...(typeof c.inputRevision === 'string' ? { inputRevision: c.inputRevision } : {}),
    policy: c.policy as PaymentFundingContext['policy'],
    currency: c.currency as CurrencyCode,
    rateMicros: BigInt(String(c.rateMicros)).toString(),
    baseMinor: BigInt(String(c.baseMinor)).toString(),
    targetMinor: c.targetMinor === null ? null : BigInt(String(c.targetMinor)).toString(),
    planId: typeof c.planId === 'string' ? c.planId : null,
    debts: c.debts.map((d) => ({
      purchaseId: String(d.purchaseId),
      sourceKind: d.sourceKind as 'purchase' | 'transfer',
      amountMinor: BigInt(String(d.amountMinor)).toString()
    }))
  }
}

/** Exact revision of the payment facts that fund a purchase-allocation replacement. */
export function paymentFundingRevision(
  records: readonly {
    id: string
    cycleId: string
    memberId: string
    kind: string
    amountMinor: bigint
    currency: string
    fundingPhase?: bigint | null
    purchaseFundingContext?: unknown
  }[]
): string {
  return JSON.stringify(
    [...records]
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((p) => [
        p.id,
        p.cycleId,
        p.memberId,
        p.kind,
        p.amountMinor.toString(),
        p.currency,
        p.fundingPhase?.toString() ?? null,
        parsePaymentFundingContext(p.purchaseFundingContext) ?? null
      ])
  )
}

/** Replay actual receipts through their own immutable pricing phases. */
export function replayPaymentPurchaseFunding(
  receipts: readonly {
    amountMinor: bigint
    currency: CurrencyCode
    kind: string
    purchaseFundingContext: PaymentFundingContext
  }[],
  available: ReadonlyMap<string, bigint>
): readonly { purchaseId: string; sourceKind: 'purchase' | 'transfer'; amountMinor: bigint }[] {
  let paid = 0n
  const funded = new Map<
    string,
    { purchaseId: string; sourceKind: 'purchase' | 'transfer'; amountMinor: bigint }
  >()
  for (const receipt of receipts) {
    const c = receipt.purchaseFundingContext
    paid += convertMoney(
      Money.fromMinor(receipt.amountMinor, receipt.currency),
      c.currency,
      BigInt(c.rateMicros)
    ).amountMinor
    if (c.policy !== receipt.kind) continue
    const gross = c.debts.reduce((n, d) => n + BigInt(d.amountMinor), 0n)
    const candidate =
      c.targetMinor !== null && paid >= BigInt(c.targetMinor)
        ? gross
        : paid > BigInt(c.baseMinor)
          ? paid - BigInt(c.baseMinor)
          : 0n
    const previous = [...funded.values()].reduce((n, a) => n + a.amountMinor, 0n)
    let remaining = (candidate < gross ? candidate : gross) - previous
    if (remaining <= 0n) continue
    for (const debt of c.debts) {
      const key = `${debt.sourceKind}:${debt.purchaseId}`
      const actual = available.get(key) ?? 0n
      const captured = BigInt(debt.amountMinor)
      const cap = (actual < captured ? actual : captured) - (funded.get(key)?.amountMinor ?? 0n)
      if (cap <= 0n) continue
      const amount = remaining < cap ? remaining : cap
      funded.set(key, {
        purchaseId: debt.purchaseId,
        sourceKind: debt.sourceKind,
        amountMinor: (funded.get(key)?.amountMinor ?? 0n) + amount
      })
      remaining -= amount
      if (remaining <= 0n) break
    }
  }
  return [...funded.values()]
}

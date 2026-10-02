import { BillingPeriod, Money } from '@household/domain'
import type {
  HouseholdUtilityCategoryRecord,
  UtilityBillImportChange,
  UtilityBillImportEntry,
  UtilityBillImportRepository,
  UtilityBillImportSnapshot,
  UtilityImageRecognition
} from '@household/ports'

const key = (value: string) => value.trim().toLowerCase()
const accountKey = (value: string) => value.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase()
const providerSlugs: readonly [RegExp, readonly string[]][] = [
  [/telmico|telasi|თელმიკო|თელასი/i, ['electricity']],
  [/tbilisi\s*cleaning|თბილის.*დასუფთავ/i, ['cleaning', 'trash']],
  [/socar|სოკარ/i, ['gas', 'gas_water']],
  [/silknet|სილქნეტ/i, ['internet']],
  [/gwp|georgian\s*water|ჯორჯიან.*უოთერ/i, ['water']]
]

export function matchUtilityImageBills(
  recognition: UtilityImageRecognition,
  categories: readonly HouseholdUtilityCategoryRecord[]
): { entries: UtilityBillImportEntry[]; issues: string[] } {
  const active = categories.filter((category) => category.isActive)
  const entries: UtilityBillImportEntry[] = []
  const issues: string[] = []
  const seen = new Set<string>()
  for (const bill of recognition.bills) {
    const configured = active.filter(
      (category) => category.providerName && key(category.providerName) === key(bill.provider)
    )
    const slugs = providerSlugs.find(([pattern]) => pattern.test(bill.provider))?.[1] ?? []
    let matches = configured.length
      ? configured
      : active.filter((category) => slugs.includes(category.slug))
    if (matches.length > 1 && bill.customerNumber) {
      matches = matches.filter(
        (category) =>
          category.customerNumber &&
          accountKey(category.customerNumber) === accountKey(bill.customerNumber!)
      )
    }
    const category = matches.length === 1 ? matches[0] : undefined
    if (!category) {
      issues.push(`${bill.provider}: category`)
      continue
    }
    if (
      category.customerNumber &&
      (!bill.customerNumber ||
        accountKey(category.customerNumber) !== accountKey(bill.customerNumber))
    ) {
      issues.push(`${bill.provider}: account`)
      continue
    }
    if (
      bill.confidence < 0.85 ||
      bill.currency !== 'GEL' ||
      !bill.amountMajor ||
      !/^-?\d+(?:[.,]\d{1,2})?$/.test(bill.amountMajor)
    ) {
      issues.push(`${bill.provider}: amount`)
      continue
    }
    if (seen.has(key(category.name))) {
      issues.push(`${bill.provider}: duplicate`)
      continue
    }
    seen.add(key(category.name))
    entries.push({
      billName: category.name,
      provider: bill.provider,
      customerNumber: bill.customerNumber,
      amountMajor: Money.fromMajor(
        bill.amountMajor.replace(/^-/, '').replace(',', '.'),
        'GEL'
      ).toMajorString()
    })
  }
  return { entries, issues }
}

/** Manual corrections never drop unknown lines or interpret detached numbers. */
export function parseUtilityBillImportCorrection(
  text: string,
  categories: readonly HouseholdUtilityCategoryRecord[]
): UtilityBillImportEntry[] | null {
  const entries: UtilityBillImportEntry[] = []
  const seen = new Set<string>()
  for (const raw of text.split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const match = /^([^:]+):\s*(.*)$/.exec(line)
    const category = match
      ? categories.find((item) => item.isActive && key(item.name) === key(match[1]!))
      : null
    if (!category || seen.has(key(category.name))) return null
    seen.add(key(category.name))
    const value = match![2]!.trim()
    if (!value) continue
    if (!/^\d+(?:[.,]\d{1,2})?$/.test(value)) return null
    entries.push({
      billName: category.name,
      amountMajor: Money.fromMajor(value.replace(',', '.'), 'GEL').toMajorString()
    })
  }
  return entries.length ? entries : null
}

export interface UtilityBillImportPreview {
  period: string
  revision: string
  entries: readonly UtilityBillImportEntry[]
  changes: readonly UtilityBillImportChange[]
  previousAmounts: Record<string, string>
  totalMajor: string
  existingPayments: boolean
  preservedPaidBills: readonly string[]
  blocked: 'closed' | 'paid' | 'ambiguous' | 'category' | null
}

export function previewUtilityBillImport(
  period: string,
  entries: readonly UtilityBillImportEntry[],
  snapshot: UtilityBillImportSnapshot
): UtilityBillImportPreview {
  BillingPeriod.fromString(period)
  const changes: UtilityBillImportChange[] = []
  const previousAmounts: Record<string, string> = Object.create(null)
  let total = Money.zero('GEL')
  let ambiguous = false
  let categoryChanged = false
  const preservedPaidBills: string[] = []
  const seen = new Set<string>()
  if (!entries.length) throw new Error('Empty utility import')
  for (const entry of entries) {
    if (snapshot.categories) {
      if (entry.provider) {
        const matched = matchUtilityImageBills(
          {
            kind: 'utility_balances',
            bills: [
              {
                provider: entry.provider,
                customerNumber: entry.customerNumber ?? null,
                category: null,
                amountMajor: entry.amountMajor,
                currency: 'GEL',
                confidence: 1
              }
            ]
          },
          snapshot.categories
        )
        if (
          matched.issues.length ||
          matched.entries.length !== 1 ||
          key(matched.entries[0]!.billName) !== key(entry.billName)
        )
          categoryChanged = true
      } else if (
        !snapshot.categories.some(
          (category) => category.isActive && key(category.name) === key(entry.billName)
        )
      )
        categoryChanged = true
    }
    if (!/^\d+(?:\.\d{1,2})?$/.test(entry.amountMajor) || !entry.billName.trim()) {
      throw new Error('Invalid utility import entry')
    }
    const name = key(entry.billName)
    if (seen.has(name)) throw new Error('Duplicate utility import category')
    seen.add(name)
    const amount = Money.fromMajor(entry.amountMajor, 'GEL')
    total = total.add(amount)
    const existing = snapshot.bills.filter((bill) => key(bill.billName) === name)
    if (existing.length > 1 || existing.some((bill) => bill.currency !== 'GEL')) {
      ambiguous = true
      continue
    }
    const bill = existing[0]
    if (bill)
      previousAmounts[entry.billName] = Money.fromMinor(
        BigInt(bill.amountMinor),
        'GEL'
      ).toMajorString()
    const paidMinor = BigInt(bill ? (snapshot.paidByBillId[bill.id] ?? '0') : '0')
    if (
      bill &&
      paidMinor > 0n &&
      amount.amountMinor ===
        (BigInt(bill.amountMinor) > paidMinor ? BigInt(bill.amountMinor) - paidMinor : 0n)
    ) {
      preservedPaidBills.push(entry.billName)
      continue
    }
    if (!bill || BigInt(bill.amountMinor) !== amount.amountMinor) {
      changes.push({
        billId: bill?.id ?? null,
        billName: entry.billName,
        amountMinor: amount.amountMinor.toString()
      })
    }
  }
  return {
    period,
    revision: snapshot.revision,
    entries,
    changes,
    previousAmounts,
    totalMajor: total.toMajorString(),
    existingPayments: snapshot.hasPayments,
    preservedPaidBills,
    blocked: snapshot.closed
      ? 'closed'
      : categoryChanged
        ? 'category'
        : ambiguous
          ? 'ambiguous'
          : snapshot.hasPayments &&
              changes.some(
                (change) =>
                  change.billId &&
                  BigInt(
                    snapshot.bills.find((bill) => bill.id === change.billId)?.amountMinor ?? '0'
                  ) > 0n
              )
            ? 'paid'
            : null
  }
}

export function createUtilityBillImportService(repository: UtilityBillImportRepository) {
  return {
    async preview(period: string, entries: readonly UtilityBillImportEntry[]) {
      return previewUtilityBillImport(period, entries, await repository.getSnapshot(period))
    },
    async confirm(preview: UtilityBillImportPreview, memberId: string) {
      // Recompute the mutation from fresh data rather than trusting serialized changes.
      const current = previewUtilityBillImport(
        preview.period,
        preview.entries,
        await repository.getSnapshot(preview.period)
      )
      if (current.blocked) return current.blocked
      if (!current.changes.length) return 'unchanged' as const
      if (current.revision !== preview.revision) return 'stale' as const
      return repository.apply({
        period: preview.period,
        expectedRevision: current.revision,
        changes: current.changes,
        createdByMemberId: memberId
      })
    }
  }
}

export type UtilityBillImportService = ReturnType<typeof createUtilityBillImportService>

import { describe, expect, test } from 'bun:test'
import type {
  HouseholdUtilityCategoryRecord,
  UtilityBillImportSnapshot,
  UtilityImageRecognition
} from '@household/ports'
import {
  createUtilityBillImportService,
  matchUtilityImageBills,
  parseUtilityBillImportCorrection,
  previewUtilityBillImport
} from './utility-bill-import'

const categories: HouseholdUtilityCategoryRecord[] = [
  ['electricity', 'Electricity'],
  ['cleaning', 'Cleaning'],
  ['gas_water', 'Gas (Water)'],
  ['internet', 'Internet']
].map(([slug, name], i) => ({
  id: `c${i}`,
  householdId: 'h',
  slug: slug!,
  name: name!,
  sortOrder: i,
  isActive: true
}))
const recognition: UtilityImageRecognition = {
  kind: 'utility_balances',
  bills: [
    ['LLC TELMICO (electricity)', '-44.02'],
    ['Tbilisi Cleaning', '-2.50'],
    ['SOCAR Natural gas', '-20.30'],
    ['Silknet – Pay by Account ID', '-61.39']
  ].map(([provider, amountMajor]) => ({
    provider: provider!,
    amountMajor: amountMajor!,
    currency: 'GEL',
    customerNumber: 'account',
    category: null,
    confidence: 0.99
  }))
}
const empty: UtilityBillImportSnapshot = {
  revision: 'r1',
  closed: false,
  hasPayments: false,
  paidByBillId: {},
  categories,
  bills: []
}

describe('utility screenshot imports', () => {
  test('a late internet bill can be reviewed after another utility bill has been paid', () => {
    const preview = previewUtilityBillImport(
      '2026-10',
      [{ billName: 'Internet', amountMajor: '61.39' }],
      {
        ...empty,
        hasPayments: true,
        bills: [
          { id: 'electricity-paid', billName: 'Electricity', amountMinor: '4402', currency: 'GEL' }
        ]
      }
    )
    expect(preview.blocked).toBeNull()
    expect(preview.changes).toEqual([{ billId: null, billName: 'Internet', amountMinor: '6139' }])
  })
  test('bank balances after full or partial payment preserve original bills while adding internet', () => {
    for (const [paidMinor, balance] of [
      ['4402', '0.00'],
      ['2000', '24.02']
    ] as const) {
      const preview = previewUtilityBillImport(
        '2026-10',
        [
          { billName: 'Electricity', amountMajor: balance },
          { billName: 'Internet', amountMajor: '61.39' }
        ],
        {
          ...empty,
          hasPayments: true,
          paidByBillId: { e: paidMinor },
          bills: [{ id: 'e', billName: 'Electricity', amountMinor: '4402', currency: 'GEL' }]
        }
      )
      expect(preview.blocked).toBeNull()
      expect(preview.preservedPaidBills).toEqual(['Electricity'])
      expect(preview.changes).toEqual([{ billId: null, billName: 'Internet', amountMinor: '6139' }])
    }
  })
  test('both bank balance signs map to the configured categories with exact 128.21 total', () => {
    for (const sign of ['', '-']) {
      const mapped = matchUtilityImageBills(
        {
          ...recognition,
          bills: recognition.bills.map((bill) => ({
            ...bill,
            amountMajor: sign + bill.amountMajor!.replace('-', '')
          }))
        },
        categories
      )
      expect(mapped.issues).toEqual([])
      expect(mapped.entries.map((entry) => entry.amountMajor)).toEqual([
        '44.02',
        '2.50',
        '20.30',
        '61.39'
      ])
      expect(previewUtilityBillImport('2026-10', mapped.entries, empty).totalMajor).toBe('128.21')
    }
  })
  test('unknown suppliers cannot use a model-provided category to bypass matching', () => {
    const mapped = matchUtilityImageBills(
      {
        kind: 'utility_balances',
        bills: [{ ...recognition.bills[0]!, provider: 'Unknown', category: 'electricity' }]
      },
      categories
    )
    expect(mapped.entries).toEqual([])
    expect(mapped.issues).toHaveLength(1)
  })
  test('mismatched or unreadable configured account, uncertain amount and foreign currency require edits', () => {
    for (const override of [
      { customerNumber: 'wrong' },
      { customerNumber: null },
      { confidence: 0.5 },
      { currency: 'USD' },
      { amountMajor: null },
      { amountMajor: '44.029' }
    ]) {
      const mapped = matchUtilityImageBills(
        { kind: 'utility_balances', bills: [{ ...recognition.bills[0]!, ...override }] },
        [{ ...categories[0]!, customerNumber: 'account' }]
      )
      expect(mapped.entries).toEqual([])
      expect(mapped.issues).toHaveLength(1)
    }
  })
  test('provider/account metadata disambiguates multiple electricity accounts', () => {
    const mapped = matchUtilityImageBills(
      {
        kind: 'utility_balances',
        bills: [{ ...recognition.bills[0]!, provider: 'My electricity', customerNumber: '123-456' }]
      },
      [
        { ...categories[0]!, providerName: 'My electricity', customerNumber: '123456' },
        {
          ...categories[0]!,
          id: 'other',
          name: 'Second electricity',
          providerName: 'My electricity',
          customerNumber: '987'
        }
      ]
    )
    expect(mapped.entries.map(({ billName, amountMajor }) => ({ billName, amountMajor }))).toEqual([
      { billName: 'Electricity', amountMajor: '44.02' }
    ])
  })
  test('multiple screenshot accounts for one category do not silently overwrite', () => {
    const mapped = matchUtilityImageBills(
      {
        ...recognition,
        bills: [recognition.bills[0]!, { ...recognition.bills[0]!, customerNumber: 'second' }]
      },
      categories
    )
    expect(mapped.issues).toHaveLength(1)
  })
  test('manual correction accepts comma decimals and explicit zero but rejects detached or unknown lines', () => {
    expect(
      parseUtilityBillImportCorrection('Electricity: 44,02\nInternet: 0\nCleaning:', categories)
    ).toEqual([
      { billName: 'Electricity', amountMajor: '44.02' },
      { billName: 'Internet', amountMajor: '0.00' }
    ])
    for (const input of [
      'Electricity:\n44.02',
      'Electricity: 44.02\nunknown: 12',
      'Electricity: 44.02\nelectricity: 5',
      'Internet: -5',
      'Internet: 4.999',
      'Internet: 3 and 5'
    ]) {
      expect(parseUtilityBillImportCorrection(input, categories)).toBeNull()
    }
  })
  test('partial imports preserve missing bills and show exact replacements', () => {
    const snapshot = {
      ...empty,
      bills: [
        { id: 'e', billName: 'Electricity', amountMinor: '4000', currency: 'GEL' as const },
        { id: 'i', billName: 'Internet', amountMinor: '6139', currency: 'GEL' as const }
      ]
    }
    const preview = previewUtilityBillImport(
      '2026-10',
      [{ billName: 'Electricity', amountMajor: '44.02' }],
      snapshot
    )
    expect(preview.changes).toEqual([{ billId: 'e', billName: 'Electricity', amountMinor: '4402' }])
    expect(preview.previousAmounts).toEqual({ Electricity: '40.00' })
  })
  test('existing charged bills cannot be overwritten after payment; duplicates remain a no-op', () => {
    const entry = [{ billName: 'Electricity', amountMajor: '44.02' }]
    expect(previewUtilityBillImport('2026-10', entry, { ...empty, closed: true }).blocked).toBe(
      'closed'
    )
    expect(
      previewUtilityBillImport('2026-10', entry, {
        ...empty,
        hasPayments: true,
        bills: [{ id: 'e', billName: 'Electricity', amountMinor: '4000', currency: 'GEL' }]
      }).blocked
    ).toBe('paid')
    expect(
      previewUtilityBillImport('2026-10', entry, {
        ...empty,
        hasPayments: true,
        bills: [{ id: 'e', billName: 'Electricity', amountMinor: '4402', currency: 'GEL' }]
      }).blocked
    ).toBeNull()
  })
  test('legacy duplicate categories and currency conflicts require dashboard review', () => {
    for (const bills of [
      [{ id: 'a', billName: 'Electricity', amountMinor: '100', currency: 'USD' as const }],
      ['a', 'b'].map((id) => ({
        id,
        billName: 'Electricity',
        amountMinor: '100',
        currency: 'GEL' as const
      }))
    ])
      expect(
        previewUtilityBillImport('2026-10', [{ billName: 'Electricity', amountMajor: '44.02' }], {
          ...empty,
          bills
        }).blocked
      ).toBe('ambiguous')
  })
  test('confirmation refuses changed amounts and payments added after the preview', async () => {
    let snapshot = empty
    let writes = 0
    const service = createUtilityBillImportService({
      getSnapshot: async () => snapshot,
      apply: async () => {
        writes++
        return 'applied'
      }
    })
    const preview = await service.preview('2026-10', [
      { billName: 'Electricity', amountMajor: '44.02' }
    ])
    snapshot = { ...empty, revision: 'r2' }
    expect(await service.confirm(preview, 'member')).toBe('stale')
    snapshot = { ...snapshot, hasPayments: true }
    expect(await service.confirm(preview, 'member')).toBe('stale')
    expect(writes).toBe(0)
  })
  test('same values from another bank are unchanged without a write', async () => {
    let snapshot = empty
    let writes = 0
    const service = createUtilityBillImportService({
      getSnapshot: async () => snapshot,
      apply: async () => {
        writes++
        return 'applied'
      }
    })
    const preview = await service.preview('2026-10', [
      { billName: 'Electricity', amountMajor: '44.02' }
    ])
    snapshot = {
      ...empty,
      revision: 'r2',
      bills: [{ id: 'e', billName: 'Electricity', amountMinor: '4402', currency: 'GEL' }]
    }
    expect(await service.confirm(preview, 'member')).toBe('unchanged')
    expect(writes).toBe(0)
  })
  test('account and category changes between recognition and confirmation require correction', async () => {
    const entries = matchUtilityImageBills(recognition, categories).entries
    const changed = {
      ...empty,
      categories: categories.map((category) =>
        category.slug === 'electricity' ? { ...category, customerNumber: 'different' } : category
      )
    }
    expect(previewUtilityBillImport('2026-10', entries, changed).blocked).toBe('category')
    expect(
      previewUtilityBillImport('2026-10', [{ billName: 'Electricity', amountMajor: '44.02' }], {
        ...empty,
        categories: []
      }).blocked
    ).toBe('category')
  })
})

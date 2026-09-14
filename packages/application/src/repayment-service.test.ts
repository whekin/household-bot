import { describe, expect, test } from 'bun:test'
import type { MemberRepayment, RepaymentRepository } from '@household/ports'
import { createRepaymentService } from './repayment-service'

const requestId = '00000000-0000-4000-8000-000000000001'
const transferId = '00000000-0000-4000-8000-000000000002'
function fixture() {
  const records: MemberRepayment[] = []
  const repository: RepaymentRepository = {
    listRepayments: async () => records,
    async addRepayment(input) {
      const existing = records.find((record) => record.id === input.id)
      if (existing) return existing
      const record = { ...input, createdAt: '2026-01-01T00:00:00Z' }
      records.push(record)
      return record
    },
    async transitionRepayment(id, expected, next) {
      const record = records.find((record) => record.id === id && record.status === expected)
      if (!record) return false
      record.status = next
      return true
    }
  }
  const service = createRepaymentService({
    repository,
    context: async () => ({
      currency: 'GEL',
      timezone: 'Asia/Tbilisi',
      members: ['a', 'b', 'c'].map((id) => ({ id, status: 'active' }))
    }),
    credit: async () => 90000n
  })
  const transfer = {
    action: 'transfer' as const,
    id: transferId,
    toMemberId: 'a',
    amountMajor: '200.00',
    occurredOn: '2026-01-01'
  }
  return { service, records, transfer }
}
describe('direct repayments', () => {
  test('request accepts a partial contribution and only the recipient confirms it once', async () => {
    const { service, records, transfer } = fixture()
    await service.execute('a', { action: 'request', id: requestId, amountMajor: '900' })
    await service.execute('b', { ...transfer, requestId })
    expect(records.map((record) => record.status)).toEqual(['open', 'pending'])
    await expect(service.execute('b', { action: 'confirm', id: transferId })).rejects.toThrow(
      'Only the recipient'
    )
    await expect(service.execute('c', { action: 'confirm', id: transferId })).rejects.toThrow(
      'Only the recipient'
    )
    await service.execute('a', { action: 'confirm', id: transferId })
    await service.execute('a', { action: 'confirm', id: transferId })
    expect(records.filter((record) => record.status === 'confirmed')).toHaveLength(1)
    expect(records[1]?.amountMinor).toBe(20000n)
    await expect(service.execute('b', { action: 'cancel', id: transferId })).rejects.toThrow(
      'Confirmed transfers'
    )
  })
  test('retries retain one transfer and reject reusing an identifier with changed details', async () => {
    const { service, records, transfer } = fixture()
    await service.execute('a', { action: 'request', id: requestId, amountMajor: '900' })
    await service.execute('b', { ...transfer, requestId })
    await service.execute('a', { action: 'close', id: requestId })
    await service.execute('b', { ...transfer, requestId })
    expect(records).toHaveLength(2)
    await expect(
      service.execute('b', { ...transfer, amountMajor: '201', requestId })
    ).rejects.toThrow('different details')
  })

  test('allows excess transfers, cancellation by either party, and owner-only request closure', async () => {
    const { service, records, transfer } = fixture()
    await service.execute('b', { ...transfer, amountMajor: '1500' })
    await expect(service.execute('c', { action: 'cancel', id: transferId })).rejects.toThrow(
      'Only the sender'
    )
    await service.execute('a', { action: 'cancel', id: transferId })
    await expect(service.execute('a', { action: 'confirm', id: transferId })).rejects.toThrow(
      'no longer pending'
    )
    await service.execute('a', { action: 'request', id: requestId, amountMajor: '300' })
    await expect(service.execute('b', { action: 'close', id: requestId })).rejects.toThrow(
      'Only the request owner'
    )
    await service.execute('a', { action: 'close', id: requestId })
    expect(records.map((record) => record.status)).toEqual(['cancelled', 'closed'])
  })
  test('rejects invalid amounts, self/foreign recipients, oversized requests and future dates', async () => {
    const { service, transfer } = fixture()
    for (const amountMajor of ['0', '-1', '1.001', 'NaN'])
      await expect(service.execute('b', { ...transfer, amountMajor })).rejects.toThrow()
    for (const toMemberId of ['b', 'foreign'])
      await expect(service.execute('b', { ...transfer, toMemberId })).rejects.toThrow(
        'another household member'
      )
    await expect(service.execute('foreign', transfer)).rejects.toThrow('membership')
    await expect(service.execute('b', { ...transfer, occurredOn: '2999-01-01' })).rejects.toThrow(
      'future'
    )
    await expect(
      service.execute('a', { action: 'request', id: requestId, amountMajor: '900.01' })
    ).rejects.toThrow('exceeds')
    await expect(service.execute('b', { ...transfer, requestId })).rejects.toThrow('not open')
  })
})

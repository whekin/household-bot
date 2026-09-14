import { Money, Temporal } from '@household/domain'
import type { CurrencyCode } from '@household/domain'
import type { MemberRepayment, RepaymentRepository } from '@household/ports'

export class RepaymentError extends Error {}

export type RepaymentCommand =
  | { action: 'list' }
  | { action: 'request'; id: string; amountMajor: string }
  | {
      action: 'transfer'
      id: string
      toMemberId: string
      amountMajor: string
      occurredOn: string
      requestId?: string
    }
  | { action: 'confirm' | 'cancel' | 'close'; id: string }

export function createRepaymentService(input: {
  repository: RepaymentRepository
  context: () => Promise<{
    currency: CurrencyCode
    timezone: string
    members: readonly { id: string; status: string }[]
  }>
  credit: (memberId: string) => Promise<bigint>
}) {
  return {
    async execute(
      actorMemberId: string,
      command: RepaymentCommand
    ): Promise<readonly MemberRepayment[]> {
      const context = await input.context()
      if (
        !context.members.some((member) => member.id === actorMemberId && member.status === 'active')
      )
        throw new RepaymentError('Active household membership required')
      const records = await input.repository.listRepayments()
      if (command.action === 'list') return records
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          command.id
        )
      )
        throw new RepaymentError('Invalid repayment identifier')
      if (command.action === 'request' || command.action === 'transfer') {
        const amount = Money.fromMajor(command.amountMajor, context.currency)
        if (amount.amountMinor > 9223372036854775807n)
          throw new RepaymentError('Amount is too large')
        if (amount.amountMinor <= 0n) throw new RepaymentError('Amount must be positive')
        const today = Temporal.Now.plainDateISO(context.timezone)
        const existing = records.find((record) => record.id === command.id)
        const occurredOn =
          command.action === 'transfer'
            ? Temporal.PlainDate.from(command.occurredOn)
            : existing
              ? Temporal.PlainDate.from(existing.occurredOn)
              : today
        if (Temporal.PlainDate.compare(occurredOn, today) > 0)
          throw new RepaymentError('Transfer date cannot be in the future')
        if (
          command.action === 'request' &&
          !records.some((record) => record.id === command.id) &&
          amount.amountMinor > (await input.credit(actorMemberId))
        )
          throw new RepaymentError('Requested amount exceeds your outstanding credit')
        const toMemberId = command.action === 'transfer' ? command.toMemberId : actorMemberId
        if (
          command.action === 'transfer' &&
          (toMemberId === actorMemberId ||
            !context.members.some((member) => member.id === toMemberId && member.status !== 'left'))
        )
          throw new RepaymentError('Choose another household member')
        const requestId = command.action === 'transfer' ? (command.requestId ?? null) : null
        if (
          !existing &&
          requestId &&
          !records.some(
            (record) =>
              record.id === requestId &&
              record.kind === 'request' &&
              record.status === 'open' &&
              record.toMemberId === toMemberId &&
              record.currency === context.currency
          )
        )
          throw new RepaymentError('Repayment request is not open for this recipient')
        if (
          existing &&
          (existing.kind !== command.action ||
            existing.fromMemberId !== (command.action === 'transfer' ? actorMemberId : null) ||
            existing.toMemberId !== toMemberId ||
            existing.amountMinor !== amount.amountMinor ||
            existing.currency !== context.currency ||
            existing.occurredOn !== occurredOn.toString() ||
            existing.requestId !== requestId)
        )
          throw new RepaymentError('Repayment identifier already used for different details')
        await input.repository.addRepayment({
          id: command.id,
          kind: command.action,
          fromMemberId: command.action === 'transfer' ? actorMemberId : null,
          toMemberId,
          amountMinor: amount.amountMinor,
          currency: context.currency,
          occurredOn: occurredOn.toString(),
          status: command.action === 'request' ? 'open' : 'pending',
          requestId
        })
      } else {
        const record = records.find((record) => record.id === command.id)
        if (!record) throw new RepaymentError('Repayment not found')
        if (command.action === 'confirm') {
          if (record.kind !== 'transfer' || record.toMemberId !== actorMemberId)
            throw new RepaymentError('Only the recipient can confirm receipt')
          if (record.status !== 'pending' && record.status !== 'confirmed')
            throw new RepaymentError('This transfer is no longer pending')
          if (
            record.status === 'pending' &&
            !(await input.repository.transitionRepayment(record.id, 'pending', 'confirmed'))
          )
            throw new RepaymentError('Transfer changed; refresh and try again')
        } else if (command.action === 'cancel') {
          if (
            record.kind !== 'transfer' ||
            (record.fromMemberId !== actorMemberId && record.toMemberId !== actorMemberId)
          )
            throw new RepaymentError('Only the sender or recipient can cancel')
          if (record.status !== 'pending' && record.status !== 'cancelled')
            throw new RepaymentError('Confirmed transfers cannot be cancelled')
          if (
            record.status === 'pending' &&
            !(await input.repository.transitionRepayment(record.id, 'pending', 'cancelled'))
          )
            throw new RepaymentError('Transfer changed; refresh and try again')
        } else {
          if (record.kind !== 'request' || record.toMemberId !== actorMemberId)
            throw new RepaymentError('Only the request owner can close it')
          await input.repository.transitionRepayment(record.id, 'open', 'closed')
        }
      }
      return input.repository.listRepayments()
    }
  }
}

import { createHash } from 'node:crypto'

import { BillingPeriod } from '@household/domain'
import type {
  ClaimReminderDispatchResult,
  ReminderDispatchRepository,
  ReminderType
} from '@household/ports'

function computePayloadHash(payload: object): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

function buildReminderDedupeKey(period: string, reminderType: ReminderType): string {
  return `${period}:${reminderType}`
}

function createReminderMessage(reminderType: ReminderType, period: string): string {
  switch (reminderType) {
    case 'utilities':
      return `Utilities reminder for ${period}`
    case 'rent-warning':
      return `Rent reminder for ${period}: payment is coming up soon.`
    case 'rent-due':
      return `Rent due reminder for ${period}: please settle payment today.`
  }
}

export interface ReminderJobResult {
  status: 'dry-run' | 'claimed' | 'duplicate'
  dedupeKey: string
  payloadHash: string
  reminderType: ReminderType
  period: string
  messageText: string
}

export interface ReminderJobService {
  handleJob(input: {
    householdId: string
    period: string
    reminderType: ReminderType
    dryRun?: boolean
  }): Promise<ReminderJobResult>
}

export function createReminderJobService(
  repository: ReminderDispatchRepository
): ReminderJobService {
  return {
    async handleJob(input) {
      const period = BillingPeriod.fromString(input.period).toString()
      const payloadHash = computePayloadHash({
        householdId: input.householdId,
        period,
        reminderType: input.reminderType
      })
      const messageText = createReminderMessage(input.reminderType, period)

      if (input.dryRun === true) {
        return {
          status: 'dry-run',
          dedupeKey: buildReminderDedupeKey(period, input.reminderType),
          payloadHash,
          reminderType: input.reminderType,
          period,
          messageText
        }
      }

      const result: ClaimReminderDispatchResult = await repository.claimReminderDispatch({
        householdId: input.householdId,
        period,
        reminderType: input.reminderType,
        payloadHash
      })

      return {
        status: result.claimed ? 'claimed' : 'duplicate',
        dedupeKey: result.dedupeKey,
        payloadHash,
        reminderType: input.reminderType,
        period,
        messageText
      }
    }
  }
}

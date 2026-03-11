import type {
  ExchangeRateProvider,
  FinancePaymentKind,
  FinanceRepository,
  HouseholdConfigurationRepository
} from '@household/ports'
import {
  BillingPeriod,
  Money,
  Temporal,
  convertMoney,
  nowInstant,
  type CurrencyCode
} from '@household/domain'

import type { FinanceCommandService } from './finance-command-service'
import { parsePaymentConfirmationMessage } from './payment-confirmation-parser'
import { buildMemberPaymentGuidance } from './payment-guidance'

function billingPeriodLockDate(period: BillingPeriod, day: number): Temporal.PlainDate {
  const firstDay = Temporal.PlainDate.from({
    year: period.year,
    month: period.month,
    day: 1
  })
  const clampedDay = Math.min(day, firstDay.daysInMonth)

  return Temporal.PlainDate.from({
    year: period.year,
    month: period.month,
    day: clampedDay
  })
}

function localDateInTimezone(timezone: string): Temporal.PlainDate {
  return nowInstant().toZonedDateTimeISO(timezone).toPlainDate()
}

async function convertIntoCycleCurrency(
  dependencies: {
    repository: Pick<FinanceRepository, 'getCycleExchangeRate' | 'saveCycleExchangeRate'>
    exchangeRateProvider: ExchangeRateProvider
    cycleId: string
    cycleCurrency: CurrencyCode
    period: BillingPeriod
    timezone: string
    lockDay: number
  },
  amount: Money
): Promise<{
  amount: Money
  explicitAmountMinor: bigint
  explicitCurrency: CurrencyCode
}> {
  if (amount.currency === dependencies.cycleCurrency) {
    return {
      amount,
      explicitAmountMinor: amount.amountMinor,
      explicitCurrency: amount.currency
    }
  }

  const existingRate = await dependencies.repository.getCycleExchangeRate(
    dependencies.cycleId,
    amount.currency,
    dependencies.cycleCurrency
  )

  if (existingRate) {
    return {
      amount: convertMoney(amount, dependencies.cycleCurrency, existingRate.rateMicros),
      explicitAmountMinor: amount.amountMinor,
      explicitCurrency: amount.currency
    }
  }

  const lockDate = billingPeriodLockDate(dependencies.period, dependencies.lockDay)
  const currentLocalDate = localDateInTimezone(dependencies.timezone)
  const shouldPersist = Temporal.PlainDate.compare(currentLocalDate, lockDate) >= 0
  const quote = await dependencies.exchangeRateProvider.getRate({
    baseCurrency: amount.currency,
    quoteCurrency: dependencies.cycleCurrency,
    effectiveDate: lockDate.toString()
  })

  if (shouldPersist) {
    await dependencies.repository.saveCycleExchangeRate({
      cycleId: dependencies.cycleId,
      sourceCurrency: quote.baseCurrency,
      targetCurrency: quote.quoteCurrency,
      rateMicros: quote.rateMicros,
      effectiveDate: quote.effectiveDate,
      source: quote.source
    })
  }

  return {
    amount: convertMoney(amount, dependencies.cycleCurrency, quote.rateMicros),
    explicitAmountMinor: amount.amountMinor,
    explicitCurrency: amount.currency
  }
}

export interface PaymentConfirmationMessageInput {
  senderTelegramUserId: string
  rawText: string
  telegramChatId: string
  telegramMessageId: string
  telegramThreadId: string
  telegramUpdateId: string
  attachmentCount: number
  messageSentAt: Temporal.Instant | null
}

export type PaymentConfirmationSubmitResult =
  | {
      status: 'duplicate'
    }
  | {
      status: 'recorded'
      kind: FinancePaymentKind
      amount: Money
    }
  | {
      status: 'needs_review'
      reason:
        | 'member_not_found'
        | 'cycle_not_found'
        | 'settlement_not_ready'
        | 'intent_missing'
        | 'kind_ambiguous'
        | 'multiple_members'
        | 'non_positive_amount'
    }

export interface PaymentConfirmationService {
  submit(input: PaymentConfirmationMessageInput): Promise<PaymentConfirmationSubmitResult>
}

export function createPaymentConfirmationService(input: {
  householdId: string
  financeService: Pick<FinanceCommandService, 'getMemberByTelegramUserId' | 'generateDashboard'>
  repository: Pick<
    FinanceRepository,
    | 'getOpenCycle'
    | 'getLatestCycle'
    | 'getCycleExchangeRate'
    | 'saveCycleExchangeRate'
    | 'savePaymentConfirmation'
  >
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdBillingSettings'
  >
  exchangeRateProvider: ExchangeRateProvider
}): PaymentConfirmationService {
  return {
    async submit(message) {
      const member = await input.financeService.getMemberByTelegramUserId(
        message.senderTelegramUserId
      )
      if (!member) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          normalizedText: message.rawText.trim().replaceAll(/\s+/g, ' '),
          status: 'needs_review',
          cycleId: null,
          memberId: null,
          kind: null,
          amountMinor: null,
          currency: null,
          explicitAmountMinor: null,
          explicitCurrency: null,
          reviewReason: 'member_not_found'
        })

        return saveResult.status === 'duplicate'
          ? saveResult
          : {
              status: 'needs_review',
              reason: 'member_not_found'
            }
      }

      const [cycle, settings] = await Promise.all([
        input.repository
          .getOpenCycle()
          .then((openCycle) => openCycle ?? input.repository.getLatestCycle()),
        input.householdConfigurationRepository.getHouseholdBillingSettings(input.householdId)
      ])

      if (!cycle) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          normalizedText: message.rawText.trim().replaceAll(/\s+/g, ' '),
          status: 'needs_review',
          cycleId: null,
          memberId: member.id,
          kind: null,
          amountMinor: null,
          currency: null,
          explicitAmountMinor: null,
          explicitCurrency: null,
          reviewReason: 'cycle_not_found'
        })

        return saveResult.status === 'duplicate'
          ? saveResult
          : {
              status: 'needs_review',
              reason: 'cycle_not_found'
            }
      }

      const parsed = parsePaymentConfirmationMessage(message.rawText, settings.settlementCurrency)

      if (!parsed.kind || parsed.reviewReason) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          normalizedText: parsed.normalizedText,
          status: 'needs_review',
          cycleId: cycle.id,
          memberId: member.id,
          kind: parsed.kind,
          amountMinor: null,
          currency: null,
          explicitAmountMinor: parsed.explicitAmount?.amountMinor ?? null,
          explicitCurrency: parsed.explicitAmount?.currency ?? null,
          reviewReason: parsed.reviewReason ?? 'kind_ambiguous'
        })

        return saveResult.status === 'duplicate'
          ? saveResult
          : {
              status: 'needs_review',
              reason: parsed.reviewReason ?? 'kind_ambiguous'
            }
      }

      const dashboard = await input.financeService.generateDashboard(cycle.period)
      if (!dashboard) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          normalizedText: parsed.normalizedText,
          status: 'needs_review',
          cycleId: cycle.id,
          memberId: member.id,
          kind: parsed.kind,
          amountMinor: null,
          currency: null,
          explicitAmountMinor: parsed.explicitAmount?.amountMinor ?? null,
          explicitCurrency: parsed.explicitAmount?.currency ?? null,
          reviewReason: 'settlement_not_ready'
        })

        return saveResult.status === 'duplicate'
          ? saveResult
          : {
              status: 'needs_review',
              reason: 'settlement_not_ready'
            }
      }

      const memberLine = dashboard.members.find((line) => line.memberId === member.id)
      if (!memberLine) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          normalizedText: parsed.normalizedText,
          status: 'needs_review',
          cycleId: cycle.id,
          memberId: member.id,
          kind: parsed.kind,
          amountMinor: null,
          currency: null,
          explicitAmountMinor: parsed.explicitAmount?.amountMinor ?? null,
          explicitCurrency: parsed.explicitAmount?.currency ?? null,
          reviewReason: 'settlement_not_ready'
        })

        return saveResult.status === 'duplicate'
          ? saveResult
          : {
              status: 'needs_review',
              reason: 'settlement_not_ready'
            }
      }

      const guidance = buildMemberPaymentGuidance({
        kind: parsed.kind,
        period: cycle.period,
        memberLine,
        settings
      })

      const resolvedAmount = parsed.explicitAmount
        ? (
            await convertIntoCycleCurrency(
              {
                repository: input.repository,
                exchangeRateProvider: input.exchangeRateProvider,
                cycleId: cycle.id,
                cycleCurrency: dashboard.currency,
                period: BillingPeriod.fromString(cycle.period),
                timezone: settings.timezone,
                lockDay:
                  parsed.kind === 'rent' ? settings.rentWarningDay : settings.utilitiesReminderDay
              },
              parsed.explicitAmount
            )
          ).amount
        : guidance.proposalAmount

      if (resolvedAmount.amountMinor <= 0n) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          normalizedText: parsed.normalizedText,
          status: 'needs_review',
          cycleId: cycle.id,
          memberId: member.id,
          kind: parsed.kind,
          amountMinor: null,
          currency: null,
          explicitAmountMinor: parsed.explicitAmount?.amountMinor ?? null,
          explicitCurrency: parsed.explicitAmount?.currency ?? null,
          reviewReason: 'non_positive_amount'
        })

        return saveResult.status === 'duplicate'
          ? saveResult
          : {
              status: 'needs_review',
              reason: 'non_positive_amount'
            }
      }

      const saveResult = await input.repository.savePaymentConfirmation({
        ...message,
        normalizedText: parsed.normalizedText,
        status: 'recorded',
        cycleId: cycle.id,
        memberId: member.id,
        kind: parsed.kind,
        amountMinor: resolvedAmount.amountMinor,
        currency: resolvedAmount.currency,
        explicitAmountMinor: parsed.explicitAmount?.amountMinor ?? null,
        explicitCurrency: parsed.explicitAmount?.currency ?? null,
        recordedAt: message.messageSentAt ?? nowInstant()
      })

      if (saveResult.status === 'duplicate') {
        return saveResult
      }

      if (saveResult.status === 'needs_review') {
        return {
          status: 'needs_review',
          reason: saveResult.reviewReason
        }
      }

      return {
        status: 'recorded',
        kind: saveResult.paymentRecord.kind,
        amount: Money.fromMinor(
          saveResult.paymentRecord.amountMinor,
          saveResult.paymentRecord.currency
        )
      }
    }
  }
}

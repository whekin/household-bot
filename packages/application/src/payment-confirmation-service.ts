import type {
  ExchangeRateProvider,
  FinancePaymentKind,
  FinancePaymentConfirmationReviewReason,
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

import { resolveCycleExchangeRate, type CycleExchangeRateRepository } from './cycle-exchange-rate'
import { expectedOpenCyclePeriod, type FinanceCommandService } from './finance-command-service'
import { parsePaymentConfirmationMessage } from './payment-confirmation-parser'
import { buildMemberPaymentGuidance, paymentKindSummaryForRecording } from './payment-guidance'

async function convertIntoCycleCurrency(
  dependencies: {
    repository: CycleExchangeRateRepository
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

  const rate = await resolveCycleExchangeRate({
    repository: dependencies.repository,
    exchangeRateProvider: dependencies.exchangeRateProvider,
    cycleId: dependencies.cycleId,
    sourceCurrency: amount.currency,
    targetCurrency: dependencies.cycleCurrency,
    period: dependencies.period,
    lockDay: dependencies.lockDay,
    timezone: dependencies.timezone
  })

  return {
    amount: convertMoney(amount, dependencies.cycleCurrency, rate.rateMicros),
    explicitAmountMinor: amount.amountMinor,
    explicitCurrency: amount.currency
  }
}

export interface PaymentConfirmationMessageInput {
  period?: string
  utilityBillId?: string
  senderTelegramUserId: string
  memberId?: string | null
  sourceKey?: string | null
  rawText: string
  parseText?: string | null
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
      kind?: FinancePaymentKind
      amount?: Money
      balanceUpdatePending?: boolean
    }
  | {
      status: 'already_settled'
      kind: FinancePaymentKind
    }
  | {
      status: 'recorded'
      kind: FinancePaymentKind
      amount: Money
      balanceUpdatePending?: boolean
    }
  | {
      status: 'needs_review'
      reason: FinancePaymentConfirmationReviewReason
    }

export interface PaymentConfirmationService {
  submit(input: PaymentConfirmationMessageInput): Promise<PaymentConfirmationSubmitResult>
}

export function createPaymentConfirmationService(input: {
  householdId: string
  financeService: Pick<FinanceCommandService, 'getMemberByTelegramUserId' | 'generateDashboard'> &
    Partial<
      Pick<
        FinanceCommandService,
        'reconcilePaymentPurchaseAllocations' | 'capturePaymentFundingContext'
      >
    >
  repository: Pick<
    FinanceRepository,
    | 'getOpenCycle'
    | 'getCycleByPeriod'
    | 'getLatestCycle'
    | 'getCycleExchangeRate'
    | 'saveCycleExchangeRate'
    | 'getLatestExchangeRate'
    | 'savePaymentConfirmation'
    | 'getPaymentRecordByConfirmationSource'
  >
  householdConfigurationRepository: Pick<
    HouseholdConfigurationRepository,
    'getHouseholdBillingSettings'
  >
  exchangeRateProvider: ExchangeRateProvider
}): PaymentConfirmationService {
  return {
    async submit(message) {
      const sourceKey = message.sourceKey?.trim() || message.telegramMessageId
      const existing = await input.repository.getPaymentRecordByConfirmationSource(
        message.telegramChatId,
        sourceKey
      )
      if (existing) {
        let balanceUpdatePending = false
        try {
          await input.financeService.reconcilePaymentPurchaseAllocations?.(existing.id)
        } catch {
          balanceUpdatePending = true
        }
        return {
          status: 'duplicate',
          kind: existing.kind,
          amount: Money.fromMinor(existing.amountMinor, existing.currency),
          ...(balanceUpdatePending ? { balanceUpdatePending: true } : {})
        }
      }
      const reporter = message.memberId
        ? null
        : await input.financeService.getMemberByTelegramUserId(message.senderTelegramUserId)
      const targetMemberId = message.memberId ?? reporter?.id ?? null

      if (!targetMemberId) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          sourceKey,
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

      const settings = await input.householdConfigurationRepository.getHouseholdBillingSettings(
        input.householdId
      )
      const defaultPeriod = expectedOpenCyclePeriod(settings, nowInstant()).toString()
      const cycle =
        message.period !== undefined
          ? await input.repository.getCycleByPeriod(
              BillingPeriod.fromString(message.period).toString()
            )
          : ((await input.repository.getCycleByPeriod(defaultPeriod)) ??
            (await input.repository.getOpenCycle()) ??
            (await input.repository.getLatestCycle()))

      if (!cycle) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          sourceKey,
          normalizedText: message.rawText.trim().replaceAll(/\s+/g, ' '),
          status: 'needs_review',
          cycleId: null,
          memberId: targetMemberId,
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

      const parsingText = message.parseText?.trim() ? message.parseText : message.rawText
      const parsed = parsePaymentConfirmationMessage(parsingText, settings.settlementCurrency)

      if (!parsed.kind || parsed.reviewReason) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          sourceKey,
          normalizedText: parsed.normalizedText,
          status: 'needs_review',
          cycleId: cycle.id,
          memberId: targetMemberId,
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
          sourceKey,
          normalizedText: parsed.normalizedText,
          status: 'needs_review',
          cycleId: cycle.id,
          memberId: targetMemberId,
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

      const memberLine = dashboard.members.find((line) => line.memberId === targetMemberId)
      if (!memberLine) {
        const saveResult = await input.repository.savePaymentConfirmation({
          ...message,
          sourceKey,
          normalizedText: parsed.normalizedText,
          status: 'needs_review',
          cycleId: cycle.id,
          memberId: targetMemberId,
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

      const kindSummary = paymentKindSummaryForRecording(dashboard, cycle.period, parsed.kind)
      const unpaid = kindSummary
        ? kindSummary.unresolvedMembers.some((member) => member.memberId === targetMemberId)
        : memberLine.remaining.amountMinor > 0n
      if (
        !unpaid &&
        !(
          message.utilityBillId &&
          parsed.kind === 'utilities' &&
          parsed.explicitAmount &&
          parsed.explicitAmount.amountMinor > 0n
        )
      ) {
        return {
          status: 'already_settled',
          kind: parsed.kind
        }
      }

      const guidance = buildMemberPaymentGuidance({
        kind: parsed.kind,
        period: cycle.period,
        memberLine,
        settings,
        paymentKindSummary: kindSummary
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
        return {
          status: 'already_settled',
          kind: parsed.kind
        }
      }

      let saveResult: Awaited<ReturnType<FinanceRepository['savePaymentConfirmation']>> | undefined
      for (let attempt = 0; attempt < 3; attempt++) {
        const pricing = await input.financeService.capturePaymentFundingContext?.(
          targetMemberId,
          parsed.kind,
          cycle.period,
          resolvedAmount.currency
        )
        try {
          saveResult = await input.repository.savePaymentConfirmation({
            ...message,
            sourceKey,
            normalizedText: parsed.normalizedText,
            status: 'recorded',
            cycleId: cycle.id,
            memberId: targetMemberId,
            kind: parsed.kind,
            amountMinor: resolvedAmount.amountMinor,
            currency: resolvedAmount.currency,
            explicitAmountMinor: parsed.explicitAmount?.amountMinor ?? null,
            explicitCurrency: parsed.explicitAmount?.currency ?? null,
            recordedAt: message.messageSentAt ?? nowInstant(),
            ...(pricing ? { purchaseFundingContext: pricing } : {}),
            ...(message.utilityBillId ? { utilityBillId: message.utilityBillId } : {})
          })
          break
        } catch (error) {
          if (
            attempt === 2 ||
            !(error instanceof Error) ||
            !error.message.includes('Payment pricing changed')
          )
            throw error
        }
      }
      if (!saveResult) throw new Error('Payment confirmation could not be saved')

      if (saveResult.status === 'duplicate') {
        const record = await input.repository.getPaymentRecordByConfirmationSource(
          message.telegramChatId,
          sourceKey
        )
        if (!record) return saveResult
        let balanceUpdatePending = false
        try {
          await input.financeService.reconcilePaymentPurchaseAllocations?.(record.id)
        } catch {
          balanceUpdatePending = true
        }
        return {
          status: 'duplicate',
          kind: record.kind,
          amount: Money.fromMinor(record.amountMinor, record.currency),
          ...(balanceUpdatePending ? { balanceUpdatePending: true } : {})
        }
      }

      if (saveResult.status === 'needs_review') {
        return {
          status: 'needs_review',
          reason: saveResult.reviewReason
        }
      }

      let balanceUpdatePending = false
      try {
        await input.financeService.reconcilePaymentPurchaseAllocations?.(
          saveResult.paymentRecord.id
        )
      } catch {
        balanceUpdatePending = true
      }
      return {
        status: 'recorded',
        kind: saveResult.paymentRecord.kind,
        ...(balanceUpdatePending ? { balanceUpdatePending: true } : {}),
        amount: Money.fromMinor(
          saveResult.paymentRecord.amountMinor,
          saveResult.paymentRecord.currency
        )
      }
    }
  }
}

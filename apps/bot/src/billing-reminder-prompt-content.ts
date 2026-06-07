import {
  buildPaymentReminderMessageContentForSurface,
  type PaymentReminderContentInput,
  type PaymentReminderMessageContent
} from './payment-reminder-content'

export type BillingReminderPromptContentInput = PaymentReminderContentInput

export function buildBillingReminderPromptContent(
  input: BillingReminderPromptContentInput
): PaymentReminderMessageContent {
  return buildPaymentReminderMessageContentForSurface({
    ...input,
    surface: 'billing-reminder-prompt'
  })
}

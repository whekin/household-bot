import {
  buildPaymentReminderMessageContentForSurface,
  type PaymentReminderContentInput,
  type PaymentReminderMessageContent
} from './payment-reminder-content'

export type PaymentInstructionContentInput = PaymentReminderContentInput

export function buildPaymentInstructionContent(
  input: PaymentInstructionContentInput
): PaymentReminderMessageContent {
  return buildPaymentReminderMessageContentForSurface({
    ...input,
    surface: 'payment-instruction'
  })
}

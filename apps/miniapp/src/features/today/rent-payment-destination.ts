import type { MiniAppDashboard } from '../../miniapp-api'

export type RentPaymentDestination = NonNullable<
  MiniAppDashboard['rentPaymentDestinations']
>[number]

export function rentPaymentAccountTail(account: string): string {
  const compact = account.replace(/\s+/g, '')
  if (compact.length <= 8) return account
  return `•• ${compact.slice(-4)}`
}

export function rentPaymentDestinationMeta(destination: RentPaymentDestination): string {
  return [destination.recipientName, destination.bankName].filter(Boolean).join(' · ')
}

export function rentPaymentDestinationCopyText(destination: RentPaymentDestination): string {
  return [
    destination.label,
    destination.recipientName,
    destination.bankName,
    destination.account,
    destination.note,
    destination.link
  ]
    .filter((value): value is string => Boolean(value))
    .join('\n')
}

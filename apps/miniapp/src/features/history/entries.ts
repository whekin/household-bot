import { CircleCheck, type LucideIcon } from 'lucide-react'

import type { MiniAppDashboard } from '@/api'
import type { Kind } from '@/components/kind'
import type { Copy } from '@/i18n'
import { majorStringToMinor, minorToMajorString } from '@/lib/money'

export type LedgerEntry = MiniAppDashboard['ledger'][number]

export function entryKind(entry: LedgerEntry): Kind {
  if (entry.kind === 'purchase') return 'buys'
  if (entry.kind === 'utility') return 'utilities'
  return entry.paymentKind === 'rent' ? 'rent' : 'utilities'
}

/** Payments keep their kind's color but show a check, so "paid" and "billed" differ. */
export function entryIcon(entry: LedgerEntry): LucideIcon | undefined {
  return entry.kind === 'payment' ? CircleCheck : undefined
}

export function entryTitle(entry: LedgerEntry, copy: Copy): string {
  if (entry.kind === 'purchase') return entry.title
  if (entry.kind === 'utility') return copy.entryBill.replace('{name}', entry.title)
  if (entry.isRoundingAdjustment) return copy.paymentLedgerRounding
  return entry.paymentKind === 'rent' ? copy.entryRentPaid : copy.entryUtilitiesPaid
}

/** Calendar day of an entry in the household's timezone, as YYYY-MM-DD. */
export function entryDay(entry: LedgerEntry, timezone: string): string | null {
  if (!entry.occurredAt) return null
  const date = new Date(entry.occurredAt)
  if (Number.isNaN(date.getTime())) return entry.occurredAt.slice(0, 10)
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).format(date)
  } catch {
    return entry.occurredAt.slice(0, 10)
  }
}

export function newestFirst(entries: readonly LedgerEntry[]): LedgerEntry[] {
  return [...entries].sort((left, right) =>
    (right.occurredAt ?? '').localeCompare(left.occurredAt ?? '')
  )
}

/**
 * A member's share of a purchase. Custom splits carry it; equal splits hand the
 * leftover cents to participants in member-id order, as the server does.
 */
export function purchaseShareForMember(entry: LedgerEntry, memberId: string): string | null {
  const explicit = entry.purchaseParticipants?.find(
    (participant) => participant.memberId === memberId
  )
  if (explicit?.shareAmountMajor) return explicit.shareAmountMajor

  const included = (entry.purchaseParticipants ?? [])
    .filter((participant) => participant.included)
    .sort((a, b) => (a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0))
  const index = included.findIndex((participant) => participant.memberId === memberId)
  if (index < 0 || included.length === 0) return null

  const amountMinor = majorStringToMinor(entry.displayAmountMajor)
  const base = amountMinor / BigInt(included.length)
  const leftover = amountMinor % BigInt(included.length)
  return minorToMajorString(base + (BigInt(index) < leftover ? 1n : 0n))
}

import type { Copy } from '@/i18n'

export type MemberStatus = 'active' | 'away' | 'left'

export function daysInPeriod(period: string | null | undefined): number {
  const match = period?.match(/^(\d{4})-(\d{2})$/)
  if (!match) return 31
  const year = Number(match[1])
  const month = Number(match[2])
  return new Date(year, month, 0).getDate()
}

export function defaultPresenceDaysForStatus(
  status: MemberStatus,
  period: string | null | undefined
): number {
  return status === 'active' ? daysInPeriod(period) : 0
}

export function memberStatusLabel(status: MemberStatus, copy: Copy): string {
  if (status === 'active') return copy.memberStatusActive
  if (status === 'away') return copy.memberStatusAway
  return copy.memberStatusLeft
}

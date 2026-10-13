import type { MiniAppDashboard } from '@/api'
import { cn } from '@/lib/cn'

type Currency = MiniAppDashboard['currency']

// A regular no-break space: the display face has no narrow one.
const NBSP = '\u00a0'

export function groupDigits(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP)
}

export function moneyParts(amountMajor: string, currency: Currency) {
  const negative = amountMajor.trim().startsWith('-')
  const absolute = negative ? amountMajor.trim().slice(1) : amountMajor.trim()
  const [whole = '0', fraction = '00'] = absolute.split('.')
  return {
    negative,
    whole: groupDigits(whole),
    fraction: fraction.padEnd(2, '0').slice(0, 2),
    symbol: currency === 'USD' ? '$' : currency === 'GEL' ? '₾' : currency,
    symbolFirst: currency === 'USD'
  }
}

/** "2 415.00 ₾" / "$875.00" — absolute value; callers say the direction in words. */
export function formatMoney(amountMajor: string, currency: Currency): string {
  const parts = moneyParts(amountMajor, currency)
  const number = `${parts.whole}.${parts.fraction}`
  return parts.symbolFirst ? `${parts.symbol}${number}` : `${number}${NBSP}${parts.symbol}`
}

/**
 * Display amount: whole part in the display face, cents and symbol quieter.
 * Never prints a sign — the sentence around it carries the direction.
 */
export function Amount({
  value,
  currency,
  className,
  centsClassName
}: {
  value: string
  currency: Currency
  className?: string
  centsClassName?: string
}) {
  const parts = moneyParts(value, currency)
  return (
    <span className={cn('inline-flex items-baseline font-display tabular-nums', className)}>
      {parts.symbolFirst ? (
        <span className={cn('mr-0.5 opacity-60', centsClassName)}>{parts.symbol}</span>
      ) : null}
      <span>{parts.whole}</span>
      <span className={cn('text-[0.55em] opacity-60', centsClassName)}>.{parts.fraction}</span>
      {parts.symbolFirst ? null : (
        <span className={cn('ml-1 text-[0.55em] opacity-60', centsClassName)}>{parts.symbol}</span>
      )}
    </span>
  )
}

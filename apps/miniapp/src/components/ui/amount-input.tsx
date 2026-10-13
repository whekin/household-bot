import { useId, type ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * The amount is the first thing every money form asks for, so it gets the room:
 * a large centered field in the display face, with the currency picker beneath.
 */
export function AmountInput({
  value,
  onChange,
  currency,
  label,
  autoFocus,
  disabled,
  footer
}: {
  value: string
  onChange: (value: string) => void
  currency: 'USD' | 'GEL'
  label: string
  autoFocus?: boolean
  disabled?: boolean
  footer?: ReactNode
}) {
  const id = useId()
  return (
    <div className="rounded-[24px] bg-card px-4 pb-4 pt-3 text-center">
      <label htmlFor={id} className="text-[13px] font-medium text-faint">
        {label}
      </label>
      <div className="mt-1 flex items-baseline justify-center gap-1.5">
        {currency === 'USD' ? (
          <span className="font-display text-3xl font-bold text-faint">$</span>
        ) : null}
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          placeholder="0.00"
          data-autofocus={autoFocus ? '' : undefined}
          disabled={disabled}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(',', '.'))}
          // Sized to its text (WebKit has no field-sizing yet) so the symbol hugs the digits.
          style={{ width: `${value ? Math.min(10, value.length) + 0.5 : 4.5}ch` }}
          className={cn(
            'min-w-0 bg-transparent text-center font-display text-[44px] font-bold leading-tight tabular-nums text-foreground outline-none placeholder:text-border-hover disabled:opacity-50'
          )}
        />
        {currency === 'GEL' ? (
          <span className="font-display text-3xl font-bold text-faint">₾</span>
        ) : null}
      </div>
      {footer ? <div className="mt-3">{footer}</div> : null}
    </div>
  )
}

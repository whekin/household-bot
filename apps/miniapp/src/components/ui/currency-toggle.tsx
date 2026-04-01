import { cn } from '../../lib/cn'

export type CurrencyCode = 'USD' | 'GEL'

type CurrencyToggleProps = {
  value: CurrencyCode
  ariaLabel: string
  disabled?: boolean
  class?: string
  onChange?: (value: CurrencyCode) => void
}

const CURRENCY_ITEMS: ReadonlyArray<{
  value: CurrencyCode
  symbol: string
  code: string
}> = [
  { value: 'USD', symbol: '$', code: 'USD' },
  { value: 'GEL', symbol: '₾', code: 'GEL' }
]

export function CurrencyToggle(props: CurrencyToggleProps) {
  return (
    <div
      class={cn('currency-toggle', props.disabled && 'is-disabled', props.class)}
      role="radiogroup"
      aria-label={props.ariaLabel}
      aria-disabled={props.disabled ? 'true' : undefined}
    >
      {CURRENCY_ITEMS.map((item) => (
        <button
          type="button"
          role="radio"
          aria-checked={props.value === item.value}
          class={cn(
            'currency-toggle__option',
            props.value === item.value && 'is-selected',
            props.disabled && 'is-disabled'
          )}
          disabled={props.disabled}
          onClick={() => props.onChange?.(item.value)}
        >
          <span class="currency-toggle__symbol" aria-hidden="true">
            {item.symbol}
          </span>
          <span class="currency-toggle__code">{item.code}</span>
        </button>
      ))}
    </div>
  )
}

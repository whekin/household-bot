import { cn } from '@/lib/cn'

const currencies = ['USD', 'GEL'] as const

export function CurrencyToggle({
  value,
  onChange,
  disabled
}: {
  value: 'USD' | 'GEL'
  onChange: (value: 'USD' | 'GEL') => void
  disabled?: boolean | undefined
}) {
  return (
    <div className="flex h-10 overflow-hidden rounded-lg border border-border">
      {currencies.map((currency) => (
        <button
          key={currency}
          type="button"
          disabled={disabled}
          onClick={() => onChange(currency)}
          className={cn(
            'flex-1 px-3 text-sm font-medium transition-colors disabled:opacity-50',
            value === currency ? 'bg-primary-soft text-primary' : 'bg-field text-muted-foreground'
          )}
        >
          {currency}
        </button>
      ))}
    </div>
  )
}

import { cn } from '@/lib/cn'
import { haptics } from '@/telegram/webapp'
import type { Locale } from '@/i18n'

function SegmentedToggle<T extends string>({
  value,
  options,
  onChange,
  ariaLabel
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (value: T) => void
  ariaLabel?: string | undefined
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex h-10 overflow-hidden rounded-lg border border-border bg-field"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => {
            if (option.value !== value) haptics.selection()
            onChange(option.value)
          }}
          className={cn(
            'flex-1 px-3 text-sm font-medium transition-colors',
            option.value === value ? 'bg-primary-soft text-primary' : 'text-faint'
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function CurrencyToggle({
  value,
  onChange,
  ariaLabel
}: {
  value: 'USD' | 'GEL'
  onChange: (value: 'USD' | 'GEL') => void
  ariaLabel?: string | undefined
}) {
  return (
    <SegmentedToggle
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      options={[
        { value: 'USD', label: 'USD' },
        { value: 'GEL', label: 'GEL' }
      ]}
    />
  )
}

export function LocaleToggle({
  value,
  onChange,
  ariaLabel
}: {
  value: Locale
  onChange: (value: Locale) => void
  ariaLabel?: string | undefined
}) {
  return (
    <SegmentedToggle
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      options={[
        { value: 'en', label: 'EN' },
        { value: 'ru', label: 'RU' }
      ]}
    />
  )
}

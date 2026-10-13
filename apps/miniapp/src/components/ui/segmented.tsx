import type { ComponentType, ReactNode } from 'react'

import type { Locale } from '@/i18n'
import { cn } from '@/lib/cn'
import { haptics } from '@/telegram/webapp'

/** iOS-style segmented control: a sunken track with the chosen option raised. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  disabled,
  className
}: {
  value: T
  options: readonly {
    value: T
    label?: ReactNode
    icon?: ComponentType<{ className?: string }>
    ariaLabel?: string
  }[]
  onChange: (value: T) => void
  ariaLabel?: string | undefined
  disabled?: boolean | undefined
  className?: string
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex h-11 gap-1 rounded-[14px] bg-field p-1', className)}
    >
      {options.map((option) => {
        const Icon = option.icon
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            aria-pressed={active}
            aria-label={option.ariaLabel}
            onClick={() => {
              if (!active) haptics.selection()
              onChange(option.value)
            }}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold transition-colors disabled:opacity-50',
              active ? 'bg-card text-foreground shadow-sm' : 'text-faint'
            )}
          >
            {Icon ? <Icon className="size-4" /> : null}
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

const CURRENCIES = [
  { value: 'GEL', label: '₾ GEL' },
  { value: 'USD', label: '$ USD' }
] as const

export function CurrencyToggle({
  value,
  onChange,
  disabled,
  ariaLabel
}: {
  value: 'USD' | 'GEL'
  onChange: (value: 'USD' | 'GEL') => void
  disabled?: boolean | undefined
  ariaLabel?: string | undefined
}) {
  return (
    <Segmented
      value={value}
      onChange={onChange}
      options={CURRENCIES}
      disabled={disabled}
      ariaLabel={ariaLabel}
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
    <Segmented
      value={value}
      onChange={onChange}
      ariaLabel={ariaLabel}
      options={[
        { value: 'en', label: 'English' },
        { value: 'ru', label: 'Русский' }
      ]}
    />
  )
}

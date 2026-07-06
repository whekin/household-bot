import { Check } from 'lucide-react'

import { cn } from '@/lib/cn'

export function Checkbox({
  checked,
  onCheckedChange,
  disabled,
  'aria-label': ariaLabel
}: {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  disabled?: boolean
  'aria-label'?: string
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        checked
          ? 'border-primary-border bg-primary text-primary-foreground'
          : 'border-border bg-field'
      )}
    >
      {checked ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </button>
  )
}

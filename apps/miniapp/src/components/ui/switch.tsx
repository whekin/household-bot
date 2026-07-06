import { cn } from '@/lib/cn'
import { haptics } from '@/telegram/webapp'

export function Switch({
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
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        haptics.selection()
        onCheckedChange(!checked)
      }}
      className={cn(
        'relative h-6 w-10 shrink-0 rounded-full border transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        checked ? 'border-primary-border bg-primary' : 'border-border bg-field'
      )}
    >
      <span
        className={cn(
          'absolute top-1/2 size-4.5 -translate-y-1/2 rounded-full bg-foreground transition-[left]',
          checked ? 'left-[calc(100%-20px)]' : 'left-0.5'
        )}
      />
    </button>
  )
}

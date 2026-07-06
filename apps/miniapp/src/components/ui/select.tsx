import { ChevronDown } from 'lucide-react'
import type { SelectHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

/**
 * Styled native select — native pickers beat custom dropdowns inside the
 * Telegram mobile webview.
 */
export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className={cn('relative', className)}>
      <select
        className="h-10 w-full appearance-none rounded-lg border border-border bg-field px-3 pr-9 text-sm text-foreground outline-none transition-colors focus:border-transparent focus:ring-2 focus:ring-ring disabled:opacity-50 [&>option]:bg-elevated [&>option]:text-foreground"
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-faint"
        aria-hidden
      />
    </div>
  )
}

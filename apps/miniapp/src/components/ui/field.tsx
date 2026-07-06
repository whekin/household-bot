import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

export function Field({
  label,
  hint,
  error,
  children,
  className
}: {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <label className={cn('block space-y-1.5', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {error ? (
        <span className="block text-xs text-destructive">{error}</span>
      ) : hint ? (
        <span className="block text-xs text-faint">{hint}</span>
      ) : null}
    </label>
  )
}

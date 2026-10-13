import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/cn'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-[24px] bg-card p-4', className)} {...props} />
}

export function CardHeader({
  title,
  hint,
  action,
  className
}: {
  title: ReactNode
  hint?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-3 flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
        {hint ? <p className="mt-0.5 text-[13px] text-faint">{hint}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

/** Small uppercase section label that sits above a group of cards. */
export function SectionLabel({
  children,
  action,
  className
}: {
  children: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex items-center justify-between gap-3 px-1', className)}>
      <h2 className="text-[13px] font-semibold text-muted-foreground">{children}</h2>
      {action}
    </div>
  )
}

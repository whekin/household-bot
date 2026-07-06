import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-4',
  {
    variants: {
      tone: {
        neutral: 'bg-field text-muted-foreground',
        primary: 'bg-primary-soft text-primary',
        success: 'bg-status-credit/15 text-status-credit',
        warning: 'bg-status-overdue/15 text-status-overdue',
        danger: 'bg-destructive-soft text-destructive',
        outline: 'border border-border text-faint'
      }
    },
    defaultVariants: {
      tone: 'neutral'
    }
  }
)

type BadgeProps = HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>

export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />
}

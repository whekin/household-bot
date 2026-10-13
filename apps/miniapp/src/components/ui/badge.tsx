import { cva, type VariantProps } from 'class-variance-authority'
import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold leading-4',
  {
    variants: {
      tone: {
        neutral: 'bg-elevated text-muted-foreground',
        primary: 'bg-primary-soft text-foreground',
        success: 'bg-buys-soft text-buys-ink',
        warning: 'bg-util-soft text-util-ink',
        danger: 'bg-danger-soft text-danger-ink',
        util: 'bg-util-soft text-util-ink',
        rent: 'bg-rent-soft text-rent-ink',
        buys: 'bg-buys-soft text-buys-ink',
        routine: 'bg-routine-soft text-routine-ink',
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

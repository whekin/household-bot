import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { Loader2 } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-2xl font-semibold transition-[background-color,transform,opacity] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40 select-none whitespace-nowrap',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground active:bg-primary-hover',
        secondary: 'bg-elevated text-foreground active:bg-field-hover',
        ghost: 'text-muted-foreground active:bg-field-hover',
        soft: 'bg-primary-soft text-foreground active:bg-field-hover',
        destructive: 'bg-danger-soft text-danger-ink active:opacity-80',
        outline: 'border border-border text-foreground active:border-border-hover'
      },
      size: {
        sm: 'h-9 px-3.5 text-[13px]',
        md: 'h-11 px-4 text-sm',
        lg: 'h-13 px-5 text-[15px]',
        icon: 'size-10 rounded-full'
      }
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'md'
    }
  }
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
    loading?: boolean
  }

export function Button({
  className,
  variant,
  size,
  asChild = false,
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      type={asChild ? undefined : 'button'}
      className={cn(buttonVariants({ variant, size }), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
      {children}
    </Comp>
  )
}

export { buttonVariants }

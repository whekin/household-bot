import {
  ArrowLeftRight,
  KeyRound,
  ListChecks,
  ShoppingBasket,
  Zap,
  type LucideIcon
} from 'lucide-react'

import type { Copy } from '@/i18n'
import { cn } from '@/lib/cn'

/**
 * One color and one icon per kind of thing, used on every screen so a glance at
 * the dot says what a row is about.
 */
export type Kind = 'utilities' | 'rent' | 'buys' | 'transfer' | 'routine'

export const KIND_STYLE: Record<
  Kind,
  { icon: LucideIcon; solid: string; soft: string; ink: string; text: string }
> = {
  utilities: {
    icon: Zap,
    solid: 'bg-util',
    soft: 'bg-util-soft',
    ink: 'text-util-ink',
    text: 'text-util'
  },
  rent: {
    icon: KeyRound,
    solid: 'bg-rent',
    soft: 'bg-rent-soft',
    ink: 'text-rent-ink',
    text: 'text-rent'
  },
  buys: {
    icon: ShoppingBasket,
    solid: 'bg-buys',
    soft: 'bg-buys-soft',
    ink: 'text-buys-ink',
    text: 'text-buys'
  },
  transfer: {
    icon: ArrowLeftRight,
    solid: 'bg-buys',
    soft: 'bg-buys-soft',
    ink: 'text-buys-ink',
    text: 'text-buys'
  },
  routine: {
    icon: ListChecks,
    solid: 'bg-routine',
    soft: 'bg-routine-soft',
    ink: 'text-routine-ink',
    text: 'text-routine'
  }
}

export function kindLabel(kind: 'utilities' | 'rent' | 'buys', copy: Copy): string {
  if (kind === 'utilities') return copy.kindUtilities
  if (kind === 'rent') return copy.kindRent
  return copy.kindBuys
}

/** Rounded square with the kind's icon on its soft tint. */
export function KindIcon({
  kind,
  icon,
  className
}: {
  kind: Kind
  /** Overrides the kind's default icon while keeping its color. */
  icon?: LucideIcon
  className?: string
}) {
  const style = KIND_STYLE[kind]
  const Icon = icon ?? style.icon
  return (
    <span
      className={cn(
        'flex size-10 shrink-0 items-center justify-center rounded-2xl',
        style.soft,
        style.ink,
        className
      )}
      aria-hidden
    >
      <Icon className="size-[18px]" strokeWidth={2.2} />
    </span>
  )
}

export function KindDot({ kind, className }: { kind: Kind; className?: string }) {
  return (
    <span
      className={cn('inline-block size-2 shrink-0 rounded-full', KIND_STYLE[kind].solid, className)}
      aria-hidden
    />
  )
}

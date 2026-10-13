import { cn } from '@/lib/cn'

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || '?'
  )
}

/** Initials in a circle; the reader's own avatar is inked so "you" stands out in lists. */
export function Avatar({
  name,
  me = false,
  className
}: {
  name: string
  me?: boolean
  className?: string
}) {
  return (
    <span
      aria-hidden
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full text-xs font-bold',
        me ? 'bg-primary text-primary-foreground' : 'bg-elevated text-foreground',
        className
      )}
    >
      {initials(name)}
    </span>
  )
}

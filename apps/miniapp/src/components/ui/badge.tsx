import type { ParentProps } from 'solid-js'

import { cn } from '../../lib/cn'

type BadgeProps = ParentProps<{
  variant?: 'default' | 'muted' | 'accent' | 'danger'
  class?: string
}>

export function Badge(props: BadgeProps) {
  return (
    <span
      class={cn(
        'ui-badge',
        {
          'ui-badge--muted': props.variant === 'muted',
          'ui-badge--accent': props.variant === 'accent',
          'ui-badge--danger': props.variant === 'danger'
        },
        props.class
      )}
    >
      {props.children}
    </span>
  )
}

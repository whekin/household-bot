import type { ParentProps } from 'solid-js'

import { cn } from '../../lib/cn'

export function Card(
  props: ParentProps<{ class?: string; accent?: boolean; muted?: boolean; wide?: boolean }>
) {
  return (
    <article
      class={cn(
        'ui-card',
        props.accent && 'ui-card--accent',
        props.muted && 'ui-card--muted',
        props.wide && 'ui-card--wide',
        props.class
      )}
    >
      {props.children}
    </article>
  )
}

export function StatCard(props: ParentProps<{ class?: string }>) {
  return <article class={cn('stat-card', props.class)}>{props.children}</article>
}

/** @deprecated Use Badge component instead */
export function MiniChip(props: ParentProps<{ muted?: boolean; class?: string }>) {
  return (
    <span class={cn('mini-chip', props.muted && 'mini-chip--muted', props.class)}>
      {props.children}
    </span>
  )
}

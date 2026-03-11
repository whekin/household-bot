import { Show, type ParentProps } from 'solid-js'

import { cn } from '../../lib/cn'

export function Field(
  props: ParentProps<{
    label: string
    hint?: string
    wide?: boolean
    class?: string
  }>
) {
  return (
    <label class={cn('settings-field', props.wide && 'settings-field--wide', props.class)}>
      <span>{props.label}</span>
      {props.children}
      <Show when={props.hint}>{(hint) => <small>{hint()}</small>}</Show>
    </label>
  )
}

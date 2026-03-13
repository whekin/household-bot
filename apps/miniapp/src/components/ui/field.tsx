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
    <label class={cn('ui-field', props.wide && 'ui-field--wide', props.class)}>
      <span class="ui-field__label">{props.label}</span>
      {props.children}
      <Show when={props.hint}>{(hint) => <small class="ui-field__hint">{hint()}</small>}</Show>
    </label>
  )
}

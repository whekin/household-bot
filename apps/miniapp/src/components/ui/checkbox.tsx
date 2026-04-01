import * as CheckboxPrimitive from '@kobalte/core/checkbox'
import { Check } from 'lucide-solid'
import type { ParentProps } from 'solid-js'

import { cn } from '../../lib/cn'

type CheckboxProps = ParentProps<{
  checked: boolean
  disabled?: boolean
  class?: string
  labelClass?: string
  onChange: (checked: boolean) => void
}>

export function Checkbox(props: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      checked={props.checked}
      {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
      onChange={props.onChange}
      class={cn('ui-checkbox', props.class)}
    >
      <CheckboxPrimitive.Input />
      <CheckboxPrimitive.Control class="ui-checkbox__control">
        <CheckboxPrimitive.Indicator class="ui-checkbox__indicator">
          <Check size={13} stroke-width={3} />
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Control>
      {props.children ? (
        <CheckboxPrimitive.Label class={cn('ui-checkbox__label', props.labelClass)}>
          {props.children}
        </CheckboxPrimitive.Label>
      ) : null}
    </CheckboxPrimitive.Root>
  )
}

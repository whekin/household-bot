import * as SwitchPrimitive from '@kobalte/core/switch'
import { cn } from '../../lib/cn'

type ToggleProps = {
  checked: boolean
  disabled?: boolean
  label?: string
  class?: string
  onChange: (checked: boolean) => void
}

export function Toggle(props: ToggleProps) {
  return (
    <SwitchPrimitive.Root
      checked={props.checked}
      {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
      onChange={props.onChange}
      class={cn('ui-toggle', props.class)}
    >
      <SwitchPrimitive.Input />
      <SwitchPrimitive.Control class="ui-toggle__track">
        <SwitchPrimitive.Thumb class="ui-toggle__thumb" />
      </SwitchPrimitive.Control>
      {props.label && (
        <SwitchPrimitive.Label class="ui-toggle__label">{props.label}</SwitchPrimitive.Label>
      )}
    </SwitchPrimitive.Root>
  )
}

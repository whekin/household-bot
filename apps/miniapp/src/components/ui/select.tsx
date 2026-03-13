import * as SelectPrimitive from '@kobalte/core/select'
import { Check, ChevronDown } from 'lucide-solid'

import { cn } from '../../lib/cn'

export type SelectOption = {
  value: string
  label: string
}

type SelectProps = {
  value?: string
  options: readonly SelectOption[]
  disabled?: boolean
  class?: string
  id?: string
  ariaLabel: string
  placeholder?: string
  onChange?: (value: string) => void
}

export function Select(props: SelectProps) {
  const selectedOption = () =>
    props.options.find((option) => option.value === (props.value ?? '')) ?? null
  const optionalRootProps = {
    ...(props.disabled !== undefined ? { disabled: props.disabled } : {}),
    ...(props.id !== undefined ? { id: props.id } : {}),
    ...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {})
  }

  return (
    <SelectPrimitive.Root<SelectOption>
      value={selectedOption()}
      options={[...props.options]}
      optionValue="value"
      optionTextValue="label"
      onChange={(option) => props.onChange?.(option?.value ?? '')}
      itemComponent={(itemProps) => (
        <SelectPrimitive.Item item={itemProps.item} class="ui-select__item">
          <SelectPrimitive.ItemLabel class="ui-select__item-label">
            {itemProps.item.rawValue.label}
          </SelectPrimitive.ItemLabel>
          <SelectPrimitive.ItemIndicator class="ui-select__item-indicator">
            <Check size={14} />
          </SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>
      )}
      {...optionalRootProps}
    >
      <SelectPrimitive.HiddenSelect />
      <SelectPrimitive.Trigger class={cn('ui-select', props.class)} aria-label={props.ariaLabel}>
        <SelectPrimitive.Value<SelectOption> class="ui-select__value">
          {(state) => state.selectedOption()?.label ?? props.placeholder ?? ''}
        </SelectPrimitive.Value>
        <SelectPrimitive.Icon class="ui-select__icon">
          <ChevronDown size={16} />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content class="ui-select__content">
          <SelectPrimitive.Listbox class="ui-select__listbox" />
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
}

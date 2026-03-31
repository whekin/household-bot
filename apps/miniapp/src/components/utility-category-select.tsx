import { UTILITY_CATEGORIES } from '@household/domain'
import { Select, type SelectOption } from './ui/select'

type UtilityCategorySelectProps = {
  value: string
  disabled?: boolean
  class?: string
  id?: string
  ariaLabel: string
  placeholder?: string
  onChange?: (value: string) => void
}

export function UtilityCategorySelect(props: UtilityCategorySelectProps) {
  const options: readonly SelectOption[] = UTILITY_CATEGORIES.map((category: string) => ({
    value: category,
    label: category
  }))

  return (
    <Select
      value={props.value}
      options={options}
      disabled={props.disabled}
      class={props.class}
      id={props.id}
      ariaLabel={props.ariaLabel}
      placeholder={props.placeholder}
      onChange={props.onChange}
    />
  )
}

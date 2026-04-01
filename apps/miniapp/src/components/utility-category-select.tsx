import { UTILITY_CATEGORIES } from '@household/domain'
import { Select, type SelectOption } from './ui/select'

type UtilityCategorySelectProps = {
  value: string
  options?: readonly SelectOption[]
  disabled?: boolean
  class?: string
  id?: string
  ariaLabel: string
  placeholder?: string
  onChange?: (value: string) => void
}

export function UtilityCategorySelect(props: UtilityCategorySelectProps) {
  const options: readonly SelectOption[] =
    props.options ??
    UTILITY_CATEGORIES.map((category: string) => ({
      value: category,
      label: category
    }))

  return (
    <Select
      value={props.value}
      options={options}
      {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
      {...(props.class !== undefined ? { class: props.class } : {})}
      {...(props.id !== undefined ? { id: props.id } : {})}
      ariaLabel={props.ariaLabel}
      {...(props.placeholder !== undefined ? { placeholder: props.placeholder } : {})}
      {...(props.onChange !== undefined ? { onChange: props.onChange } : {})}
    />
  )
}

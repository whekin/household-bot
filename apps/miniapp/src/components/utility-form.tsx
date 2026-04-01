import { CurrencyToggle } from './ui/currency-toggle'
import { Field } from './ui/field'
import { Input } from './ui/input'
import { type SelectOption } from './ui/select'
import { UtilityCategorySelect } from './utility-category-select'

export type UtilityFormData = {
  billName: string
  amountMajor: string
  currency: 'USD' | 'GEL'
}

type UtilityFormProps = {
  value: UtilityFormData
  onChange: (value: UtilityFormData) => void
  categoryOptions?: readonly SelectOption[]
  labels: {
    category: string
    amount: string
    currency: string
  }
  disabled?: boolean
}

export function UtilityForm(props: UtilityFormProps) {
  return (
    <div class="editor-grid">
      <Field label={props.labels.category}>
        <UtilityCategorySelect
          value={props.value.billName}
          ariaLabel={props.labels.category}
          placeholder={props.labels.category}
          {...(props.categoryOptions ? { options: props.categoryOptions } : {})}
          {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
          onChange={(value) => props.onChange({ ...props.value, billName: value })}
        />
      </Field>
      <Field label={props.labels.amount}>
        <Input
          type="number"
          value={props.value.amountMajor}
          {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
          onInput={(e) => props.onChange({ ...props.value, amountMajor: e.currentTarget.value })}
        />
      </Field>
      <Field label={props.labels.currency}>
        <CurrencyToggle
          value={props.value.currency}
          ariaLabel={props.labels.currency}
          {...(props.disabled !== undefined ? { disabled: props.disabled } : {})}
          onChange={(value) => props.onChange({ ...props.value, currency: value as 'USD' | 'GEL' })}
        />
      </Field>
    </div>
  )
}

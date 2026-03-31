import { Field } from './ui/field'
import { Input } from './ui/input'
import { Select, type SelectOption } from './ui/select'
import { UtilityCategorySelect } from './utility-category-select'

export type UtilityFormData = {
  billName: string
  amountMajor: string
  currency: 'USD' | 'GEL'
}

type UtilityFormProps = {
  value: UtilityFormData
  onChange: (value: UtilityFormData) => void
  currencyOptions: readonly SelectOption[]
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
          disabled={props.disabled}
          onChange={(value) => props.onChange({ ...props.value, billName: value })}
        />
      </Field>
      <Field label={props.labels.amount}>
        <Input
          type="number"
          value={props.value.amountMajor}
          disabled={props.disabled}
          onInput={(e) => props.onChange({ ...props.value, amountMajor: e.currentTarget.value })}
        />
      </Field>
      <Field label={props.labels.currency}>
        <Select
          value={props.value.currency}
          ariaLabel={props.labels.currency}
          options={props.currencyOptions}
          disabled={props.disabled}
          onChange={(value) => props.onChange({ ...props.value, currency: value as 'USD' | 'GEL' })}
        />
      </Field>
    </div>
  )
}

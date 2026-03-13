import type { JSX } from 'solid-js'

import { cn } from '../../lib/cn'

type InputProps = {
  value?: string
  placeholder?: string
  type?: 'text' | 'number' | 'email'
  min?: string | number
  max?: string | number
  step?: string | number
  maxlength?: number
  disabled?: boolean
  invalid?: boolean
  class?: string
  style?: JSX.CSSProperties
  list?: string
  id?: string
  onInput?: JSX.EventHandlerUnion<HTMLInputElement, InputEvent>
  onChange?: JSX.EventHandlerUnion<HTMLInputElement, Event>
  onBlur?: JSX.EventHandlerUnion<HTMLInputElement, FocusEvent>
}

export function Input(props: InputProps) {
  return (
    <input
      type={props.type ?? 'text'}
      value={props.value ?? ''}
      placeholder={props.placeholder}
      min={props.min}
      max={props.max}
      step={props.step}
      maxlength={props.maxlength}
      disabled={props.disabled}
      aria-invalid={props.invalid}
      style={props.style}
      list={props.list}
      id={props.id}
      class={cn('ui-input', props.class)}
      onInput={props.onInput}
      onChange={props.onChange}
      onBlur={props.onBlur}
    />
  )
}

export function Textarea(props: {
  value?: string
  placeholder?: string
  rows?: number
  maxlength?: number
  disabled?: boolean
  class?: string
  onInput?: JSX.EventHandlerUnion<HTMLTextAreaElement, InputEvent>
}) {
  return (
    <textarea
      value={props.value ?? ''}
      placeholder={props.placeholder}
      rows={props.rows ?? 4}
      maxlength={props.maxlength}
      disabled={props.disabled}
      class={cn('ui-input ui-textarea', props.class)}
      onInput={props.onInput}
    />
  )
}

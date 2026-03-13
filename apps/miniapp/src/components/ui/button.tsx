import { cva, type VariantProps } from 'class-variance-authority'
import { Show, type JSX, type ParentProps } from 'solid-js'
import { Loader2 } from 'lucide-solid'

import { cn } from '../../lib/cn'

const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      primary: 'ui-button--primary',
      secondary: 'ui-button--secondary',
      danger: 'ui-button--danger',
      ghost: 'ui-button--ghost',
      icon: 'ui-button--icon'
    },
    size: {
      sm: 'ui-button--sm',
      md: '',
      lg: 'ui-button--lg'
    }
  },
  defaultVariants: {
    variant: 'secondary',
    size: 'md'
  }
})

type ButtonProps = ParentProps<{
  type?: 'button' | 'submit' | 'reset'
  class?: string
  disabled?: boolean
  loading?: boolean
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
}> &
  VariantProps<typeof buttonVariants>

export function Button(props: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      class={cn(buttonVariants({ variant: props.variant, size: props.size }), props.class)}
      disabled={props.disabled || props.loading}
      onClick={props.onClick}
    >
      <Show when={props.loading}>
        <Loader2 class="ui-button__spinner" size={16} />
      </Show>
      {props.children}
    </button>
  )
}

export function IconButton(
  props: ParentProps<{
    label: string
    class?: string
    disabled?: boolean
    onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  }>
) {
  const maybeClass = props.class ? { class: props.class } : {}
  const maybeDisabled = props.disabled !== undefined ? { disabled: props.disabled } : {}
  const maybeOnClick = props.onClick ? { onClick: props.onClick } : {}

  return (
    <Button variant="icon" {...maybeClass} {...maybeDisabled} {...maybeOnClick}>
      <span aria-hidden="true">{props.children}</span>
      <span class="sr-only">{props.label}</span>
    </Button>
  )
}

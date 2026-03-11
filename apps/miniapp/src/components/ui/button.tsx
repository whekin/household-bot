import { cva, type VariantProps } from 'class-variance-authority'
import type { JSX, ParentProps } from 'solid-js'

import { cn } from '../../lib/cn'

const buttonVariants = cva('ui-button', {
  variants: {
    variant: {
      primary: 'ui-button--primary',
      secondary: 'ui-button--secondary',
      danger: 'ui-button--danger',
      ghost: 'ui-button--ghost',
      icon: 'ui-button--icon'
    }
  },
  defaultVariants: {
    variant: 'secondary'
  }
})

type ButtonProps = ParentProps<{
  type?: 'button' | 'submit' | 'reset'
  class?: string
  disabled?: boolean
  onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
}> &
  VariantProps<typeof buttonVariants>

export function Button(props: ButtonProps) {
  return (
    <button
      type={props.type ?? 'button'}
      class={cn(buttonVariants({ variant: props.variant }), props.class)}
      disabled={props.disabled}
      onClick={props.onClick}
    >
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

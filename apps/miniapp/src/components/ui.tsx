import { Show, createEffect, onCleanup, type JSX, type ParentProps } from 'solid-js'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon'

export function Button(
  props: ParentProps<{
    type?: 'button' | 'submit' | 'reset'
    variant?: ButtonVariant
    class?: string
    disabled?: boolean
    onClick?: JSX.EventHandlerUnion<HTMLButtonElement, MouseEvent>
  }>
) {
  return (
    <button
      type={props.type ?? 'button'}
      class={`ui-button ui-button--${props.variant ?? 'secondary'} ${props.class ?? ''}`.trim()}
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

export function Field(
  props: ParentProps<{
    label: string
    hint?: string
    wide?: boolean
    class?: string
  }>
) {
  return (
    <label
      class={`settings-field ${props.wide ? 'settings-field--wide' : ''} ${props.class ?? ''}`.trim()}
    >
      <span>{props.label}</span>
      {props.children}
      <Show when={props.hint}>{(hint) => <small>{hint()}</small>}</Show>
    </label>
  )
}

export function Modal(
  props: ParentProps<{
    open: boolean
    title: string
    description?: string
    closeLabel: string
    footer?: JSX.Element
    onClose: () => void
  }>
) {
  createEffect(() => {
    if (!props.open) {
      return
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        props.onClose()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    onCleanup(() => window.removeEventListener('keydown', onKeyDown))
  })

  return (
    <Show when={props.open}>
      <div class="modal-backdrop" onClick={() => props.onClose()}>
        <section
          class="modal-sheet"
          role="dialog"
          aria-modal="true"
          aria-label={props.title}
          onClick={(event) => event.stopPropagation()}
        >
          <header class="modal-sheet__header">
            <div>
              <h3>{props.title}</h3>
              <Show when={props.description}>{(description) => <p>{description()}</p>}</Show>
            </div>
            <IconButton label={props.closeLabel} onClick={() => props.onClose()}>
              x
            </IconButton>
          </header>

          <div class="modal-sheet__body">{props.children}</div>

          <Show when={props.footer}>
            {(footer) => <footer class="modal-sheet__footer">{footer()}</footer>}
          </Show>
        </section>
      </div>
    </Show>
  )
}

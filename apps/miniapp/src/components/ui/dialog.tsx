import * as Dialog from '@kobalte/core/dialog'
import { Show, type JSX, type ParentProps } from 'solid-js'

import { XIcon } from './icons'

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
  return (
    <Dialog.Root open={props.open} onOpenChange={(open) => !open && props.onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay class="modal-backdrop" />
        <div class="modal-backdrop">
          <Dialog.Content class="modal-sheet" aria-label={props.title}>
            <header class="modal-sheet__header">
              <div>
                <Dialog.Title>{props.title}</Dialog.Title>
                <Show when={props.description}>
                  {(description) => <Dialog.Description>{description()}</Dialog.Description>}
                </Show>
              </div>
              <Dialog.CloseButton class="ui-button ui-button--icon modal-close-button">
                <XIcon />
                <span class="sr-only">{props.closeLabel}</span>
              </Dialog.CloseButton>
            </header>
            <div class="modal-sheet__body">{props.children}</div>
            <Show when={props.footer}>
              {(footer) => <footer class="modal-sheet__footer">{footer()}</footer>}
            </Show>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

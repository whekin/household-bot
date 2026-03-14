import { Show, createEffect, onCleanup } from 'solid-js'

import { cn } from '../../lib/cn'

export interface ToastOptions {
  message: string
  type?: 'success' | 'info' | 'error'
  duration?: number
}

export interface ToastState {
  visible: boolean
  message: string
  type: 'success' | 'info' | 'error'
}

const toastVariants = {
  success: 'toast--success',
  info: 'toast--info',
  error: 'toast--error'
}

export function Toast(props: { state: ToastState; onClose: () => void }) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  createEffect(() => {
    if (props.state.visible) {
      timeoutId = setTimeout(
        () => {
          props.onClose()
        },
        props.state.type === 'error' ? 4000 : 2000
      )
    }
  })

  onCleanup(() => {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  })

  return (
    <Show when={props.state.visible}>
      <div role="status" aria-live="polite" class={cn('toast', toastVariants[props.state.type])}>
        <span class="toast__message">{props.state.message}</span>
      </div>
    </Show>
  )
}

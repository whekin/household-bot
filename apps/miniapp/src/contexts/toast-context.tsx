import { createContext, createSignal, useContext, type ParentProps } from 'solid-js'

import { Toast, type ToastState } from '../components/ui/toast'
import { useI18n } from './i18n-context'

type ToastContextValue = {
  showToast: (message: string, type?: 'success' | 'info' | 'error') => void
  showError: (error: unknown, fallback?: string) => void
  hideToast: () => void
}

const ToastContext = createContext<ToastContextValue>()

function extractErrorMessage(error: unknown): string | null {
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim()
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim()
  }

  return null
}

export function ToastProvider(props: ParentProps) {
  const { locale } = useI18n()
  const [toastState, setToastState] = createSignal<ToastState>({
    visible: false,
    message: '',
    type: 'info'
  })

  function hideToast() {
    setToastState((current) => ({ ...current, visible: false }))
  }

  function showToast(message: string, type: 'success' | 'info' | 'error' = 'info') {
    setToastState({
      visible: true,
      message,
      type
    })
  }

  function showError(error: unknown, fallback?: string) {
    const defaultFallback =
      locale() === 'ru'
        ? 'Что-то пошло не так. Попробуй ещё раз.'
        : 'Something went wrong. Try again.'

    showToast(extractErrorMessage(error) ?? fallback ?? defaultFallback, 'error')
  }

  return (
    <ToastContext.Provider
      value={{
        showToast,
        showError,
        hideToast
      }}
    >
      {props.children}
      <Toast state={toastState()} onClose={hideToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) {
    throw new Error('useToast must be used within ToastProvider')
  }

  return context
}

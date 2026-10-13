import { useEffect, useRef } from 'react'

import { getTelegramWebApp } from './webapp'

/**
 * Bind the Telegram MainButton while the calling component is mounted.
 * Pass `null` to leave the button hidden (e.g. no primary action right now).
 */
export function useMainButton(
  config: {
    text: string
    onClick: () => void
    disabled?: boolean
    loading?: boolean
  } | null
) {
  const text = config?.text
  const onClick = config?.onClick
  const disabled = config?.disabled ?? false
  const loading = config?.loading ?? false

  useEffect(() => {
    const button = getTelegramWebApp()?.MainButton
    if (!button || !text || !onClick) {
      return
    }

    button.setText(text)
    if (disabled || loading) {
      button.disable()
    } else {
      button.enable()
    }
    if (loading) {
      button.showProgress(false)
    } else {
      button.hideProgress()
    }
    button.onClick(onClick)
    button.show()

    return () => {
      button.offClick(onClick)
      button.hideProgress()
      button.hide()
    }
  }, [text, onClick, disabled, loading])
}

/** Show the Telegram BackButton while mounted; `onBack` fires on tap. */
export function useBackButton(onBack: (() => void) | null) {
  // The latest handler is read at tap time, so a new closure each render does not
  // re-register the button.
  const handler = useRef(onBack)
  handler.current = onBack
  const enabled = onBack !== null

  useEffect(() => {
    const button = getTelegramWebApp()?.BackButton
    if (!button || !enabled) {
      return
    }

    const click = () => handler.current?.()
    button.onClick(click)
    button.show()

    return () => {
      button.offClick(click)
      button.hide()
    }
  }, [enabled])
}

import { useEffect } from 'react'

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
  useEffect(() => {
    const button = getTelegramWebApp()?.BackButton
    if (!button || !onBack) {
      return
    }

    button.onClick(onBack)
    button.show()

    return () => {
      button.offClick(onBack)
      button.hide()
    }
  }, [onBack])
}

import { useEffect, useRef } from 'react'

import { getTelegramWebApp } from './webapp'

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

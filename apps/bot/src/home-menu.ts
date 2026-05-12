export type TelegramInlineCallbackButton = {
  text: string
  callback_data: string
}

export const TELEGRAM_HOME_HELP_CALLBACK = 'home:help'
export const TELEGRAM_HOME_MENU_CALLBACK = 'home:menu'
export const TELEGRAM_HOME_MY_BILL_CALLBACK = 'home:my_bill'
export const TELEGRAM_HOME_MY_BILL_FULL_CALLBACK = 'home:my_bill_full'
export const TELEGRAM_HOME_STATUS_CALLBACK = 'home:status'
export const TELEGRAM_HOME_BALANCES_CALLBACK = 'home:balances'
export const TELEGRAM_HOME_SETUP_CALLBACK = 'home:setup'
export const TELEGRAM_HOME_FEEDBACK_CALLBACK = 'home:feedback'

export const TELEGRAM_HOME_CALLBACKS = [
  TELEGRAM_HOME_HELP_CALLBACK,
  TELEGRAM_HOME_MENU_CALLBACK,
  TELEGRAM_HOME_MY_BILL_CALLBACK,
  TELEGRAM_HOME_MY_BILL_FULL_CALLBACK,
  TELEGRAM_HOME_STATUS_CALLBACK,
  TELEGRAM_HOME_BALANCES_CALLBACK,
  TELEGRAM_HOME_SETUP_CALLBACK,
  TELEGRAM_HOME_FEEDBACK_CALLBACK
] as const

export type TelegramHomeCallback = (typeof TELEGRAM_HOME_CALLBACKS)[number]

export function buildTelegramHomeMenuButton(text: string): TelegramInlineCallbackButton {
  return {
    text,
    callback_data: TELEGRAM_HOME_MENU_CALLBACK
  }
}

export function buildTelegramHomeMenuRow(text: string): [TelegramInlineCallbackButton] {
  return [buildTelegramHomeMenuButton(text)]
}

export function buildTelegramHomeMenuReplyMarkup(text: string): {
  reply_markup: {
    inline_keyboard: [TelegramInlineCallbackButton][]
  }
} {
  return {
    reply_markup: {
      inline_keyboard: [buildTelegramHomeMenuRow(text)]
    }
  }
}

import { describe, expect, test } from 'bun:test'

import {
  buildTelegramHomeMenuButton,
  buildTelegramHomeMenuReplyMarkup,
  buildTelegramHomeMenuRow,
  TELEGRAM_HOME_BALANCES_CALLBACK,
  TELEGRAM_HOME_CALLBACKS,
  TELEGRAM_HOME_MENU_CALLBACK,
  TELEGRAM_HOME_MY_BILL_CALLBACK,
  TELEGRAM_HOME_MY_BILL_FULL_CALLBACK,
  TELEGRAM_HOME_STATUS_CALLBACK
} from './home-menu'

describe('telegram home menu helpers', () => {
  test('exports stable home callback constants', () => {
    expect(TELEGRAM_HOME_MENU_CALLBACK).toBe('home:menu')
    expect(TELEGRAM_HOME_MY_BILL_CALLBACK).toBe('home:my_bill')
    expect(TELEGRAM_HOME_MY_BILL_FULL_CALLBACK).toBe('home:my_bill_full')
    expect(TELEGRAM_HOME_STATUS_CALLBACK).toBe('home:status')
    expect(TELEGRAM_HOME_BALANCES_CALLBACK).toBe('home:balances')
    expect(TELEGRAM_HOME_CALLBACKS).toContain('home:menu')
  })

  test('builds pure Home/Menu callback markup', () => {
    expect(buildTelegramHomeMenuButton('Menu')).toEqual({
      text: 'Menu',
      callback_data: 'home:menu'
    })
    expect(buildTelegramHomeMenuRow('Menu')).toEqual([
      {
        text: 'Menu',
        callback_data: 'home:menu'
      }
    ])
    expect(buildTelegramHomeMenuReplyMarkup('Menu')).toEqual({
      reply_markup: {
        inline_keyboard: [
          [
            {
              text: 'Menu',
              callback_data: 'home:menu'
            }
          ]
        ]
      }
    })
  })
})

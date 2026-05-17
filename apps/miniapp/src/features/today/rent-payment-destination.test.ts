import { describe, expect, test } from 'bun:test'

import {
  rentPaymentAccountTail,
  rentPaymentDestinationCopyText,
  rentPaymentDestinationMeta,
  type RentPaymentDestination
} from './rent-payment-destination'

const destination: RentPaymentDestination = {
  label: 'Landlord TBC card',
  recipientName: 'Nana Beridze',
  bankName: 'TBC Bank',
  account: '1234 5678 9012 3456',
  note: 'Message: Kojori House rent',
  link: null
}

describe('rent payment destination helpers', () => {
  test('formats a compact account tail', () => {
    expect(rentPaymentAccountTail(destination.account)).toBe('•• 3456')
    expect(rentPaymentAccountTail('GE29')).toBe('GE29')
  })

  test('formats available recipient and bank metadata', () => {
    expect(rentPaymentDestinationMeta(destination)).toBe('Nana Beridze · TBC Bank')
    expect(
      rentPaymentDestinationMeta({
        ...destination,
        recipientName: null
      })
    ).toBe('TBC Bank')
  })

  test('builds deterministic copy text without empty fields', () => {
    expect(
      rentPaymentDestinationCopyText({
        ...destination,
        link: 'https://bank.example/rent'
      })
    ).toBe(
      [
        'Landlord TBC card',
        'Nana Beridze',
        'TBC Bank',
        '1234 5678 9012 3456',
        'Message: Kojori House rent',
        'https://bank.example/rent'
      ].join('\n')
    )

    expect(
      rentPaymentDestinationCopyText({
        ...destination,
        recipientName: null,
        note: null
      })
    ).toBe(['Landlord TBC card', 'TBC Bank', '1234 5678 9012 3456'].join('\n'))
  })
})

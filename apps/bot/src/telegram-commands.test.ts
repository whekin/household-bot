import { describe, expect, test } from 'bun:test'

import { filterTelegramCommandCatalog, formatAssistantCommandCatalog } from './telegram-commands'

describe('telegram command catalog', () => {
  test('filters private member commands without admin-only entries', () => {
    const commands = filterTelegramCommandCatalog({
      chatType: 'private',
      isMember: true,
      isAdmin: false
    }).map((entry) => entry.command)

    expect(commands).toContain('my_bill_full')
    expect(commands).toContain('app')
    expect(commands).not.toContain('setup')
    expect(commands).not.toContain('bill_json')
  })

  test('filters private admin commands with admin read commands', () => {
    const commands = filterTelegramCommandCatalog({
      chatType: 'private',
      isMember: true,
      isAdmin: true
    }).map((entry) => entry.command)

    expect(commands).toContain('bill_json')
    expect(commands).not.toContain('setup')
  })

  test('filters group member and group admin commands by permission', () => {
    const memberCommands = filterTelegramCommandCatalog({
      chatType: 'group',
      isMember: true,
      isAdmin: false
    }).map((entry) => entry.command)
    const adminCommands = filterTelegramCommandCatalog({
      chatType: 'group',
      isMember: true,
      isAdmin: true
    }).map((entry) => entry.command)

    expect(memberCommands).toContain('payment_add')
    expect(memberCommands).not.toContain('setup')
    expect(adminCommands).toContain('setup')
    expect(adminCommands).toContain('pending_members')
  })

  test('filters non-member commands to public entries only', () => {
    const commands = filterTelegramCommandCatalog({
      chatType: 'private',
      isMember: false,
      isAdmin: false
    }).map((entry) => entry.command)

    expect(commands).toEqual(['help', 'cancel'])
  })

  test('formats only read-only assistant-executable commands for assistant context', () => {
    const entries = filterTelegramCommandCatalog({
      chatType: 'group',
      isMember: true,
      isAdmin: false,
      readOnlyOnly: true,
      assistantExecutableOnly: true
    })
    const text = formatAssistantCommandCatalog('en', entries)

    expect(text).toContain('/my_bill_full')
    expect(text).toContain('/household_status')
    expect(text).not.toContain('/payment_add')
    expect(text).not.toContain('/setup')
  })
})

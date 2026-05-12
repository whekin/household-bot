import { describe, expect, test } from 'bun:test'

import {
  filterTelegramCommandCatalog,
  formatAssistantCommandCatalog,
  formatTelegramHelpText,
  getTelegramCommandScopes,
  TELEGRAM_COMMAND_CATALOG
} from './telegram-commands'

describe('telegram command catalog', () => {
  test('filters private member commands without admin-only entries', () => {
    const commands = filterTelegramCommandCatalog({
      chatType: 'private',
      isMember: true,
      isAdmin: false
    }).map((entry) => entry.command)

    expect(commands).toContain('my_bill_full')
    expect(commands).toContain('home')
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

    expect(commands).toEqual(['help', 'home', 'cancel'])
  })

  test('includes home in default private and group command scopes', () => {
    const scopes = getTelegramCommandScopes('en')

    for (const scope of scopes) {
      expect(scope.commands.map((command) => command.command)).toContain('home')
    }
  })

  test('publishes only Telegram-visible commands in scoped command menus', () => {
    const scopes = getTelegramCommandScopes('en')
    const defaultCommands = scopes
      .find((scope) => scope.scope === 'default')!
      .commands.map((command) => command.command)
    const privateCommands = scopes
      .find((scope) => scope.scope === 'all_private_chats')!
      .commands.map((command) => command.command)
    const groupCommands = scopes
      .find((scope) => scope.scope === 'all_group_chats')!
      .commands.map((command) => command.command)
    const adminCommands = scopes
      .find((scope) => scope.scope === 'all_chat_administrators')!
      .commands.map((command) => command.command)

    expect(defaultCommands).toEqual(['help', 'home'])
    expect(privateCommands).toEqual(['help', 'home', 'anon', 'cancel', 'app', 'keyboard'])
    expect(groupCommands).toEqual(['help', 'home', 'payment_add', 'utilities'])
    expect(adminCommands).toEqual([
      'help',
      'home',
      'payment_add',
      'utilities',
      'setup',
      'unsetup',
      'bind',
      'join_link',
      'pending_members'
    ])

    for (const commands of [defaultCommands, privateCommands, groupCommands, adminCommands]) {
      expect(commands).not.toContain('my_bill')
      expect(commands).not.toContain('household_status')
      expect(commands).not.toContain('balance')
      expect(commands).not.toContain('approve_member')
    }
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

  test('assistant catalog includes hidden read-only fallbacks by explicit allowlist', () => {
    const entries = filterTelegramCommandCatalog({
      chatType: 'private',
      isMember: true,
      isAdmin: false,
      readOnlyOnly: true,
      assistantExecutableOnly: true,
      telegramVisibleOnly: false
    })
    const text = formatAssistantCommandCatalog('en', entries)

    expect(text).toContain('/my_bill')
    expect(text).toContain('/my_bill - Show your personal finance summary')
    expect(text).toContain('/my_bill_full')
    expect(text).toContain('/my_bill_full - Show your detailed personal bill')
    expect(text).toContain('/household_status')
    expect(text).toContain('/balance')
    expect(text).not.toContain('/anon')
    expect(text).not.toContain('/keyboard')
  })

  test('normal help hides fallback commands and respects capabilities', () => {
    const disabledText = formatTelegramHelpText('en', {
      includePrivateCommands: true,
      includeGroupCommands: false,
      includeAdminCommands: false,
      miniAppAvailable: false,
      anonymousFeedbackAvailable: false,
      financeCommandsAvailable: false
    })

    expect(disabledText.split('\n').slice(0, 3).join('\n')).toContain('/home opens the main menu')
    expect(disabledText).toContain('/home - Open the household control center')
    expect(disabledText).toContain('/help - Show task-based guidance')
    expect(disabledText).toContain('Common tasks:')
    expect(disabledText).not.toContain('Check what you owe')
    expect(disabledText).not.toContain('See household status')
    expect(disabledText).not.toContain('Review purchase balances')
    expect(disabledText).not.toContain('Open the dashboard')
    expect(disabledText).not.toContain('/my_bill')
    expect(disabledText).not.toContain('/anon')
    expect(disabledText).not.toContain('/app')

    const enabledText = formatTelegramHelpText('en', {
      includePrivateCommands: true,
      includeGroupCommands: false,
      includeAdminCommands: false,
      miniAppAvailable: true,
      anonymousFeedbackAvailable: true,
      financeCommandsAvailable: true
    })

    expect(enabledText).toContain('/anon - Send anonymous household feedback')
    expect(enabledText).toContain('/app - Open the Kojori mini app')
    expect(enabledText).toContain('Check what you owe')
    expect(enabledText).toContain('Open the dashboard')
    expect(enabledText).not.toContain('/my_bill')
  })

  test('every command has explicit independent visibility metadata', () => {
    expect(TELEGRAM_COMMAND_CATALOG.length).toBeGreaterThan(0)

    for (const entry of TELEGRAM_COMMAND_CATALOG) {
      expect(typeof entry.telegramVisible).toBe('boolean')
      expect(typeof entry.telegramDefaultVisible).toBe('boolean')
      expect(typeof entry.assistantExecutable).toBe('boolean')
      expect(['primary', 'advanced', 'hidden']).toContain(entry.helpVisibility)
    }
  })
})

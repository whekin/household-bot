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

    expect(commands).toEqual(['start', 'home', 'bill', 'app', 'anon', 'cancel', 'help'])
  })

  test('filters private admin commands without group-only setup entries', () => {
    const commands = filterTelegramCommandCatalog({
      chatType: 'private',
      isMember: true,
      isAdmin: true
    }).map((entry) => entry.command)

    expect(commands).toEqual(['start', 'home', 'bill', 'app', 'anon', 'cancel', 'help'])
    expect(commands).not.toContain('setup')
    expect(commands).not.toContain('invite')
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

    expect(memberCommands).toEqual(['home', 'bill', 'help'])
    expect(adminCommands).toEqual(['home', 'bill', 'help', 'setup', 'bind', 'invite'])
  })

  test('filters non-member commands to public entries only', () => {
    const commands = filterTelegramCommandCatalog({
      chatType: 'private',
      isMember: false,
      isAdmin: false
    }).map((entry) => entry.command)

    expect(commands).toEqual(['start', 'home', 'cancel', 'help'])
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

    expect(defaultCommands).toEqual(['home', 'help'])
    expect(privateCommands).toEqual(['home', 'bill', 'app', 'anon', 'cancel', 'help'])
    expect(groupCommands).toEqual(['home', 'bill', 'help'])
    expect(adminCommands).toEqual(['home', 'bill', 'help', 'setup', 'bind', 'invite'])

    for (const commands of [defaultCommands, privateCommands, groupCommands, adminCommands]) {
      expect(commands).not.toContain('start')
    }
  })

  test('publishes command descriptions from the locale catalog', () => {
    const adminScope = getTelegramCommandScopes('ru').find(
      (scope) => scope.scope === 'all_chat_administrators'
    )!

    expect(adminScope.commands).toEqual([
      { command: 'home', description: 'Меню дома' },
      { command: 'bill', description: 'Сколько платить в этом месяце' },
      { command: 'help', description: 'Что умеет бот' },
      { command: 'setup', description: 'Подключить группу' },
      { command: 'bind', description: 'Привязать топик' },
      { command: 'invite', description: 'Пригласить в дом' }
    ])
  })

  test('publishes feature-aware command scopes for reduced runtimes', () => {
    const scopes = getTelegramCommandScopes('en', {
      homeMenuAvailable: false,
      setupCommandsAvailable: false,
      financeCommandsAvailable: false,
      anonymousFeedbackAvailable: false,
      miniAppAvailable: false
    })

    expect(
      scopes.find((scope) => scope.scope === 'default')!.commands.map((command) => command.command)
    ).toEqual(['help'])
    expect(
      scopes
        .find((scope) => scope.scope === 'all_private_chats')!
        .commands.map((command) => command.command)
    ).toEqual(['cancel', 'help'])
    expect(
      scopes
        .find((scope) => scope.scope === 'all_group_chats')!
        .commands.map((command) => command.command)
    ).toEqual(['help'])
    expect(
      scopes
        .find((scope) => scope.scope === 'all_chat_administrators')!
        .commands.map((command) => command.command)
    ).toEqual(['help'])
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

    expect(text.split('\n').map((line) => line.split(' - ')[0])).toEqual([
      '/home',
      '/bill',
      '/help'
    ])
    expect(text).toContain(
      '/bill - What to pay this month (member, read) aliases=bill, what do i owe, my bill'
    )
    expect(text).not.toContain('/setup')
  })

  test('assistant catalog in private chat skips write-only and non-executable commands', () => {
    const entries = filterTelegramCommandCatalog({
      chatType: 'private',
      isMember: true,
      isAdmin: false,
      readOnlyOnly: true,
      assistantExecutableOnly: true,
      telegramVisibleOnly: false
    })
    const text = formatAssistantCommandCatalog('en', entries)

    expect(text.split('\n').map((line) => line.split(' - ')[0])).toEqual([
      '/home',
      '/bill',
      '/app',
      '/help'
    ])
    expect(text).toContain('/app - Open the app (member, read) aliases=open app, mini app')
    expect(text).not.toContain('/anon')
    expect(text).not.toContain('/cancel')
    expect(text).not.toContain('/start')
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

    expect(disabledText.startsWith('🏠 What the bot can do\n')).toBe(true)
    expect(disabledText).toContain('Commands:\n/home — Household menu\n/help — What the bot can do')
    expect(disabledText).not.toContain('🛒 Purchase')
    expect(disabledText).not.toContain('/bill')
    expect(disabledText).not.toContain('/anon')
    expect(disabledText).not.toContain('/app')
    expect(disabledText).not.toContain('/setup')

    const enabledText = formatTelegramHelpText('en', {
      includePrivateCommands: true,
      includeGroupCommands: false,
      includeAdminCommands: false,
      miniAppAvailable: true,
      anonymousFeedbackAvailable: true,
      financeCommandsAvailable: true
    })

    expect(enabledText).toBe(
      [
        '🏠 What the bot can do',
        '',
        '🛒 Purchase — write in the purchases topic what you bought and for how much.',
        '✅ Payment — write in the payments topic, for example "rent paid".',
        '💸 What to pay — /bill',
        '📱 Everything in detail — in the app: /app',
        '',
        'Commands:',
        '/home — Household menu',
        '/bill — What to pay this month',
        '/app — Open the app',
        '/anon — Anonymous message',
        '/help — What the bot can do'
      ].join('\n')
    )
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

  test('catalog only carries the kept commands', () => {
    expect(TELEGRAM_COMMAND_CATALOG.map((entry) => entry.command)).toEqual([
      'start',
      'home',
      'bill',
      'app',
      'anon',
      'cancel',
      'help',
      'setup',
      'bind',
      'invite'
    ])
  })
})

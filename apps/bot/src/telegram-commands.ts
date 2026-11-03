import { getBotTranslations, type BotLocale } from './i18n'
import type { TelegramCommandName } from './i18n/types'

export interface TelegramCommandDefinition {
  command: TelegramCommandName
  description: string
}

export interface ScopedTelegramCommands {
  scope: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators'
  commands: readonly TelegramCommandDefinition[]
}

export type TelegramCommandHelpVisibility = 'primary' | 'advanced' | 'hidden'
export interface TelegramHelpOptions {
  includePrivateCommands?: boolean
  includeGroupCommands?: boolean
  includeAdminCommands?: boolean
  homeMenuAvailable?: boolean
  miniAppAvailable?: boolean
  anonymousFeedbackAvailable?: boolean
  financeCommandsAvailable?: boolean
  setupCommandsAvailable?: boolean
}

export type TelegramCommandPermission = 'public' | 'member' | 'admin'
export type TelegramCommandAvailability = 'private' | 'group'
export type TelegramCommandCapability =
  | 'finance'
  | 'mini_app'
  | 'anonymous_feedback'
  | 'home_menu'
  | 'household_setup'

export interface TelegramCommandCatalogEntry {
  command: TelegramCommandName
  permission: TelegramCommandPermission
  availability: readonly TelegramCommandAvailability[]
  behavior: 'read' | 'write'
  telegramVisible: boolean
  telegramDefaultVisible: boolean
  assistantExecutable: boolean
  helpVisibility: TelegramCommandHelpVisibility
  capability?: TelegramCommandCapability
  aliases: readonly string[]
}

export interface TelegramCommandFilterInput {
  chatType: 'private' | 'group'
  isMember: boolean
  isAdmin: boolean
  readOnlyOnly?: boolean
  assistantExecutableOnly?: boolean
  telegramVisibleOnly?: boolean
  helpVisibility?: TelegramCommandHelpVisibility | readonly TelegramCommandHelpVisibility[]
  enabledCapabilities?: readonly TelegramCommandCapability[]
}

export interface TelegramCommandScopeOptions {
  homeMenuAvailable?: boolean
  miniAppAvailable?: boolean
  anonymousFeedbackAvailable?: boolean
  financeCommandsAvailable?: boolean
  setupCommandsAvailable?: boolean
}

export const TELEGRAM_COMMAND_CATALOG: readonly TelegramCommandCatalogEntry[] = [
  {
    command: 'start',
    permission: 'public',
    availability: ['private'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'hidden',
    capability: 'home_menu',
    aliases: ['start']
  },
  {
    command: 'home',
    permission: 'public',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: true,
    telegramDefaultVisible: true,
    assistantExecutable: true,
    helpVisibility: 'primary',
    capability: 'home_menu',
    aliases: ['home', 'menu', 'меню', 'домой']
  },
  {
    command: 'bill',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'primary',
    capability: 'finance',
    aliases: [
      'bill',
      'what do i owe',
      'my bill',
      'household bill',
      'счёт',
      'счет',
      'мой счёт',
      'сколько платить',
      'сколько я должен'
    ]
  },
  {
    command: 'app',
    permission: 'member',
    availability: ['private'],
    behavior: 'read',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'primary',
    capability: 'mini_app',
    aliases: ['open app', 'mini app', 'приложение']
  },
  {
    command: 'anon',
    permission: 'member',
    availability: ['private'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'primary',
    capability: 'anonymous_feedback',
    aliases: ['anonymous message', 'анонимно']
  },
  {
    command: 'cancel',
    permission: 'public',
    availability: ['private'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'hidden',
    aliases: ['cancel', 'отмена']
  },
  {
    command: 'help',
    permission: 'public',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: true,
    telegramDefaultVisible: true,
    assistantExecutable: true,
    helpVisibility: 'primary',
    aliases: ['help', 'what can you do', 'что умеешь', 'помощь']
  },
  {
    command: 'setup',
    permission: 'admin',
    availability: ['group'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'advanced',
    capability: 'household_setup',
    aliases: ['setup household']
  },
  {
    command: 'bind',
    permission: 'admin',
    availability: ['group'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'advanced',
    capability: 'household_setup',
    aliases: ['bind topic']
  },
  {
    command: 'invite',
    permission: 'admin',
    availability: ['group'],
    behavior: 'read',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'advanced',
    capability: 'household_setup',
    aliases: ['invite', 'join link', 'pending members', 'пригласить']
  }
] as const

const TELEGRAM_DEFAULT_COMMAND_NAMES: readonly TelegramCommandName[] =
  TELEGRAM_COMMAND_CATALOG.filter((entry) => entry.telegramDefaultVisible).map(
    (entry) => entry.command
  )

function commandCapabilitiesFromOptions(
  options: TelegramCommandScopeOptions
): readonly TelegramCommandCapability[] {
  const enabledCapabilities: TelegramCommandCapability[] = []
  if (options.financeCommandsAvailable ?? true) {
    enabledCapabilities.push('finance')
  }
  if (options.miniAppAvailable ?? true) {
    enabledCapabilities.push('mini_app')
  }
  if (options.anonymousFeedbackAvailable ?? true) {
    enabledCapabilities.push('anonymous_feedback')
  }
  if (options.homeMenuAvailable ?? true) {
    enabledCapabilities.push('home_menu')
  }
  if (options.setupCommandsAvailable ?? true) {
    enabledCapabilities.push('household_setup')
  }

  return enabledCapabilities
}

export function filterTelegramCommandCatalog(
  input: TelegramCommandFilterInput
): readonly TelegramCommandCatalogEntry[] {
  const helpVisibility = input.helpVisibility
    ? new Set(Array.isArray(input.helpVisibility) ? input.helpVisibility : [input.helpVisibility])
    : null
  const enabledCapabilities = input.enabledCapabilities ? new Set(input.enabledCapabilities) : null

  return TELEGRAM_COMMAND_CATALOG.filter((entry) => {
    if (!entry.availability.some((availability) => availability === input.chatType)) {
      return false
    }
    if (input.telegramVisibleOnly && !entry.telegramVisible) {
      return false
    }
    if (input.readOnlyOnly && entry.behavior !== 'read') {
      return false
    }
    if (input.assistantExecutableOnly && !entry.assistantExecutable) {
      return false
    }
    if (helpVisibility && !helpVisibility.has(entry.helpVisibility)) {
      return false
    }
    if (entry.capability && enabledCapabilities && !enabledCapabilities.has(entry.capability)) {
      return false
    }
    if (entry.permission === 'member' && !input.isMember) {
      return false
    }
    if (entry.permission === 'admin' && !input.isAdmin) {
      return false
    }

    return true
  })
}

export function formatAssistantCommandCatalog(
  locale: BotLocale,
  entries: readonly TelegramCommandCatalogEntry[]
): string {
  const descriptions = getBotTranslations(locale).commands

  return entries
    .map((entry) => {
      const aliases = entry.aliases.length > 0 ? ` aliases=${entry.aliases.join(', ')}` : ''
      return `/${entry.command} - ${descriptions[entry.command]} (${entry.permission}, ${entry.behavior})${aliases}`
    })
    .join('\n')
}

export function availableAssistantCommandCatalog(input: {
  locale: BotLocale
  chatType: 'private' | 'group'
  isMember: boolean
  isAdmin: boolean
}): string {
  return formatAssistantCommandCatalog(
    input.locale,
    filterTelegramCommandCatalog({
      chatType: input.chatType,
      isMember: input.isMember,
      isAdmin: input.isAdmin,
      readOnlyOnly: true,
      assistantExecutableOnly: true
    })
  )
}

function mapCommands(
  locale: BotLocale,
  names: readonly TelegramCommandName[]
): readonly TelegramCommandDefinition[] {
  const descriptions = getBotTranslations(locale).commands

  return names.map((command) => ({
    command,
    description: descriptions[command]
  }))
}

export function getTelegramCommandScopes(
  locale: BotLocale,
  options: TelegramCommandScopeOptions = {}
): readonly ScopedTelegramCommands[] {
  const enabledCapabilities = commandCapabilitiesFromOptions(options)
  const defaultCommands = TELEGRAM_DEFAULT_COMMAND_NAMES.filter((command) => {
    const entry = TELEGRAM_COMMAND_CATALOG.find((candidate) => candidate.command === command)
    return !entry?.capability || enabledCapabilities.includes(entry.capability)
  })
  const privateCommands = filterTelegramCommandCatalog({
    chatType: 'private',
    isMember: true,
    isAdmin: false,
    telegramVisibleOnly: true,
    enabledCapabilities
  }).map((entry) => entry.command)
  const groupMemberCommands = filterTelegramCommandCatalog({
    chatType: 'group',
    isMember: true,
    isAdmin: false,
    telegramVisibleOnly: true,
    enabledCapabilities
  }).map((entry) => entry.command)
  const groupAdminCommands = filterTelegramCommandCatalog({
    chatType: 'group',
    isMember: true,
    isAdmin: true,
    telegramVisibleOnly: true,
    enabledCapabilities
  }).map((entry) => entry.command)

  return [
    {
      scope: 'default',
      commands: mapCommands(locale, defaultCommands)
    },
    {
      scope: 'all_private_chats',
      commands: mapCommands(locale, privateCommands)
    },
    {
      scope: 'all_group_chats',
      commands: mapCommands(locale, groupMemberCommands)
    },
    {
      scope: 'all_chat_administrators',
      commands: mapCommands(locale, groupAdminCommands)
    }
  ]
}

export function formatTelegramHelpText(
  locale: BotLocale,
  options: TelegramHelpOptions = {}
): string {
  const t = getBotTranslations(locale).help
  const homeMenuAvailable = options.homeMenuAvailable ?? true
  const financeAvailable = options.financeCommandsAvailable ?? true
  const enabledCapabilities = commandCapabilitiesFromOptions({
    homeMenuAvailable,
    miniAppAvailable: options.miniAppAvailable ?? false,
    anonymousFeedbackAvailable: options.anonymousFeedbackAvailable ?? false,
    financeCommandsAvailable: financeAvailable,
    setupCommandsAvailable: options.setupCommandsAvailable ?? homeMenuAvailable
  })
  const chatTypes: ('private' | 'group')[] = [
    ...((options.includePrivateCommands ?? true) ? (['private'] as const) : []),
    ...(options.includeGroupCommands ? (['group'] as const) : [])
  ]
  const commandNames = new Set<TelegramCommandName>()
  for (const chatType of chatTypes) {
    for (const entry of filterTelegramCommandCatalog({
      chatType,
      isMember: true,
      isAdmin: options.includeAdminCommands ?? false,
      helpVisibility: ['primary', 'advanced'],
      enabledCapabilities
    })) {
      commandNames.add(entry.command)
    }
  }
  const commands = mapCommands(locale, [...commandNames])

  return [
    t.intro,
    '',
    ...(financeAvailable ? [t.purchases, t.payments, t.bill] : []),
    ...(options.miniAppAvailable ? [t.app] : []),
    ...(options.includeAdminCommands ? [t.setup] : []),
    ...(commands.length > 0
      ? [
          '',
          t.commandsHeading,
          ...commands.map((command) => `/${command.command} — ${command.description}`)
        ]
      : [])
  ].join('\n')
}

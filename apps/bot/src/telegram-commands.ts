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
  miniAppAvailable?: boolean
  anonymousFeedbackAvailable?: boolean
  financeCommandsAvailable?: boolean
}

export type TelegramCommandPermission = 'public' | 'member' | 'admin'
export type TelegramCommandAvailability = 'private' | 'group'
export type TelegramCommandCapability = 'finance' | 'mini_app' | 'anonymous_feedback'

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

export const TELEGRAM_COMMAND_CATALOG: readonly TelegramCommandCatalogEntry[] = [
  {
    command: 'help',
    permission: 'public',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: true,
    telegramDefaultVisible: true,
    assistantExecutable: true,
    helpVisibility: 'primary',
    aliases: ['help', 'commands', 'what can you do', 'что умеешь', 'команды']
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
    aliases: ['home', 'control center', 'dashboard', 'домой', 'центр управления']
  },
  {
    command: 'bill',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'hidden',
    capability: 'finance',
    aliases: ['household bill', 'everyone bill', 'общий счет', 'общий счёт']
  },
  {
    command: 'bill_full',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'hidden',
    capability: 'finance',
    aliases: ['full household bill', 'all purchase impact', 'полный счет', 'полный счёт']
  },
  {
    command: 'my_bill',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'hidden',
    capability: 'finance',
    aliases: ['my bill', 'what do i owe', 'мой счет', 'мой счёт', 'сколько я должен']
  },
  {
    command: 'my_bill_full',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'hidden',
    capability: 'finance',
    aliases: [
      'my full bill',
      'my purchase impact',
      'why do i owe zero',
      'мой полный счет',
      'мой полный счёт',
      'почему я ничего не должен'
    ]
  },
  {
    command: 'household_status',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'hidden',
    capability: 'finance',
    aliases: ['household status', 'current status', 'статус дома']
  },
  {
    command: 'balance',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'hidden',
    capability: 'finance',
    aliases: ['balances', 'purchases', 'покупки', 'балансы']
  },
  {
    command: 'bill_json',
    permission: 'admin',
    availability: ['private', 'group'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'hidden',
    capability: 'finance',
    aliases: ['billing json', 'audit json']
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
    aliases: ['anonymous feedback']
  },
  {
    command: 'cancel',
    permission: 'public',
    availability: ['private'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'primary',
    aliases: ['cancel']
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
    aliases: ['open app', 'mini app', 'dashboard app']
  },
  {
    command: 'dashboard',
    permission: 'member',
    availability: ['private'],
    behavior: 'read',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: true,
    helpVisibility: 'hidden',
    capability: 'mini_app',
    aliases: ['dashboard']
  },
  {
    command: 'payment_add',
    permission: 'member',
    availability: ['group'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'primary',
    capability: 'finance',
    aliases: ['record payment']
  },
  {
    command: 'utilities',
    permission: 'member',
    availability: ['group'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'primary',
    capability: 'finance',
    aliases: ['utilities template']
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
    aliases: ['setup household']
  },
  {
    command: 'unsetup',
    permission: 'admin',
    availability: ['group'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'advanced',
    aliases: ['unsetup household']
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
    aliases: ['bind topic']
  },
  {
    command: 'join_link',
    permission: 'admin',
    availability: ['group'],
    behavior: 'read',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'advanced',
    aliases: ['join link']
  },
  {
    command: 'pending_members',
    permission: 'admin',
    availability: ['group'],
    behavior: 'read',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'advanced',
    aliases: ['pending members']
  },
  {
    command: 'approve_member',
    permission: 'admin',
    availability: ['group'],
    behavior: 'write',
    telegramVisible: false,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'hidden',
    aliases: ['approve member']
  },
  {
    command: 'keyboard',
    permission: 'member',
    availability: ['private'],
    behavior: 'write',
    telegramVisible: true,
    telegramDefaultVisible: false,
    assistantExecutable: false,
    helpVisibility: 'primary',
    capability: 'mini_app',
    aliases: ['keyboard']
  }
] as const

const TELEGRAM_DEFAULT_COMMAND_NAMES: readonly TelegramCommandName[] =
  TELEGRAM_COMMAND_CATALOG.filter((entry) => entry.telegramDefaultVisible).map(
    (entry) => entry.command
  )

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

export function getTelegramCommandScopes(locale: BotLocale): readonly ScopedTelegramCommands[] {
  const privateCommands = filterTelegramCommandCatalog({
    chatType: 'private',
    isMember: true,
    isAdmin: false,
    telegramVisibleOnly: true,
    enabledCapabilities: ['anonymous_feedback', 'mini_app']
  }).map((entry) => entry.command)
  const groupMemberCommands = filterTelegramCommandCatalog({
    chatType: 'group',
    isMember: true,
    isAdmin: false,
    telegramVisibleOnly: true,
    enabledCapabilities: ['finance']
  }).map((entry) => entry.command)
  const groupAdminCommands = filterTelegramCommandCatalog({
    chatType: 'group',
    isMember: true,
    isAdmin: true,
    telegramVisibleOnly: true,
    enabledCapabilities: ['finance']
  }).map((entry) => entry.command)

  return [
    {
      scope: 'default',
      commands: mapCommands(locale, TELEGRAM_DEFAULT_COMMAND_NAMES)
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
  const t = getBotTranslations(locale)
  const includePrivateCommands = options.includePrivateCommands ?? true
  const includeGroupCommands = options.includeGroupCommands ?? false
  const includeAdminCommands = options.includeAdminCommands ?? false
  const enabledCapabilities: TelegramCommandCapability[] = []
  if (options.financeCommandsAvailable ?? true) {
    enabledCapabilities.push('finance')
  }
  if (options.miniAppAvailable) {
    enabledCapabilities.push('mini_app')
  }
  if (options.anonymousFeedbackAvailable) {
    enabledCapabilities.push('anonymous_feedback')
  }
  const groupMemberCommandNames = filterTelegramCommandCatalog({
    chatType: 'group',
    isMember: true,
    isAdmin: false,
    helpVisibility: 'primary',
    enabledCapabilities
  }).map((entry) => entry.command)
  const groupMemberCommandsSet = new Set<TelegramCommandName>(groupMemberCommandNames)
  const privateCommands = includePrivateCommands
    ? mapCommands(
        locale,
        filterTelegramCommandCatalog({
          chatType: 'private',
          isMember: true,
          isAdmin: includeAdminCommands,
          helpVisibility: 'primary',
          enabledCapabilities
        }).map((entry) => entry.command)
      )
    : []
  const groupCommands = includeGroupCommands ? mapCommands(locale, groupMemberCommandNames) : []
  const adminCommands = includeAdminCommands
    ? mapCommands(
        locale,
        filterTelegramCommandCatalog({
          chatType: 'group',
          isMember: true,
          isAdmin: true,
          helpVisibility: ['primary', 'advanced'],
          enabledCapabilities
        }).map((entry) => entry.command)
      ).filter(
        (command) =>
          !TELEGRAM_DEFAULT_COMMAND_NAMES.includes(command.command) &&
          !groupMemberCommandsSet.has(command.command)
      )
    : []

  const sections = [t.help.intro]

  sections.push(t.help.tasksHeading)

  if (options.financeCommandsAvailable ?? true) {
    sections.push(t.help.checkMyBill, t.help.checkHouseholdStatus, t.help.checkBalances)
  }

  if (options.miniAppAvailable) {
    sections.push(t.help.openDashboard)
  }

  if (includeAdminCommands) {
    sections.push(t.help.setupHousehold, t.help.manageMembers)
  }

  sections.push('', t.help.advancedHeading)

  if (privateCommands.length > 0) {
    sections.push(
      t.help.privateChatHeading,
      ...privateCommands.map((command) => `/${command.command} - ${command.description}`)
    )
  }

  if (groupCommands.length > 0) {
    sections.push(
      t.help.groupHeading,
      ...groupCommands.map((command) => `/${command.command} - ${command.description}`)
    )
  }

  if (adminCommands.length > 0) {
    sections.push(
      t.help.groupAdminsHeading,
      ...adminCommands.map((command) => `/${command.command} - ${command.description}`)
    )
  }

  return sections.join('\n')
}

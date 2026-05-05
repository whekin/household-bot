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

export interface TelegramHelpOptions {
  includePrivateCommands?: boolean
  includeGroupCommands?: boolean
  includeAdminCommands?: boolean
}

export type TelegramCommandPermission = 'public' | 'member' | 'admin'
export type TelegramCommandAvailability = 'private' | 'group'

export interface TelegramCommandCatalogEntry {
  command: TelegramCommandName
  permission: TelegramCommandPermission
  availability: readonly TelegramCommandAvailability[]
  behavior: 'read' | 'write'
  defaultCommand: boolean
  assistantExecutable: boolean
  aliases: readonly string[]
}

export interface TelegramCommandFilterInput {
  chatType: 'private' | 'group'
  isMember: boolean
  isAdmin: boolean
  readOnlyOnly?: boolean
  assistantExecutableOnly?: boolean
}

export const TELEGRAM_COMMAND_CATALOG = [
  {
    command: 'help',
    permission: 'public',
    availability: ['private', 'group'],
    behavior: 'read',
    defaultCommand: true,
    assistantExecutable: true,
    aliases: ['help', 'commands', 'what can you do', 'что умеешь', 'команды']
  },
  {
    command: 'bill',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    defaultCommand: true,
    assistantExecutable: true,
    aliases: ['household bill', 'everyone bill', 'общий счет', 'общий счёт']
  },
  {
    command: 'bill_full',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    defaultCommand: true,
    assistantExecutable: true,
    aliases: ['full household bill', 'all purchase impact', 'полный счет', 'полный счёт']
  },
  {
    command: 'my_bill',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    defaultCommand: true,
    assistantExecutable: true,
    aliases: ['my bill', 'what do i owe', 'мой счет', 'мой счёт', 'сколько я должен']
  },
  {
    command: 'my_bill_full',
    permission: 'member',
    availability: ['private', 'group'],
    behavior: 'read',
    defaultCommand: true,
    assistantExecutable: true,
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
    defaultCommand: true,
    assistantExecutable: true,
    aliases: ['household status', 'current status', 'статус дома']
  },
  {
    command: 'bill_json',
    permission: 'admin',
    availability: ['private', 'group'],
    behavior: 'read',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['billing json', 'audit json']
  },
  {
    command: 'anon',
    permission: 'member',
    availability: ['private'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['anonymous feedback']
  },
  {
    command: 'cancel',
    permission: 'public',
    availability: ['private'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['cancel']
  },
  {
    command: 'app',
    permission: 'member',
    availability: ['private'],
    behavior: 'read',
    defaultCommand: false,
    assistantExecutable: true,
    aliases: ['open app', 'mini app', 'dashboard app']
  },
  {
    command: 'dashboard',
    permission: 'member',
    availability: ['private'],
    behavior: 'read',
    defaultCommand: false,
    assistantExecutable: true,
    aliases: ['dashboard']
  },
  {
    command: 'payment_add',
    permission: 'member',
    availability: ['group'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['record payment']
  },
  {
    command: 'utilities',
    permission: 'member',
    availability: ['group'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['utilities template']
  },
  {
    command: 'setup',
    permission: 'admin',
    availability: ['group'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['setup household']
  },
  {
    command: 'unsetup',
    permission: 'admin',
    availability: ['group'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['unsetup household']
  },
  {
    command: 'bind',
    permission: 'admin',
    availability: ['group'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['bind topic']
  },
  {
    command: 'join_link',
    permission: 'admin',
    availability: ['group'],
    behavior: 'read',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['join link']
  },
  {
    command: 'pending_members',
    permission: 'admin',
    availability: ['group'],
    behavior: 'read',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['pending members']
  },
  {
    command: 'approve_member',
    permission: 'admin',
    availability: ['group'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['approve member']
  },
  {
    command: 'keyboard',
    permission: 'member',
    availability: ['private'],
    behavior: 'write',
    defaultCommand: false,
    assistantExecutable: false,
    aliases: ['keyboard']
  }
] as const satisfies readonly TelegramCommandCatalogEntry[]

const DEFAULT_COMMAND_NAMES = TELEGRAM_COMMAND_CATALOG.filter((entry) => entry.defaultCommand).map(
  (entry) => entry.command
)

export function filterTelegramCommandCatalog(
  input: TelegramCommandFilterInput
): readonly TelegramCommandCatalogEntry[] {
  return TELEGRAM_COMMAND_CATALOG.filter((entry) => {
    if (!entry.availability.some((availability) => availability === input.chatType)) {
      return false
    }
    if (input.readOnlyOnly && entry.behavior !== 'read') {
      return false
    }
    if (input.assistantExecutableOnly && !entry.assistantExecutable) {
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
    isAdmin: false
  }).map((entry) => entry.command)
  const groupMemberCommands = filterTelegramCommandCatalog({
    chatType: 'group',
    isMember: true,
    isAdmin: false
  }).map((entry) => entry.command)
  const groupAdminCommands = filterTelegramCommandCatalog({
    chatType: 'group',
    isMember: true,
    isAdmin: true
  }).map((entry) => entry.command)

  return [
    {
      scope: 'default',
      commands: mapCommands(locale, DEFAULT_COMMAND_NAMES)
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
  const defaultCommands = new Set<TelegramCommandName>(DEFAULT_COMMAND_NAMES)
  const includePrivateCommands = options.includePrivateCommands ?? true
  const includeGroupCommands = options.includeGroupCommands ?? false
  const includeAdminCommands = options.includeAdminCommands ?? false
  const groupMemberCommandNames = filterTelegramCommandCatalog({
    chatType: 'group',
    isMember: true,
    isAdmin: false
  }).map((entry) => entry.command)
  const groupMemberCommandsSet = new Set<TelegramCommandName>(groupMemberCommandNames)
  const privateCommands = includePrivateCommands
    ? mapCommands(
        locale,
        filterTelegramCommandCatalog({
          chatType: 'private',
          isMember: true,
          isAdmin: includeAdminCommands
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
          isAdmin: true
        }).map((entry) => entry.command)
      ).filter(
        (command) =>
          !defaultCommands.has(command.command) && !groupMemberCommandsSet.has(command.command)
      )
    : []

  const sections = [t.help.intro]

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

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

const DEFAULT_COMMAND_NAMES = [
  'help',
  'bill',
  'household_status'
] as const satisfies readonly TelegramCommandName[]
const PRIVATE_CHAT_COMMAND_NAMES = [
  ...DEFAULT_COMMAND_NAMES,
  'bill_json',
  'anon',
  'cancel',
  'app',
  'dashboard'
] as const satisfies readonly TelegramCommandName[]
const GROUP_CHAT_COMMAND_NAMES = DEFAULT_COMMAND_NAMES
const GROUP_MEMBER_COMMAND_NAMES = [
  ...GROUP_CHAT_COMMAND_NAMES,
  'payment_add',
  'utilities'
] as const satisfies readonly TelegramCommandName[]
const GROUP_ADMIN_COMMAND_NAMES = [
  ...GROUP_MEMBER_COMMAND_NAMES,
  'bill_json',
  'setup',
  'unsetup',
  'bind',
  'join_link',
  'pending_members',
  'approve_member'
] as const satisfies readonly TelegramCommandName[]

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
  return [
    {
      scope: 'default',
      commands: mapCommands(locale, DEFAULT_COMMAND_NAMES)
    },
    {
      scope: 'all_private_chats',
      commands: mapCommands(locale, PRIVATE_CHAT_COMMAND_NAMES)
    },
    {
      scope: 'all_group_chats',
      commands: mapCommands(locale, GROUP_MEMBER_COMMAND_NAMES)
    },
    {
      scope: 'all_chat_administrators',
      commands: mapCommands(locale, GROUP_ADMIN_COMMAND_NAMES)
    }
  ]
}

export function formatTelegramHelpText(
  locale: BotLocale,
  options: TelegramHelpOptions = {}
): string {
  const t = getBotTranslations(locale)
  const defaultCommands = new Set<TelegramCommandName>(DEFAULT_COMMAND_NAMES)
  const groupMemberCommands = new Set<TelegramCommandName>(GROUP_MEMBER_COMMAND_NAMES)
  const includePrivateCommands = options.includePrivateCommands ?? true
  const includeGroupCommands = options.includeGroupCommands ?? false
  const includeAdminCommands = options.includeAdminCommands ?? false
  const privateCommands = includePrivateCommands
    ? mapCommands(locale, PRIVATE_CHAT_COMMAND_NAMES)
    : []
  const groupCommands = includeGroupCommands ? mapCommands(locale, GROUP_MEMBER_COMMAND_NAMES) : []
  const adminCommands = includeAdminCommands
    ? mapCommands(locale, GROUP_ADMIN_COMMAND_NAMES).filter(
        (command) =>
          !defaultCommands.has(command.command) && !groupMemberCommands.has(command.command)
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

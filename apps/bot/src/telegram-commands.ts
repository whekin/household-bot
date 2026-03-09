export interface TelegramCommandDefinition {
  command: string
  description: string
}

export interface ScopedTelegramCommands {
  scope: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators'
  commands: readonly TelegramCommandDefinition[]
}

const DEFAULT_COMMANDS = [
  {
    command: 'help',
    description: 'Show command list'
  },
  {
    command: 'household_status',
    description: 'Show current household status'
  }
] as const satisfies readonly TelegramCommandDefinition[]

const PRIVATE_CHAT_COMMANDS = [
  ...DEFAULT_COMMANDS,
  {
    command: 'anon',
    description: 'Send anonymous household feedback'
  },
  {
    command: 'cancel',
    description: 'Cancel the current prompt'
  }
] as const satisfies readonly TelegramCommandDefinition[]

const GROUP_CHAT_COMMANDS = DEFAULT_COMMANDS

const GROUP_ADMIN_COMMANDS = [
  ...GROUP_CHAT_COMMANDS,
  {
    command: 'setup',
    description: 'Register this group as a household'
  },
  {
    command: 'bind_purchase_topic',
    description: 'Bind the current topic as purchases'
  },
  {
    command: 'bind_feedback_topic',
    description: 'Bind the current topic as feedback'
  },
  {
    command: 'pending_members',
    description: 'List pending household join requests'
  },
  {
    command: 'approve_member',
    description: 'Approve a pending household member'
  }
] as const satisfies readonly TelegramCommandDefinition[]

export const TELEGRAM_COMMAND_SCOPES = [
  {
    scope: 'default',
    commands: DEFAULT_COMMANDS
  },
  {
    scope: 'all_private_chats',
    commands: PRIVATE_CHAT_COMMANDS
  },
  {
    scope: 'all_group_chats',
    commands: GROUP_CHAT_COMMANDS
  },
  {
    scope: 'all_chat_administrators',
    commands: GROUP_ADMIN_COMMANDS
  }
] as const satisfies readonly ScopedTelegramCommands[]

export function formatTelegramHelpText(): string {
  return [
    'Household bot scaffold is live.',
    'Private chat:',
    ...PRIVATE_CHAT_COMMANDS.map((command) => `/${command.command} - ${command.description}`),
    'Group admins:',
    ...GROUP_ADMIN_COMMANDS.filter(
      (command) => !DEFAULT_COMMANDS.some((baseCommand) => baseCommand.command === command.command)
    ).map((command) => `/${command.command} - ${command.description}`)
  ].join('\n')
}

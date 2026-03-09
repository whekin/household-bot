import {
  getTelegramCommandScopes,
  type ScopedTelegramCommands
} from '../../apps/bot/src/telegram-commands'
import type { BotLocale } from '../../apps/bot/src/i18n'

type CommandsCommand = 'info' | 'set' | 'delete'

type CommandLanguageTarget = 'default' | BotLocale

interface TelegramScopePayload {
  type: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators'
}

interface CommandLanguageConfig {
  target: CommandLanguageTarget
  locale: BotLocale
}

const COMMAND_LANGUAGES: readonly CommandLanguageConfig[] = [
  {
    target: 'default',
    locale: 'en'
  },
  {
    target: 'en',
    locale: 'en'
  },
  {
    target: 'ru',
    locale: 'ru'
  }
]

function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} is required`)
  }

  return value
}

function parseCommand(raw: string | undefined): CommandsCommand {
  const command = raw?.trim() || 'info'
  if (command === 'info' || command === 'set' || command === 'delete') {
    return command
  }

  throw new Error(`Unsupported command: ${command}`)
}

async function telegramRequest<T>(
  botToken: string,
  method: string,
  body?: URLSearchParams
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: body ? 'POST' : 'GET',
    body
  })

  const payload = (await response.json()) as {
    ok?: boolean
    result?: unknown
  }

  if (!response.ok || payload.ok !== true) {
    throw new Error(`Telegram ${method} failed: ${JSON.stringify(payload)}`)
  }

  return payload.result as T
}

function appendScope(params: URLSearchParams, scope: TelegramScopePayload): void {
  params.set('scope', JSON.stringify(scope))
}

function appendLanguageCode(params: URLSearchParams, target: CommandLanguageTarget): void {
  if (target !== 'default') {
    params.set('language_code', target)
  }
}

async function setCommandsForLanguage(
  botToken: string,
  language: CommandLanguageConfig
): Promise<readonly ScopedTelegramCommands[]> {
  const scopes = getTelegramCommandScopes(language.locale)

  for (const scopeConfig of scopes) {
    const params = new URLSearchParams({
      commands: JSON.stringify(scopeConfig.commands)
    })

    appendScope(params, {
      type: scopeConfig.scope
    })
    appendLanguageCode(params, language.target)

    await telegramRequest(botToken, 'setMyCommands', params)
  }

  return scopes
}

async function setCommands(botToken: string): Promise<void> {
  const results = []

  for (const language of COMMAND_LANGUAGES) {
    const scopes = await setCommandsForLanguage(botToken, language)
    results.push({
      language: language.target,
      locale: language.locale,
      scopes: scopes.map((scope) => ({
        scope: scope.scope,
        commandCount: scope.commands.length
      }))
    })
  }

  console.log(JSON.stringify({ ok: true, results }, null, 2))
}

async function deleteCommands(botToken: string): Promise<void> {
  const deletedScopes = []

  for (const language of COMMAND_LANGUAGES) {
    for (const scopeConfig of getTelegramCommandScopes(language.locale)) {
      const params = new URLSearchParams()
      appendScope(params, {
        type: scopeConfig.scope
      })
      appendLanguageCode(params, language.target)

      await telegramRequest(botToken, 'deleteMyCommands', params)
    }

    deletedScopes.push({
      language: language.target,
      scopes: getTelegramCommandScopes(language.locale).map((scope) => scope.scope)
    })
  }

  console.log(JSON.stringify({ ok: true, deletedScopes }, null, 2))
}

async function getCommands(botToken: string): Promise<void> {
  const result: Array<{
    language: CommandLanguageTarget
    locale: BotLocale
    scopes: Array<{
      scope: string
      commands: unknown
    }>
  }> = []

  for (const language of COMMAND_LANGUAGES) {
    const scopes = []

    for (const scopeConfig of getTelegramCommandScopes(language.locale)) {
      const params = new URLSearchParams()
      appendScope(params, {
        type: scopeConfig.scope
      })
      appendLanguageCode(params, language.target)

      const commands = await telegramRequest(botToken, 'getMyCommands', params)
      scopes.push({
        scope: scopeConfig.scope,
        commands
      })
    }

    result.push({
      language: language.target,
      locale: language.locale,
      scopes
    })
  }

  console.log(JSON.stringify(result, null, 2))
}

async function run(): Promise<void> {
  const command = parseCommand(process.argv[2])
  const botToken = requireEnv('TELEGRAM_BOT_TOKEN')

  switch (command) {
    case 'set':
      await setCommands(botToken)
      return
    case 'delete':
      await deleteCommands(botToken)
      return
    case 'info':
      await getCommands(botToken)
      return
    default:
      throw new Error(`Unsupported command: ${command}`)
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

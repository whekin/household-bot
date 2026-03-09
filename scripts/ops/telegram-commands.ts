import { TELEGRAM_COMMAND_SCOPES } from '../../apps/bot/src/telegram-commands'

type CommandsCommand = 'info' | 'set' | 'delete'

interface TelegramScopePayload {
  type: 'default' | 'all_private_chats' | 'all_group_chats' | 'all_chat_administrators'
}

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

async function setCommands(botToken: string): Promise<void> {
  const languageCode = process.env.TELEGRAM_COMMANDS_LANGUAGE_CODE?.trim()

  for (const scopeConfig of TELEGRAM_COMMAND_SCOPES) {
    const params = new URLSearchParams({
      commands: JSON.stringify(scopeConfig.commands)
    })

    appendScope(params, {
      type: scopeConfig.scope
    })

    if (languageCode) {
      params.set('language_code', languageCode)
    }

    await telegramRequest(botToken, 'setMyCommands', params)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        scopes: TELEGRAM_COMMAND_SCOPES.map((scope) => ({
          scope: scope.scope,
          commandCount: scope.commands.length
        }))
      },
      null,
      2
    )
  )
}

async function deleteCommands(botToken: string): Promise<void> {
  const languageCode = process.env.TELEGRAM_COMMANDS_LANGUAGE_CODE?.trim()

  for (const scopeConfig of TELEGRAM_COMMAND_SCOPES) {
    const params = new URLSearchParams()
    appendScope(params, {
      type: scopeConfig.scope
    })

    if (languageCode) {
      params.set('language_code', languageCode)
    }

    await telegramRequest(botToken, 'deleteMyCommands', params)
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        deletedScopes: TELEGRAM_COMMAND_SCOPES.map((scope) => scope.scope)
      },
      null,
      2
    )
  )
}

async function getCommands(botToken: string): Promise<void> {
  const languageCode = process.env.TELEGRAM_COMMANDS_LANGUAGE_CODE?.trim()
  const result: Array<{
    scope: string
    commands: unknown
  }> = []

  for (const scopeConfig of TELEGRAM_COMMAND_SCOPES) {
    const params = new URLSearchParams()
    appendScope(params, {
      type: scopeConfig.scope
    })

    if (languageCode) {
      params.set('language_code', languageCode)
    }

    const commands = await telegramRequest(botToken, 'getMyCommands', params)
    result.push({
      scope: scopeConfig.scope,
      commands
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

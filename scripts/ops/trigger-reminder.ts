type ReminderType = 'utilities' | 'rent-warning' | 'rent-due'

function parseReminderType(raw: string | undefined): ReminderType {
  const value = raw?.trim()

  if (value === 'utilities' || value === 'rent-warning' || value === 'rent-due') {
    return value
  }

  throw new Error(
    'Usage: bun run ops:reminder <utilities|rent-warning|rent-due> [period] [--dry-run]'
  )
}

function parseArgs(argv: readonly string[]) {
  const reminderType = parseReminderType(argv[2])
  const rawPeriod = argv[3]?.trim()
  const dryRun = argv.includes('--dry-run')

  return {
    reminderType,
    period: rawPeriod && rawPeriod.length > 0 ? rawPeriod : undefined,
    dryRun
  }
}

function readText(command: string[], name: string): string {
  const result = Bun.spawnSync(command, {
    stdout: 'pipe',
    stderr: 'pipe'
  })

  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim()
    throw new Error(`${name} failed: ${stderr || `exit code ${result.exitCode}`}`)
  }

  const value = result.stdout.toString().trim()
  if (!value) {
    throw new Error(`${name} returned an empty value`)
  }

  return value
}

function resolveBotApiUrl(): string {
  const envValue = process.env.BOT_API_URL?.trim()
  if (envValue) {
    return envValue
  }

  return readText(
    ['terraform', '-chdir=infra/terraform', 'output', '-raw', 'bot_api_service_url'],
    'terraform output bot_api_service_url'
  )
}

function resolveSchedulerSecret(): string {
  const envValue = process.env.SCHEDULER_SHARED_SECRET?.trim()
  if (envValue) {
    return envValue
  }

  const projectId = process.env.GCP_PROJECT_ID?.trim() || 'gen-lang-client-0200379851'
  return readText(
    [
      'gcloud',
      'secrets',
      'versions',
      'access',
      'latest',
      '--secret=scheduler-shared-secret',
      '--project',
      projectId
    ],
    'gcloud secrets versions access'
  )
}

async function run() {
  const { reminderType, period, dryRun } = parseArgs(process.argv)
  const botApiUrl = resolveBotApiUrl().replace(/\/$/, '')
  const schedulerSecret = resolveSchedulerSecret()

  const response = await fetch(`${botApiUrl}/jobs/reminder/${reminderType}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-household-scheduler-secret': schedulerSecret
    },
    body: JSON.stringify({
      ...(period ? { period } : {}),
      ...(dryRun ? { dryRun: true } : {})
    })
  })

  const text = await response.text()
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${text}`)
  }

  console.log(text)
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})

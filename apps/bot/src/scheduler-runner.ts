function requireEnv(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`${name} environment variable is required`)
  }
  return value
}

function parsePositiveInteger(name: string, fallback: number): number {
  const raw = process.env[name]?.trim()
  if (!raw) {
    return fallback
  }

  const parsed = Number(raw)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${name} value: ${raw}`)
  }

  return parsed
}

async function runOnce(input: {
  baseUrl: string
  schedulerSecret: string
  dueScanLimit: number
}) {
  const response = await fetch(`${input.baseUrl}/jobs/dispatch-due?limit=${input.dueScanLimit}`, {
    method: 'POST',
    headers: {
      'x-household-scheduler-secret': input.schedulerSecret
    }
  })

  if (!response.ok) {
    throw new Error(`Scheduler scan failed with status ${response.status}`)
  }

  const payload = (await response.json()) as {
    ok?: boolean
    scanned?: number
    error?: string
  }

  if (payload.ok !== true) {
    throw new Error(payload.error ?? 'Scheduler scan failed')
  }

  console.log(JSON.stringify({ event: 'scheduler.tick', scanned: payload.scanned ?? 0 }))
}

async function main() {
  const intervalMs = parsePositiveInteger('SCHEDULER_POLL_INTERVAL_MS', 60_000)
  const runConfig = {
    baseUrl: requireEnv('BOT_INTERNAL_BASE_URL').replace(/\/$/, ''),
    schedulerSecret: requireEnv('SCHEDULER_SHARED_SECRET'),
    dueScanLimit: parsePositiveInteger('SCHEDULER_DUE_SCAN_LIMIT', 25)
  }
  let stopping = false

  const stop = () => {
    stopping = true
  }

  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  while (!stopping) {
    try {
      await runOnce(runConfig)
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'scheduler.tick_failed',
          error: error instanceof Error ? error.message : String(error)
        })
      )
    }

    if (stopping) {
      break
    }

    await Bun.sleep(intervalMs)
  }
}

await main()

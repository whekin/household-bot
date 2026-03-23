import { getLogger } from '@household/observability'

import { createBotRuntimeApp } from './app'

if (import.meta.main) {
  const app = await createBotRuntimeApp()
  const logger = getLogger('runtime')

  Bun.serve({
    port: app.runtime.port,
    fetch: app.fetch
  })

  logger.info(
    {
      event: 'runtime.started',
      mode: 'bun',
      port: app.runtime.port,
      webhookPath: app.runtime.telegramWebhookPath
    },
    'Bot webhook server started'
  )

  process.on('SIGTERM', () => {
    logger.info(
      {
        event: 'runtime.shutdown',
        signal: 'SIGTERM'
      },
      'Bot shutdown requested'
    )

    void app.shutdown()
  })
}

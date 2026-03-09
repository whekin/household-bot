import type { ReminderJobService } from '@household/application'
import { BillingPeriod, nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import { REMINDER_TYPES, type ReminderTarget, type ReminderType } from '@household/ports'

import { getBotTranslations } from './i18n'

interface ReminderJobRequestBody {
  period?: string
  jobId?: string
  dryRun?: boolean
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8'
    }
  })
}

function parseReminderType(raw: string): ReminderType | null {
  if ((REMINDER_TYPES as readonly string[]).includes(raw)) {
    return raw as ReminderType
  }

  return null
}

function currentPeriod(): string {
  return BillingPeriod.fromInstant(nowInstant()).toString()
}

async function readBody(request: Request): Promise<ReminderJobRequestBody> {
  const text = await request.text()

  if (text.trim().length === 0) {
    return {}
  }

  try {
    return JSON.parse(text) as ReminderJobRequestBody
  } catch {
    throw new Error('Invalid JSON body')
  }
}

export function createReminderJobsHandler(options: {
  listReminderTargets: () => Promise<readonly ReminderTarget[]>
  releaseReminderDispatch: (input: {
    householdId: string
    period: string
    reminderType: ReminderType
  }) => Promise<void>
  sendReminderMessage: (target: ReminderTarget, text: string) => Promise<void>
  reminderService: ReminderJobService
  forceDryRun?: boolean
  logger?: Logger
}): {
  handle: (request: Request, rawReminderType: string) => Promise<Response>
} {
  function messageText(target: ReminderTarget, reminderType: ReminderType, period: string): string {
    const t = getBotTranslations(target.locale).reminders

    switch (reminderType) {
      case 'utilities':
        return t.utilities(period)
      case 'rent-warning':
        return t.rentWarning(period)
      case 'rent-due':
        return t.rentDue(period)
    }
  }

  return {
    handle: async (request, rawReminderType) => {
      const reminderType = parseReminderType(rawReminderType)
      if (!reminderType) {
        return json({ ok: false, error: 'Invalid reminder type' }, 400)
      }

      try {
        const body = await readBody(request)
        const schedulerJobName = request.headers.get('x-cloudscheduler-jobname')
        const period = BillingPeriod.fromString(body.period ?? currentPeriod()).toString()
        const dryRun = options.forceDryRun === true || body.dryRun === true
        const targets = await options.listReminderTargets()
        const dispatches: Array<{
          householdId: string
          householdName: string
          telegramChatId: string
          telegramThreadId: string | null
          dedupeKey: string
          outcome: 'dry-run' | 'claimed' | 'duplicate' | 'failed'
          messageText: string
          error?: string
        }> = []

        for (const target of targets) {
          const result = await options.reminderService.handleJob({
            householdId: target.householdId,
            period,
            reminderType,
            dryRun
          })
          const text = messageText(target, reminderType, period)

          let outcome: 'dry-run' | 'claimed' | 'duplicate' | 'failed' = result.status
          let error: string | undefined

          if (result.status === 'claimed') {
            try {
              await options.sendReminderMessage(target, text)
            } catch (dispatchError) {
              await options.releaseReminderDispatch({
                householdId: target.householdId,
                period,
                reminderType
              })

              outcome = 'failed'
              error =
                dispatchError instanceof Error
                  ? dispatchError.message
                  : 'Unknown reminder delivery error'
            }
          }

          options.logger?.info(
            {
              event: 'scheduler.reminder.dispatch',
              reminderType,
              period,
              jobId: body.jobId ?? schedulerJobName ?? null,
              householdId: target.householdId,
              householdName: target.householdName,
              dedupeKey: result.dedupeKey,
              outcome,
              dryRun,
              ...(error ? { error } : {})
            },
            'Reminder job processed'
          )

          dispatches.push({
            householdId: target.householdId,
            householdName: target.householdName,
            telegramChatId: target.telegramChatId,
            telegramThreadId: target.telegramThreadId,
            dedupeKey: result.dedupeKey,
            outcome,
            messageText: text,
            ...(error ? { error } : {})
          })
        }

        const totals = dispatches.reduce(
          (summary, dispatch) => {
            summary.targets += 1
            summary[dispatch.outcome] += 1
            return summary
          },
          {
            targets: 0,
            claimed: 0,
            duplicate: 0,
            'dry-run': 0,
            failed: 0
          }
        )

        return json({
          ok: true,
          jobId: body.jobId ?? schedulerJobName ?? null,
          reminderType,
          period,
          dryRun,
          totals,
          dispatches
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown reminder job error'

        options.logger?.error(
          {
            event: 'scheduler.reminder.dispatch_failed',
            reminderType: rawReminderType,
            error: message
          },
          'Reminder job failed'
        )

        return json({ ok: false, error: message }, 400)
      }
    }
  }
}

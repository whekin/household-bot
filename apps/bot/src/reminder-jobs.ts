import type { ReminderJobService } from '@household/application'
import { BillingPeriod, nowInstant } from '@household/domain'
import type { Logger } from '@household/observability'
import { REMINDER_TYPES, type ReminderType } from '@household/ports'

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
  householdId: string
  reminderService: ReminderJobService
  forceDryRun?: boolean
  logger?: Logger
}): {
  handle: (request: Request, rawReminderType: string) => Promise<Response>
} {
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
        const result = await options.reminderService.handleJob({
          householdId: options.householdId,
          period,
          reminderType,
          dryRun
        })

        const logPayload = {
          event: 'scheduler.reminder.dispatch',
          reminderType,
          period,
          jobId: body.jobId ?? schedulerJobName ?? null,
          dedupeKey: result.dedupeKey,
          outcome: result.status,
          dryRun
        }

        options.logger?.info(logPayload, 'Reminder job processed')

        return json({
          ok: true,
          jobId: body.jobId ?? schedulerJobName ?? null,
          reminderType,
          period,
          dedupeKey: result.dedupeKey,
          outcome: result.status,
          dryRun,
          messageText: result.messageText
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

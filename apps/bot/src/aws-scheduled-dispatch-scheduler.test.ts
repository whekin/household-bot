import { describe, expect, test } from 'bun:test'

import { Temporal } from '@household/domain'

import { createAwsScheduledDispatchScheduler } from './aws-scheduled-dispatch-scheduler'

describe('createAwsScheduledDispatchScheduler', () => {
  test('creates one-shot EventBridge schedules targeting the bot lambda', async () => {
    const calls: unknown[] = []
    const scheduler = createAwsScheduledDispatchScheduler({
      region: 'eu-central-1',
      targetLambdaArn: 'arn:aws:lambda:eu-central-1:123:function:bot',
      roleArn: 'arn:aws:iam::123:role/scheduler',
      groupName: 'dispatches',
      client: {
        send: async (command) => {
          calls.push(command.input)
          return {}
        }
      }
    })

    const result = await scheduler.scheduleOneShotDispatch({
      dispatchId: 'dispatch-1',
      dueAt: Temporal.Instant.from('2026-03-24T12:00:00Z')
    })

    expect(result.providerDispatchId).toContain('dispatch-dispatch-1-')
    expect(calls[0]).toMatchObject({
      GroupName: 'dispatches',
      ScheduleExpression: 'at(2026-03-24T12:00:00Z)',
      ActionAfterCompletion: 'DELETE',
      FlexibleTimeWindow: {
        Mode: 'OFF'
      },
      Target: {
        Arn: 'arn:aws:lambda:eu-central-1:123:function:bot',
        RoleArn: 'arn:aws:iam::123:role/scheduler',
        Input: JSON.stringify({
          source: 'household.scheduled-dispatch',
          dispatchId: 'dispatch-1'
        })
      }
    })
  })
})

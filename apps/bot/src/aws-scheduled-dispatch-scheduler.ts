import {
  CreateScheduleCommand,
  DeleteScheduleCommand,
  SchedulerClient
} from '@aws-sdk/client-scheduler'

import type {
  ScheduleOneShotDispatchInput,
  ScheduleOneShotDispatchResult,
  ScheduledDispatchScheduler
} from '@household/ports'

function scheduleName(dispatchId: string): string {
  return `dispatch-${dispatchId}-${crypto.randomUUID().slice(0, 8)}`
}

function atExpression(dueAtIso: string): string {
  return `at(${dueAtIso.replace(/\.\d{3}Z$/, 'Z')})`
}

export function createAwsScheduledDispatchScheduler(input: {
  region: string
  targetLambdaArn: string
  roleArn: string
  groupName: string
  client?: Pick<SchedulerClient, 'send'>
}): ScheduledDispatchScheduler {
  const client = input.client ?? new SchedulerClient({ region: input.region })

  return {
    provider: 'aws-eventbridge',

    async scheduleOneShotDispatch(
      dispatchInput: ScheduleOneShotDispatchInput
    ): Promise<ScheduleOneShotDispatchResult> {
      const name = scheduleName(dispatchInput.dispatchId)
      await client.send(
        new CreateScheduleCommand({
          Name: name,
          GroupName: input.groupName,
          ScheduleExpression: atExpression(dispatchInput.dueAt.toString()),
          FlexibleTimeWindow: {
            Mode: 'OFF'
          },
          ActionAfterCompletion: 'DELETE',
          Target: {
            Arn: input.targetLambdaArn,
            RoleArn: input.roleArn,
            Input: JSON.stringify({
              source: 'household.scheduled-dispatch',
              dispatchId: dispatchInput.dispatchId
            })
          }
        })
      )

      return {
        providerDispatchId: name
      }
    },

    async cancelDispatch(providerDispatchId) {
      try {
        await client.send(
          new DeleteScheduleCommand({
            Name: providerDispatchId,
            GroupName: input.groupName
          })
        )
      } catch (error) {
        const code = (error as { name?: string }).name
        if (code === 'ResourceNotFoundException') {
          return
        }
        throw error
      }
    }
  }
}

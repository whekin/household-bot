import { createScheduledDispatchService } from '@household/application'
import type {
  HouseholdConfigurationRepository,
  ScheduledDispatchRepository
} from '@household/ports'

import { createAwsScheduledDispatchScheduler } from '../aws-scheduled-dispatch-scheduler'
import type { BotRuntimeConfig } from '../config'
import { createGcpScheduledDispatchScheduler } from '../gcp-scheduled-dispatch-scheduler'
import { createSelfHostedScheduledDispatchScheduler } from '../self-hosted-scheduled-dispatch-scheduler'

export function createScheduledDispatchRuntime(input: {
  runtime: Pick<BotRuntimeConfig, 'scheduledDispatch' | 'schedulerSharedSecret'>
  repository: ScheduledDispatchRepository | null
  householdConfigurationRepository: HouseholdConfigurationRepository | null
}) {
  const scheduledDispatch = input.runtime.scheduledDispatch
  const scheduler =
    scheduledDispatch &&
    (scheduledDispatch.provider === 'aws-eventbridge' || input.runtime.schedulerSharedSecret)
      ? scheduledDispatch.provider === 'gcp-cloud-tasks'
        ? createGcpScheduledDispatchScheduler({
            projectId: scheduledDispatch.projectId,
            location: scheduledDispatch.location,
            queue: scheduledDispatch.queue,
            publicBaseUrl: scheduledDispatch.publicBaseUrl,
            sharedSecret: input.runtime.schedulerSharedSecret!
          })
        : scheduledDispatch.provider === 'aws-eventbridge'
          ? createAwsScheduledDispatchScheduler({
              region: scheduledDispatch.region,
              targetLambdaArn: scheduledDispatch.targetLambdaArn,
              roleArn: scheduledDispatch.roleArn,
              groupName: scheduledDispatch.groupName
            })
          : createSelfHostedScheduledDispatchScheduler()
      : null

  const service =
    input.repository && scheduler && input.householdConfigurationRepository
      ? createScheduledDispatchService({
          repository: input.repository,
          scheduler,
          householdConfigurationRepository: input.householdConfigurationRepository
        })
      : null

  return {
    scheduler,
    service
  }
}

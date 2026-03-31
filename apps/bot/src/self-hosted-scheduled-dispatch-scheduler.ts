import type {
  ScheduleOneShotDispatchInput,
  ScheduleOneShotDispatchResult,
  ScheduledDispatchScheduler
} from '@household/ports'

function providerDispatchId(dispatchId: string): string {
  return `self-hosted:${dispatchId}`
}

export function createSelfHostedScheduledDispatchScheduler(): ScheduledDispatchScheduler {
  return {
    provider: 'self-hosted',

    async scheduleOneShotDispatch(
      dispatchInput: ScheduleOneShotDispatchInput
    ): Promise<ScheduleOneShotDispatchResult> {
      return {
        providerDispatchId: providerDispatchId(dispatchInput.dispatchId)
      }
    },

    async cancelDispatch(_providerDispatchId) {
      return
    }
  }
}

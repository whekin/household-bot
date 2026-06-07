import { createAnonymousFeedbackService } from '@household/application'
import { createDbAnonymousFeedbackRepository } from '@household/adapters-db'

export function createAnonymousFeedbackServiceRegistry(input: {
  databaseUrl: string
  onClose: (task: () => Promise<void>) => void
}) {
  const repositoryClients = new Map<
    string,
    ReturnType<typeof createDbAnonymousFeedbackRepository>
  >()
  const services = new Map<string, ReturnType<typeof createAnonymousFeedbackService>>()

  function serviceForHousehold(householdId: string) {
    const existing = services.get(householdId)
    if (existing) {
      return existing
    }

    const repositoryClient = createDbAnonymousFeedbackRepository(input.databaseUrl, householdId)
    repositoryClients.set(householdId, repositoryClient)
    input.onClose(repositoryClient.close)

    const service = createAnonymousFeedbackService(repositoryClient.repository)
    services.set(householdId, service)
    return service
  }

  return {
    serviceForHousehold
  }
}

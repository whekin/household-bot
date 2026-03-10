export interface ClaimProcessedBotMessageInput {
  householdId: string
  source: string
  sourceMessageKey: string
  payloadHash?: string | null
}

export interface ClaimProcessedBotMessageResult {
  claimed: boolean
}

export interface ReleaseProcessedBotMessageInput {
  householdId: string
  source: string
  sourceMessageKey: string
}

export interface ProcessedBotMessageRepository {
  claimMessage(input: ClaimProcessedBotMessageInput): Promise<ClaimProcessedBotMessageResult>
  releaseMessage(input: ReleaseProcessedBotMessageInput): Promise<void>
}

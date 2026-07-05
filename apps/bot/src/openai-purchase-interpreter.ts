export type PurchaseInterpretationDecision = 'purchase' | 'clarification' | 'not_purchase'
export type PurchaseInterpretationAmountSource = 'explicit' | 'calculated'

export interface PurchaseInterpretation {
  decision: PurchaseInterpretationDecision
  amountMinor: bigint | null
  currency: 'GEL' | 'USD' | null
  itemDescription: string | null
  payerMemberId?: string | null
  amountSource?: PurchaseInterpretationAmountSource | null
  calculationExplanation?: string | null
  participantMemberIds?: readonly string[] | null
  confidence: number
  parserMode: 'llm'
  clarificationQuestion: string | null
}

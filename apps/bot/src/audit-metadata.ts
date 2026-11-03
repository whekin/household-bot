// Shapes shared by every place that records the same kind of audit event.

export function serializeUtilityResolutionAssignments(
  assignments: readonly {
    memberId: string
    displayName: string
    utilityBillId: string
    billName: string
    amount: {
      amountMinor: bigint
      currency: 'USD' | 'GEL'
    }
  }[]
): Record<string, unknown>[] {
  return assignments.map((assignment) => ({
    memberId: assignment.memberId,
    displayName: assignment.displayName,
    utilityBillId: assignment.utilityBillId,
    billName: assignment.billName,
    amountMinor: assignment.amount.amountMinor.toString(),
    currency: assignment.amount.currency
  }))
}

/** Cancel reciprocal obligations before billing allocates them again.
 * A transfer from A to B creates B -> A credit, offsetting existing A -> B debt.
 * Inputs and outputs are integer minor units; source records remain unchanged.
 */
export function netRepaymentObligations<
  T extends {
    id: string
    payerId: string
    transfer: boolean
    outstanding: Map<string, bigint>
  }
>(sources: readonly T[]): void {
  for (const transfer of sources.filter((source) => source.transfer)) {
    for (const [debtorId, initial] of transfer.outstanding) {
      let remaining = initial
      for (const opposite of sources) {
        if (opposite.id === transfer.id || opposite.payerId !== debtorId || remaining <= 0n)
          continue
        const debt = opposite.outstanding.get(transfer.payerId) ?? 0n
        const cancelled = remaining < debt ? remaining : debt
        if (cancelled <= 0n) continue
        opposite.outstanding.set(transfer.payerId, debt - cancelled)
        remaining -= cancelled
      }
      transfer.outstanding.set(debtorId, remaining)
    }
  }
}

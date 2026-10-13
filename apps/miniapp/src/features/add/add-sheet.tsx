import { ChevronRight } from 'lucide-react'

import { useDashboard } from '@/app/dashboard-context'
import { KindIcon, type Kind } from '@/components/kind'
import { Sheet } from '@/components/ui/dialog'
import { useI18n } from '@/i18n/context'
import { haptics } from '@/telegram/webapp'

export type AddChoice = 'purchase' | 'bill' | 'transfer' | 'payment'

/** The one place to add anything to the house ledger. */
export function AddSheet({
  open,
  onOpenChange,
  onChoose
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onChoose: (choice: AddChoice) => void
}) {
  const { copy } = useI18n()
  const { effectiveIsAdmin } = useDashboard()

  const options: { id: AddChoice; kind: Kind; title: string; hint: string }[] = [
    { id: 'purchase', kind: 'buys', title: copy.addPurchase, hint: copy.addPurchaseHint },
    { id: 'bill', kind: 'utilities', title: copy.addBill, hint: copy.addBillHint },
    { id: 'transfer', kind: 'transfer', title: copy.addTransfer, hint: copy.addTransferHint },
    ...(effectiveIsAdmin
      ? [
          {
            id: 'payment' as const,
            kind: 'rent' as const,
            title: copy.addPayment,
            hint: copy.addPaymentHint
          }
        ]
      : [])
  ]

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={copy.addSheetTitle}>
      <ul className="space-y-2">
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              onClick={() => {
                haptics.selection()
                onOpenChange(false)
                onChoose(option.id)
              }}
              className="flex w-full items-center gap-3 rounded-[20px] bg-card p-3 text-left transition-transform active:scale-[0.98]"
            >
              <KindIcon kind={option.kind} className="size-12 rounded-[18px]" />
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{option.title}</span>
                <span className="block truncate text-[13px] text-faint">{option.hint}</span>
              </span>
              <ChevronRight className="size-4 text-faint" />
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}

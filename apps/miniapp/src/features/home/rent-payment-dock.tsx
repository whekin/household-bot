import { Check, ChevronDown, Copy as CopyIcon, ExternalLink } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'

import { useToast } from '@/components/toast'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import {
  rentPaymentAccountTail,
  rentPaymentDestinationCopyText,
  rentPaymentDestinationMeta,
  type RentPaymentDestination
} from './rent-payment-destination'

function CopyIconButton({
  label,
  copied,
  onClick
}: {
  label: string
  copied: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-field transition-colors active:border-border-hover',
        copied ? 'text-status-credit' : 'text-muted-foreground'
      )}
    >
      {copied ? <Check className="size-4" /> : <CopyIcon className="size-4" />}
    </button>
  )
}

/**
 * Rent payment destinations: compact primary summary with copy-account, an
 * expandable list of full destination cards with copy-all. Ported from the
 * legacy RentPaymentDock in today-sections.tsx.
 */
export function RentPaymentDock({
  destinations
}: {
  destinations: readonly RentPaymentDestination[]
}) {
  const { copy } = useI18n()
  const { showToast } = useToast()
  const [expanded, setExpanded] = useState(false)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const detailsId = useId()

  useEffect(() => () => clearTimeout(copiedTimer.current), [])

  async function copyText(input: { key: string; text: string; successMessage: string }) {
    try {
      const writeText = globalThis.navigator?.clipboard?.writeText
      if (!writeText) throw new Error('Clipboard unavailable')

      await writeText.call(globalThis.navigator.clipboard, input.text)
      setCopiedKey(input.key)
      showToast(input.successMessage, 'success')

      clearTimeout(copiedTimer.current)
      copiedTimer.current = setTimeout(() => setCopiedKey(null), 1600)
    } catch {
      showToast(copy.rentPaymentCopyFailed, 'error')
    }
  }

  function copyAccount(destination: RentPaymentDestination, index: number) {
    void copyText({
      key: `rent:${index}:account`,
      text: destination.account,
      successMessage: copy.rentPaymentAccountCopied
    })
  }

  function copyDetails(destination: RentPaymentDestination, index: number) {
    void copyText({
      key: `rent:${index}:details`,
      text: rentPaymentDestinationCopyText(destination),
      successMessage: copy.rentPaymentDetailsCopied
    })
  }

  const primary = destinations[0] ?? null
  if (!primary) return null

  return (
    <aside aria-label={copy.rentPaymentDetailsTitle} className="rounded-xl bg-elevated p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-wide text-faint">
            {copy.rentPaymentDetailsTitle}
          </p>
          <p className="truncate text-sm font-semibold text-foreground">{primary.label}</p>
          <p className="font-mono text-xs text-muted-foreground">
            {rentPaymentAccountTail(primary.account)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <CopyIconButton
            label={copy.rentPaymentCopyAccount}
            copied={copiedKey === 'rent:0:account'}
            onClick={() => copyAccount(primary, 0)}
          />
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded((value) => !value)}
            className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-xs font-medium text-primary active:bg-field-hover"
          >
            <span>{expanded ? copy.rentPaymentHideDetails : copy.rentPaymentShowDetails}</span>
            <ChevronDown
              className={cn('size-4 transition-transform', expanded && 'rotate-180')}
              aria-hidden
            />
          </button>
        </div>
      </div>

      {expanded ? (
        <div id={detailsId} className="mt-3 space-y-3">
          {destinations.map((destination, index) => {
            const meta = rentPaymentDestinationMeta(destination)
            const detailsKey = `rent:${index}:details`

            return (
              <article
                key={`${destination.label}:${destination.account}`}
                className="space-y-2 rounded-lg bg-card p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{destination.label}</p>
                    {meta ? <p className="text-xs text-muted-foreground">{meta}</p> : null}
                  </div>
                  {destination.link ? (
                    <a
                      href={destination.link}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={copy.rentPaymentOpenLink}
                      className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border text-primary"
                    >
                      <ExternalLink className="size-4" />
                    </a>
                  ) : null}
                </div>

                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-lg bg-field px-2.5 py-2 font-mono text-xs text-foreground">
                    {destination.account}
                  </code>
                  <CopyIconButton
                    label={copy.rentPaymentCopyAccount}
                    copied={copiedKey === `rent:${index}:account`}
                    onClick={() => copyAccount(destination, index)}
                  />
                </div>

                {destination.note ? (
                  <p className="text-xs text-muted-foreground">{destination.note}</p>
                ) : null}

                <button
                  type="button"
                  onClick={() => copyDetails(destination, index)}
                  className={cn(
                    'flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-xs font-medium transition-colors active:border-border-hover',
                    copiedKey === detailsKey ? 'text-status-credit' : 'text-muted-foreground'
                  )}
                >
                  {copiedKey === detailsKey ? (
                    <Check className="size-3.5" />
                  ) : (
                    <CopyIcon className="size-3.5" />
                  )}
                  {copy.rentPaymentCopyDetails}
                </button>
              </article>
            )
          })}
        </div>
      ) : null}
    </aside>
  )
}

import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * Bottom sheet — slides up from the bottom edge, the natural modal shape inside a
 * Telegram mini app. `description` is a one-line subtitle under the title.
 */
export function Sheet({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 animate-fade-in bg-overlay" />
        <DialogPrimitive.Content
          {...(description ? {} : { 'aria-describedby': undefined })}
          onOpenAutoFocus={(event) => {
            // Forms mark their first field; everything else keeps Radix's default focus.
            const target = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>(
              '[data-autofocus]'
            )
            if (target) {
              event.preventDefault()
              target.focus()
            }
          }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[90dvh] w-full max-w-lg animate-sheet-in flex-col rounded-t-[28px] bg-background shadow-modal outline-none'
          )}
        >
          <div
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-hover"
            aria-hidden
          />
          <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="font-display text-lg font-semibold leading-tight tracking-tight text-foreground">
                {title}
              </DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-[13px] text-muted-foreground">
                  {description}
                </DialogPrimitive.Description>
              ) : null}
            </div>
            <DialogPrimitive.Close
              className="flex size-8 shrink-0 items-center justify-center rounded-full bg-elevated text-muted-foreground transition-colors active:bg-field-hover"
              aria-label="Close"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(20px,env(safe-area-inset-bottom))] pt-1">
            {children}
          </div>
          {footer ? (
            <div className="border-t border-border px-5 py-3 pb-[max(12px,env(safe-area-inset-bottom))]">
              {footer}
            </div>
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

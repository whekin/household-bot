import { ArrowRight, ExternalLink, Loader2, RotateCcw } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import { joinDeepLink, useSession } from '@/app/session-context'

function CenteredCard({
  badge,
  title,
  body,
  children
}: {
  badge: string
  title: string
  body: string
  children?: ReactNode
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <span className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
          {badge}
        </span>
        <h1 className="mt-3 font-display text-2xl font-semibold text-foreground">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
        {children ? <div className="mt-6 flex flex-col gap-2">{children}</div> : null}
      </div>
    </main>
  )
}

export function LoadingScreen() {
  const { copy } = useI18n()
  return (
    <CenteredCard badge={copy.loadingBadge} title={copy.loadingTitle} body={copy.loadingBody}>
      <Loader2 className="mx-auto size-6 animate-spin text-primary" aria-hidden />
    </CenteredCard>
  )
}

export function BlockedScreen({
  reason
}: {
  reason: 'telegram_only' | 'session_expired' | 'error'
}) {
  const { copy } = useI18n()

  const title =
    reason === 'telegram_only'
      ? copy.telegramOnlyTitle
      : reason === 'session_expired'
        ? copy.sessionExpiredTitle
        : copy.unexpectedErrorTitle
  const body =
    reason === 'telegram_only'
      ? copy.telegramOnlyBody
      : reason === 'session_expired'
        ? copy.sessionExpiredBody
        : copy.unexpectedErrorBody

  return (
    <CenteredCard badge={copy.loadingBadge} title={title} body={body}>
      <Button variant="primary" size="lg" onClick={() => window.location.reload()}>
        <RotateCcw className="size-5" aria-hidden />
        {copy.reload}
      </Button>
    </CenteredCard>
  )
}

export function OnboardingScreen({
  mode,
  householdName
}: {
  mode: 'join_required' | 'pending' | 'open_from_group'
  householdName?: string | undefined
}) {
  const { copy } = useI18n()
  const { joining, handleJoinHousehold } = useSession()
  const botLink = joinDeepLink()

  const title =
    mode === 'pending'
      ? copy.pendingTitle
      : mode === 'open_from_group'
        ? copy.openFromGroupTitle
        : copy.joinTitle
  const body = (
    mode === 'pending'
      ? copy.pendingBody
      : mode === 'open_from_group'
        ? copy.openFromGroupBody
        : copy.joinBody
  ).replace('{household}', householdName ?? copy.householdFallback)

  return (
    <CenteredCard badge={copy.loadingBadge} title={title} body={body}>
      {mode === 'join_required' ? (
        <Button
          variant="primary"
          size="lg"
          loading={joining}
          onClick={() => void handleJoinHousehold()}
        >
          <ArrowRight className="size-5" aria-hidden />
          {joining ? copy.joining : copy.joinAction}
        </Button>
      ) : null}
      {botLink ? (
        <Button asChild variant="secondary" size="lg">
          <a href={botLink}>
            <ExternalLink className="size-5" aria-hidden />
            {copy.botLinkAction}
          </a>
        </Button>
      ) : null}
      <Button variant="ghost" onClick={() => window.location.reload()}>
        <RotateCcw className="size-4" aria-hidden />
        {copy.reload}
      </Button>
    </CenteredCard>
  )
}

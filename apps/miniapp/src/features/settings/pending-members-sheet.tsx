import { Check, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { useToast } from '@/components/toast'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { useI18n } from '@/i18n/context'
import { approveMiniAppPendingMember, rejectMiniAppPendingMember } from '@/api'

export function PendingMembersSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { pendingMembers, refresh } = useDashboard()
  const { copy, locale } = useI18n()
  const { showToast } = useToast()

  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [rejectingId, setRejectingId] = useState<string | null>(null)

  async function handleApprove(telegramUserId: string) {
    if (!initData || approvingId) return
    setApprovingId(telegramUserId)
    try {
      await approveMiniAppPendingMember(initData, telegramUserId)
      await refresh()
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          locale === 'ru' ? 'Не получилось подтвердить участника.' : 'Failed to approve member.',
          'error'
        )
      }
    } finally {
      setApprovingId(null)
    }
  }

  async function handleReject(telegramUserId: string) {
    if (!initData || rejectingId) return
    setRejectingId(telegramUserId)
    try {
      await rejectMiniAppPendingMember(initData, telegramUserId)
      await refresh()
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          locale === 'ru' ? 'Не получилось отклонить участника.' : 'Failed to reject member.',
          'error'
        )
      }
    } finally {
      setRejectingId(null)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={copy.pendingMembersTitle}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{copy.pendingMembersBody}</p>

        {pendingMembers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{copy.pendingMembersEmpty}</p>
        ) : (
          <div className="space-y-2">
            {pendingMembers.map((member) => (
              <div
                key={member.telegramUserId}
                className="flex items-center gap-3 rounded-xl bg-elevated px-3 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {member.displayName}
                  </p>
                  <p className="text-xs text-faint">
                    {member.username ? `@${member.username}` : '—'}
                  </p>
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={rejectingId === member.telegramUserId}
                    disabled={approvingId === member.telegramUserId}
                    onClick={() => void handleReject(member.telegramUserId)}
                  >
                    <X className="size-3.5" aria-hidden />
                    {rejectingId === member.telegramUserId
                      ? copy.rejectingMember
                      : copy.rejectMemberAction}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    loading={approvingId === member.telegramUserId}
                    disabled={rejectingId === member.telegramUserId}
                    onClick={() => void handleApprove(member.telegramUserId)}
                  >
                    <Check className="size-3.5" aria-hidden />
                    {approvingId === member.telegramUserId
                      ? copy.approvingMember
                      : copy.approveMemberAction}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}

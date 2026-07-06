import { Badge } from '@/components/ui/badge'
import { Sheet } from '@/components/ui/dialog'
import { useDashboard } from '@/app/dashboard-context'
import { useI18n } from '@/i18n/context'
import type { Copy } from '@/i18n'
import type { MiniAppTopicBinding } from '@/api'

export function topicRoleLabel(role: MiniAppTopicBinding['role'], copy: Copy): string {
  const labels: Record<MiniAppTopicBinding['role'], string> = {
    purchase: copy.topicPurchase,
    feedback: copy.topicFeedback,
    reminders: copy.topicReminders,
    payments: copy.topicPayments,
    notifications: copy.topicNotifications
  }
  return labels[role] ?? role
}

function TopicGroup({
  label,
  topics,
  copy,
  bound
}: {
  label: string
  topics: readonly MiniAppTopicBinding[]
  copy: Copy
  bound: boolean
}) {
  if (topics.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      {topics.map((topic) => (
        <div
          key={topic.role}
          className={`flex items-center justify-between gap-3 rounded-xl bg-elevated px-3 py-2.5 ${
            bound ? '' : 'opacity-60'
          }`}
        >
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">
              {topicRoleLabel(topic.role, copy)}
            </p>
            <p className="truncate text-xs text-faint">
              {bound ? topic.topicName || copy.topicBound : copy.topicUnbound}
            </p>
          </div>
          <Badge tone={bound ? 'primary' : 'neutral'}>
            {bound ? copy.topicBound : copy.topicUnbound}
          </Badge>
        </div>
      ))}
    </div>
  )
}

export function TopicsSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { adminSettings } = useDashboard()
  const { copy, locale } = useI18n()

  const topics = adminSettings?.topics ?? []
  const connectedTopics = topics.filter((topic) => Boolean(topic.telegramThreadId))
  const unboundTopics = topics.filter((topic) => !topic.telegramThreadId)

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={copy.topicBindingsTitle}>
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{copy.topicBindingsBody}</p>
        <p className="text-xs text-faint">
          {locale === 'ru'
            ? `${connectedTopics.length} из ${topics.length} подключены`
            : `${connectedTopics.length} of ${topics.length} connected`}
        </p>

        <TopicGroup label={copy.topicBound} topics={connectedTopics} copy={copy} bound />
        <TopicGroup label={copy.topicUnbound} topics={unboundTopics} copy={copy} bound={false} />
      </div>
    </Sheet>
  )
}

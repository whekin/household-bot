import {
  CalendarRange,
  ChevronRight,
  LayoutList,
  ListChecks,
  MessagesSquare,
  Moon,
  Receipt,
  Sun,
  SunMoon,
  UserPlus,
  type LucideIcon
} from 'lucide-react'
import { useState, type ReactNode } from 'react'

import { useAppNav } from '@/app/app-nav'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession, useSession } from '@/app/session-context'
import { useTheme } from '@/app/theme-context'
import { Avatar } from '@/components/avatar'
import { formatMoney } from '@/components/money'
import { useToast } from '@/components/toast'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { LocaleToggle, Segmented } from '@/components/ui/segmented'
import { Skeleton } from '@/components/ui/skeleton'
import { BillingSettingsSheet } from '@/features/settings/billing-settings-sheet'
import { CategoriesSheet } from '@/features/settings/categories-sheet'
import { CycleSheet } from '@/features/settings/cycle-sheet'
import { MembersSheet } from '@/features/settings/members-sheet'
import { PendingMembersSheet } from '@/features/settings/pending-members-sheet'
import { TopicsSheet } from '@/features/settings/topics-sheet'
import { useI18n } from '@/i18n/context'
import { formatCyclePeriod } from '@/lib/dates'
import { minorToMajorString } from '@/lib/money'

type AdminSheet = 'billing' | 'categories' | 'cycle' | 'topics' | 'pending'

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="animate-rise">
      <div className="mb-1.5 px-1">
        <h3 className="text-[15px] font-semibold">{title}</h3>
        {hint ? <p className="text-xs text-faint">{hint}</p> : null}
      </div>
      <div className="rounded-[24px] bg-card px-3 py-1">{children}</div>
    </section>
  )
}

function LinkRow({
  icon: Icon,
  title,
  hint,
  badge,
  onClick
}: {
  icon: LucideIcon
  title: string
  hint?: string | undefined
  badge?: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-elevated">
        <Icon className="size-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{title}</span>
        {hint ? <span className="block truncate text-xs text-faint">{hint}</span> : null}
      </span>
      {badge}
      <ChevronRight className="size-4 shrink-0 text-faint" />
    </button>
  )
}

/**
 * The people and the rules: housemates, shared routines, your own preferences, and
 * — for admins — how the house is billed.
 */
export function HouseView() {
  const session = useReadySession()
  const { copy, locale } = useI18n()
  const { openRoutines } = useAppNav()
  const {
    dashboard,
    loading,
    adminLoading,
    adminSettings,
    cycleState,
    pendingMembers,
    effectiveIsAdmin
  } = useDashboard()
  const [memberSheet, setMemberSheet] = useState<{ open: boolean; memberId: string | null }>({
    open: false,
    memberId: null
  })
  const [adminSheet, setAdminSheet] = useState<AdminSheet | null>(null)

  if (loading || adminLoading || !dashboard) {
    return (
      <div className="space-y-3" role="status">
        <Skeleton className="h-56 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const weights = new Map((adminSettings?.members ?? []).map((member) => [member.id, member]))
  const people = dashboard.members.filter((member) => member.status !== 'left')
  const sheetProps = (id: AdminSheet) => ({
    open: adminSheet === id,
    onOpenChange: (open: boolean) => setAdminSheet(open ? id : null)
  })

  return (
    <div className="space-y-5">
      {effectiveIsAdmin && pendingMembers.length > 0 ? (
        <button
          type="button"
          onClick={() => setAdminSheet('pending')}
          className="flex w-full animate-rise items-center gap-3 rounded-[24px] bg-routine-soft p-4 text-left text-routine-ink"
        >
          <UserPlus className="size-5 shrink-0" />
          <span className="min-w-0 flex-1 text-sm font-semibold">
            {copy.houseRequests.replace(
              '{names}',
              pendingMembers.map((member) => member.displayName).join(', ')
            )}
          </span>
          <span className="text-[13px] font-bold">{copy.houseRequestsAction}</span>
        </button>
      ) : null}

      <Group
        title={copy.housePeople}
        hint={copy.houseCount.replace('{count}', String(people.length))}
      >
        <ul>
          {people.map((member) => {
            const settings = weights.get(member.memberId)
            const tags = [
              settings?.isAdmin ? copy.houseAdmin : null,
              member.status === 'away' ? copy.houseAway : null,
              settings && settings.rentShareWeight !== 1
                ? copy.houseWeight.replace('{weight}', String(settings.rentShareWeight))
                : null
            ].filter(Boolean)
            const isMe = member.memberId === session.member.id
            const content = (
              <>
                <Avatar name={member.displayName} me={isMe} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium">
                    {member.displayName}
                    {isMe ? (
                      <span className="font-normal text-faint"> · {copy.youSuffix}</span>
                    ) : null}
                  </span>
                  {tags.length > 0 ? (
                    <span className="block truncate text-xs text-faint">{tags.join(' · ')}</span>
                  ) : null}
                </span>
              </>
            )
            return (
              <li key={member.memberId}>
                {effectiveIsAdmin ? (
                  <button
                    type="button"
                    onClick={() => setMemberSheet({ open: true, memberId: member.memberId })}
                    className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
                  >
                    {content}
                    <ChevronRight className="size-4 shrink-0 text-faint" />
                  </button>
                ) : (
                  <div className="flex min-h-14 items-center gap-3 py-2">{content}</div>
                )}
              </li>
            )
          })}
        </ul>
      </Group>

      <section className="animate-rise">
        <button
          type="button"
          onClick={openRoutines}
          className="flex w-full items-center gap-3 rounded-[24px] bg-routine-soft p-4 text-left text-routine-ink transition-transform active:scale-[0.99]"
        >
          <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-routine text-white">
            <ListChecks className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold">{copy.houseRoutines}</span>
            <span className="block text-xs opacity-75">{copy.houseRoutinesHint}</span>
          </span>
          <ChevronRight className="size-4 opacity-60" />
        </button>
      </section>

      <YouGroup />

      {effectiveIsAdmin && adminSettings ? (
        <Group title={copy.houseSettings} hint={copy.houseSettingsHint}>
          <LinkRow
            icon={Receipt}
            title={copy.houseBilling}
            hint={copy.houseBillingHint
              .replace(
                '{rent}',
                formatMoney(
                  minorToMajorString(BigInt(adminSettings.settings.rentAmountMinor ?? '0')),
                  adminSettings.settings.rentCurrency
                )
              )
              .replace('{timezone}', adminSettings.settings.timezone)}
            onClick={() => setAdminSheet('billing')}
          />
          <LinkRow
            icon={LayoutList}
            title={copy.houseCategories}
            hint={copy.houseCategoriesHint.replace(
              '{count}',
              String(adminSettings.categories.filter((category) => category.isActive).length)
            )}
            onClick={() => setAdminSheet('categories')}
          />
          <LinkRow
            icon={CalendarRange}
            title={copy.houseCycle}
            hint={
              cycleState?.cycle
                ? formatCyclePeriod(cycleState.cycle.period, locale)
                : copy.houseCycleNone
            }
            onClick={() => setAdminSheet('cycle')}
          />
          <LinkRow
            icon={MessagesSquare}
            title={copy.houseTopics}
            hint={copy.houseTopicsHint
              .replace(
                '{connected}',
                String(adminSettings.topics.filter((topic) => topic.telegramThreadId).length)
              )
              .replace('{total}', String(adminSettings.topics.length))}
            onClick={() => setAdminSheet('topics')}
          />
          {pendingMembers.length === 0 ? (
            <LinkRow
              icon={UserPlus}
              title={copy.pendingMembersTitle}
              onClick={() => setAdminSheet('pending')}
            />
          ) : null}
        </Group>
      ) : null}

      <footer className="flex flex-col items-center gap-1 pb-2 pt-2 text-center">
        <p className="font-display text-sm font-bold">{copy.appTitle}</p>
        {session.mode === 'demo' ? (
          <Badge tone="routine">{copy.demoBadge}</Badge>
        ) : (
          <p className="text-xs text-faint">{copy.houseLive}</p>
        )}
      </footer>

      {effectiveIsAdmin ? (
        <>
          <MembersSheet
            open={memberSheet.open}
            initialMemberId={memberSheet.memberId}
            onOpenChange={(open) =>
              setMemberSheet({ open, memberId: open ? memberSheet.memberId : null })
            }
          />
          <BillingSettingsSheet {...sheetProps('billing')} />
          <CategoriesSheet {...sheetProps('categories')} />
          <CycleSheet {...sheetProps('cycle')} />
          <TopicsSheet {...sheetProps('topics')} />
          <PendingMembersSheet {...sheetProps('pending')} />
        </>
      ) : null}
    </div>
  )
}

/** The reader's own preferences: name, language and appearance. */
function YouGroup() {
  const session = useReadySession()
  const { initData, saveOwnDisplayName, handleMemberLocaleChange, handleMiniAppRequestError } =
    useSession()
  const { copy, locale } = useI18n()
  const { preference, setPreference } = useTheme()
  const { showToast } = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const name = session.member.displayName
  const draftValid = draft.trim().length >= 2 && draft.trim() !== name

  async function saveName() {
    if (!initData || saving || !draftValid) return
    setSaving(true)
    try {
      await saveOwnDisplayName(draft.trim())
      setEditing(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) showToast(copy.houseNameFailed, 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Group title={copy.houseYou}>
      <button
        type="button"
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
      >
        <Avatar name={name} me />
        <span className="min-w-0 flex-1">
          <span className="block text-xs text-faint">{copy.houseName}</span>
          <span className="block truncate text-[15px] font-medium">{name}</span>
        </span>
        <span className="text-[13px] font-semibold text-muted-foreground">{copy.entryEdit}</span>
      </button>
      <div className="space-y-2 border-t border-border py-3">
        <p className="text-xs font-medium text-faint">{copy.houseLanguage}</p>
        <LocaleToggle
          value={locale}
          ariaLabel={copy.houseLanguage}
          onChange={(next) => void handleMemberLocaleChange(next)}
        />
      </div>
      <div className="space-y-2 border-t border-border py-3">
        <p className="text-xs font-medium text-faint">{copy.houseAppearance}</p>
        <Segmented
          value={preference}
          ariaLabel={copy.houseAppearance}
          onChange={setPreference}
          options={[
            { value: 'auto', icon: SunMoon, label: copy.appearanceAuto },
            { value: 'light', icon: Sun, label: copy.appearanceLight },
            { value: 'dark', icon: Moon, label: copy.appearanceDark }
          ]}
        />
      </div>

      {editing ? (
        <Sheet open onOpenChange={setEditing} title={copy.houseNameEdit}>
          <div className="space-y-4">
            <Field label={copy.houseName} hint={copy.houseNameHint}>
              <Input
                data-autofocus=""
                value={draft}
                maxLength={64}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveName()
                }}
              />
            </Field>
            <Button
              variant="primary"
              size="lg"
              className="w-full"
              loading={saving}
              disabled={!draftValid}
              onClick={() => void saveName()}
            >
              {copy.houseNameSave}
            </Button>
          </div>
        </Sheet>
      ) : null}
    </Group>
  )
}

import { Check, Globe, Moon, Settings2, Sun, SunMoon, User, X } from 'lucide-react'
import { useState, type ComponentType } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Sheet } from '@/components/ui/dialog'
import { useToast } from '@/components/toast'
import { useReadySession, useSession } from '@/app/session-context'
import { useTheme } from '@/app/theme-context'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { haptics } from '@/telegram/webapp'
import type { ThemePreference } from '@/telegram/theme'

import { memberStatusLabel } from './helpers'
import { LocaleToggle } from './toggles'

function AppearanceToggle({
  value,
  onChange,
  ariaLabel,
  options
}: {
  value: ThemePreference
  onChange: (value: ThemePreference) => void
  ariaLabel?: string | undefined
  options: readonly {
    value: ThemePreference
    icon: ComponentType<{ className?: string }>
    ariaLabel: string
  }[]
}) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className="flex h-10 overflow-hidden rounded-lg border border-border bg-field"
    >
      {options.map((option) => {
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.ariaLabel}
            aria-pressed={option.value === value}
            onClick={() => {
              if (option.value !== value) haptics.selection()
              onChange(option.value)
            }}
            className={cn(
              'flex flex-1 items-center justify-center transition-colors',
              option.value === value ? 'bg-primary-soft text-primary' : 'text-faint'
            )}
          >
            <Icon className="size-4" />
          </button>
        )
      })}
    </div>
  )
}

export function ProfileCard() {
  const session = useReadySession()
  const { initData, saveOwnDisplayName, handleMemberLocaleChange, handleMiniAppRequestError } =
    useSession()
  const { copy, locale } = useI18n()
  const { preference, mode, setPreference } = useTheme()
  const { showToast } = useToast()

  const appearanceLabel =
    preference === 'auto'
      ? copy.appearanceAuto
      : preference === 'light'
        ? copy.appearanceLight
        : copy.appearanceDark
  const AppearanceIcon = mode === 'dark' ? Moon : Sun

  const [editorOpen, setEditorOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  const member = session.member

  function openEditor() {
    setDraft(member.displayName)
    setEditorOpen(true)
  }

  async function handleSaveDisplayName() {
    if (!initData || saving) return
    setSaving(true)
    try {
      await saveOwnDisplayName(draft.trim())
      setEditorOpen(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          locale === 'ru' ? 'Не получилось сохранить имя.' : 'Failed to save name.',
          'error'
        )
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">
            {copy.houseSectionGeneral}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">{copy.generalSettingsBody}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={openEditor}>
          <Settings2 className="size-3.5" aria-hidden />
          {copy.manageProfileAction}
        </Button>
      </div>

      <div className="space-y-3">
        <div className="flex items-center gap-3 rounded-xl bg-elevated px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <User className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-faint">{copy.displayNameLabel}</p>
            <p className="truncate text-sm font-semibold text-foreground">{member.displayName}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <Badge tone={member.isAdmin ? 'primary' : 'neutral'}>
              {member.isAdmin ? copy.adminTag : copy.residentTag}
            </Badge>
            <Badge tone="neutral">{memberStatusLabel(member.status, copy)}</Badge>
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-elevated px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <Globe className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-faint">{copy.language}</p>
            <p className="text-sm font-semibold text-foreground">
              {locale === 'en' ? 'English' : 'Русский'}
            </p>
          </div>
          <div className="w-28 shrink-0">
            <LocaleToggle
              value={locale}
              ariaLabel={copy.language}
              onChange={(next) => void handleMemberLocaleChange(next)}
            />
          </div>
        </div>

        <div className="flex items-center gap-3 rounded-xl bg-elevated px-3 py-2.5">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary">
            <AppearanceIcon className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-faint">{copy.appearance}</p>
            <p className="text-sm font-semibold text-foreground">{appearanceLabel}</p>
          </div>
          <div className="w-36 shrink-0">
            <AppearanceToggle
              value={preference}
              ariaLabel={copy.appearance}
              onChange={setPreference}
              options={[
                { value: 'auto', icon: SunMoon, ariaLabel: copy.appearanceAuto },
                { value: 'light', icon: Sun, ariaLabel: copy.appearanceLight },
                { value: 'dark', icon: Moon, ariaLabel: copy.appearanceDark }
              ]}
            />
          </div>
        </div>
      </div>

      <Sheet
        open={editorOpen}
        onOpenChange={setEditorOpen}
        title={copy.manageProfileAction}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>
              <X className="size-4" aria-hidden />
              {copy.closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={saving || draft.trim().length < 2 || draft.trim() === member.displayName}
              onClick={() => void handleSaveDisplayName()}
            >
              <Check className="size-4" aria-hidden />
              {saving ? copy.savingDisplayName : copy.saveDisplayName}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{copy.profileEditorBody}</p>
          <Field label={copy.displayNameLabel} hint={copy.displayNameHint}>
            <Input value={draft} onChange={(event) => setDraft(event.target.value)} />
          </Field>
        </div>
      </Sheet>
    </Card>
  )
}

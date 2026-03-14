import { useNavigate } from '@solidjs/router'
import { Show, createSignal, type ParentProps } from 'solid-js'
import { Settings } from 'lucide-solid'

import { useSession } from '../../contexts/session-context'
import { useI18n } from '../../contexts/i18n-context'
import { useDashboard } from '../../contexts/dashboard-context'
import { NavigationTabs } from './navigation-tabs'
import { Badge } from '../ui/badge'
import { Button, IconButton } from '../ui/button'
import { Modal } from '../ui/dialog'
import { Field } from '../ui/field'
import { Input } from '../ui/input'

export function AppShell(props: ParentProps) {
  const { readySession } = useSession()
  const { copy, locale, setLocale } = useI18n()
  const {
    dashboard,
    effectiveIsAdmin,
    testingRolePreview,
    setTestingRolePreview,
    testingPeriodOverride,
    setTestingPeriodOverride,
    testingTodayOverride,
    setTestingTodayOverride
  } = useDashboard()
  const navigate = useNavigate()

  const [testingSurfaceOpen, setTestingSurfaceOpen] = createSignal(false)

  function memberStatusLabel(status: 'active' | 'away' | 'left') {
    const labels = {
      active: copy().memberStatusActive,
      away: copy().memberStatusAway,
      left: copy().memberStatusLeft
    }
    return labels[status]
  }

  let tapCount = 0
  let tapTimer: ReturnType<typeof setTimeout> | undefined
  function handleRoleChipTap() {
    tapCount++
    if (tapCount >= 5) {
      setTestingSurfaceOpen(true)
      tapCount = 0
    }
    clearTimeout(tapTimer)
    tapTimer = setTimeout(() => {
      tapCount = 0
    }, 1000)
  }

  return (
    <main class="shell">
      {/* ── Top bar ──────────────────────────────────── */}
      <section class="topbar">
        <div class="topbar__copy">
          <p class="eyebrow">{copy().appSubtitle}</p>
          <h1>{readySession()?.member.householdName ?? copy().appTitle}</h1>
        </div>

        <div class="topbar__actions">
          <div class="locale-switch locale-switch--compact">
            <div class="locale-switch__buttons">
              <button
                classList={{ 'is-active': locale() === 'en' }}
                type="button"
                onClick={() => setLocale('en')}
              >
                EN
              </button>
              <button
                classList={{ 'is-active': locale() === 'ru' }}
                type="button"
                onClick={() => setLocale('ru')}
              >
                RU
              </button>
            </div>
          </div>
          <IconButton label="Settings" onClick={() => navigate('/settings')}>
            <Settings size={18} />
          </IconButton>
        </div>
      </section>

      {/* ── Context badges ───────────────────────────── */}
      <section class="app-context-row">
        <div class="app-context-meta">
          <Badge variant={readySession()?.mode === 'demo' ? 'accent' : 'default'}>
            {readySession()?.mode === 'demo' ? copy().demoBadge : copy().liveBadge}
          </Badge>
          <Show
            when={readySession()?.member.isAdmin}
            fallback={
              <Badge variant="muted">
                {effectiveIsAdmin() ? copy().adminTag : copy().residentTag}
              </Badge>
            }
          >
            <button class="ui-badge ui-badge--muted" onClick={handleRoleChipTap}>
              {effectiveIsAdmin() ? copy().adminTag : copy().residentTag}
            </button>
          </Show>
          <Badge variant="muted">
            {readySession()?.member.status
              ? memberStatusLabel(readySession()!.member.status)
              : copy().memberStatusActive}
          </Badge>
          <Show when={testingRolePreview()}>
            {(preview) => (
              <Badge variant="accent">
                {`${copy().testingViewBadge ?? ''}: ${preview() === 'admin' ? copy().adminTag : copy().residentTag}`}
              </Badge>
            )}
          </Show>
        </div>
      </section>

      {/* ── Route content ────────────────────────────── */}
      <section class="content-stack">{props.children}</section>

      {/* ── Bottom nav (Bug #6: 3 tabs, proper padding) */}
      <div class="app-bottom-nav">
        <NavigationTabs />
      </div>

      {/* ── Modals at route/shell level (Bug #1/#2 fix) */}
      <Modal
        open={testingSurfaceOpen()}
        title={copy().testingSurfaceTitle ?? ''}
        description={copy().testingSurfaceBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setTestingSurfaceOpen(false)}
        footer={
          <div class="modal-action-row">
            <Button variant="ghost" onClick={() => setTestingSurfaceOpen(false)}>
              {copy().closeEditorAction}
            </Button>
            <Button variant="secondary" onClick={() => setTestingRolePreview(null)}>
              {copy().testingUseRealRoleAction ?? ''}
            </Button>
          </div>
        }
      >
        <div class="testing-card">
          <article class="testing-card__section">
            <span>{copy().testingCurrentRoleLabel ?? ''}</span>
            <strong>{readySession()?.member.isAdmin ? copy().adminTag : copy().residentTag}</strong>
          </article>
          <article class="testing-card__section">
            <span>{copy().testingPreviewRoleLabel ?? ''}</span>
            <strong>
              {testingRolePreview()
                ? testingRolePreview() === 'admin'
                  ? copy().adminTag
                  : copy().residentTag
                : copy().testingUseRealRoleAction}
            </strong>
          </article>
          <div class="testing-card__actions">
            <Button variant="secondary" onClick={() => setTestingRolePreview('admin')}>
              {copy().testingPreviewAdminAction ?? ''}
            </Button>
            <Button variant="secondary" onClick={() => setTestingRolePreview('resident')}>
              {copy().testingPreviewResidentAction ?? ''}
            </Button>
          </div>
          <article class="testing-card__section">
            <span>{copy().testingPeriodCurrentLabel ?? ''}</span>
            <strong>{dashboard()?.period ?? '—'}</strong>
          </article>
          <div class="testing-card__actions" style={{ 'flex-direction': 'column', gap: '12px' }}>
            <Field label={copy().testingPeriodOverrideLabel ?? ''} wide>
              <Input
                placeholder={copy().testingPeriodOverridePlaceholder ?? ''}
                value={testingPeriodOverride() ?? ''}
                onInput={(e) => {
                  const next = e.currentTarget.value.trim()
                  setTestingPeriodOverride(next.length > 0 ? next : null)
                }}
              />
            </Field>
            <Field label={copy().testingTodayOverrideLabel ?? ''} wide>
              <Input
                placeholder={copy().testingTodayOverridePlaceholder ?? ''}
                value={testingTodayOverride() ?? ''}
                onInput={(e) => {
                  const next = e.currentTarget.value.trim()
                  setTestingTodayOverride(next.length > 0 ? next : null)
                }}
              />
            </Field>
            <div class="modal-action-row">
              <Button
                variant="ghost"
                onClick={() => {
                  setTestingPeriodOverride(null)
                  setTestingTodayOverride(null)
                }}
              >
                {copy().testingClearOverridesAction ?? ''}
              </Button>
            </div>
          </div>
        </div>
      </Modal>
    </main>
  )
}

import { Show, For, createSignal } from 'solid-js'
import { ArrowLeft, Globe, User } from 'lucide-solid'
import { useNavigate } from '@solidjs/router'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Select } from '../components/ui/select'
import { Input, Textarea } from '../components/ui/input'
import { Modal } from '../components/ui/dialog'
import { Collapsible } from '../components/ui/collapsible'
import { Field } from '../components/ui/field'
import {
  updateMiniAppBillingSettings,
  updateMiniAppMemberDisplayName,
  updateMiniAppMemberRentWeight,
  updateMiniAppMemberStatus,
  promoteMiniAppMember,
  approveMiniAppPendingMember,
  rejectMiniAppPendingMember
} from '../miniapp-api'
import { minorToMajorString } from '../lib/money'

export default function SettingsRoute() {
  const navigate = useNavigate()
  const {
    readySession,
    initData,
    handleMemberLocaleChange,
    displayNameDraft,
    setDisplayNameDraft,
    savingOwnDisplayName,
    handleSaveOwnDisplayName
  } = useSession()
  const { copy, locale } = useI18n()
  const {
    effectiveIsAdmin,
    adminSettings,
    setAdminSettings,
    cycleState,
    pendingMembers,
    setPendingMembers
  } = useDashboard()

  // ── Profile settings ─────────────────────────────
  const [profileEditorOpen, setProfileEditorOpen] = createSignal(false)

  // ── Billing settings form ────────────────────────
  const [billingEditorOpen, setBillingEditorOpen] = createSignal(false)
  const [savingSettings, setSavingSettings] = createSignal(false)
  const [billingForm, setBillingForm] = createSignal({
    householdName: adminSettings()?.householdName ?? '',
    settlementCurrency: adminSettings()?.settings.settlementCurrency ?? 'GEL',
    paymentBalanceAdjustmentPolicy:
      adminSettings()?.settings.paymentBalanceAdjustmentPolicy ?? 'utilities',
    rentAmountMajor: adminSettings()
      ? minorToMajorString(BigInt(adminSettings()!.settings.rentAmountMinor ?? '0'))
      : '',
    rentCurrency: adminSettings()?.settings.rentCurrency ?? 'USD',
    rentDueDay: adminSettings()?.settings.rentDueDay ?? 20,
    rentWarningDay: adminSettings()?.settings.rentWarningDay ?? 17,
    utilitiesDueDay: adminSettings()?.settings.utilitiesDueDay ?? 4,
    utilitiesReminderDay: adminSettings()?.settings.utilitiesReminderDay ?? 3,
    timezone: adminSettings()?.settings.timezone ?? 'Asia/Tbilisi',
    assistantContext: adminSettings()?.assistantConfig?.assistantContext ?? '',
    assistantTone: adminSettings()?.assistantConfig?.assistantTone ?? ''
  })

  // ── Pending members ──────────────────────────────
  const [approvingId, setApprovingId] = createSignal<string | null>(null)
  const [rejectingId, setRejectingId] = createSignal<string | null>(null)

  async function handleApprove(telegramUserId: string) {
    const data = initData()
    if (!data || approvingId()) return

    setApprovingId(telegramUserId)
    try {
      await approveMiniAppPendingMember(data, telegramUserId)
      setPendingMembers((prev) => prev.filter((m) => m.telegramUserId !== telegramUserId))
    } finally {
      setApprovingId(null)
    }
  }

  async function handleReject(telegramUserId: string) {
    const data = initData()
    if (!data || rejectingId()) return

    setRejectingId(telegramUserId)
    try {
      await rejectMiniAppPendingMember(data, telegramUserId)
      setPendingMembers((prev) => prev.filter((m) => m.telegramUserId !== telegramUserId))
    } finally {
      setRejectingId(null)
    }
  }

  async function handleSaveSettings() {
    const data = initData()
    if (!data) return

    setSavingSettings(true)
    try {
      const { householdName, settings, assistantConfig } = await updateMiniAppBillingSettings(
        data,
        billingForm()
      )
      setAdminSettings((prev) =>
        prev ? { ...prev, householdName, settings, assistantConfig } : prev
      )
      setBillingEditorOpen(false)
    } finally {
      setSavingSettings(false)
    }
  }

  // ── Member Editing ──────────────────────────────
  const [editMemberId, setEditMemberId] = createSignal<string | null>(null)
  const [savingMember, setSavingMember] = createSignal(false)
  const [editMemberForm, setEditMemberForm] = createSignal({
    displayName: '',
    rentShareWeight: 1,
    status: 'active' as 'active' | 'away' | 'left',
    isAdmin: false
  })

  function openEditMember(
    member: NonNullable<ReturnType<typeof adminSettings>>['members'][number]
  ) {
    setEditMemberId(member.id)
    setEditMemberForm({
      displayName: member.displayName,
      rentShareWeight: member.rentShareWeight,
      status: member.status,
      isAdmin: member.isAdmin
    })
  }

  async function handleSaveMember() {
    const data = initData()
    const memberId = editMemberId()
    const settings = adminSettings()
    if (!data || !memberId || !settings) return

    setSavingMember(true)
    try {
      const form = editMemberForm()
      const currentMember = settings.members.find((m) => m.id === memberId)
      if (!currentMember) return

      let updatedMember = currentMember

      // Update display name if changed
      if (form.displayName !== currentMember.displayName) {
        updatedMember = await updateMiniAppMemberDisplayName(data, memberId, form.displayName)
      }
      // Update rent weight if changed
      if (form.rentShareWeight !== currentMember.rentShareWeight) {
        updatedMember = await updateMiniAppMemberRentWeight(data, memberId, form.rentShareWeight)
      }
      // Update status if changed
      if (form.status !== currentMember.status) {
        updatedMember = await updateMiniAppMemberStatus(data, memberId, form.status)
      }
      // Promote to admin if requested and not already admin
      if (form.isAdmin && !currentMember.isAdmin) {
        updatedMember = await promoteMiniAppMember(data, memberId)
      }

      // Update local state
      setAdminSettings((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          members: prev.members.map((m) => (m.id === memberId ? updatedMember : m))
        }
      })
      setEditMemberId(null)
    } finally {
      setSavingMember(false)
    }
  }

  return (
    <div class="route route--settings">
      {/* ── Back + header ────────────────────────────── */}
      <div class="settings-header">
        <Button variant="ghost" size="sm" class="ui-button--very-left" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {copy().closeEditorAction}
        </Button>
        <h2>{effectiveIsAdmin() ? copy().householdSettingsTitle : copy().residentHouseTitle}</h2>
        <p>{effectiveIsAdmin() ? copy().householdSettingsBody : copy().residentHouseBody}</p>
      </div>

      {/* ── Profile ──────────────────────────────────── */}
      <Collapsible title={copy().houseSectionGeneral} body={copy().generalSettingsBody} defaultOpen>
        <Card>
          <div class="settings-profile">
            <div
              class="settings-profile__row interactive"
              style={{ cursor: 'pointer' }}
              onClick={() => setProfileEditorOpen(true)}
            >
              <User size={16} />
              <div>
                <span class="settings-profile__label">{copy().displayNameLabel}</span>
                <strong>{readySession()?.member.displayName}</strong>
              </div>
            </div>
            <div class="settings-profile__row">
              <Globe size={16} />
              <div>
                <span class="settings-profile__label">{copy().language}</span>
                <div class="locale-switch locale-switch--compact">
                  <div class="locale-switch__buttons">
                    <button
                      classList={{ 'is-active': locale() === 'en' }}
                      type="button"
                      onClick={() => void handleMemberLocaleChange('en')}
                    >
                      EN
                    </button>
                    <button
                      classList={{ 'is-active': locale() === 'ru' }}
                      type="button"
                      onClick={() => void handleMemberLocaleChange('ru')}
                    >
                      RU
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </Card>
      </Collapsible>

      {/* ── Admin sections ───────────────────────────── */}
      <Show when={effectiveIsAdmin()}>
        {/* Billing settings */}
        <Collapsible title={copy().houseSectionBilling} body={copy().billingSettingsTitle}>
          <Card>
            <Show when={adminSettings()}>
              {(settings) => (
                <div class="settings-billing-summary">
                  <div class="settings-row">
                    <span>{copy().householdNameLabel}</span>
                    <strong>{settings().householdName}</strong>
                  </div>
                  <div class="settings-row">
                    <span>{copy().settlementCurrency}</span>
                    <Badge variant="muted">{settings().settings.settlementCurrency}</Badge>
                  </div>
                  <div class="settings-row">
                    <span>{copy().defaultRentAmount}</span>
                    <strong>
                      {minorToMajorString(BigInt(settings().settings.rentAmountMinor ?? '0'))}{' '}
                      {settings().settings.rentCurrency}
                    </strong>
                  </div>
                  <div class="settings-row">
                    <span>{copy().timezone}</span>
                    <Badge variant="muted">{settings().settings.timezone}</Badge>
                  </div>
                  <Button variant="secondary" onClick={() => setBillingEditorOpen(true)}>
                    {copy().manageSettingsAction}
                  </Button>
                </div>
              )}
            </Show>
          </Card>
        </Collapsible>

        {/* Billing cycle */}
        <Collapsible title={copy().billingCycleTitle}>
          <Card>
            <Show
              when={cycleState()?.cycle}
              fallback={<p class="empty-state">{copy().billingCycleEmpty}</p>}
            >
              {(cycle) => (
                <div class="settings-billing-summary">
                  <div class="settings-row">
                    <span>{copy().billingCyclePeriod}</span>
                    <Badge variant="accent">{cycle().period}</Badge>
                  </div>
                  <div class="settings-row">
                    <span>{copy().currencyLabel}</span>
                    <Badge variant="muted">{cycle().currency}</Badge>
                  </div>
                </div>
              )}
            </Show>
          </Card>
        </Collapsible>

        {/* Pending members */}
        <Collapsible title={copy().pendingMembersTitle} body={copy().pendingMembersBody}>
          <Show
            when={pendingMembers().length > 0}
            fallback={<p class="empty-state">{copy().pendingMembersEmpty}</p>}
          >
            <div class="pending-list">
              <For each={pendingMembers()}>
                {(member) => (
                  <Card>
                    <div class="pending-member-row">
                      <div>
                        <strong>{member.displayName}</strong>
                        <Show when={member.username}>
                          {(username) => (
                            <span class="pending-member-row__handle">@{username()}</span>
                          )}
                        </Show>
                      </div>
                      <div class="pending-member-actions">
                        <Button
                          variant="ghost"
                          size="sm"
                          loading={rejectingId() === member.telegramUserId}
                          disabled={approvingId() === member.telegramUserId}
                          onClick={() => void handleReject(member.telegramUserId)}
                        >
                          {rejectingId() === member.telegramUserId
                            ? copy().rejectingMember
                            : copy().rejectMemberAction}
                        </Button>
                        <Button
                          variant="primary"
                          size="sm"
                          loading={approvingId() === member.telegramUserId}
                          disabled={rejectingId() === member.telegramUserId}
                          onClick={() => void handleApprove(member.telegramUserId)}
                        >
                          {approvingId() === member.telegramUserId
                            ? copy().approvingMember
                            : copy().approveMemberAction}
                        </Button>
                      </div>
                    </div>
                  </Card>
                )}
              </For>
            </div>
          </Show>
        </Collapsible>

        {/* Members */}
        <Collapsible title={copy().houseSectionMembers} body={copy().membersBody}>
          <Show when={adminSettings()?.members}>
            {(members) => (
              <div class="members-list">
                <For each={members()}>
                  {(member) => (
                    <Card>
                      <div
                        class="member-row interactive"
                        style={{ cursor: 'pointer' }}
                        onClick={() => openEditMember(member)}
                      >
                        <div class="member-row__info">
                          <strong>{member.displayName}</strong>
                          <div class="member-row__badges">
                            <Badge variant={member.isAdmin ? 'accent' : 'muted'}>
                              {member.isAdmin ? copy().adminTag : copy().residentTag}
                            </Badge>
                            <Badge variant="muted">
                              {member.status === 'active'
                                ? copy().memberStatusActive
                                : member.status === 'away'
                                  ? copy().memberStatusAway
                                  : copy().memberStatusLeft}
                            </Badge>
                          </div>
                        </div>
                        <div class="member-row__weight">
                          <span>
                            {copy().rentWeightLabel}: {member.rentShareWeight}
                          </span>
                        </div>
                      </div>
                    </Card>
                  )}
                </For>
              </div>
            )}
          </Show>
        </Collapsible>

        {/* Topic bindings */}
        <Collapsible title={copy().houseSectionTopics} body={copy().topicBindingsBody}>
          <Show when={adminSettings()?.topics}>
            {(topics) => (
              <div class="topics-list">
                <For each={topics()}>
                  {(topic) => {
                    const roleLabel = () => {
                      const labels: Record<string, string> = {
                        purchase: copy().topicPurchase,
                        feedback: copy().topicFeedback,
                        reminders: copy().topicReminders,
                        payments: copy().topicPayments
                      }
                      return labels[topic.role] ?? topic.role
                    }
                    return (
                      <div class="topic-row">
                        <span>{roleLabel()}</span>
                        <Badge variant={topic.telegramThreadId ? 'accent' : 'muted'}>
                          {topic.telegramThreadId ? copy().topicBound : copy().topicUnbound}
                        </Badge>
                      </div>
                    )
                  }}
                </For>
              </div>
            )}
          </Show>
        </Collapsible>
      </Show>

      {/* ── Billing Settings Editor Modal ────────────── */}
      <Modal
        open={billingEditorOpen()}
        title={copy().billingSettingsTitle}
        description={copy().billingSettingsEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setBillingEditorOpen(false)}
        footer={
          <div class="modal-action-row">
            <Button variant="ghost" onClick={() => setBillingEditorOpen(false)}>
              {copy().closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={savingSettings()}
              onClick={() => void handleSaveSettings()}
            >
              {savingSettings() ? copy().savingSettings : copy().saveSettingsAction}
            </Button>
          </div>
        }
      >
        <div class="editor-grid">
          <Field label={copy().householdNameLabel} hint={copy().householdNameHint} wide>
            <Input
              value={billingForm().householdName}
              onInput={(e) =>
                setBillingForm((f) => ({ ...f, householdName: e.currentTarget.value }))
              }
            />
          </Field>
          <Field label={copy().settlementCurrency}>
            <Select
              value={billingForm().settlementCurrency}
              ariaLabel={copy().settlementCurrency}
              options={[
                { value: 'GEL', label: 'GEL' },
                { value: 'USD', label: 'USD' }
              ]}
              onChange={(value) =>
                setBillingForm((f) => ({ ...f, settlementCurrency: value as 'USD' | 'GEL' }))
              }
            />
          </Field>
          <Field label={copy().defaultRentAmount}>
            <Input
              type="number"
              value={billingForm().rentAmountMajor}
              onInput={(e) =>
                setBillingForm((f) => ({ ...f, rentAmountMajor: e.currentTarget.value }))
              }
            />
          </Field>
          <Field label={copy().timezone} hint={copy().timezoneHint}>
            <Input
              value={billingForm().timezone}
              onInput={(e) => setBillingForm((f) => ({ ...f, timezone: e.currentTarget.value }))}
            />
          </Field>
          <Field label={copy().assistantToneLabel} hint={copy().assistantTonePlaceholder}>
            <Input
              value={billingForm().assistantTone}
              onInput={(e) =>
                setBillingForm((f) => ({ ...f, assistantTone: e.currentTarget.value }))
              }
            />
          </Field>
          <Field label={copy().assistantContextLabel} wide>
            <Textarea
              value={billingForm().assistantContext}
              placeholder={copy().assistantContextPlaceholder}
              onInput={(e) =>
                setBillingForm((f) => ({ ...f, assistantContext: e.currentTarget.value }))
              }
            />
          </Field>
        </div>
      </Modal>

      {/* ── Member Editor Modal ────────────── */}
      <Modal
        open={!!editMemberId()}
        title={copy().inspectMemberTitle}
        description={copy().memberEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setEditMemberId(null)}
        footer={
          <div class="modal-action-row">
            <Button variant="ghost" onClick={() => setEditMemberId(null)}>
              {copy().closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={savingMember()}
              onClick={() => void handleSaveMember()}
            >
              {copy().saveMemberChangesAction}
            </Button>
          </div>
        }
      >
        <div class="editor-grid">
          <Field label={copy().displayNameLabel} wide>
            <Input
              value={editMemberForm().displayName}
              onInput={(e) =>
                setEditMemberForm((f) => ({ ...f, displayName: e.currentTarget.value }))
              }
            />
          </Field>
          <Field label={copy().rentWeightLabel}>
            <Input
              type="number"
              step="0.1"
              value={String(editMemberForm().rentShareWeight)}
              onInput={(e) =>
                setEditMemberForm((f) => ({
                  ...f,
                  rentShareWeight: parseFloat(e.currentTarget.value) || 0
                }))
              }
            />
          </Field>
          <Field label={copy().memberStatusLabel}>
            <Select
              value={editMemberForm().status}
              ariaLabel={copy().memberStatusLabel}
              options={[
                { value: 'active', label: copy().memberStatusActive },
                { value: 'away', label: copy().memberStatusAway },
                { value: 'left', label: copy().memberStatusLeft }
              ]}
              onChange={(value) =>
                setEditMemberForm((f) => ({ ...f, status: value as 'active' | 'away' | 'left' }))
              }
            />
          </Field>
          <Show when={!editMemberForm().isAdmin}>
            <Field label="Admin Access">
              <Button
                variant="secondary"
                onClick={() => setEditMemberForm((f) => ({ ...f, isAdmin: true }))}
              >
                {copy().promoteAdminAction}
              </Button>
            </Field>
          </Show>
        </div>
      </Modal>

      {/* ── Own Profile Editor Modal ───────── */}
      <Modal
        open={profileEditorOpen()}
        title={copy().displayNameLabel}
        description={copy().profileEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setProfileEditorOpen(false)}
        footer={
          <div class="modal-action-row modal-action-row--single">
            <Button variant="ghost" onClick={() => setProfileEditorOpen(false)}>
              {copy().closeEditorAction}
            </Button>
            <Button
              variant="primary"
              disabled={
                savingOwnDisplayName() ||
                displayNameDraft().trim().length < 2 ||
                displayNameDraft().trim() === readySession()?.member.displayName
              }
              loading={savingOwnDisplayName()}
              onClick={async () => {
                await handleSaveOwnDisplayName()
                setProfileEditorOpen(false)
              }}
            >
              {savingOwnDisplayName() ? copy().savingDisplayName : copy().saveDisplayName}
            </Button>
          </div>
        }
      >
        <div class="editor-grid">
          <Field label={copy().displayNameLabel} hint={copy().displayNameHint} wide>
            <Input
              value={displayNameDraft()}
              onInput={(event) => setDisplayNameDraft(event.currentTarget.value)}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

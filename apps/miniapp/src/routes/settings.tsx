import { Show, For, Index, createSignal } from 'solid-js'
import { ArrowLeft, Globe, Plus, User } from 'lucide-solid'
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
  demoteMiniAppMember,
  promoteMiniAppMember,
  approveMiniAppPendingMember,
  rejectMiniAppPendingMember,
  upsertMiniAppUtilityCategory,
  type MiniAppUtilityCategory
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

  // ── Utility categories ───────────────────────────
  const [categoryEditorOpen, setCategoryEditorOpen] = createSignal(false)
  const [editingCategorySlug, setEditingCategorySlug] = createSignal<string | null>(null)
  const [savingCategory, setSavingCategory] = createSignal(false)
  const [categoryForm, setCategoryForm] = createSignal({
    name: '',
    sortOrder: 0,
    isActive: true
  })

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
    rentPaymentDestinations: [...(adminSettings()?.settings.rentPaymentDestinations ?? [])],
    assistantContext: adminSettings()?.assistantConfig?.assistantContext ?? '',
    assistantTone: adminSettings()?.assistantConfig?.assistantTone ?? ''
  })

  function openBillingEditor() {
    const settings = adminSettings()
    if (settings) {
      setBillingForm({
        householdName: settings.householdName ?? '',
        settlementCurrency: settings.settings.settlementCurrency ?? 'GEL',
        paymentBalanceAdjustmentPolicy:
          settings.settings.paymentBalanceAdjustmentPolicy ?? 'utilities',
        rentAmountMajor: minorToMajorString(BigInt(settings.settings.rentAmountMinor ?? '0')),
        rentCurrency: settings.settings.rentCurrency ?? 'USD',
        rentDueDay: settings.settings.rentDueDay ?? 20,
        rentWarningDay: settings.settings.rentWarningDay ?? 17,
        utilitiesDueDay: settings.settings.utilitiesDueDay ?? 4,
        utilitiesReminderDay: settings.settings.utilitiesReminderDay ?? 3,
        timezone: settings.settings.timezone ?? 'Asia/Tbilisi',
        rentPaymentDestinations: [...(settings.settings.rentPaymentDestinations ?? [])],
        assistantContext: settings.assistantConfig?.assistantContext ?? '',
        assistantTone: settings.assistantConfig?.assistantTone ?? ''
      })
    }
    setBillingEditorOpen(true)
  }

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

  // ── Utility Category Editing ─────────────────────
  function openAddCategory() {
    setEditingCategorySlug(null)
    setCategoryForm({
      name: '',
      sortOrder: adminSettings()?.categories.length ?? 0,
      isActive: true
    })
    setCategoryEditorOpen(true)
  }

  function openEditCategory(category: MiniAppUtilityCategory) {
    setEditingCategorySlug(category.slug)
    setCategoryForm({
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive
    })
    setCategoryEditorOpen(true)
  }

  async function handleSaveCategory() {
    const data = initData()
    if (!data) return

    setSavingCategory(true)
    try {
      const form = categoryForm()
      const slug = editingCategorySlug()
      const category = await upsertMiniAppUtilityCategory(data, {
        ...(slug ? { slug } : {}),
        name: form.name,
        sortOrder: form.sortOrder,
        isActive: form.isActive
      })

      // Update local state
      setAdminSettings((prev) => {
        if (!prev) return prev
        const existing = prev.categories.find((c) => c.slug === category.slug)
        if (existing) {
          return {
            ...prev,
            categories: prev.categories.map((c) => (c.slug === category.slug ? category : c))
          }
        }
        return { ...prev, categories: [...prev.categories, category] }
      })
      setCategoryEditorOpen(false)
    } finally {
      setSavingCategory(false)
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
      // Remove admin access if requested and currently admin
      if (!form.isAdmin && currentMember.isAdmin) {
        updatedMember = await demoteMiniAppMember(data, memberId)
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
                  <Button variant="secondary" onClick={openBillingEditor}>
                    {copy().manageSettingsAction}
                  </Button>
                </div>
              )}
            </Show>
          </Card>
        </Collapsible>

        {/* Utility Categories */}
        <Collapsible title={copy().utilityCategoriesTitle} body={copy().utilityCategoriesBody}>
          <div class="editable-list-actions">
            <Button variant="primary" size="sm" onClick={() => openAddCategory()}>
              <Plus size={14} />
              {copy().addCategoryAction}
            </Button>
          </div>
          <Show
            when={adminSettings()?.categories}
            fallback={<p class="empty-state">{copy().utilityCategoriesBody}</p>}
          >
            {(categories) => (
              <Show
                when={categories().length > 0}
                fallback={<p class="empty-state">{copy().utilityCategoriesBody}</p>}
              >
                <div class="editable-list">
                  <For each={categories()}>
                    {(category) => (
                      <button class="editable-list-row" onClick={() => openEditCategory(category)}>
                        <div class="editable-list-row__main">
                          <span class="editable-list-row__title">{category.name}</span>
                        </div>
                        <Badge variant={category.isActive ? 'accent' : 'muted'}>
                          {category.isActive ? copy().onLabel : copy().offLabel}
                        </Badge>
                      </button>
                    )}
                  </For>
                </div>
              </Show>
            )}
          </Show>
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
            <div class="editable-list">
              <For each={pendingMembers()}>
                {(member) => (
                  <div class="editable-list-row">
                    <div class="editable-list-row__main">
                      <span class="editable-list-row__title">{member.displayName}</span>
                      <Show when={member.username}>
                        {(username) => (
                          <span class="editable-list-row__subtitle">@{username()}</span>
                        )}
                      </Show>
                    </div>
                    <div class="editable-list-row__meta">
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
                )}
              </For>
            </div>
          </Show>
        </Collapsible>

        {/* Members */}
        <Collapsible title={copy().houseSectionMembers} body={copy().membersBody}>
          <Show when={adminSettings()?.members}>
            {(members) => (
              <div class="editable-list">
                <For each={members()}>
                  {(member) => (
                    <button class="editable-list-row" onClick={() => openEditMember(member)}>
                      <div class="editable-list-row__main">
                        <span class="editable-list-row__title">{member.displayName}</span>
                        <span class="editable-list-row__subtitle">
                          {copy().rentWeightLabel}: {member.rentShareWeight}
                        </span>
                      </div>
                      <div class="editable-list-row__meta">
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
                    </button>
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
              <div class="editable-list">
                <For each={topics()}>
                  {(topic) => {
                    const roleLabel = () => {
                      const labels: Record<string, string> = {
                        chat: copy().topicChat,
                        purchase: copy().topicPurchase,
                        feedback: copy().topicFeedback,
                        reminders: copy().topicReminders,
                        payments: copy().topicPayments
                      }
                      return labels[topic.role] ?? topic.role
                    }
                    return (
                      <div class="editable-list-row">
                        <div class="editable-list-row__main">
                          <span class="editable-list-row__title">{roleLabel()}</span>
                        </div>
                        <div class="editable-list-row__meta">
                          <Badge variant={topic.telegramThreadId ? 'accent' : 'muted'}>
                            {topic.telegramThreadId ? copy().topicBound : copy().topicUnbound}
                          </Badge>
                        </div>
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
          <Field label={copy().rentCurrencyLabel}>
            <Select
              value={billingForm().rentCurrency}
              ariaLabel={copy().rentCurrencyLabel}
              options={[
                { value: 'USD', label: 'USD' },
                { value: 'GEL', label: 'GEL' }
              ]}
              onChange={(value) =>
                setBillingForm((f) => ({ ...f, rentCurrency: value as 'USD' | 'GEL' }))
              }
            />
          </Field>
          <Field label={copy().paymentBalanceAdjustmentPolicy}>
            <Select
              value={billingForm().paymentBalanceAdjustmentPolicy}
              ariaLabel={copy().paymentBalanceAdjustmentPolicy}
              options={[
                { value: 'utilities', label: copy().paymentBalanceAdjustmentUtilities },
                { value: 'rent', label: copy().paymentBalanceAdjustmentRent },
                { value: 'separate', label: copy().paymentBalanceAdjustmentSeparate }
              ]}
              onChange={(value) =>
                setBillingForm((f) => ({
                  ...f,
                  paymentBalanceAdjustmentPolicy: value as 'utilities' | 'rent' | 'separate'
                }))
              }
            />
          </Field>
          <Field label={copy().rentWarningDay}>
            <Input
              type="number"
              value={String(billingForm().rentWarningDay)}
              onInput={(e) =>
                setBillingForm((f) => ({
                  ...f,
                  rentWarningDay: Number(e.currentTarget.value) || 0
                }))
              }
            />
          </Field>
          <Field label={copy().rentDueDay}>
            <Input
              type="number"
              value={String(billingForm().rentDueDay)}
              onInput={(e) =>
                setBillingForm((f) => ({ ...f, rentDueDay: Number(e.currentTarget.value) || 0 }))
              }
            />
          </Field>
          <Field label={copy().utilitiesReminderDay}>
            <Input
              type="number"
              value={String(billingForm().utilitiesReminderDay)}
              onInput={(e) =>
                setBillingForm((f) => ({
                  ...f,
                  utilitiesReminderDay: Number(e.currentTarget.value) || 0
                }))
              }
            />
          </Field>
          <Field label={copy().utilitiesDueDay}>
            <Input
              type="number"
              value={String(billingForm().utilitiesDueDay)}
              onInput={(e) =>
                setBillingForm((f) => ({
                  ...f,
                  utilitiesDueDay: Number(e.currentTarget.value) || 0
                }))
              }
            />
          </Field>
          <Field label={copy().timezone} hint={copy().timezoneHint}>
            <Input
              value={billingForm().timezone}
              onInput={(e) => setBillingForm((f) => ({ ...f, timezone: e.currentTarget.value }))}
            />
          </Field>
          <Field label={copy().rentPaymentDestinationsTitle} wide>
            <div style={{ display: 'grid', gap: '12px' }}>
              <Show
                when={billingForm().rentPaymentDestinations.length > 0}
                fallback={<p class="empty-state">{copy().rentPaymentDestinationsEmpty}</p>}
              >
                <div style={{ display: 'grid', gap: '12px' }}>
                  <Index each={billingForm().rentPaymentDestinations}>
                    {(destination, index) => (
                      <Card muted wide>
                        <div class="editor-grid">
                          <Field label={copy().rentPaymentDestinationLabel} wide>
                            <Input
                              value={destination().label}
                              onInput={(e) =>
                                setBillingForm((f) => {
                                  const next = [...f.rentPaymentDestinations]
                                  next[index] = {
                                    ...next[index]!,
                                    label: e.currentTarget.value
                                  }
                                  return { ...f, rentPaymentDestinations: next }
                                })
                              }
                            />
                          </Field>
                          <Field label={copy().rentPaymentDestinationRecipient} wide>
                            <Input
                              value={destination().recipientName ?? ''}
                              onInput={(e) =>
                                setBillingForm((f) => {
                                  const next = [...f.rentPaymentDestinations]
                                  next[index] = {
                                    ...next[index]!,
                                    recipientName: e.currentTarget.value || null
                                  }
                                  return { ...f, rentPaymentDestinations: next }
                                })
                              }
                            />
                          </Field>
                          <Field label={copy().rentPaymentDestinationBank} wide>
                            <Input
                              value={destination().bankName ?? ''}
                              onInput={(e) =>
                                setBillingForm((f) => {
                                  const next = [...f.rentPaymentDestinations]
                                  next[index] = {
                                    ...next[index]!,
                                    bankName: e.currentTarget.value || null
                                  }
                                  return { ...f, rentPaymentDestinations: next }
                                })
                              }
                            />
                          </Field>
                          <Field label={copy().rentPaymentDestinationAccount} wide>
                            <Input
                              value={destination().account}
                              onInput={(e) =>
                                setBillingForm((f) => {
                                  const next = [...f.rentPaymentDestinations]
                                  next[index] = {
                                    ...next[index]!,
                                    account: e.currentTarget.value
                                  }
                                  return { ...f, rentPaymentDestinations: next }
                                })
                              }
                            />
                          </Field>
                          <Field label={copy().rentPaymentDestinationLink} wide>
                            <Input
                              value={destination().link ?? ''}
                              onInput={(e) =>
                                setBillingForm((f) => {
                                  const next = [...f.rentPaymentDestinations]
                                  next[index] = {
                                    ...next[index]!,
                                    link: e.currentTarget.value || null
                                  }
                                  return { ...f, rentPaymentDestinations: next }
                                })
                              }
                            />
                          </Field>
                          <Field label={copy().rentPaymentDestinationNote} wide>
                            <Textarea
                              value={destination().note ?? ''}
                              onInput={(e) =>
                                setBillingForm((f) => {
                                  const next = [...f.rentPaymentDestinations]
                                  next[index] = {
                                    ...next[index]!,
                                    note: e.currentTarget.value || null
                                  }
                                  return { ...f, rentPaymentDestinations: next }
                                })
                              }
                            />
                          </Field>
                          <div style={{ display: 'flex', 'justify-content': 'flex-end' }}>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setBillingForm((f) => ({
                                  ...f,
                                  rentPaymentDestinations: f.rentPaymentDestinations.filter(
                                    (_, idx) => idx !== index
                                  )
                                }))
                              }
                            >
                              {copy().rentPaymentDestinationRemoveAction}
                            </Button>
                          </div>
                        </div>
                      </Card>
                    )}
                  </Index>
                </div>
              </Show>
              <div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setBillingForm((f) => ({
                      ...f,
                      rentPaymentDestinations: [
                        ...f.rentPaymentDestinations,
                        {
                          label: '',
                          recipientName: null,
                          bankName: null,
                          account: '',
                          note: null,
                          link: null
                        }
                      ]
                    }))
                  }
                >
                  {copy().rentPaymentDestinationAddAction}
                </Button>
              </div>
            </div>
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
          <Field label={copy().memberRoleLabel}>
            <Select
              value={editMemberForm().isAdmin ? 'admin' : 'resident'}
              ariaLabel={copy().memberRoleLabel}
              options={[
                { value: 'resident', label: copy().memberRoleResident },
                { value: 'admin', label: copy().memberRoleAdmin }
              ]}
              onChange={(value) => setEditMemberForm((f) => ({ ...f, isAdmin: value === 'admin' }))}
            />
          </Field>
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

      {/* ── Category Editor Modal ────────────── */}
      <Modal
        open={categoryEditorOpen()}
        title={editingCategorySlug() ? copy().editCategoryAction : copy().addCategoryAction}
        description={editingCategorySlug() ? copy().categoryEditorBody : copy().categoryCreateBody}
        closeLabel={copy().closeEditorAction}
        onClose={() => setCategoryEditorOpen(false)}
        footer={
          <div class="modal-action-row">
            <Button variant="ghost" onClick={() => setCategoryEditorOpen(false)}>
              {copy().closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={savingCategory()}
              disabled={categoryForm().name.trim().length < 1}
              onClick={() => void handleSaveCategory()}
            >
              {savingCategory() ? copy().savingCategory : copy().saveCategoryAction}
            </Button>
          </div>
        }
      >
        <div class="editor-grid">
          <Field label={copy().utilityCategoryName} wide>
            <Input
              value={categoryForm().name}
              onInput={(e) => setCategoryForm((f) => ({ ...f, name: e.currentTarget.value }))}
            />
          </Field>
          <Field label={copy().utilityCategoryActive}>
            <Select
              value={categoryForm().isActive ? 'true' : 'false'}
              ariaLabel={copy().utilityCategoryActive}
              options={[
                { value: 'true', label: copy().onLabel },
                { value: 'false', label: copy().offLabel }
              ]}
              onChange={(value) => setCategoryForm((f) => ({ ...f, isActive: value === 'true' }))}
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

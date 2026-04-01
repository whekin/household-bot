import { Show, For, Index, createEffect, createMemo, createSignal } from 'solid-js'
import { ArrowLeft, Globe, Plus, User } from 'lucide-solid'
import { useNavigate } from '@solidjs/router'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { formatCyclePeriod } from '../lib/dates'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { CurrencyToggle } from '../components/ui/currency-toggle'
import { Select } from '../components/ui/select'
import { Input, Textarea } from '../components/ui/input'
import { Modal } from '../components/ui/dialog'
import { Collapsible } from '../components/ui/collapsible'
import { Field } from '../components/ui/field'
import { Toggle } from '../components/ui/toggle'
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

const NEW_CATEGORY_SLUG = '__new__'

type BillingFormState = {
  householdName: string
  settlementCurrency: 'USD' | 'GEL'
  paymentBalanceAdjustmentPolicy: 'utilities' | 'rent' | 'separate'
  rentAmountMajor: string
  rentCurrency: 'USD' | 'GEL'
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  timezone: string
  rentPaymentDestinations: {
    label: string
    recipientName: string | null
    bankName: string | null
    account: string
    note: string | null
    link: string | null
  }[]
  assistantContext: string
  assistantTone: string
}

function truncateValue(value: string | null | undefined, maxLength = 40): string {
  const normalized = value?.trim() ?? ''
  if (!normalized) return '—'
  if (normalized.length <= maxLength) return normalized
  return `${normalized.slice(0, maxLength - 1)}…`
}

export default function SettingsRoute() {
  const navigate = useNavigate()
  const {
    readySession,
    initData,
    refreshHouseholdData,
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

  const [profileEditing, setProfileEditing] = createSignal(false)
  const [billingEditing, setBillingEditing] = createSignal(false)
  const [editingCategorySlug, setEditingCategorySlug] = createSignal<string | null>(null)
  const [savingCategory, setSavingCategory] = createSignal(false)
  const [categoryForm, setCategoryForm] = createSignal({
    name: '',
    sortOrder: 0,
    isActive: true
  })
  const [savingSettings, setSavingSettings] = createSignal(false)
  const [billingForm, setBillingForm] = createSignal<BillingFormState>({
    householdName: '',
    settlementCurrency: 'GEL',
    paymentBalanceAdjustmentPolicy: 'utilities',
    rentAmountMajor: '',
    rentCurrency: 'USD',
    rentDueDay: 20,
    rentWarningDay: 17,
    utilitiesDueDay: 4,
    utilitiesReminderDay: 3,
    timezone: 'Asia/Tbilisi',
    rentPaymentDestinations: [],
    assistantContext: '',
    assistantTone: ''
  })

  const [approvingId, setApprovingId] = createSignal<string | null>(null)
  const [rejectingId, setRejectingId] = createSignal<string | null>(null)

  const [editMemberId, setEditMemberId] = createSignal<string | null>(null)
  const [savingMember, setSavingMember] = createSignal(false)
  const [editMemberForm, setEditMemberForm] = createSignal({
    displayName: '',
    rentShareWeight: 1,
    status: 'active' as 'active' | 'away' | 'left',
    isAdmin: false
  })

  function buildBillingFormValue(): BillingFormState {
    const settings = adminSettings()
    return {
      householdName: settings?.householdName ?? '',
      settlementCurrency: (settings?.settings.settlementCurrency ?? 'GEL') as 'USD' | 'GEL',
      paymentBalanceAdjustmentPolicy: (settings?.settings.paymentBalanceAdjustmentPolicy ??
        'utilities') as 'utilities' | 'rent' | 'separate',
      rentAmountMajor: settings
        ? minorToMajorString(BigInt(settings.settings.rentAmountMinor ?? '0'))
        : '',
      rentCurrency: (settings?.settings.rentCurrency ?? 'USD') as 'USD' | 'GEL',
      rentDueDay: settings?.settings.rentDueDay ?? 20,
      rentWarningDay: settings?.settings.rentWarningDay ?? 17,
      utilitiesDueDay: settings?.settings.utilitiesDueDay ?? 4,
      utilitiesReminderDay: settings?.settings.utilitiesReminderDay ?? 3,
      timezone: settings?.settings.timezone ?? 'Asia/Tbilisi',
      rentPaymentDestinations: [...(settings?.settings.rentPaymentDestinations ?? [])],
      assistantContext: settings?.assistantConfig?.assistantContext ?? '',
      assistantTone: settings?.assistantConfig?.assistantTone ?? ''
    }
  }

  const sortedCategories = createMemo(() =>
    [...(adminSettings()?.categories ?? [])].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
    )
  )

  createEffect(() => {
    const member = readySession()?.member
    if (!member || profileEditing()) return
    setDisplayNameDraft(member.displayName)
  })

  createEffect(() => {
    if (billingEditing()) return
    setBillingForm(buildBillingFormValue())
  })

  function openProfileEditor() {
    setDisplayNameDraft(readySession()?.member.displayName ?? '')
    setProfileEditing(true)
  }

  function closeProfileEditor() {
    setDisplayNameDraft(readySession()?.member.displayName ?? '')
    setProfileEditing(false)
  }

  function openBillingEditor() {
    setBillingForm(buildBillingFormValue())
    setBillingEditing(true)
  }

  function closeBillingEditor() {
    setBillingForm(buildBillingFormValue())
    setBillingEditing(false)
  }

  function billingPolicyLabel(policy: 'utilities' | 'rent' | 'separate') {
    if (policy === 'rent') return copy().paymentBalanceAdjustmentRent
    if (policy === 'separate') return copy().paymentBalanceAdjustmentSeparate
    return copy().paymentBalanceAdjustmentUtilities
  }

  function openAddCategory() {
    setEditingCategorySlug(NEW_CATEGORY_SLUG)
    setCategoryForm({
      name: '',
      sortOrder: sortedCategories().length,
      isActive: true
    })
  }

  function openEditCategory(category: MiniAppUtilityCategory) {
    setEditingCategorySlug(category.slug)
    setCategoryForm({
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive
    })
  }

  function closeCategoryEditor() {
    setEditingCategorySlug(null)
    setCategoryForm({
      name: '',
      sortOrder: 0,
      isActive: true
    })
  }

  async function handleApprove(telegramUserId: string) {
    const data = initData()
    if (!data || approvingId()) return

    setApprovingId(telegramUserId)
    try {
      await approveMiniAppPendingMember(data, telegramUserId)
      setPendingMembers((prev) => prev.filter((member) => member.telegramUserId !== telegramUserId))
      await refreshHouseholdData(true, true)
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
      setPendingMembers((prev) => prev.filter((member) => member.telegramUserId !== telegramUserId))
      await refreshHouseholdData(true, true)
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
      setBillingEditing(false)
      await refreshHouseholdData(true, true)
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleSaveCategory() {
    const data = initData()
    const currentSlug = editingCategorySlug()
    if (!data || !currentSlug) return

    setSavingCategory(true)
    try {
      const form = categoryForm()
      const category = await upsertMiniAppUtilityCategory(data, {
        ...(currentSlug !== NEW_CATEGORY_SLUG ? { slug: currentSlug } : {}),
        name: form.name,
        sortOrder: form.sortOrder,
        isActive: form.isActive
      })

      setAdminSettings((prev) => {
        if (!prev) return prev
        const existing = prev.categories.find((item) => item.slug === category.slug)
        if (existing) {
          return {
            ...prev,
            categories: prev.categories.map((item) =>
              item.slug === category.slug ? category : item
            )
          }
        }
        return { ...prev, categories: [...prev.categories, category] }
      })

      closeCategoryEditor()
      await refreshHouseholdData(true, true)
    } finally {
      setSavingCategory(false)
    }
  }

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
      const currentMember = settings.members.find((member) => member.id === memberId)
      if (!currentMember) return

      let updatedMember = currentMember

      if (form.displayName !== currentMember.displayName) {
        updatedMember = await updateMiniAppMemberDisplayName(data, memberId, form.displayName)
      }
      if (form.rentShareWeight !== currentMember.rentShareWeight) {
        updatedMember = await updateMiniAppMemberRentWeight(data, memberId, form.rentShareWeight)
      }
      if (form.status !== currentMember.status) {
        updatedMember = await updateMiniAppMemberStatus(data, memberId, form.status)
      }
      if (form.isAdmin && !currentMember.isAdmin) {
        updatedMember = await promoteMiniAppMember(data, memberId)
      }
      if (!form.isAdmin && currentMember.isAdmin) {
        updatedMember = await demoteMiniAppMember(data, memberId)
      }

      setAdminSettings((prev) => {
        if (!prev) return prev
        return {
          ...prev,
          members: prev.members.map((member) => (member.id === memberId ? updatedMember : member))
        }
      })
      setEditMemberId(null)
      await refreshHouseholdData(true, true)
    } finally {
      setSavingMember(false)
    }
  }

  return (
    <div class="route route--settings">
      <div class="settings-header">
        <Button variant="ghost" size="sm" class="ui-button--very-left" onClick={() => navigate(-1)}>
          <ArrowLeft size={16} />
          {copy().closeEditorAction}
        </Button>
        <h2>{effectiveIsAdmin() ? copy().householdSettingsTitle : copy().residentHouseTitle}</h2>
        <p>{effectiveIsAdmin() ? copy().householdSettingsBody : copy().residentHouseBody}</p>
      </div>

      <Card class="settings-section">
        <div class="statement-section-heading">
          <div>
            <strong>{copy().houseSectionGeneral}</strong>
            <p>{copy().generalSettingsBody}</p>
          </div>
        </div>

        <div class="settings-section__body">
          <div class="settings-inline-item">
            <div class="settings-detail-row">
              <div class="settings-detail-row__icon">
                <User size={16} />
              </div>
              <div class="settings-detail-row__copy">
                <span class="settings-profile__label">{copy().displayNameLabel}</span>
                <strong>{readySession()?.member.displayName ?? '—'}</strong>
              </div>
              <Show when={!profileEditing()}>
                <Button variant="ghost" size="sm" onClick={openProfileEditor}>
                  {copy().manageProfileAction}
                </Button>
              </Show>
            </div>

            <Show when={profileEditing()}>
              <div class="settings-inline-editor">
                <Field label={copy().displayNameLabel} hint={copy().displayNameHint} wide>
                  <Input
                    value={displayNameDraft()}
                    onInput={(event) => setDisplayNameDraft(event.currentTarget.value)}
                  />
                </Field>
                <div class="settings-inline-editor__actions">
                  <Button variant="ghost" onClick={closeProfileEditor}>
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
                      setProfileEditing(false)
                    }}
                  >
                    {savingOwnDisplayName() ? copy().savingDisplayName : copy().saveDisplayName}
                  </Button>
                </div>
              </div>
            </Show>
          </div>

          <div class="settings-inline-item">
            <div class="settings-detail-row">
              <div class="settings-detail-row__icon">
                <Globe size={16} />
              </div>
              <div class="settings-detail-row__copy">
                <span class="settings-profile__label">{copy().language}</span>
                <strong>{locale() === 'en' ? 'English' : 'Русский'}</strong>
              </div>
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

      <Show when={effectiveIsAdmin()}>
        <Card class="settings-section">
          <div class="statement-section-heading">
            <div>
              <strong>{copy().houseSectionBilling}</strong>
              <p>{copy().billingSettingsEditorBody}</p>
            </div>
            <Show when={!billingEditing()}>
              <Button variant="secondary" size="sm" onClick={openBillingEditor}>
                {copy().manageSettingsAction}
              </Button>
            </Show>
          </div>

          <div class="settings-cycle-strip">
            <div class="settings-cycle-strip__header">
              <strong>{copy().currentCycleLabel}</strong>
              <Show when={cycleState()?.cycle}>
                {(cycle) => (
                  <Badge variant="accent">{formatCyclePeriod(cycle().period, locale())}</Badge>
                )}
              </Show>
            </div>
            <Show
              when={cycleState()?.cycle}
              fallback={<p class="empty-state">{copy().billingCycleOpenHint}</p>}
            >
              {(cycle) => (
                <div class="settings-summary-list">
                  <div class="settings-summary-row">
                    <span>{copy().billingCyclePeriod}</span>
                    <strong>{formatCyclePeriod(cycle().period, locale())}</strong>
                  </div>
                  <div class="settings-summary-row">
                    <span>{copy().currencyLabel}</span>
                    <Badge variant="muted">{cycle().currency}</Badge>
                  </div>
                </div>
              )}
            </Show>
          </div>

          <Show when={adminSettings()}>
            {(settings) => (
              <Show
                when={billingEditing()}
                fallback={
                  <div class="settings-summary-grid">
                    <div class="settings-summary-group">
                      <div class="settings-summary-row">
                        <span>{copy().householdNameLabel}</span>
                        <strong>{settings().householdName}</strong>
                      </div>
                      <div class="settings-summary-row">
                        <span>{copy().settlementCurrency}</span>
                        <Badge variant="muted">{settings().settings.settlementCurrency}</Badge>
                      </div>
                      <div class="settings-summary-row">
                        <span>{copy().timezone}</span>
                        <strong>{settings().settings.timezone}</strong>
                      </div>
                    </div>

                    <div class="settings-summary-group">
                      <div class="settings-summary-row">
                        <span>{copy().defaultRentAmount}</span>
                        <strong>
                          {minorToMajorString(BigInt(settings().settings.rentAmountMinor ?? '0'))}{' '}
                          {settings().settings.rentCurrency}
                        </strong>
                      </div>
                      <div class="settings-summary-row">
                        <span>{copy().rentWarningDay}</span>
                        <strong>{settings().settings.rentWarningDay}</strong>
                      </div>
                      <div class="settings-summary-row">
                        <span>{copy().rentDueDay}</span>
                        <strong>{settings().settings.rentDueDay}</strong>
                      </div>
                    </div>

                    <div class="settings-summary-group">
                      <div class="settings-summary-row">
                        <span>{copy().utilitiesReminderDay}</span>
                        <strong>{settings().settings.utilitiesReminderDay}</strong>
                      </div>
                      <div class="settings-summary-row">
                        <span>{copy().utilitiesDueDay}</span>
                        <strong>{settings().settings.utilitiesDueDay}</strong>
                      </div>
                      <div class="settings-summary-row">
                        <span>{copy().paymentBalanceAdjustmentPolicy}</span>
                        <strong>
                          {billingPolicyLabel(settings().settings.paymentBalanceAdjustmentPolicy)}
                        </strong>
                      </div>
                    </div>

                    <div class="settings-summary-group">
                      <div class="settings-summary-row">
                        <span>{copy().rentPaymentDestinationsTitle}</span>
                        <strong>{settings().settings.rentPaymentDestinations?.length ?? 0}</strong>
                      </div>
                      <div class="settings-summary-row settings-summary-row--stack">
                        <span>{copy().assistantToneLabel}</span>
                        <strong>{truncateValue(settings().assistantConfig?.assistantTone)}</strong>
                      </div>
                      <div class="settings-summary-row settings-summary-row--stack">
                        <span>{copy().assistantContextLabel}</span>
                        <strong>
                          {truncateValue(settings().assistantConfig?.assistantContext, 80)}
                        </strong>
                      </div>
                    </div>
                  </div>
                }
              >
                <div class="settings-form-stack">
                  <div class="settings-form-section">
                    <div class="settings-form-grid">
                      <Field label={copy().householdNameLabel} hint={copy().householdNameHint} wide>
                        <Input
                          value={billingForm().householdName}
                          onInput={(e) =>
                            setBillingForm((form) => ({
                              ...form,
                              householdName: e.currentTarget.value
                            }))
                          }
                        />
                      </Field>
                      <Field label={copy().settlementCurrency}>
                        <CurrencyToggle
                          value={billingForm().settlementCurrency}
                          ariaLabel={copy().settlementCurrency}
                          onChange={(value) =>
                            setBillingForm((form) => ({
                              ...form,
                              settlementCurrency: value
                            }))
                          }
                        />
                      </Field>
                      <Field label={copy().timezone} hint={copy().timezoneHint}>
                        <Input
                          value={billingForm().timezone}
                          onInput={(e) =>
                            setBillingForm((form) => ({ ...form, timezone: e.currentTarget.value }))
                          }
                        />
                      </Field>
                    </div>
                  </div>

                  <div class="settings-form-section">
                    <div class="settings-form-grid settings-form-grid--compact">
                      <Field label={copy().defaultRentAmount}>
                        <Input
                          type="number"
                          value={billingForm().rentAmountMajor}
                          onInput={(e) =>
                            setBillingForm((form) => ({
                              ...form,
                              rentAmountMajor: e.currentTarget.value
                            }))
                          }
                        />
                      </Field>
                      <Field label={copy().rentCurrencyLabel}>
                        <CurrencyToggle
                          value={billingForm().rentCurrency}
                          ariaLabel={copy().rentCurrencyLabel}
                          onChange={(value) =>
                            setBillingForm((form) => ({ ...form, rentCurrency: value }))
                          }
                        />
                      </Field>
                      <Field label={copy().rentWarningDay}>
                        <Input
                          type="number"
                          value={String(billingForm().rentWarningDay)}
                          onInput={(e) =>
                            setBillingForm((form) => ({
                              ...form,
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
                            setBillingForm((form) => ({
                              ...form,
                              rentDueDay: Number(e.currentTarget.value) || 0
                            }))
                          }
                        />
                      </Field>
                    </div>
                  </div>

                  <div class="settings-form-section">
                    <div class="settings-form-grid settings-form-grid--compact">
                      <Field label={copy().utilitiesReminderDay}>
                        <Input
                          type="number"
                          value={String(billingForm().utilitiesReminderDay)}
                          onInput={(e) =>
                            setBillingForm((form) => ({
                              ...form,
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
                            setBillingForm((form) => ({
                              ...form,
                              utilitiesDueDay: Number(e.currentTarget.value) || 0
                            }))
                          }
                        />
                      </Field>
                      <Field label={copy().paymentBalanceAdjustmentPolicy} wide>
                        <Select
                          value={billingForm().paymentBalanceAdjustmentPolicy}
                          ariaLabel={copy().paymentBalanceAdjustmentPolicy}
                          options={[
                            {
                              value: 'utilities',
                              label: copy().paymentBalanceAdjustmentUtilities
                            },
                            { value: 'rent', label: copy().paymentBalanceAdjustmentRent },
                            {
                              value: 'separate',
                              label: copy().paymentBalanceAdjustmentSeparate
                            }
                          ]}
                          onChange={(value) =>
                            setBillingForm((form) => ({
                              ...form,
                              paymentBalanceAdjustmentPolicy: value as
                                | 'utilities'
                                | 'rent'
                                | 'separate'
                            }))
                          }
                        />
                      </Field>
                    </div>
                  </div>

                  <div class="settings-form-section">
                    <div class="settings-form-section__header">
                      <strong>{copy().rentPaymentDestinationsTitle}</strong>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() =>
                          setBillingForm((form) => ({
                            ...form,
                            rentPaymentDestinations: [
                              ...form.rentPaymentDestinations,
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

                    <Show
                      when={billingForm().rentPaymentDestinations.length > 0}
                      fallback={<p class="empty-state">{copy().rentPaymentDestinationsEmpty}</p>}
                    >
                      <div class="settings-destination-list">
                        <Index each={billingForm().rentPaymentDestinations}>
                          {(destination, index) => (
                            <div class="settings-destination-row">
                              <div class="settings-destination-row__header">
                                <strong>
                                  {destination().label ||
                                    `${copy().rentPaymentDestinationAddAction} ${index + 1}`}
                                </strong>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  onClick={() =>
                                    setBillingForm((form) => ({
                                      ...form,
                                      rentPaymentDestinations: form.rentPaymentDestinations.filter(
                                        (_, currentIndex) => currentIndex !== index
                                      )
                                    }))
                                  }
                                >
                                  {copy().rentPaymentDestinationRemoveAction}
                                </Button>
                              </div>
                              <div class="settings-form-grid">
                                <Field label={copy().rentPaymentDestinationLabel} wide>
                                  <Input
                                    value={destination().label}
                                    onInput={(e) =>
                                      setBillingForm((form) => {
                                        const next = [...form.rentPaymentDestinations]
                                        next[index] = {
                                          ...next[index]!,
                                          label: e.currentTarget.value
                                        }
                                        return { ...form, rentPaymentDestinations: next }
                                      })
                                    }
                                  />
                                </Field>
                                <Field label={copy().rentPaymentDestinationRecipient}>
                                  <Input
                                    value={destination().recipientName ?? ''}
                                    onInput={(e) =>
                                      setBillingForm((form) => {
                                        const next = [...form.rentPaymentDestinations]
                                        next[index] = {
                                          ...next[index]!,
                                          recipientName: e.currentTarget.value || null
                                        }
                                        return { ...form, rentPaymentDestinations: next }
                                      })
                                    }
                                  />
                                </Field>
                                <Field label={copy().rentPaymentDestinationBank}>
                                  <Input
                                    value={destination().bankName ?? ''}
                                    onInput={(e) =>
                                      setBillingForm((form) => {
                                        const next = [...form.rentPaymentDestinations]
                                        next[index] = {
                                          ...next[index]!,
                                          bankName: e.currentTarget.value || null
                                        }
                                        return { ...form, rentPaymentDestinations: next }
                                      })
                                    }
                                  />
                                </Field>
                                <Field label={copy().rentPaymentDestinationAccount} wide>
                                  <Input
                                    value={destination().account}
                                    onInput={(e) =>
                                      setBillingForm((form) => {
                                        const next = [...form.rentPaymentDestinations]
                                        next[index] = {
                                          ...next[index]!,
                                          account: e.currentTarget.value
                                        }
                                        return { ...form, rentPaymentDestinations: next }
                                      })
                                    }
                                  />
                                </Field>
                                <Field label={copy().rentPaymentDestinationLink} wide>
                                  <Input
                                    value={destination().link ?? ''}
                                    onInput={(e) =>
                                      setBillingForm((form) => {
                                        const next = [...form.rentPaymentDestinations]
                                        next[index] = {
                                          ...next[index]!,
                                          link: e.currentTarget.value || null
                                        }
                                        return { ...form, rentPaymentDestinations: next }
                                      })
                                    }
                                  />
                                </Field>
                                <Field label={copy().rentPaymentDestinationNote} wide>
                                  <Textarea
                                    value={destination().note ?? ''}
                                    onInput={(e) =>
                                      setBillingForm((form) => {
                                        const next = [...form.rentPaymentDestinations]
                                        next[index] = {
                                          ...next[index]!,
                                          note: e.currentTarget.value || null
                                        }
                                        return { ...form, rentPaymentDestinations: next }
                                      })
                                    }
                                  />
                                </Field>
                              </div>
                            </div>
                          )}
                        </Index>
                      </div>
                    </Show>
                  </div>

                  <div class="settings-form-section">
                    <div class="settings-form-grid">
                      <Field
                        label={copy().assistantToneLabel}
                        hint={copy().assistantTonePlaceholder}
                      >
                        <Input
                          value={billingForm().assistantTone}
                          onInput={(e) =>
                            setBillingForm((form) => ({
                              ...form,
                              assistantTone: e.currentTarget.value
                            }))
                          }
                        />
                      </Field>
                      <Field label={copy().assistantContextLabel} wide>
                        <Textarea
                          value={billingForm().assistantContext}
                          placeholder={copy().assistantContextPlaceholder}
                          onInput={(e) =>
                            setBillingForm((form) => ({
                              ...form,
                              assistantContext: e.currentTarget.value
                            }))
                          }
                        />
                      </Field>
                    </div>
                  </div>

                  <div class="settings-inline-editor__actions">
                    <Button variant="ghost" onClick={closeBillingEditor}>
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
                </div>
              </Show>
            )}
          </Show>
        </Card>

        <Card class="settings-section">
          <div class="statement-section-heading">
            <div>
              <strong>{copy().utilityCategoriesTitle}</strong>
              <p>{copy().utilityCategoriesBody}</p>
            </div>
            <Button
              variant="primary"
              size="sm"
              disabled={editingCategorySlug() !== null}
              onClick={openAddCategory}
            >
              <Plus size={14} />
              {copy().addCategoryAction}
            </Button>
          </div>

          <div class="settings-section__body">
            <Show when={editingCategorySlug() === NEW_CATEGORY_SLUG}>
              <div class="settings-category-row settings-category-row--editing">
                <div class="settings-form-grid">
                  <Field label={copy().utilityCategoryName} wide>
                    <Input
                      value={categoryForm().name}
                      onInput={(e) =>
                        setCategoryForm((form) => ({ ...form, name: e.currentTarget.value }))
                      }
                    />
                  </Field>
                </div>
                <div class="settings-category-row__controls">
                  <Toggle
                    checked={categoryForm().isActive}
                    label={copy().utilityCategoryActive}
                    onChange={(checked) =>
                      setCategoryForm((form) => ({ ...form, isActive: checked }))
                    }
                  />
                  <div class="settings-inline-editor__actions">
                    <Button variant="ghost" size="sm" onClick={closeCategoryEditor}>
                      {copy().closeEditorAction}
                    </Button>
                    <Button
                      variant="primary"
                      size="sm"
                      loading={savingCategory()}
                      disabled={categoryForm().name.trim().length < 1}
                      onClick={() => void handleSaveCategory()}
                    >
                      {savingCategory() ? copy().savingCategory : copy().saveCategoryAction}
                    </Button>
                  </div>
                </div>
              </div>
            </Show>

            <Show
              when={sortedCategories().length > 0}
              fallback={<p class="empty-state">{copy().utilityCategoriesBody}</p>}
            >
              <div class="settings-category-list">
                <For each={sortedCategories()}>
                  {(category) => (
                    <div class="settings-category-row">
                      <Show
                        when={editingCategorySlug() === category.slug}
                        fallback={
                          <>
                            <div class="settings-category-row__copy">
                              <strong>{category.name}</strong>
                              <span>{copy().utilityCategoryName}</span>
                            </div>
                            <div class="settings-category-row__actions">
                              <Badge variant={category.isActive ? 'accent' : 'muted'}>
                                {category.isActive ? copy().onLabel : copy().offLabel}
                              </Badge>
                              <Button
                                variant="ghost"
                                size="sm"
                                disabled={editingCategorySlug() !== null}
                                onClick={() => openEditCategory(category)}
                              >
                                {copy().editCategoryAction}
                              </Button>
                            </div>
                          </>
                        }
                      >
                        <div class="settings-form-grid">
                          <Field label={copy().utilityCategoryName} wide>
                            <Input
                              value={categoryForm().name}
                              onInput={(e) =>
                                setCategoryForm((form) => ({
                                  ...form,
                                  name: e.currentTarget.value
                                }))
                              }
                            />
                          </Field>
                        </div>
                        <div class="settings-category-row__controls">
                          <Toggle
                            checked={categoryForm().isActive}
                            label={copy().utilityCategoryActive}
                            onChange={(checked) =>
                              setCategoryForm((form) => ({ ...form, isActive: checked }))
                            }
                          />
                          <div class="settings-inline-editor__actions">
                            <Button variant="ghost" size="sm" onClick={closeCategoryEditor}>
                              {copy().closeEditorAction}
                            </Button>
                            <Button
                              variant="primary"
                              size="sm"
                              loading={savingCategory()}
                              disabled={categoryForm().name.trim().length < 1}
                              onClick={() => void handleSaveCategory()}
                            >
                              {savingCategory() ? copy().savingCategory : copy().saveCategoryAction}
                            </Button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </Card>

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
                setEditMemberForm((form) => ({ ...form, displayName: e.currentTarget.value }))
              }
            />
          </Field>
          <Field label={copy().rentWeightLabel}>
            <Input
              type="number"
              step="0.1"
              value={String(editMemberForm().rentShareWeight)}
              onInput={(e) =>
                setEditMemberForm((form) => ({
                  ...form,
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
                setEditMemberForm((form) => ({
                  ...form,
                  status: value as 'active' | 'away' | 'left'
                }))
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
              onChange={(value) =>
                setEditMemberForm((form) => ({ ...form, isAdmin: value === 'admin' }))
              }
            />
          </Field>
        </div>
      </Modal>
    </div>
  )
}

import { Show, For, Index, createEffect, createMemo, createSignal } from 'solid-js'
import type { JSX } from 'solid-js'
import { ArrowLeft, Globe, Plus, User } from 'lucide-solid'
import { useNavigate } from '@solidjs/router'

import { useSession } from '../contexts/session-context'
import { useI18n } from '../contexts/i18n-context'
import { useDashboard } from '../contexts/dashboard-context'
import { useToast } from '../contexts/toast-context'
import { formatCyclePeriod } from '../lib/dates'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { CurrencyToggle } from '../components/ui/currency-toggle'
import { Select } from '../components/ui/select'
import { Input, Textarea } from '../components/ui/input'
import { Modal } from '../components/ui/dialog'
import { Field } from '../components/ui/field'
import { Toggle } from '../components/ui/toggle'
import {
  updateMiniAppBillingSettings,
  updateMiniAppMemberDisplayName,
  updateMiniAppMemberPresenceDays,
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

function SettingsSummaryRow(props: {
  label: string
  value: JSX.Element | string
  stack?: boolean
}) {
  return (
    <div classList={{ 'settings-summary-row': true, 'settings-summary-row--stack': props.stack }}>
      <span>{props.label}</span>
      <strong>{props.value}</strong>
    </div>
  )
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
  const { showError } = useToast()
  const {
    dashboard,
    effectivePeriod,
    effectiveIsAdmin,
    adminSettings,
    setAdminSettings,
    cycleState,
    pendingMembers,
    setPendingMembers
  } = useDashboard()

  const [profileEditing, setProfileEditing] = createSignal(false)
  const [billingEditing, setBillingEditing] = createSignal(false)
  const [assistantEditing, setAssistantEditing] = createSignal(false)
  const [utilitiesEditorOpen, setUtilitiesEditorOpen] = createSignal(false)
  const [editingCategorySlug, setEditingCategorySlug] = createSignal<string | null>(null)
  const [savingCategory, setSavingCategory] = createSignal(false)
  const [categoryForm, setCategoryForm] = createSignal({
    name: '',
    sortOrder: 0,
    isActive: true,
    providerName: '',
    customerNumber: '',
    paymentLink: '',
    note: ''
  })
  const [savingSettings, setSavingSettings] = createSignal(false)
  const [savingAssistant, setSavingAssistant] = createSignal(false)
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
    isAdmin: false,
    daysPresent: 0,
    daysPresentDirty: false
  })

  const editingMember = createMemo(
    () => adminSettings()?.members.find((member) => member.id === editMemberId()) ?? null
  )
  const settingsMembers = createMemo(() => adminSettings()?.members ?? [])
  const sortedCategories = createMemo(() =>
    [...(adminSettings()?.categories ?? [])].sort(
      (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
    )
  )
  const activeUtilityCategories = createMemo(() =>
    sortedCategories().filter((category) => category.isActive)
  )
  const awayMembersCount = createMemo(
    () => settingsMembers().filter((member) => member.status === 'away').length
  )
  const leftMembersCount = createMemo(
    () => settingsMembers().filter((member) => member.status === 'left').length
  )

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

  const dashboardMemberById = createMemo(() => {
    const lines = dashboard()?.members ?? []
    return new Map(lines.map((member) => [member.memberId, member]))
  })

  function currentPresenceDaysForMember(memberId: string, status: 'active' | 'away' | 'left') {
    return (
      dashboardMemberById().get(memberId)?.daysPresent ??
      defaultPresenceDaysForStatus(status, effectivePeriod())
    )
  }

  createEffect(() => {
    const member = readySession()?.member
    if (!member || profileEditing()) return
    setDisplayNameDraft(member.displayName)
  })

  createEffect(() => {
    if (billingEditing() || assistantEditing()) return
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

  function openAssistantEditor() {
    setBillingForm(buildBillingFormValue())
    setAssistantEditing(true)
  }

  function closeAssistantEditor() {
    setBillingForm(buildBillingFormValue())
    setAssistantEditing(false)
  }

  function billingPolicyLabel(policy: 'utilities' | 'rent' | 'separate') {
    if (policy === 'rent') return copy().paymentBalanceAdjustmentRent
    if (policy === 'separate') return copy().paymentBalanceAdjustmentSeparate
    return copy().paymentBalanceAdjustmentUtilities
  }

  function daysInPeriod(period: string | null | undefined): number {
    const match = period?.match(/^(\d{4})-(\d{2})$/)
    if (!match) return 31
    const year = Number(match[1])
    const month = Number(match[2])
    return new Date(year, month, 0).getDate()
  }

  function defaultPresenceDaysForStatus(
    status: 'active' | 'away' | 'left',
    period: string | null | undefined
  ) {
    return status === 'active' ? daysInPeriod(period) : 0
  }

  function openAddCategory() {
    setUtilitiesEditorOpen(true)
    setEditingCategorySlug(NEW_CATEGORY_SLUG)
    setCategoryForm({
      name: '',
      sortOrder: sortedCategories().length,
      isActive: true,
      providerName: '',
      customerNumber: '',
      paymentLink: '',
      note: ''
    })
  }

  function openEditCategory(category: MiniAppUtilityCategory) {
    setUtilitiesEditorOpen(true)
    setEditingCategorySlug(category.slug)
    setCategoryForm({
      name: category.name,
      sortOrder: category.sortOrder,
      isActive: category.isActive,
      providerName: category.providerName ?? '',
      customerNumber: category.customerNumber ?? '',
      paymentLink: category.paymentLink ?? '',
      note: category.note ?? ''
    })
  }

  function closeCategoryEditor() {
    setEditingCategorySlug(null)
    setCategoryForm({
      name: '',
      sortOrder: 0,
      isActive: true,
      providerName: '',
      customerNumber: '',
      paymentLink: '',
      note: ''
    })
  }

  function openUtilitiesEditor() {
    closeCategoryEditor()
    setUtilitiesEditorOpen(true)
  }

  function closeUtilitiesEditor() {
    closeCategoryEditor()
    setUtilitiesEditorOpen(false)
  }

  async function handleApprove(telegramUserId: string) {
    const data = initData()
    if (!data || approvingId()) return

    setApprovingId(telegramUserId)
    try {
      await approveMiniAppPendingMember(data, telegramUserId)
      setPendingMembers((prev) => prev.filter((member) => member.telegramUserId !== telegramUserId))
      await refreshHouseholdData(true, true)
    } catch (error) {
      showError(
        error,
        locale() === 'ru' ? 'Не получилось подтвердить участника.' : 'Failed to approve member.'
      )
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
    } catch (error) {
      showError(
        error,
        locale() === 'ru' ? 'Не получилось отклонить участника.' : 'Failed to reject member.'
      )
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
    } catch (error) {
      showError(
        error,
        locale() === 'ru' ? 'Не получилось сохранить настройки.' : 'Failed to save settings.'
      )
    } finally {
      setSavingSettings(false)
    }
  }

  async function handleSaveAssistant() {
    const data = initData()
    if (!data) return

    setSavingAssistant(true)
    try {
      const { householdName, settings, assistantConfig } = await updateMiniAppBillingSettings(
        data,
        billingForm()
      )
      setAdminSettings((prev) =>
        prev ? { ...prev, householdName, settings, assistantConfig } : prev
      )
      setAssistantEditing(false)
      await refreshHouseholdData(true, true)
    } catch (error) {
      showError(
        error,
        locale() === 'ru'
          ? 'Не получилось сохранить настройки бота.'
          : 'Failed to save assistant settings.'
      )
    } finally {
      setSavingAssistant(false)
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
        isActive: form.isActive,
        providerName: form.providerName.trim() || null,
        customerNumber: form.customerNumber.trim() || null,
        paymentLink: form.paymentLink.trim() || null,
        note: form.note.trim() || null
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
    } catch (error) {
      showError(
        error,
        locale() === 'ru' ? 'Не получилось сохранить категорию.' : 'Failed to save category.'
      )
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
      isAdmin: member.isAdmin,
      daysPresent: currentPresenceDaysForMember(member.id, member.status),
      daysPresentDirty: false
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
      const period = effectivePeriod() ?? dashboard()?.period ?? null
      const currentDaysPresent = currentPresenceDaysForMember(
        currentMember.id,
        currentMember.status
      )
      if (form.daysPresent !== currentDaysPresent) {
        if (!period) {
          throw new Error(
            locale() === 'ru'
              ? 'Нет активного расчетного периода для сохранения дней присутствия.'
              : 'No billing period available to save presence days.'
          )
        }
        await updateMiniAppMemberPresenceDays(data, memberId, period, form.daysPresent)
        updatedMember = {
          ...updatedMember,
          daysPresent: form.daysPresent
        }
      }
      if (form.isAdmin && !currentMember.isAdmin) {
        updatedMember = await promoteMiniAppMember(data, memberId)
      }
      if (form.status !== currentMember.status) {
        updatedMember = await updateMiniAppMemberStatus(data, memberId, form.status)
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
    } catch (error) {
      showError(
        error,
        locale() === 'ru' ? 'Не получилось сохранить участника.' : 'Failed to save member.'
      )
    } finally {
      setSavingMember(false)
    }
  }

  function topicRoleLabel(role: string) {
    const labels: Record<string, string> = {
      chat: copy().topicChat,
      purchase: copy().topicPurchase,
      feedback: copy().topicFeedback,
      reminders: copy().topicReminders,
      payments: copy().topicPayments
    }
    return labels[role] ?? role
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

      <Card class="settings-hub-card settings-hub-card--personal">
        <div class="settings-hub-card__header">
          <div class="settings-hub-card__copy">
            <span class="settings-card-eyebrow">{copy().houseSectionGeneral}</span>
            <strong>{copy().generalSettingsBody}</strong>
          </div>
          <Button variant="secondary" size="sm" onClick={openProfileEditor}>
            {copy().manageProfileAction}
          </Button>
        </div>

        <div class="settings-profile-grid">
          <div class="settings-profile-chip">
            <div class="settings-detail-row__icon">
              <User size={16} />
            </div>
            <div class="settings-profile-chip__copy">
              <span>{copy().displayNameLabel}</span>
              <strong>{readySession()?.member.displayName ?? '—'}</strong>
            </div>
          </div>

          <div class="settings-profile-chip">
            <div class="settings-detail-row__icon">
              <Globe size={16} />
            </div>
            <div class="settings-profile-chip__copy">
              <span>{copy().language}</span>
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
      </Card>

      <Show when={effectiveIsAdmin()}>
        <div class="settings-hub-stack">
          <Show when={adminSettings()}>
            {(settings) => (
              <>
                <div class="settings-hub-grid">
                  <Card class="settings-hub-card settings-hub-card--hero">
                    <div class="settings-hub-card__header">
                      <div class="settings-hub-card__copy">
                        <span class="settings-card-eyebrow">{copy().houseSectionBilling}</span>
                        <strong>{copy().billingSettingsEditorBody}</strong>
                      </div>
                      <Button variant="primary" size="sm" onClick={openBillingEditor}>
                        {copy().manageBillingAction}
                      </Button>
                    </div>

                    <div class="settings-hub-stats">
                      <div class="settings-hub-stat">
                        <span>{copy().currentCycleLabel}</span>
                        <strong>
                          {cycleState()?.cycle
                            ? formatCyclePeriod(cycleState()!.cycle!.period, locale())
                            : '—'}
                        </strong>
                      </div>
                      <div class="settings-hub-stat">
                        <span>{copy().defaultRentAmount}</span>
                        <strong>
                          {minorToMajorString(BigInt(settings().settings.rentAmountMinor ?? '0'))}{' '}
                          {settings().settings.rentCurrency}
                        </strong>
                      </div>
                    </div>

                    <div class="settings-summary-list">
                      <SettingsSummaryRow
                        label={copy().paymentBalanceAdjustmentPolicy}
                        value={billingPolicyLabel(
                          settings().settings.paymentBalanceAdjustmentPolicy
                        )}
                      />
                      <SettingsSummaryRow
                        label={copy().settlementCurrency}
                        value={settings().settings.settlementCurrency}
                      />
                      <SettingsSummaryRow
                        label={copy().timezone}
                        value={settings().settings.timezone}
                      />
                      <SettingsSummaryRow
                        label={copy().rentDueDay}
                        value={String(settings().settings.rentDueDay)}
                      />
                      <SettingsSummaryRow
                        label={copy().utilitiesDueDay}
                        value={String(settings().settings.utilitiesDueDay)}
                      />
                      <SettingsSummaryRow
                        label={copy().rentPaymentDestinationsTitle}
                        value={String(settings().settings.rentPaymentDestinations?.length ?? 0)}
                      />
                    </div>
                  </Card>

                  <Card class="settings-hub-card">
                    <div class="settings-hub-card__header">
                      <div class="settings-hub-card__copy">
                        <span class="settings-card-eyebrow">{copy().houseSectionMembers}</span>
                        <strong>{copy().membersBody}</strong>
                      </div>
                      <Badge variant="accent">{settingsMembers().length}</Badge>
                    </div>

                    <div class="settings-hub-stats settings-hub-stats--triple">
                      <div class="settings-hub-stat">
                        <span>{copy().membersCount}</span>
                        <strong>{settingsMembers().length}</strong>
                      </div>
                      <div class="settings-hub-stat">
                        <span>{copy().memberStatusAway}</span>
                        <strong>{awayMembersCount()}</strong>
                      </div>
                      <div class="settings-hub-stat">
                        <span>{copy().memberStatusLeft}</span>
                        <strong>{leftMembersCount()}</strong>
                      </div>
                    </div>

                    <div class="settings-member-preview-list">
                      <For each={settingsMembers()}>
                        {(member) => (
                          <button
                            class="settings-member-preview"
                            onClick={() => openEditMember(member)}
                          >
                            <div class="settings-member-preview__copy">
                              <strong>{member.displayName}</strong>
                              <span>
                                {copy().presenceDaysLabel}:{' '}
                                {currentPresenceDaysForMember(member.id, member.status)}
                              </span>
                            </div>
                            <div class="settings-member-preview__meta">
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
                  </Card>

                  <Card class="settings-hub-card">
                    <div class="settings-hub-card__header">
                      <div class="settings-hub-card__copy">
                        <span class="settings-card-eyebrow">{copy().houseSectionUtilities}</span>
                        <strong>{copy().utilityCategoriesBody}</strong>
                      </div>
                      <Button variant="secondary" size="sm" onClick={openUtilitiesEditor}>
                        {copy().manageUtilitiesAction}
                      </Button>
                    </div>

                    <div class="settings-hub-stats">
                      <div class="settings-hub-stat">
                        <span>{copy().utilityCategoriesTitle}</span>
                        <strong>{sortedCategories().length}</strong>
                      </div>
                      <div class="settings-hub-stat">
                        <span>{copy().onLabel}</span>
                        <strong>{activeUtilityCategories().length}</strong>
                      </div>
                    </div>

                    <Show
                      when={sortedCategories().length > 0}
                      fallback={<p class="empty-state">{copy().utilityCategoriesBody}</p>}
                    >
                      <div class="settings-utility-preview-list">
                        <For each={sortedCategories().slice(0, 4)}>
                          {(category) => (
                            <div class="settings-utility-preview">
                              <div class="settings-utility-preview__copy">
                                <strong>{category.name}</strong>
                                <span>
                                  {category.providerName ||
                                    category.customerNumber ||
                                    category.note ||
                                    '—'}
                                </span>
                              </div>
                              <Badge variant={category.isActive ? 'accent' : 'muted'}>
                                {category.isActive ? copy().onLabel : copy().offLabel}
                              </Badge>
                            </div>
                          )}
                        </For>
                      </div>
                    </Show>
                  </Card>
                </div>

                <div class="settings-advanced">
                  <div class="settings-advanced__header">
                    <div>
                      <strong>{copy().settingsAdvancedTitle}</strong>
                      <p>{copy().settingsAdvancedBody}</p>
                    </div>
                  </div>

                  <Show when={pendingMembers().length > 0}>
                    <Card class="settings-hub-card settings-hub-card--quiet">
                      <div class="settings-hub-card__header">
                        <div class="settings-hub-card__copy">
                          <span class="settings-card-eyebrow">{copy().pendingMembersTitle}</span>
                          <strong>{copy().pendingMembersBody}</strong>
                        </div>
                        <Badge variant="accent">{pendingMembers().length}</Badge>
                      </div>

                      <div class="settings-member-preview-list">
                        <For each={pendingMembers()}>
                          {(member) => (
                            <div class="settings-pending-row">
                              <div class="settings-member-preview__copy">
                                <strong>{member.displayName}</strong>
                                <span>{member.username ? `@${member.username}` : '—'}</span>
                              </div>
                              <div class="settings-pending-row__actions">
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
                    </Card>
                  </Show>

                  <Card class="settings-hub-card settings-hub-card--quiet">
                    <div class="settings-hub-card__header">
                      <div class="settings-hub-card__copy">
                        <span class="settings-card-eyebrow">{copy().assistantSettingsTitle}</span>
                        <strong>{copy().assistantSettingsBody}</strong>
                      </div>
                      <Button variant="secondary" size="sm" onClick={openAssistantEditor}>
                        {copy().manageAssistantAction}
                      </Button>
                    </div>

                    <div class="settings-summary-list">
                      <SettingsSummaryRow
                        label={copy().assistantToneLabel}
                        value={truncateValue(settings().assistantConfig?.assistantTone)}
                        stack
                      />
                      <SettingsSummaryRow
                        label={copy().assistantContextLabel}
                        value={truncateValue(settings().assistantConfig?.assistantContext, 96)}
                        stack
                      />
                    </div>
                  </Card>

                  <Card class="settings-hub-card settings-hub-card--quiet">
                    <div class="settings-hub-card__header">
                      <div class="settings-hub-card__copy">
                        <span class="settings-card-eyebrow">{copy().houseSectionTopics}</span>
                        <strong>{copy().topicBindingsBody}</strong>
                      </div>
                    </div>

                    <div class="settings-topic-list">
                      <For each={settings().topics}>
                        {(topic) => (
                          <div class="settings-topic-row">
                            <div class="settings-topic-row__copy">
                              <strong>{topicRoleLabel(topic.role)}</strong>
                              <span>{topic.topicName || copy().topicUnbound}</span>
                            </div>
                            <Badge variant={topic.telegramThreadId ? 'accent' : 'muted'}>
                              {topic.telegramThreadId ? copy().topicBound : copy().topicUnbound}
                            </Badge>
                          </div>
                        )}
                      </For>
                    </div>
                  </Card>
                </div>
              </>
            )}
          </Show>
        </div>
      </Show>

      <Modal
        open={profileEditing()}
        title={copy().manageProfileAction}
        description={copy().profileEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={closeProfileEditor}
        footer={
          <div class="modal-action-row">
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
        }
      >
        <div class="settings-sheet-stack">
          <div class="settings-sheet-section">
            <Field label={copy().displayNameLabel} hint={copy().displayNameHint} wide>
              <Input
                value={displayNameDraft()}
                onInput={(event) => setDisplayNameDraft(event.currentTarget.value)}
              />
            </Field>
          </div>
        </div>
      </Modal>

      <Modal
        open={billingEditing()}
        title={copy().manageBillingAction}
        description={copy().billingSettingsEditorBody}
        closeLabel={copy().closeEditorAction}
        onClose={closeBillingEditor}
        footer={
          <div class="modal-action-row">
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
        }
      >
        <div class="settings-sheet-stack">
          <div class="settings-sheet-section">
            <div class="settings-sheet-section__header">
              <strong>{copy().houseSectionGeneral}</strong>
            </div>
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

          <div class="settings-sheet-section">
            <div class="settings-sheet-section__header">
              <strong>{copy().homeRentTitle}</strong>
            </div>
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
                  onChange={(value) => setBillingForm((form) => ({ ...form, rentCurrency: value }))}
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

          <div class="settings-sheet-section">
            <div class="settings-sheet-section__header">
              <strong>{copy().homeUtilitiesTitle}</strong>
            </div>
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
                    { value: 'utilities', label: copy().paymentBalanceAdjustmentUtilities },
                    { value: 'rent', label: copy().paymentBalanceAdjustmentRent },
                    { value: 'separate', label: copy().paymentBalanceAdjustmentSeparate }
                  ]}
                  onChange={(value) =>
                    setBillingForm((form) => ({
                      ...form,
                      paymentBalanceAdjustmentPolicy: value as 'utilities' | 'rent' | 'separate'
                    }))
                  }
                />
              </Field>
            </div>
          </div>

          <div class="settings-sheet-section">
            <div class="settings-sheet-section__header">
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
                    <div class="settings-destination-row settings-destination-row--sheet">
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
        </div>
      </Modal>

      <Modal
        open={assistantEditing()}
        title={copy().manageAssistantAction}
        description={copy().assistantSettingsBody}
        closeLabel={copy().closeEditorAction}
        onClose={closeAssistantEditor}
        footer={
          <div class="modal-action-row">
            <Button variant="ghost" onClick={closeAssistantEditor}>
              {copy().closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={savingAssistant()}
              onClick={() => void handleSaveAssistant()}
            >
              {savingAssistant() ? copy().savingSettings : copy().saveSettingsAction}
            </Button>
          </div>
        }
      >
        <div class="settings-sheet-stack">
          <div class="settings-sheet-section">
            <div class="settings-form-grid">
              <Field label={copy().assistantToneLabel} hint={copy().assistantTonePlaceholder}>
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
        </div>
      </Modal>

      <Modal
        open={utilitiesEditorOpen()}
        title={
          editingCategorySlug()
            ? editingCategorySlug() === NEW_CATEGORY_SLUG
              ? copy().addCategoryAction
              : copy().editCategoryAction
            : copy().manageUtilitiesAction
        }
        description={
          editingCategorySlug()
            ? editingCategorySlug() === NEW_CATEGORY_SLUG
              ? copy().categoryCreateBody
              : copy().categoryEditorBody
            : copy().utilityCategoriesBody
        }
        closeLabel={copy().closeEditorAction}
        onClose={closeUtilitiesEditor}
        footer={
          <Show
            when={editingCategorySlug()}
            fallback={
              <div class="modal-action-row">
                <Button variant="ghost" onClick={closeUtilitiesEditor}>
                  {copy().closeEditorAction}
                </Button>
              </div>
            }
          >
            <div class="modal-action-row">
              <Button variant="ghost" onClick={closeCategoryEditor}>
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
          </Show>
        }
      >
        <Show
          when={editingCategorySlug()}
          fallback={
            <div class="settings-sheet-stack">
              <div class="settings-sheet-section">
                <div class="settings-sheet-section__header">
                  <strong>{copy().utilityCategoriesTitle}</strong>
                  <Button variant="primary" size="sm" onClick={openAddCategory}>
                    <Plus size={14} />
                    {copy().addCategoryAction}
                  </Button>
                </div>
                <Show
                  when={sortedCategories().length > 0}
                  fallback={<p class="empty-state">{copy().utilityCategoriesBody}</p>}
                >
                  <div class="settings-manager-list">
                    <For each={sortedCategories()}>
                      {(category) => (
                        <button
                          class="settings-manager-row"
                          onClick={() => openEditCategory(category)}
                        >
                          <div class="settings-manager-row__copy">
                            <strong>{category.name}</strong>
                            <span>
                              {category.providerName ||
                                category.customerNumber ||
                                category.note ||
                                '—'}
                            </span>
                          </div>
                          <div class="settings-manager-row__meta">
                            <Badge variant={category.isActive ? 'accent' : 'muted'}>
                              {category.isActive ? copy().onLabel : copy().offLabel}
                            </Badge>
                            <span>{copy().editCategoryAction}</span>
                          </div>
                        </button>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </div>
          }
        >
          <div class="settings-sheet-stack">
            <div class="settings-sheet-section">
              <div class="settings-form-grid">
                <Field label={copy().utilityCategoryName} wide>
                  <Input
                    value={categoryForm().name}
                    onInput={(e) =>
                      setCategoryForm((form) => ({ ...form, name: e.currentTarget.value }))
                    }
                  />
                </Field>
                <Field label="Provider" wide>
                  <Input
                    value={categoryForm().providerName}
                    onInput={(e) =>
                      setCategoryForm((form) => ({ ...form, providerName: e.currentTarget.value }))
                    }
                  />
                </Field>
                <Field label="Customer / account number" wide>
                  <Input
                    value={categoryForm().customerNumber}
                    onInput={(e) =>
                      setCategoryForm((form) => ({
                        ...form,
                        customerNumber: e.currentTarget.value
                      }))
                    }
                  />
                </Field>
                <Field label="Payment link" wide>
                  <Input
                    value={categoryForm().paymentLink}
                    onInput={(e) =>
                      setCategoryForm((form) => ({ ...form, paymentLink: e.currentTarget.value }))
                    }
                  />
                </Field>
                <Field label="Note" wide>
                  <Textarea
                    value={categoryForm().note}
                    onInput={(e) =>
                      setCategoryForm((form) => ({ ...form, note: e.currentTarget.value }))
                    }
                  />
                </Field>
              </div>
            </div>
            <div class="settings-sheet-section">
              <Toggle
                checked={categoryForm().isActive}
                label={copy().utilityCategoryActive}
                onChange={(checked) => setCategoryForm((form) => ({ ...form, isActive: checked }))}
              />
            </div>
          </div>
        </Show>
      </Modal>

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
        <div class="settings-sheet-stack">
          <div class="settings-sheet-section">
            <div class="settings-form-grid">
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
                    setEditMemberForm((form) => {
                      const nextStatus = value as 'active' | 'away' | 'left'
                      return {
                        ...form,
                        status: nextStatus,
                        ...(form.daysPresentDirty
                          ? {}
                          : {
                              daysPresent: defaultPresenceDaysForStatus(
                                nextStatus,
                                effectivePeriod() ?? dashboard()?.period
                              )
                            })
                      }
                    })
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
          </div>

          <div class="settings-sheet-section">
            <Field label={copy().presenceDaysLabel} hint={copy().presenceDaysHint} wide>
              <Input
                type="number"
                min="0"
                max={String(daysInPeriod(effectivePeriod() ?? dashboard()?.period))}
                value={String(editMemberForm().daysPresent)}
                onInput={(e) =>
                  setEditMemberForm((form) => ({
                    ...form,
                    daysPresent: Math.max(0, parseInt(e.currentTarget.value || '0', 10) || 0),
                    daysPresentDirty: true
                  }))
                }
              />
            </Field>
          </div>

          <Show when={editingMember()}>
            {(member) => (
              <div class="settings-sheet-section">
                <div class="settings-sheet-section__header">
                  <strong>{copy().presenceSummaryLabel}</strong>
                </div>
                <div class="settings-summary-list">
                  <SettingsSummaryRow
                    label={copy().memberStatusLabel}
                    value={
                      editMemberForm().status === 'active'
                        ? copy().memberStatusActive
                        : editMemberForm().status === 'away'
                          ? copy().memberStatusAway
                          : copy().memberStatusLeft
                    }
                  />
                  <SettingsSummaryRow
                    label={copy().presenceDaysLabel}
                    value={String(editMemberForm().daysPresent)}
                  />
                  <SettingsSummaryRow
                    label={copy().presenceDefaultLabel}
                    value={String(
                      defaultPresenceDaysForStatus(
                        editMemberForm().status,
                        effectivePeriod() ?? dashboard()?.period
                      )
                    )}
                  />
                  <SettingsSummaryRow
                    label={copy().currentSavedValueLabel}
                    value={String(currentPresenceDaysForMember(member().id, member().status))}
                  />
                </div>
              </div>
            )}
          </Show>
        </div>
      </Modal>
    </div>
  )
}

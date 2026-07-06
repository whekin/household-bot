import { Check, Plus, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Textarea } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/toast'
import { useDashboard } from '@/app/dashboard-context'
import { useReadySession, useSession } from '@/app/session-context'
import { useI18n } from '@/i18n/context'
import { minorToMajorString } from '@/lib/money'
import { searchTimezones } from '@/lib/timezones'
import {
  updateMiniAppBillingSettings,
  type MiniAppAdminSettingsPayload,
  type MiniAppRentPaymentDestination
} from '@/api'

import { CurrencyToggle, LocaleToggle } from './toggles'

export type BillingFormState = {
  householdName: string
  settlementCurrency: 'USD' | 'GEL'
  paymentBalanceAdjustmentPolicy: 'utilities' | 'rent' | 'separate'
  rentAmountMajor: string
  rentCurrency: 'USD' | 'GEL'
  rentDueDay: number
  rentWarningDay: number
  utilitiesDueDay: number
  utilitiesReminderDay: number
  preferredUtilityPayerMemberId: string | null
  timezone: string
  rentPaymentDestinations: MiniAppRentPaymentDestination[]
  assistantContext: string
  assistantTone: string
  notificationSettings: {
    periodEvents: boolean
    planEvents: boolean
    purchaseEvents: boolean
    paymentEvents: boolean
  }
}

export function buildBillingFormValue(
  settings: MiniAppAdminSettingsPayload | null
): BillingFormState {
  return {
    householdName: settings?.householdName ?? '',
    settlementCurrency: settings?.settings.settlementCurrency ?? 'GEL',
    paymentBalanceAdjustmentPolicy:
      settings?.settings.paymentBalanceAdjustmentPolicy ?? 'utilities',
    rentAmountMajor: settings
      ? minorToMajorString(BigInt(settings.settings.rentAmountMinor ?? '0'))
      : '',
    rentCurrency: settings?.settings.rentCurrency ?? 'USD',
    rentDueDay: settings?.settings.rentDueDay ?? 20,
    rentWarningDay: settings?.settings.rentWarningDay ?? 17,
    utilitiesDueDay: settings?.settings.utilitiesDueDay ?? 4,
    utilitiesReminderDay: settings?.settings.utilitiesReminderDay ?? 3,
    preferredUtilityPayerMemberId: settings?.settings.preferredUtilityPayerMemberId ?? null,
    timezone: settings?.settings.timezone ?? 'Asia/Tbilisi',
    rentPaymentDestinations: [...(settings?.settings.rentPaymentDestinations ?? [])],
    assistantContext: settings?.assistantConfig.assistantContext ?? '',
    assistantTone: settings?.assistantConfig.assistantTone ?? '',
    notificationSettings: {
      periodEvents: settings?.notificationSettings.periodEvents ?? true,
      planEvents: settings?.notificationSettings.planEvents ?? true,
      purchaseEvents: settings?.notificationSettings.purchaseEvents ?? true,
      paymentEvents: settings?.notificationSettings.paymentEvents ?? true
    }
  }
}

function SectionTitle({ children }: { children: string }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-primary">{children}</p>
  )
}

export function BillingSettingsSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const session = useReadySession()
  const { initData, handleHouseholdLocaleChange, handleMiniAppRequestError } = useSession()
  const { adminSettings, refresh } = useDashboard()
  const { copy, locale } = useI18n()
  const { showToast } = useToast()

  const [form, setForm] = useState<BillingFormState>(() => buildBillingFormValue(adminSettings))
  const [saving, setSaving] = useState(false)

  const adminSettingsRef = useRef(adminSettings)
  adminSettingsRef.current = adminSettings

  useEffect(() => {
    if (!open) return
    // Reset the draft from saved settings every time the sheet opens; while
    // the sheet stays open the draft must survive background refreshes,
    // matching the legacy editor behaviour.
    setForm(buildBillingFormValue(adminSettingsRef.current))
  }, [open])

  const members = adminSettings?.members ?? []

  const timezoneOptions = useMemo(() => {
    const list = searchTimezones('', 600)
    return list.includes(form.timezone) ? list : [form.timezone, ...list]
  }, [form.timezone])

  const notificationToggles = [
    { key: 'periodEvents', label: copy.notificationPeriodEvents },
    { key: 'planEvents', label: copy.notificationPlanEvents },
    { key: 'purchaseEvents', label: copy.notificationPurchaseEvents },
    { key: 'paymentEvents', label: copy.notificationPaymentEvents }
  ] as const

  function updateDestination(index: number, patch: Partial<MiniAppRentPaymentDestination>) {
    setForm((prev) => {
      const next = [...prev.rentPaymentDestinations]
      next[index] = { ...next[index]!, ...patch }
      return { ...prev, rentPaymentDestinations: next }
    })
  }

  async function handleSave() {
    if (!initData || saving) return
    setSaving(true)
    try {
      await updateMiniAppBillingSettings(initData, form)
      await refresh()
      onOpenChange(false)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          locale === 'ru' ? 'Не получилось сохранить настройки.' : 'Failed to save settings.',
          'error'
        )
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={copy.manageBillingAction}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            <X className="size-4" aria-hidden />
            {copy.closeEditorAction}
          </Button>
          <Button variant="primary" loading={saving} onClick={() => void handleSave()}>
            <Check className="size-4" aria-hidden />
            {saving ? copy.savingSettings : copy.saveSettingsAction}
          </Button>
        </div>
      }
    >
      <div className="space-y-6">
        <p className="text-sm text-muted-foreground">{copy.billingSettingsEditorBody}</p>

        <section className="space-y-3">
          <SectionTitle>{copy.houseSectionGeneral}</SectionTitle>
          <Field label={copy.householdNameLabel} hint={copy.householdNameHint}>
            <Input
              value={form.householdName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, householdName: event.target.value }))
              }
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={copy.settlementCurrency}>
              <CurrencyToggle
                value={form.settlementCurrency}
                ariaLabel={copy.settlementCurrency}
                onChange={(value) => setForm((prev) => ({ ...prev, settlementCurrency: value }))}
              />
            </Field>
            <Field label={copy.householdLanguage}>
              <LocaleToggle
                value={session.member.householdDefaultLocale}
                ariaLabel={copy.householdLanguage}
                onChange={(value) => void handleHouseholdLocaleChange(value)}
              />
            </Field>
          </div>
          <Field label={copy.timezone} hint={copy.timezoneHint}>
            <Select
              value={form.timezone}
              onChange={(event) => setForm((prev) => ({ ...prev, timezone: event.target.value }))}
            >
              {timezoneOptions.map((timezone) => (
                <option key={timezone} value={timezone}>
                  {timezone}
                </option>
              ))}
            </Select>
          </Field>
        </section>

        <section className="space-y-3">
          <SectionTitle>{copy.homeRentTitle}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label={copy.defaultRentAmount}>
              <Input
                type="number"
                inputMode="decimal"
                value={form.rentAmountMajor}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, rentAmountMajor: event.target.value }))
                }
              />
            </Field>
            <Field label={copy.rentCurrencyLabel}>
              <CurrencyToggle
                value={form.rentCurrency}
                ariaLabel={copy.rentCurrencyLabel}
                onChange={(value) => setForm((prev) => ({ ...prev, rentCurrency: value }))}
              />
            </Field>
            <Field label={copy.rentWarningDay}>
              <Input
                type="number"
                value={String(form.rentWarningDay)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    rentWarningDay: Number(event.target.value) || 0
                  }))
                }
              />
            </Field>
            <Field label={copy.rentDueDay}>
              <Input
                type="number"
                value={String(form.rentDueDay)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, rentDueDay: Number(event.target.value) || 0 }))
                }
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle>{copy.homeUtilitiesTitle}</SectionTitle>
          <div className="grid grid-cols-2 gap-3">
            <Field label={copy.utilitiesReminderDay}>
              <Input
                type="number"
                value={String(form.utilitiesReminderDay)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    utilitiesReminderDay: Number(event.target.value) || 0
                  }))
                }
              />
            </Field>
            <Field label={copy.utilitiesDueDay}>
              <Input
                type="number"
                value={String(form.utilitiesDueDay)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    utilitiesDueDay: Number(event.target.value) || 0
                  }))
                }
              />
            </Field>
          </div>
          <Field label={copy.paymentBalanceAdjustmentPolicy}>
            <Select
              value={form.paymentBalanceAdjustmentPolicy}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  paymentBalanceAdjustmentPolicy: event.target.value as
                    | 'utilities'
                    | 'rent'
                    | 'separate'
                }))
              }
            >
              <option value="utilities">{copy.paymentBalanceAdjustmentUtilities}</option>
              <option value="rent">{copy.paymentBalanceAdjustmentRent}</option>
              <option value="separate">{copy.paymentBalanceAdjustmentSeparate}</option>
            </Select>
          </Field>
          <Field label={copy.preferredUtilityPayer}>
            <Select
              value={form.preferredUtilityPayerMemberId ?? ''}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  preferredUtilityPayerMemberId: event.target.value || null
                }))
              }
            >
              <option value="">{copy.preferredUtilityPayerAutomatic}</option>
              {members
                .filter((member) => member.status !== 'left')
                .map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.displayName}
                  </option>
                ))}
            </Select>
          </Field>
        </section>

        <section className="space-y-3">
          <SectionTitle>{copy.notificationSettingsTitle}</SectionTitle>
          <p className="text-xs text-faint">{copy.notificationSettingsBody}</p>
          <div className="space-y-2">
            {notificationToggles.map((toggle) => (
              <div
                key={toggle.key}
                className="flex items-center justify-between rounded-xl bg-elevated px-3 py-2.5"
              >
                <span className="text-sm text-foreground">{toggle.label}</span>
                <Switch
                  checked={form.notificationSettings[toggle.key]}
                  aria-label={toggle.label}
                  onCheckedChange={(checked) =>
                    setForm((prev) => ({
                      ...prev,
                      notificationSettings: {
                        ...prev.notificationSettings,
                        [toggle.key]: checked
                      }
                    }))
                  }
                />
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <SectionTitle>{copy.assistantSettingsTitle}</SectionTitle>
          <p className="text-xs text-faint">{copy.assistantSettingsBody}</p>
          <Field label={copy.assistantToneLabel} hint={copy.assistantTonePlaceholder}>
            <Input
              value={form.assistantTone}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, assistantTone: event.target.value }))
              }
            />
          </Field>
          <Field label={copy.assistantContextLabel}>
            <Textarea
              value={form.assistantContext}
              placeholder={copy.assistantContextPlaceholder}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, assistantContext: event.target.value }))
              }
            />
          </Field>
        </section>

        <section className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <SectionTitle>{copy.rentPaymentDestinationsTitle}</SectionTitle>
            <Button
              variant="secondary"
              size="sm"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  rentPaymentDestinations: [
                    ...prev.rentPaymentDestinations,
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
              <Plus className="size-3.5" aria-hidden />
              {copy.rentPaymentDestinationAddAction}
            </Button>
          </div>

          {form.rentPaymentDestinations.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.rentPaymentDestinationsEmpty}</p>
          ) : (
            <div className="space-y-3">
              {form.rentPaymentDestinations.map((destination, index) => (
                <div key={index} className="space-y-3 rounded-xl bg-elevated p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="truncate text-sm font-semibold text-foreground">
                      {destination.label || `${copy.rentPaymentDestinationAddAction} ${index + 1}`}
                    </p>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          rentPaymentDestinations: prev.rentPaymentDestinations.filter(
                            (_, currentIndex) => currentIndex !== index
                          )
                        }))
                      }
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                      {copy.rentPaymentDestinationRemoveAction}
                    </Button>
                  </div>
                  <Field label={copy.rentPaymentDestinationLabel}>
                    <Input
                      value={destination.label}
                      onChange={(event) => updateDestination(index, { label: event.target.value })}
                    />
                  </Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={copy.rentPaymentDestinationRecipient}>
                      <Input
                        value={destination.recipientName ?? ''}
                        onChange={(event) =>
                          updateDestination(index, { recipientName: event.target.value || null })
                        }
                      />
                    </Field>
                    <Field label={copy.rentPaymentDestinationBank}>
                      <Input
                        value={destination.bankName ?? ''}
                        onChange={(event) =>
                          updateDestination(index, { bankName: event.target.value || null })
                        }
                      />
                    </Field>
                  </div>
                  <Field label={copy.rentPaymentDestinationAccount}>
                    <Input
                      value={destination.account}
                      onChange={(event) =>
                        updateDestination(index, { account: event.target.value })
                      }
                    />
                  </Field>
                  <Field label={copy.rentPaymentDestinationLink}>
                    <Input
                      value={destination.link ?? ''}
                      onChange={(event) =>
                        updateDestination(index, { link: event.target.value || null })
                      }
                    />
                  </Field>
                  <Field label={copy.rentPaymentDestinationNote}>
                    <Textarea
                      value={destination.note ?? ''}
                      onChange={(event) =>
                        updateDestination(index, { note: event.target.value || null })
                      }
                    />
                  </Field>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </Sheet>
  )
}

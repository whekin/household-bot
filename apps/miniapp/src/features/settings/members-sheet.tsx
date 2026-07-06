import { Check, ChevronRight, X } from 'lucide-react'
import { useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Sheet } from '@/components/ui/dialog'
import { useToast } from '@/components/toast'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { useI18n } from '@/i18n/context'
import { confirmDialog } from '@/telegram/webapp'
import {
  demoteMiniAppMember,
  promoteMiniAppMember,
  updateMiniAppMemberDisplayName,
  updateMiniAppMemberPresenceDays,
  updateMiniAppMemberRentWeight,
  updateMiniAppMemberStatus,
  type MiniAppMember
} from '@/api'

import { daysInPeriod, defaultPresenceDaysForStatus, memberStatusLabel } from './helpers'

type MemberFormState = {
  displayName: string
  rentShareWeight: number
  status: 'active' | 'away' | 'left'
  isAdmin: boolean
  daysPresent: number
  daysPresentDirty: boolean
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </div>
  )
}

export function MembersSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { dashboard, adminSettings, effectivePeriod, refresh } = useDashboard()
  const { copy, locale } = useI18n()
  const { showToast } = useToast()

  const [editMemberId, setEditMemberId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<MemberFormState>({
    displayName: '',
    rentShareWeight: 1,
    status: 'active',
    isAdmin: false,
    daysPresent: 0,
    daysPresentDirty: false
  })

  const members = adminSettings?.members ?? []
  const editingMember = members.find((member) => member.id === editMemberId) ?? null
  const period = effectivePeriod ?? dashboard?.period ?? null

  function currentPresenceDaysForMember(memberId: string, status: 'active' | 'away' | 'left') {
    return (
      dashboard?.members.find((line) => line.memberId === memberId)?.daysPresent ??
      defaultPresenceDaysForStatus(status, period)
    )
  }

  function openEditor(member: MiniAppMember) {
    setEditMemberId(member.id)
    setForm({
      displayName: member.displayName,
      rentShareWeight: member.rentShareWeight,
      status: member.status,
      isAdmin: member.isAdmin,
      daysPresent: currentPresenceDaysForMember(member.id, member.status),
      daysPresentDirty: false
    })
  }

  function handleSheetOpenChange(next: boolean) {
    if (!next) setEditMemberId(null)
    onOpenChange(next)
  }

  async function handleSaveMember() {
    if (!initData || saving) return
    const currentMember = editingMember
    if (!currentMember) return

    if (!form.isAdmin && currentMember.isAdmin) {
      const ok = await confirmDialog(`${copy.demoteAdminAction}?`)
      if (!ok) return
    }
    if (form.status === 'left' && currentMember.status !== 'left') {
      const ok = await confirmDialog(
        locale === 'ru'
          ? `Отметить участника ${currentMember.displayName} как выехавшего?`
          : `Mark ${currentMember.displayName} as left?`
      )
      if (!ok) return
    }

    setSaving(true)
    try {
      if (form.displayName !== currentMember.displayName) {
        await updateMiniAppMemberDisplayName(initData, currentMember.id, form.displayName)
      }
      if (form.rentShareWeight !== currentMember.rentShareWeight) {
        await updateMiniAppMemberRentWeight(initData, currentMember.id, form.rentShareWeight)
      }
      const currentDaysPresent = currentPresenceDaysForMember(
        currentMember.id,
        currentMember.status
      )
      if (form.daysPresent !== currentDaysPresent) {
        if (!period) {
          throw new Error(
            locale === 'ru'
              ? 'Нет активного расчетного периода для сохранения дней присутствия.'
              : 'No billing period available to save presence days.'
          )
        }
        await updateMiniAppMemberPresenceDays(initData, currentMember.id, period, form.daysPresent)
      }
      if (form.isAdmin && !currentMember.isAdmin) {
        await promoteMiniAppMember(initData, currentMember.id)
      }
      if (form.status !== currentMember.status) {
        await updateMiniAppMemberStatus(initData, currentMember.id, form.status)
      }
      if (!form.isAdmin && currentMember.isAdmin) {
        await demoteMiniAppMember(initData, currentMember.id)
      }

      await refresh()
      setEditMemberId(null)
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          locale === 'ru' ? 'Не получилось сохранить участника.' : 'Failed to save member.',
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
      onOpenChange={handleSheetOpenChange}
      title={editingMember ? copy.inspectMemberTitle : copy.membersTitle}
      footer={
        editingMember ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditMemberId(null)}>
              <X className="size-4" aria-hidden />
              {copy.closeEditorAction}
            </Button>
            <Button variant="primary" loading={saving} onClick={() => void handleSaveMember()}>
              <Check className="size-4" aria-hidden />
              {copy.saveMemberChangesAction}
            </Button>
          </div>
        ) : undefined
      }
    >
      {editingMember ? (
        <div className="space-y-5">
          <p className="text-sm text-muted-foreground">{copy.memberEditorBody}</p>

          <Field label={copy.displayNameLabel}>
            <Input
              value={form.displayName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, displayName: event.target.value }))
              }
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={copy.rentWeightLabel}>
              <Input
                type="number"
                step="0.1"
                value={String(form.rentShareWeight)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    rentShareWeight: parseFloat(event.target.value) || 0
                  }))
                }
              />
            </Field>
            <Field label={copy.memberStatusLabel}>
              <Select
                value={form.status}
                onChange={(event) =>
                  setForm((prev) => {
                    const nextStatus = event.target.value as 'active' | 'away' | 'left'
                    return {
                      ...prev,
                      status: nextStatus,
                      ...(prev.daysPresentDirty
                        ? {}
                        : { daysPresent: defaultPresenceDaysForStatus(nextStatus, period) })
                    }
                  })
                }
              >
                <option value="active">{copy.memberStatusActive}</option>
                <option value="away">{copy.memberStatusAway}</option>
                <option value="left">{copy.memberStatusLeft}</option>
              </Select>
            </Field>
            <Field label={copy.memberRoleLabel}>
              <Select
                value={form.isAdmin ? 'admin' : 'resident'}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, isAdmin: event.target.value === 'admin' }))
                }
              >
                <option value="resident">{copy.memberRoleResident}</option>
                <option value="admin">{copy.memberRoleAdmin}</option>
              </Select>
            </Field>
            <Field label={copy.presenceDaysLabel}>
              <Input
                type="number"
                min="0"
                max={String(daysInPeriod(period))}
                value={String(form.daysPresent)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    daysPresent: Math.max(0, parseInt(event.target.value || '0', 10) || 0),
                    daysPresentDirty: true
                  }))
                }
              />
            </Field>
          </div>
          <p className="text-xs text-faint">{copy.presenceDaysHint}</p>

          <section className="space-y-2 rounded-xl bg-elevated p-3">
            <p className="text-xs font-medium text-muted-foreground">{copy.presenceSummaryLabel}</p>
            <SummaryRow
              label={copy.memberStatusLabel}
              value={memberStatusLabel(form.status, copy)}
            />
            <SummaryRow label={copy.presenceDaysLabel} value={String(form.daysPresent)} />
            <SummaryRow
              label={copy.presenceDefaultLabel}
              value={String(defaultPresenceDaysForStatus(form.status, period))}
            />
            <SummaryRow
              label={copy.currentSavedValueLabel}
              value={String(currentPresenceDaysForMember(editingMember.id, editingMember.status))}
            />
          </section>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">{copy.membersBody}</p>
          <div className="space-y-2">
            {members.map((member) => (
              <button
                key={member.id}
                type="button"
                onClick={() => openEditor(member)}
                className="flex w-full items-center gap-3 rounded-xl bg-elevated px-3 py-2.5 text-left transition-colors active:bg-field-hover"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {member.displayName}
                  </p>
                  <p className="text-xs text-faint">
                    {copy.presenceDaysLabel}:{' '}
                    {currentPresenceDaysForMember(member.id, member.status)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Badge tone={member.isAdmin ? 'primary' : 'neutral'}>
                    {member.isAdmin ? copy.adminTag : copy.residentTag}
                  </Badge>
                  <Badge tone="neutral">{memberStatusLabel(member.status, copy)}</Badge>
                  <ChevronRight className="size-4 text-faint" />
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  )
}

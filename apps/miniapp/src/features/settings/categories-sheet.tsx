import { Check, Plus, X } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, Textarea } from '@/components/ui/input'
import { Sheet } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { useToast } from '@/components/toast'
import { useDashboard } from '@/app/dashboard-context'
import { useSession } from '@/app/session-context'
import { useI18n } from '@/i18n/context'
import { upsertMiniAppUtilityCategory, type MiniAppUtilityCategory } from '@/api'

const NEW_CATEGORY_SLUG = '__new__'

type CategoryFormState = {
  name: string
  sortOrder: number
  isActive: boolean
  providerName: string
  customerNumber: string
  paymentLink: string
  note: string
}

const emptyCategoryForm: CategoryFormState = {
  name: '',
  sortOrder: 0,
  isActive: true,
  providerName: '',
  customerNumber: '',
  paymentLink: '',
  note: ''
}

function CategoryGroup({
  label,
  categories,
  muted,
  onEdit,
  editLabel
}: {
  label: string
  categories: MiniAppUtilityCategory[]
  muted?: boolean | undefined
  onEdit: (category: MiniAppUtilityCategory) => void
  editLabel: string
}) {
  if (categories.length === 0) return null

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-faint">{label}</p>
      {categories.map((category) => (
        <button
          key={category.slug}
          type="button"
          onClick={() => onEdit(category)}
          className={`flex w-full items-center gap-3 rounded-xl bg-elevated px-3 py-2.5 text-left transition-colors active:bg-field-hover ${
            muted ? 'opacity-60' : ''
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{category.name}</p>
            <p className="truncate text-xs text-faint">
              {category.providerName || category.customerNumber || category.note || '—'}
            </p>
          </div>
          <span className="shrink-0 text-xs font-medium text-primary">{editLabel}</span>
        </button>
      ))}
    </div>
  )
}

export function CategoriesSheet({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { initData, handleMiniAppRequestError } = useSession()
  const { adminSettings, refresh } = useDashboard()
  const { copy, locale } = useI18n()
  const { showToast } = useToast()

  const [editingSlug, setEditingSlug] = useState<string | null>(null)
  const [form, setForm] = useState<CategoryFormState>(emptyCategoryForm)
  const [saving, setSaving] = useState(false)

  const sortedCategories = useMemo(
    () =>
      [...(adminSettings?.categories ?? [])].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name)
      ),
    [adminSettings]
  )
  const activeCategories = sortedCategories.filter((category) => category.isActive)
  const inactiveCategories = sortedCategories.filter((category) => !category.isActive)

  function openAddCategory() {
    setEditingSlug(NEW_CATEGORY_SLUG)
    setForm({ ...emptyCategoryForm, sortOrder: sortedCategories.length })
  }

  function openEditCategory(category: MiniAppUtilityCategory) {
    setEditingSlug(category.slug)
    setForm({
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
    setEditingSlug(null)
    setForm(emptyCategoryForm)
  }

  function handleSheetOpenChange(next: boolean) {
    if (!next) closeCategoryEditor()
    onOpenChange(next)
  }

  async function handleSaveCategory() {
    if (!initData || saving || !editingSlug) return
    setSaving(true)
    try {
      await upsertMiniAppUtilityCategory(initData, {
        ...(editingSlug !== NEW_CATEGORY_SLUG ? { slug: editingSlug } : {}),
        name: form.name,
        sortOrder: form.sortOrder,
        isActive: form.isActive,
        providerName: form.providerName.trim() || null,
        customerNumber: form.customerNumber.trim() || null,
        paymentLink: form.paymentLink.trim() || null,
        note: form.note.trim() || null
      })
      await refresh()
      closeCategoryEditor()
    } catch (error) {
      if (!handleMiniAppRequestError(error)) {
        showToast(
          locale === 'ru' ? 'Не получилось сохранить категорию.' : 'Failed to save category.',
          'error'
        )
      }
    } finally {
      setSaving(false)
    }
  }

  const editorTitle =
    editingSlug === NEW_CATEGORY_SLUG ? copy.addCategoryAction : copy.editCategoryAction

  return (
    <Sheet
      open={open}
      onOpenChange={handleSheetOpenChange}
      title={editingSlug ? editorTitle : copy.manageUtilitiesAction}
      footer={
        editingSlug ? (
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={closeCategoryEditor}>
              <X className="size-4" aria-hidden />
              {copy.closeEditorAction}
            </Button>
            <Button
              variant="primary"
              loading={saving}
              disabled={form.name.trim().length < 1}
              onClick={() => void handleSaveCategory()}
            >
              <Check className="size-4" aria-hidden />
              {saving ? copy.savingCategory : copy.saveCategoryAction}
            </Button>
          </div>
        ) : undefined
      }
    >
      {editingSlug ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {editingSlug === NEW_CATEGORY_SLUG ? copy.categoryCreateBody : copy.categoryEditorBody}
          </p>
          <Field label={copy.utilityCategoryName}>
            <Input
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </Field>
          <Field label="Provider">
            <Input
              value={form.providerName}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, providerName: event.target.value }))
              }
            />
          </Field>
          <Field label="Customer / account number">
            <Input
              value={form.customerNumber}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, customerNumber: event.target.value }))
              }
            />
          </Field>
          <Field label="Payment link">
            <Input
              value={form.paymentLink}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, paymentLink: event.target.value }))
              }
            />
          </Field>
          <Field label="Note">
            <Textarea
              value={form.note}
              onChange={(event) => setForm((prev) => ({ ...prev, note: event.target.value }))}
            />
          </Field>
          <Field label="Sort order">
            <Input
              type="number"
              value={String(form.sortOrder)}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value) || 0 }))
              }
            />
          </Field>
          <div className="flex items-center justify-between rounded-xl bg-elevated px-3 py-2.5">
            <span className="text-sm text-foreground">{copy.utilityCategoryActive}</span>
            <Switch
              checked={form.isActive}
              aria-label={copy.utilityCategoryActive}
              onCheckedChange={(checked) => setForm((prev) => ({ ...prev, isActive: checked }))}
            />
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-3">
            <p className="text-sm text-muted-foreground">{copy.utilityCategoriesBody}</p>
            <Button variant="primary" size="sm" onClick={openAddCategory}>
              <Plus className="size-3.5" />
              {copy.addCategoryAction}
            </Button>
          </div>

          {sortedCategories.length === 0 ? (
            <p className="text-sm text-muted-foreground">{copy.utilityCategoriesBody}</p>
          ) : (
            <div className="space-y-4">
              <CategoryGroup
                label={copy.onLabel}
                categories={activeCategories}
                onEdit={openEditCategory}
                editLabel={copy.editCategoryAction}
              />
              <CategoryGroup
                label={copy.offLabel}
                categories={inactiveCategories}
                muted
                onEdit={openEditCategory}
                editLabel={copy.editCategoryAction}
              />
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

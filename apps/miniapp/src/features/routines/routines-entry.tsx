import { Check, ChevronRight } from 'lucide-react'
import { useI18n } from '@/i18n/context'

export function openRoutines() {
  window.dispatchEvent(new CustomEvent('miniapp:routines'))
}
export function RoutinesEntry() {
  const { locale } = useI18n()
  return (
    <button
      type="button"
      onClick={openRoutines}
      className="flex min-h-14 w-full items-center gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-left"
    >
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary-soft text-primary">
        <Check className="size-5" />
      </span>
      <span className="flex-1 text-sm font-semibold">
        {locale === 'ru' ? 'Регулярные дела' : 'Shared routines'}
      </span>
      <ChevronRight className="size-4 text-faint" />
    </button>
  )
}

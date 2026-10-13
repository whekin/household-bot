import { Check, ChevronRight } from 'lucide-react'

import { useToast } from '@/components/toast'
import { openRoutines } from '@/features/routines/routines-entry'
import { useRoutinesToday } from '@/features/routines/use-routines'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/cn'
import { haptics } from '@/telegram/webapp'

/**
 * Today's shared tasks, tickable right here. One tap marks a task done for the
 * whole house; tapping again reopens it.
 */
export function RoutinesCard() {
  const { copy } = useI18n()
  const { showToast } = useToast()
  const { routines, loading, toggle } = useRoutinesToday()

  if (loading || routines.length === 0) return null

  const rows = routines.flatMap((routine) =>
    (routine.day?.rows ?? []).map((row) => ({ routine, row }))
  )
  const done = rows.filter(({ row }) => row.status === 'completed').length

  return (
    <section className="animate-rise rounded-[24px] bg-card p-4 [animation-delay:120ms]">
      <button
        type="button"
        onClick={openRoutines}
        className="mb-2 flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex items-center gap-2">
          <span className="text-[15px] font-semibold">{copy.routinesTitle}</span>
          <span className="rounded-full bg-routine-soft px-2 py-0.5 text-[11px] font-bold tabular-nums text-routine-ink">
            {done}/{rows.length}
          </span>
        </span>
        <span className="flex items-center gap-0.5 text-[13px] font-medium text-faint">
          {copy.routinesOpen}
          <ChevronRight className="size-4" />
        </span>
      </button>

      {done === rows.length ? (
        <p className="py-2 text-sm text-muted-foreground">{copy.routinesAllDone}</p>
      ) : null}

      <ul>
        {rows.map(({ routine, row }) => {
          const completed = row.status === 'completed'
          const meta = completed
            ? copy.routinesDoneBy.replace('{name}', row.actorName ?? '—')
            : row.status === 'claimed'
              ? copy.routinesTakenBy.replace('{name}', row.actorName ?? '—')
              : (row.localTime ?? copy.routinesAnyTime)
          return (
            <li key={row.id}>
              <button
                type="button"
                onClick={() => {
                  haptics.impact(completed ? 'light' : 'medium')
                  toggle({ routine, row, action: completed ? 'reopen' : 'complete' }).catch(() =>
                    showToast(copy.routinesFailed, 'error')
                  )
                }}
                className="flex min-h-14 w-full items-center gap-3 text-left"
              >
                <span
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
                    completed
                      ? 'border-routine bg-routine text-white'
                      : 'border-border-hover text-transparent'
                  )}
                >
                  <Check className="size-4" strokeWidth={3} />
                </span>
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      'block truncate text-[15px] font-medium',
                      completed && 'text-faint line-through decoration-faint/60'
                    )}
                  >
                    {row.title}
                  </span>
                  <span className="block truncate text-xs text-faint">{meta}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

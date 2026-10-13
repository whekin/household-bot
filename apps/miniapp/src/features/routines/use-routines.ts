import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { miniAppApiError, postMiniApp } from '@/api/client'
import { useSession } from '@/app/session-context'
import type { RoutineView, RoutinesResponse } from './types'

type RoutineRow = NonNullable<RoutineView['day']>['rows'][number]
type RowAction = 'complete' | 'reopen'

export function routinesQueryKey(demo: boolean, initData: string | undefined) {
  return ['routines', demo ? 'demo' : (initData ?? '')] as const
}

/* The demo keeps one in-memory household so a tick on Home survives a remount. */
let demoState: RoutinesResponse | null = null

// Loaded on demand: the demo pulls the routine domain code, which live users never need here.
async function demoRoutines(): Promise<RoutinesResponse> {
  if (!demoState) {
    const { demoRoutinesResponse } = await import('./routine-demo')
    demoState = demoRoutinesResponse()
  }
  return structuredClone(demoState)
}

function joinToken(): string | undefined {
  return new URLSearchParams(window.location.search).get('join') ?? undefined
}

async function requestRoutines(
  initData: string,
  body: Record<string, unknown>
): Promise<RoutinesResponse> {
  const { response, payload } = await postMiniApp<RoutinesResponse>('/api/miniapp/routines', {
    initData,
    joinToken: joinToken(),
    ...body
  })
  if (!response.ok) throw miniAppApiError(response, payload, 'Could not load routines')
  return payload
}

function withRowStatus(
  data: RoutinesResponse,
  routineId: string,
  rowId: string,
  patch: Partial<RoutineRow>
): RoutinesResponse {
  return {
    ...data,
    routines: data.routines.map((routine) =>
      routine.id !== routineId || !routine.day
        ? routine
        : {
            ...routine,
            day: {
              ...routine.day,
              rows: routine.day.rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row))
            }
          }
    )
  }
}

/**
 * Today's shared routines for Home. Ticking a task updates the list at once and
 * rolls back if the server refuses it.
 */
export function useRoutinesToday() {
  const { initData, readySession, handleMiniAppRequestError } = useSession()
  const queryClient = useQueryClient()
  const demo = readySession?.mode === 'demo'
  const key = routinesQueryKey(demo, initData)

  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      demo
        ? Promise.resolve(demoRoutines())
        : requestRoutines(initData ?? '', { operation: 'list' }),
    enabled: Boolean(readySession) && (demo || Boolean(initData)),
    refetchInterval: () => (document.hidden ? false : 30_000)
  })

  const toggle = useMutation({
    mutationFn: async (input: { routine: RoutineView; row: RoutineRow; action: RowAction }) => {
      if (demo) {
        demoState = withRowStatus(await demoRoutines(), input.routine.id, input.row.id, {
          status: input.action === 'complete' ? 'completed' : 'pending',
          actorId: readySession?.member.id ?? null,
          actorName: readySession?.member.displayName ?? null,
          version: input.row.version + 1
        })
        return demoRoutines()
      }
      return requestRoutines(initData ?? '', {
        operation: 'act',
        id: input.routine.id,
        rowId: input.row.id,
        version: input.row.version,
        action: input.action,
        requestId: crypto.randomUUID()
      })
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<RoutinesResponse>(key)
      if (previous) {
        queryClient.setQueryData(
          key,
          withRowStatus(previous, input.routine.id, input.row.id, {
            status: input.action === 'complete' ? 'completed' : 'pending',
            actorId: readySession?.member.id ?? null,
            actorName: readySession?.member.displayName ?? null
          })
        )
      }
      return { previous }
    },
    onError: (error, _input, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
      handleMiniAppRequestError(error)
    },
    onSuccess: (data) => {
      queryClient.setQueryData(key, data)
    }
  })

  const routines = (query.data?.routines ?? []).filter(
    (routine) => !routine.paused && (routine.day?.rows.length ?? 0) > 0
  )

  return {
    routines,
    loading: query.isPending,
    error: query.error,
    toggle: toggle.mutateAsync,
    toggling: toggle.isPending
  }
}

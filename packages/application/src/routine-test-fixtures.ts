import type { RoutineDocument, RoutineRepository } from '@household/ports'
import type { RoutineActor } from './routine-service'

export function routineMemoryRepository(): RoutineRepository {
  const docs = new Map<string, RoutineDocument>()
  return {
    async list(householdId) {
      return structuredClone(
        [...docs.values()].filter((d) => !householdId || d.householdId === householdId)
      )
    },
    async get(id) {
      return structuredClone(docs.get(id) ?? null)
    },
    async create(doc) {
      if (!docs.has(doc.id)) docs.set(doc.id, structuredClone(doc))
      return structuredClone(docs.get(doc.id)!)
    },
    async change(id, householdId, change) {
      const doc = structuredClone(docs.get(id))
      if (!doc || doc.householdId !== householdId) throw new Error('Routine not found')
      change(doc)
      docs.set(id, doc)
      return structuredClone(doc)
    }
  }
}
export const routineActor: RoutineActor = {
  id: 'alex',
  householdId: 'house',
  telegramUserId: '100',
  displayName: 'Саша',
  isAdmin: true,
  status: 'active'
}
export const routineInput = {
  id: 'aabbccddeeff0011',
  expectedRevision: 0,
  definition: {
    title: 'Дом',
    tasks: [
      {
        id: 'water',
        title: 'Вода',
        weekdays: [1, 2, 3, 4, 5, 6, 7],
        times: ['09:00'],
        reminderEnabled: true,
        claimEnabled: true
      }
    ]
  },
  publishTime: '08:00',
  timezone: 'Asia/Tbilisi'
}

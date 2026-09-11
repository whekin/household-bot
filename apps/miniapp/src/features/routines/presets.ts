import type { RoutineDefinition, RoutineTask } from '@household/domain'

interface PresetTask extends Omit<RoutineTask, 'title'> {
  readonly title: { readonly ru: string; readonly en: string }
}
export interface RoutinePreset {
  readonly id: string
  readonly name: { readonly ru: string; readonly en: string }
  readonly hint: { readonly ru: string; readonly en: string }
  readonly publishTime: string
  readonly tasks: readonly PresetTask[]
}

const daily = [1, 2, 3, 4, 5, 6, 7]
const task = (
  id: string,
  ru: string,
  en: string,
  time: string,
  options: { reminder?: boolean; claim?: boolean } = {}
): PresetTask => ({
  id,
  title: { ru, en },
  weekdays: daily,
  times: [time],
  reminderEnabled: options.reminder ?? false,
  claimEnabled: options.claim ?? false
})

/**
 * Starting points only: every field stays editable before and after saving,
 * and nothing here is advice about how a household should care for anything.
 */
export const routinePresets: readonly RoutinePreset[] = [
  {
    id: 'kitten-care',
    name: { ru: 'Уход за котятами', en: 'Kitten care' },
    hint: {
      ru: 'Кормления и вода на ночь. Напоминания — только на два кормления со смесью.',
      en: 'Feedings plus water at night. Reminders only for the two formula feedings.'
    },
    publishTime: '08:00',
    tasks: [
      task('feed-morning', 'Кормление', 'Feeding', '09:30'),
      task('feed-midday', 'Кормление со смесью', 'Feeding with formula', '12:30', {
        reminder: true,
        claim: true
      }),
      task('feed-day', 'Кормление', 'Feeding', '16:00'),
      task('feed-evening', 'Кормление со смесью', 'Feeding with formula', '20:00', {
        reminder: true,
        claim: true
      }),
      task('water-night', 'Бутылки с тёплой водой', 'Warm water bottles', '21:30'),
      task('feed-night', 'Ночное кормление', 'Night feeding', '23:30')
    ]
  }
]

export function presetDefinition(preset: RoutinePreset, locale: string): RoutineDefinition {
  const language = locale === 'ru' ? 'ru' : 'en'
  return {
    title: preset.name[language],
    tasks: preset.tasks.map(({ title, ...rest }) => ({ ...rest, title: title[language] }))
  }
}

import { DatePicker, parseDate } from '@ark-ui/solid/date-picker'
import { createCalendar } from '@internationalized/date'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-solid'
import { Index, Show } from 'solid-js'
import { Portal } from 'solid-js/web'

import type { Locale } from '../../i18n'
import { cn } from '../../lib/cn'

type DatePickerProps = {
  value?: string | null
  placeholder?: string
  mode?: 'date' | 'month'
  locale: Locale
  disabled?: boolean
  portal?: boolean
  class?: string
  onChange?: (value: string | null) => void
}

type DateValueLike = {
  year: number
  month: number
  day: number
  toDate: (timeZone: string) => Date
}

function localeTag(locale: Locale): string {
  return locale === 'ru' ? 'ru-RU' : 'en-US'
}

function parsePickerValue(value: string | null | undefined, mode: 'date' | 'month') {
  if (!value) {
    return []
  }

  const normalized = mode === 'month' ? `${value}-01` : value

  try {
    return [parseDate(normalized)]
  } catch {
    return []
  }
}

function serializePickerValue(value: DateValueLike, mode: 'date' | 'month'): string {
  const year = String(value.year).padStart(4, '0')
  const month = String(value.month).padStart(2, '0')
  const day = String(value.day).padStart(2, '0')

  return mode === 'month' ? `${year}-${month}` : `${year}-${month}-${day}`
}

export function DatePickerField(props: DatePickerProps) {
  const mode = props.mode ?? 'date'
  const usePortal = props.portal ?? true

  const renderPopoverContent = () => (
    <DatePicker.Positioner class="ui-date-picker__positioner">
      <DatePicker.Content class="ui-date-picker__content">
        <DatePicker.Context>
          {(api) => (
            <>
              <DatePicker.ViewControl class="ui-date-picker__header">
                <DatePicker.PrevTrigger class="ui-date-picker__nav">
                  <ChevronLeft size={16} />
                </DatePicker.PrevTrigger>
                <DatePicker.ViewTrigger class="ui-date-picker__view-trigger">
                  <DatePicker.RangeText class="ui-date-picker__title" />
                </DatePicker.ViewTrigger>
                <DatePicker.NextTrigger class="ui-date-picker__nav">
                  <ChevronRight size={16} />
                </DatePicker.NextTrigger>
              </DatePicker.ViewControl>

              <DatePicker.View
                view={mode === 'month' ? 'month' : 'day'}
                class="ui-date-picker__view"
              >
                <Show
                  when={mode === 'date'}
                  fallback={
                    <div class="ui-date-picker__month-grid">
                      <Index each={api().getMonthsGrid({ columns: 3, format: 'short' })}>
                        {(row) => (
                          <div class="ui-date-picker__month-row">
                            <Index each={row()}>
                              {(month) => (
                                <DatePicker.TableCell
                                  value={month().value}
                                  class="ui-date-picker__month-cell"
                                >
                                  <DatePicker.TableCellTrigger class="ui-date-picker__month-trigger">
                                    {month().label}
                                  </DatePicker.TableCellTrigger>
                                </DatePicker.TableCell>
                              )}
                            </Index>
                          </div>
                        )}
                      </Index>
                    </div>
                  }
                >
                  <DatePicker.Table class="ui-date-picker__table">
                    <DatePicker.TableHead>
                      <DatePicker.TableRow>
                        <Index each={api().weekDays}>
                          {(weekDay) => (
                            <DatePicker.TableHeader class="ui-date-picker__weekday">
                              {weekDay().narrow}
                            </DatePicker.TableHeader>
                          )}
                        </Index>
                      </DatePicker.TableRow>
                    </DatePicker.TableHead>
                    <DatePicker.TableBody>
                      <Index each={api().weeks}>
                        {(week) => (
                          <DatePicker.TableRow>
                            <Index each={week()}>
                              {(day) => (
                                <DatePicker.TableCell
                                  value={day()}
                                  class="ui-date-picker__day-cell"
                                >
                                  <DatePicker.TableCellTrigger class="ui-date-picker__day-trigger">
                                    {day().day}
                                  </DatePicker.TableCellTrigger>
                                </DatePicker.TableCell>
                              )}
                            </Index>
                          </DatePicker.TableRow>
                        )}
                      </Index>
                    </DatePicker.TableBody>
                  </DatePicker.Table>
                </Show>
              </DatePicker.View>
            </>
          )}
        </DatePicker.Context>
      </DatePicker.Content>
    </DatePicker.Positioner>
  )

  return (
    <DatePicker.Root
      class={cn('ui-date-picker', props.class)}
      value={parsePickerValue(props.value, mode)}
      locale={localeTag(props.locale)}
      createCalendar={createCalendar}
      closeOnSelect
      disabled={props.disabled}
      positioning={{
        placement: 'bottom-start',
        sameWidth: true,
        strategy: usePortal ? 'absolute' : 'fixed',
        gutter: 8
      }}
      defaultView={mode === 'month' ? 'month' : 'day'}
      minView={mode === 'month' ? 'month' : 'day'}
      maxView={mode === 'month' ? 'month' : 'year'}
      onValueChange={(details) => {
        const nextValue = details.value[0] as DateValueLike | undefined
        props.onChange?.(nextValue ? serializePickerValue(nextValue, mode) : null)
      }}
    >
      <DatePicker.Control class="ui-date-picker__control">
        <DatePicker.Trigger class="ui-date-picker__field" aria-label={props.placeholder}>
          <CalendarDays size={16} />
          <DatePicker.ValueText
            class="ui-date-picker__value"
            placeholder={props.placeholder ?? ''}
          />
        </DatePicker.Trigger>
        <Show when={props.value}>
          <DatePicker.ClearTrigger
            class="ui-date-picker__clear"
            aria-label={props.locale === 'ru' ? 'Очистить дату' : 'Clear date'}
          >
            <X size={14} />
          </DatePicker.ClearTrigger>
        </Show>
      </DatePicker.Control>
      <Show when={usePortal} fallback={renderPopoverContent()}>
        <Portal>{renderPopoverContent()}</Portal>
      </Show>
    </DatePicker.Root>
  )
}

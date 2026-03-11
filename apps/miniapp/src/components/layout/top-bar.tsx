import type { Locale } from '../../i18n'
import { GlobeIcon } from '../ui'

type Props = {
  subtitle: string
  title: string
  languageLabel: string
  locale: Locale
  saving: boolean
  onChange: (locale: Locale) => void
}

export function TopBar(props: Props) {
  return (
    <section class="topbar">
      <div>
        <p class="eyebrow">{props.subtitle}</p>
        <h1>{props.title}</h1>
      </div>

      <div class="locale-switch locale-switch--compact">
        <span class="locale-switch__label sr-only">{props.languageLabel}</span>
        <div class="locale-switch__buttons">
          <span class="locale-switch__icon" aria-hidden="true">
            <GlobeIcon />
          </span>
          <button
            classList={{ 'is-active': props.locale === 'en' }}
            type="button"
            disabled={props.saving}
            aria-label={`${props.languageLabel}: English`}
            onClick={() => props.onChange('en')}
          >
            EN
          </button>
          <button
            classList={{ 'is-active': props.locale === 'ru' }}
            type="button"
            disabled={props.saving}
            aria-label={`${props.languageLabel}: Russian`}
            onClick={() => props.onChange('ru')}
          >
            RU
          </button>
        </div>
      </div>
    </section>
  )
}

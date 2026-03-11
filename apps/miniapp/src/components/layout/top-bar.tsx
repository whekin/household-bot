import type { Locale } from '../../i18n'

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

      <label class="locale-switch">
        <span>{props.languageLabel}</span>
        <div class="locale-switch__buttons">
          <button
            classList={{ 'is-active': props.locale === 'en' }}
            type="button"
            disabled={props.saving}
            onClick={() => props.onChange('en')}
          >
            EN
          </button>
          <button
            classList={{ 'is-active': props.locale === 'ru' }}
            type="button"
            disabled={props.saving}
            onClick={() => props.onChange('ru')}
          >
            RU
          </button>
        </div>
      </label>
    </section>
  )
}

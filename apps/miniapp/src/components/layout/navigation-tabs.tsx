import type { JSX } from 'solid-js'

type TabItem<T extends string> = {
  key: T
  label: string
  icon?: JSX.Element
}

type Props<T extends string> = {
  items: readonly TabItem<T>[]
  active: T
  onChange: (key: T) => void
}

export function NavigationTabs<T extends string>(props: Props<T>): JSX.Element {
  return (
    <nav class="nav-grid">
      {props.items.map((item) => (
        <button
          classList={{ 'is-active': props.active === item.key }}
          type="button"
          onClick={() => props.onChange(item.key)}
        >
          {item.icon}
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  )
}

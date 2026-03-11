import { Show, type JSX } from 'solid-js'

import { Button, MiniChip } from '../ui'

type Props = {
  badges: readonly string[]
  title: string
  body: string
  action?:
    | {
        label: string
        onClick: () => void
      }
    | undefined
}

export function HeroBanner(props: Props): JSX.Element {
  return (
    <section class="hero-card">
      <div class="hero-card__meta">
        {props.badges.map((badge, index) => (
          <MiniChip muted={index > 0}>{badge}</MiniChip>
        ))}
      </div>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      <Show when={props.action}>
        {(action) => (
          <div class="panel-toolbar">
            <Button variant="secondary" onClick={() => action().onClick()}>
              {action().label}
            </Button>
          </div>
        )}
      </Show>
    </section>
  )
}

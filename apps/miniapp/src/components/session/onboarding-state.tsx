import { Show } from 'solid-js'

import { Button } from '../ui'

type Props = {
  badge: string
  title: string
  body: string
  joinActionLabel: string
  joiningLabel: string
  joining: boolean
  canJoin: boolean
  botLinkLabel: string
  botLink: string | null
  reloadLabel: string
  onJoin: () => void
  onReload: () => void
}

export function OnboardingState(props: Props) {
  return (
    <section class="hero-card">
      <div class="hero-card__meta">
        <span class="pill">{props.badge}</span>
      </div>
      <h2>{props.title}</h2>
      <p>{props.body}</p>
      <div class="nav-grid">
        <Show when={props.canJoin}>
          <Button variant="ghost" disabled={props.joining} onClick={props.onJoin}>
            {props.joining ? props.joiningLabel : props.joinActionLabel}
          </Button>
        </Show>
        <Show when={props.botLink}>
          {(link) => (
            <a class="ui-button ui-button--ghost" href={link()} target="_blank" rel="noreferrer">
              {props.botLinkLabel}
            </a>
          )}
        </Show>
        <Button variant="ghost" onClick={props.onReload}>
          {props.reloadLabel}
        </Button>
      </div>
    </section>
  )
}

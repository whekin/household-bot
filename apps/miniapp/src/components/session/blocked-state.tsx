import { HeroBanner } from '../layout/hero-banner'

type Props = {
  badge: string
  title: string
  body: string
  reloadLabel: string
  onReload: () => void
}

export function BlockedState(props: Props) {
  return (
    <HeroBanner
      badges={[props.badge]}
      title={props.title}
      body={props.body}
      action={{ label: props.reloadLabel, onClick: props.onReload }}
    />
  )
}

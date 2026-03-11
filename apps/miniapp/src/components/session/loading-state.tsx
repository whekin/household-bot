import { HeroBanner } from '../layout/hero-banner'

type Props = {
  badge: string
  title: string
  body: string
}

export function LoadingState(props: Props) {
  return <HeroBanner badges={[props.badge]} title={props.title} body={props.body} />
}

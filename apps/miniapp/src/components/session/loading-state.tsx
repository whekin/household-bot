import { Skeleton } from '../ui/skeleton'

type Props = {
  badge: string
  title: string
  body: string
}

export function LoadingState(props: Props) {
  return (
    <section class="loading-shell" aria-live="polite" aria-busy="true">
      <header class="loading-shell__top">
        <div class="loading-shell__copy">
          <Skeleton width="120px" height="12px" />
          <Skeleton width="190px" height="44px" />
        </div>
        <div class="loading-shell__actions">
          <Skeleton width="88px" height="40px" />
          <Skeleton width="132px" height="40px" />
        </div>
      </header>

      <div class="loading-shell__chips">
        <Skeleton width="124px" height="34px" />
        <Skeleton width="152px" height="34px" />
        <Skeleton width="92px" height="34px" />
      </div>

      <div class="loading-shell__card">
        <Skeleton width="72px" height="18px" />
        <Skeleton width="100%" height="10px" />
        <Skeleton width="46%" height="58px" />
        <Skeleton width="72%" height="18px" />

        <div class="loading-shell__stats">
          <Skeleton height="78px" />
          <Skeleton height="78px" />
        </div>

        <Skeleton width="100%" height="12px" />

        <div class="loading-shell__buttons">
          <Skeleton height="52px" />
          <Skeleton height="52px" />
        </div>
      </div>

      <div class="loading-shell__status">
        <span>{props.badge}</span>
        <strong>{props.title}</strong>
        <p>{props.body}</p>
      </div>
    </section>
  )
}

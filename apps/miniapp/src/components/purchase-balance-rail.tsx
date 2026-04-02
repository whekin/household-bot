import { For, Show } from 'solid-js'

export type PurchaseBalanceRailRow = {
  memberId: string
  displayName: string
  balanceLabel: string
  width: string
  side: 'left' | 'right' | 'none'
  isCurrent?: boolean
  metaLabel?: string
  metaValue?: string
}

type PurchaseBalanceRailProps = {
  rows: PurchaseBalanceRailRow[]
  currentLabel: string
  variant?: 'compact' | 'detail'
  surface?: 'boxed' | 'flat'
}

export function normalizedRailWidth(valueMinor: bigint, maxMinor: bigint): string {
  if (maxMinor <= 0n) return '0%'
  return `${Math.max((Number(valueMinor) / Number(maxMinor)) * 100, 6)}%`
}

export function PurchaseBalanceRail(props: PurchaseBalanceRailProps) {
  const variant = () => props.variant ?? 'compact'
  const surface = () => props.surface ?? 'boxed'

  return (
    <div
      class={`purchase-balance-rail purchase-balance-rail--${variant()} purchase-balance-rail--${surface()}`}
    >
      <div class="purchase-balance-rail__list">
        <For each={props.rows}>
          {(row) => (
            <div class="purchase-balance-rail__row" classList={{ 'is-current': row.isCurrent }}>
              <div class="purchase-balance-rail__head">
                <div class="purchase-balance-rail__member">
                  <strong>{row.displayName}</strong>
                  <Show when={row.isCurrent}>
                    <span class="purchase-balance-rail__current">{props.currentLabel}</span>
                  </Show>
                </div>
                <span>{row.balanceLabel}</span>
              </div>
              <div class="purchase-balance-rail__track">
                <div class="purchase-balance-rail__zero" />
                <Show when={row.side !== 'none'}>
                  <div
                    class={`purchase-balance-rail__fill ${
                      row.side === 'left' ? 'is-left' : 'is-right'
                    }`}
                    style={{
                      width: row.width,
                      left: row.side === 'left' ? `calc(50% - ${row.width})` : '50%'
                    }}
                  />
                </Show>
              </div>
              <Show when={row.metaLabel && row.metaValue}>
                <div class="purchase-balance-rail__meta">
                  <span>{row.metaLabel}</span>
                  <strong>{row.metaValue}</strong>
                </div>
              </Show>
            </div>
          )}
        </For>
      </div>
    </div>
  )
}

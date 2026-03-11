import { For } from 'solid-js'

import type { MiniAppDashboard } from '../../miniapp-api'
import { StatCard } from '../ui'

type SummaryItem = {
  label: string
  value: string
}

type Props = {
  dashboard: MiniAppDashboard
  utilityTotalMajor: string
  purchaseTotalMajor: string
  labels: {
    remaining: string
    rent: string
    utilities: string
    purchases: string
  }
}

export function FinanceSummaryCards(props: Props) {
  const items: SummaryItem[] = [
    {
      label: props.labels.remaining,
      value: `${props.dashboard.totalRemainingMajor} ${props.dashboard.currency}`
    },
    {
      label: props.labels.rent,
      value: `${props.dashboard.rentDisplayAmountMajor} ${props.dashboard.currency}`
    },
    {
      label: props.labels.utilities,
      value: `${props.utilityTotalMajor} ${props.dashboard.currency}`
    },
    {
      label: props.labels.purchases,
      value: `${props.purchaseTotalMajor} ${props.dashboard.currency}`
    }
  ]

  return (
    <For each={items}>
      {(item) => (
        <StatCard>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
        </StatCard>
      )}
    </For>
  )
}

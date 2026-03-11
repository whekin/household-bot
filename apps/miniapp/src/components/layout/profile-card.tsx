import { Card, MiniChip } from '../ui'

type Props = {
  displayName: string
  roleLabel: string
  statusSummary: string
  modeBadge: string
  localeBadge: string
}

export function ProfileCard(props: Props) {
  return (
    <Card class="profile-card" accent>
      <header>
        <strong>{props.displayName}</strong>
        <span>{props.roleLabel}</span>
      </header>
      <p>{props.statusSummary}</p>
      <div class="ledger-compact-card__meta">
        <MiniChip>{props.modeBadge}</MiniChip>
        <MiniChip muted>{props.localeBadge}</MiniChip>
      </div>
    </Card>
  )
}

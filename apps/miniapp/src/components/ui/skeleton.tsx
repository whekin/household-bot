import { cn } from '../../lib/cn'

type SkeletonProps = {
  class?: string
  width?: string
  height?: string
}

export function Skeleton(props: SkeletonProps) {
  return (
    <div
      class={cn('ui-skeleton', props.class)}
      style={{
        width: props.width,
        height: props.height
      }}
    />
  )
}

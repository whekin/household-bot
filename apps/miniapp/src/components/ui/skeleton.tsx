import type { JSX } from 'solid-js'
import { cn } from '../../lib/cn'

type SkeletonProps = {
  class?: string
  width?: string
  height?: string
  style?: JSX.CSSProperties
}

export function Skeleton(props: SkeletonProps) {
  return (
    <div
      class={cn('ui-skeleton', props.class)}
      style={{
        width: props.width,
        height: props.height,
        ...props.style
      }}
    />
  )
}

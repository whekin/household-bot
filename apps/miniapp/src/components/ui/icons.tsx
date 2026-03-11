import type { JSX } from 'solid-js'

type IconProps = {
  class?: string
}

function iconProps(props: IconProps): JSX.SvgSVGAttributes<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': 1.8,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    class: props.class ?? 'ui-icon',
    'aria-hidden': 'true'
  }
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M12 20h9" />
      <path d="m16.5 3.5 4 4L8 20l-5 1 1-5 12.5-12.5Z" />
    </svg>
  )
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </svg>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1 1 0 0 0 .2 1.1l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1 1 0 0 0-1.1-.2 1 1 0 0 0-.6.9V20a2 2 0 1 1-4 0v-.2a1 1 0 0 0-.7-.9 1 1 0 0 0-1 .2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1 1 0 0 0 .2-1.1 1 1 0 0 0-.9-.6H4a2 2 0 1 1 0-4h.2a1 1 0 0 0 .9-.7 1 1 0 0 0-.2-1l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1 1 0 0 0 1.1.2 1 1 0 0 0 .6-.9V4a2 2 0 1 1 4 0v.2a1 1 0 0 0 .7.9 1 1 0 0 0 1-.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1 1 0 0 0-.2 1.1 1 1 0 0 0 .9.6H20a2 2 0 1 1 0 4h-.2a1 1 0 0 0-.9.7Z" />
    </svg>
  )
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="M8 2v4" />
      <path d="M16 2v4" />
      <rect width="18" height="18" x="3" y="4" rx="2" />
      <path d="M3 10h18" />
    </svg>
  )
}

export function GlobeIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18" />
      <path d="M12 3a15 15 0 0 0 0 18" />
    </svg>
  )
}

export function XIcon(props: IconProps) {
  return (
    <svg {...iconProps(props)}>
      <path d="m6 6 12 12" />
      <path d="M18 6 6 18" />
    </svg>
  )
}

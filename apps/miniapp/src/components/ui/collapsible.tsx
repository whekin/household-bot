import * as CollapsiblePrimitive from '@kobalte/core/collapsible'
import { Show, type ParentProps } from 'solid-js'
import { ChevronDown } from 'lucide-solid'

import { cn } from '../../lib/cn'

type CollapsibleProps = ParentProps<{
  title: string
  body?: string
  defaultOpen?: boolean
  class?: string
}>

export function Collapsible(props: CollapsibleProps) {
  return (
    <CollapsiblePrimitive.Root
      {...(props.defaultOpen !== undefined ? { defaultOpen: props.defaultOpen } : {})}
      class={cn('ui-collapsible', props.class)}
    >
      <CollapsiblePrimitive.Trigger class="ui-collapsible__trigger">
        <div class="ui-collapsible__copy">
          <strong>{props.title}</strong>
          <Show when={props.body}>{(body) => <p>{body()}</p>}</Show>
        </div>
        <ChevronDown class="ui-collapsible__chevron" size={18} />
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content class="ui-collapsible__content">
        {props.children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  )
}

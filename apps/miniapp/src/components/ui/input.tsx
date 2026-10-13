import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

const fieldClasses =
  'w-full rounded-xl border border-transparent bg-field px-3.5 text-[15px] text-foreground placeholder:text-faint transition-colors outline-none focus:border-border-hover focus:bg-card disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, 'h-12', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClasses, 'min-h-24 py-3', className)} {...props} />
}

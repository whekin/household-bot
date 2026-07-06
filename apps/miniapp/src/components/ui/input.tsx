import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/cn'

const fieldClasses =
  'w-full rounded-lg border border-border bg-field px-3 text-sm text-foreground placeholder:text-faint transition-colors outline-none focus:border-transparent focus:ring-2 focus:ring-ring disabled:opacity-50'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldClasses, 'h-10', className)} {...props} />
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldClasses, 'min-h-20 py-2', className)} {...props} />
}

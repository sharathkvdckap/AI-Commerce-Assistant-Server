import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Avatar({
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
        className,
      )}
      {...props}
    />
  )
}

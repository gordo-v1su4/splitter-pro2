import type { HTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border border-[#181818] bg-[#090909]',
        'px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-[#777]',
        className,
      )}
      {...props}
    />
  )
}

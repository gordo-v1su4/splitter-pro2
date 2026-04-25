import type { HTMLAttributes } from 'react'

import { cn } from '../../lib/utils'

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border border-white/[0.08] bg-white/[0.02]',
        'px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-400',
        className,
      )}
      {...props}
    />
  )
}

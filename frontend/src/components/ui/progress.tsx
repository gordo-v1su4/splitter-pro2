import { cn } from '../../lib/utils'

export function Progress({ value, className }: { value: number; className?: string }) {
  const safeValue = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-zinc-800', className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-zinc-100 via-zinc-300 to-zinc-500 transition-[width] duration-300"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  )
}

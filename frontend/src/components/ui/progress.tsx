import { cn } from '../../lib/utils'

export function Progress({ value, className }: { value: number; className?: string }) {
  const safeValue = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-px w-full overflow-hidden bg-white/[0.06]', className)}>
      <div
        className="h-full bg-zinc-500/45 transition-[width] duration-500 ease-out"
        style={{ width: `${safeValue}%` }}
      />
    </div>
  )
}

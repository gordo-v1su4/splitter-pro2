import { cn } from '../../lib/utils'

export function Progress({
  value,
  className,
  indicatorClassName,
}: {
  value: number
  className?: string
  indicatorClassName?: string
}) {
  const safeValue = Math.max(0, Math.min(100, value))
  return (
    <div className={cn('h-px w-full overflow-hidden bg-white/[0.06]', className)}>
      <div
        className={cn(
          'h-full bg-zinc-500/45 transition-[width] duration-500 ease-out',
          indicatorClassName,
        )}
        style={{ width: `${safeValue}%` }}
      />
    </div>
  )
}

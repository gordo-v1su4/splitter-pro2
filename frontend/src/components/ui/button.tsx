import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-sm font-medium tracking-tight',
    'transition-colors duration-150 outline-none',
    'focus-visible:ring-1 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0b]',
    'disabled:pointer-events-none disabled:opacity-40',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'bg-[color:var(--color-accent)] text-[#0a0a0b]',
          'hover:bg-[#c4f06b]',
        ].join(' '),
        secondary: [
          'border border-white/[0.08] bg-white/[0.02] text-zinc-200',
          'hover:bg-white/[0.05] hover:border-white/[0.16] hover:text-zinc-50',
        ].join(' '),
        ghost: [
          'text-zinc-400',
          'hover:bg-white/[0.04] hover:text-zinc-100',
        ].join(' '),
        outline: [
          'border border-white/[0.12] text-zinc-200',
          'hover:bg-white/[0.04] hover:border-white/[0.24]',
        ].join(' '),
      },
      size: {
        /* fixed height so padding/line-height can’t balloon the control */
        default: 'h-10 min-h-10 px-4 text-[13px] leading-none',
        /* ~half of default — Process video, dense chrome */
        sm: 'h-7 min-h-7 px-2.5 py-0 text-[10px] leading-none gap-1',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'default',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />
  },
)

Button.displayName = 'Button'

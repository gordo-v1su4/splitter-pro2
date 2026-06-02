import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-[2px] font-medium uppercase tracking-[0.14em]',
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
          'border border-[#181818] bg-[#090909] text-[#c0c0c0]',
          'hover:bg-white/[0.05] hover:border-white/[0.16] hover:text-[#e0e0e0]',
        ].join(' '),
        ghost: [
          'text-[#777]',
          'hover:bg-white/[0.04] hover:text-[#d4d4d4]',
        ].join(' '),
        outline: [
          'border border-white/[0.12] text-[#c0c0c0]',
          'hover:bg-white/[0.04] hover:border-white/[0.24]',
        ].join(' '),
      },
      size: {
        /* fixed height so padding/line-height can’t balloon the control */
        default: 'h-8 min-h-8 px-3 py-2 text-[10px] leading-none',
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

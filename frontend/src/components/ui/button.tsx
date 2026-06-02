import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1 rounded-[2px] border font-mono font-normal uppercase tracking-[0.16em]',
    'transition-colors duration-150 outline-none',
    'focus-visible:ring-1 focus-visible:ring-[color:var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[#0a0a0b]',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[#2a2a2a] disabled:bg-[#2a2a2a] disabled:text-[#6a6a6a] disabled:opacity-100',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'border-[color:var(--color-accent-line)] bg-[color:var(--color-accent-soft)] text-[color:var(--color-accent)]',
          'hover:border-[color:var(--color-accent)] hover:bg-[rgba(115,173,104,0.18)] active:bg-[rgba(115,173,104,0.24)]',
        ].join(' '),
        secondary: [
          'border-[#2a2a2a] bg-transparent text-[#666]',
          'hover:border-[#444] hover:bg-white/[0.03] hover:text-[#aaa]',
        ].join(' '),
        ghost: [
          'border-transparent bg-transparent text-[#666]',
          'hover:border-[#2a2a2a] hover:bg-white/[0.03] hover:text-[#aaa]',
        ].join(' '),
        outline: [
          'border-[color:var(--color-accent-line)] bg-transparent text-[color:var(--color-accent)]',
          'hover:border-[color:var(--color-accent)] hover:bg-[color:var(--color-accent-soft)]',
        ].join(' '),
      },
      size: {
        default: 'h-6 min-h-6 px-2 py-0 text-[8px] leading-none',
        sm: 'h-5 min-h-5 px-1.5 py-0 text-[8px] leading-none gap-1',
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

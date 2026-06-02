import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-1.5 rounded-[2px] border font-medium uppercase tracking-[0.14em]',
    'transition-colors duration-150 outline-none',
    'focus-visible:ring-1 focus-visible:ring-[#e05c00] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0a0a0b]',
    'disabled:pointer-events-none disabled:cursor-not-allowed disabled:border-[#2a2a2a] disabled:bg-[#2a2a2a] disabled:text-[#6a6a6a] disabled:opacity-100',
  ].join(' '),
  {
    variants: {
      variant: {
        primary: [
          'border-[#e05c00] bg-[#e05c00] text-white',
          'hover:border-[#c95200] hover:bg-[#c95200] active:bg-[#b34800]',
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
          'border-[#e05c00] bg-transparent text-[#e05c00]',
          'hover:bg-[#e05c0012]',
        ].join(' '),
      },
      size: {
        default: 'h-8 min-h-8 px-3 py-2 text-[10px] leading-none',
        sm: 'h-6 min-h-6 px-2 py-0 text-[9px] leading-none gap-1',
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

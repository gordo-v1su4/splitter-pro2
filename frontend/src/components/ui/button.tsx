import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '../../lib/utils'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-400/70 disabled:pointer-events-none disabled:opacity-55',
  {
    variants: {
      variant: {
        primary:
          'bg-zinc-100 px-4 py-2.5 text-zinc-950 shadow-[0_10px_24px_rgba(0,0,0,0.18)] hover:-translate-y-0.5 hover:bg-white',
        secondary:
          'border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-zinc-100 hover:-translate-y-0.5 hover:border-zinc-500 hover:bg-zinc-800',
        ghost: 'px-4 py-2.5 text-zinc-300 hover:bg-zinc-900 hover:text-zinc-50',
      },
    },
    defaultVariants: {
      variant: 'primary',
    },
  },
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant }), className)} ref={ref} {...props} />
  },
)

Button.displayName = 'Button'

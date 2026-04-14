import { forwardRef, type CSSProperties, type ButtonHTMLAttributes, type AnchorHTMLAttributes } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const base =
  'inline-flex items-center justify-center gap-2 rounded-xl font-[family-name:var(--font-heading)] font-semibold transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-50'

const variants = {
  primary: 'bg-[var(--brand)]',
  secondary: 'border-[1.5px] border-gray-100 bg-white text-[var(--brand)]',
  accent: 'bg-[var(--brand-accent)] text-[var(--brand)]',
  destructive: 'border-[1.5px] border-[#E53E3E] bg-[#FFF0F0] text-[#E53E3E]',
  warning: 'border-[1.5px] border-[#FF8C42] bg-[#FFF3EA] text-[#8B4000]',
  ghost: 'text-[var(--brand)] hover:bg-gray-50',
} as const

const variantStyles: Partial<Record<keyof typeof variants, CSSProperties>> = {
  primary: { color: '#FFFFFF' },
}

const sizes = {
  default: 'h-[52px] px-3.5 text-body',
  sm: 'px-3.5 py-2.5 text-sm',
  xs: 'px-3 py-2 text-body-sm',
} as const

export interface VercoButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: keyof typeof variants
  size?: keyof typeof sizes
  /** When set, renders as a Next.js Link instead of a button */
  href?: string
}

const VercoButton = forwardRef<HTMLButtonElement, VercoButtonProps>(
  ({ className, variant = 'primary', size = 'default', href, style, children, ...props }, ref) => {
    const classes = cn(base, variants[variant], sizes[size], className)
    const mergedStyle = { ...variantStyles[variant], ...style }

    if (href) {
      return (
        <Link
          href={href}
          className={classes}
          style={mergedStyle}
          {...(props as unknown as AnchorHTMLAttributes<HTMLAnchorElement>)}
        >
          {children}
        </Link>
      )
    }

    return (
      <button ref={ref} className={classes} style={mergedStyle} {...props}>
        {children}
      </button>
    )
  }
)
VercoButton.displayName = 'VercoButton'

export { VercoButton, variants as vercoButtonVariants, sizes as vercoButtonSizes }

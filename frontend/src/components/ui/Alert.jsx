import { cn } from '@/utils'

const styles = {
  info: 'border-line-strong text-fg',
  success: 'border-teal text-fg',
  warning: 'border-orange text-fg',
  error: 'border-orange text-fg',
}

/** Inline status message: panel surface, hairline border, plain text. */
export default function Alert({ variant = 'info', className, children }) {
  return (
    <div role="alert" className={cn('rounded-card border-hair bg-panel px-3 py-2.5 text-[13px] leading-normal', styles[variant], className)}>
      {children}
    </div>
  )
}

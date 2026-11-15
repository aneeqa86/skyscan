import { cn } from '@/utils'

const styles = {
  info: 'border-line-strong text-fg',
  success: 'border-teal/50 text-teal',
  warning: 'border-orange/50 text-orange-light',
  error: 'border-orange text-orange',
}

/** Alert: inline status message. variant: info | success | warning | error */
export default function Alert({ variant = 'info', className, children }) {
  return (
    <div role="alert" className={cn('rounded-md border bg-ink-800 px-3 py-2 text-sm', styles[variant], className)}>
      {children}
    </div>
  )
}

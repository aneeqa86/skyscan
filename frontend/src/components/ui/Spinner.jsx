import { cn } from '@/utils'

/** Spinner in the design's style: a 3/4 arc, teal by default. */
export default function Spinner({ size = 'md', className }) {
  const px = { sm: 14, md: 18, lg: 24 }[size] ?? 18
  return (
    <svg
      className={cn('animate-spin text-teal', className)}
      width={px}
      height={px}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      role="status"
      aria-label="Loading"
    >
      <path d="M8 2a6 6 0 1 0 6 6" />
    </svg>
  )
}

/** Full-area loading state: spinner + label. */
export function PageSpinner({ label = 'Loading' }) {
  return (
    <div className="flex h-[60vh] items-center justify-center gap-2.5 text-sm text-muted">
      <Spinner />
      {label}
    </div>
  )
}

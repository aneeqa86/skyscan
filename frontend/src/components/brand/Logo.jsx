import { cn } from '@/utils'

/**
 * The SKYSCAN mark (design package: assets/logo-mark.svg): three isometric
 * blocks, the tallest roof in orange, scanned by a beacon with pulse rings and
 * dashed beams. Animation stops under prefers-reduced-motion.
 */
export function LogoMark({ size = 30, animate = true, className }) {
  const ring = animate ? 'animate-pulse-ring' : ''
  const beam = animate ? 'animate-beam' : ''
  return (
    <svg
      width={size}
      height={Math.round((size * 60) / 56)}
      viewBox="0 0 56 60"
      fill="none"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      <g stroke="#00C9A7" strokeWidth="1.2">
        <polygon points="7,30 16,34.5 16,48.5 7,44" fill="#0B1220" />
        <polygon points="16,34.5 25,30 25,44 16,48.5" fill="#0B1220" />
        <polygon points="16,25.5 25,30 16,34.5 7,30" fill="#00C9A7" />
        <polygon points="31,22 40,26.5 40,46.5 31,42" fill="#0B1220" />
        <polygon points="40,26.5 49,22 49,42 40,46.5" fill="#0B1220" />
        <polygon points="40,17.5 49,22 40,26.5 31,22" fill="#FF6B35" stroke="#FF6B35" />
        <polygon points="20,43 28,47 28,56 20,52" fill="#0B1220" />
        <polygon points="28,47 36,43 36,52 28,56" fill="#0B1220" />
        <polygon points="28,39 36,43 28,47 20,43" fill="#00C9A7" />
      </g>
      <g stroke="#00C9A7" strokeWidth=".9" strokeDasharray="2 2">
        <line className={beam} x1="28" y1="8" x2="16" y2="30" />
        <line className={beam} x1="28" y1="8" x2="40" y2="22" />
        <line className={beam} x1="28" y1="8" x2="28" y2="39" />
      </g>
      <circle cx="28" cy="8" r="2" fill="#FF6B35" />
      <g stroke="#00C9A7" strokeWidth=".8" style={{ transformBox: 'fill-box' }}>
        <circle className={ring} cx="28" cy="8" r="7" style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
        <circle
          className={ring}
          cx="28"
          cy="8"
          r="7"
          style={{ transformBox: 'fill-box', transformOrigin: 'center', animationDelay: '1.8s' }}
        />
      </g>
    </svg>
  )
}

/**
 * Lockup: mark + SKY/SCAN wordmark (Space Grotesk, wide tracking), with the
 * mono subline on marketing pages.
 */
export default function Logo({ size = 'sm', subline = false, className }) {
  const big = size === 'lg'
  return (
    <span className={cn('inline-flex items-center', big ? 'gap-3' : 'gap-2.5', className)}>
      <LogoMark size={big ? 38 : 30} />
      <span className="flex flex-col gap-1 leading-none">
        <span className={cn('font-display font-semibold tracking-[0.3em]', big ? 'text-xl' : 'text-[17px]')}>
          <span className="text-teal">SKY</span>
          <span className="text-orange">SCAN</span>
        </span>
        {subline && <span className="font-mono text-[8.5px] tracking-[0.2em] text-muted">URBAN LIDAR INTELLIGENCE</span>}
      </span>
    </span>
  )
}

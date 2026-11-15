import { cn } from '@/utils'
import IsoCity from './IsoCity'

/**
 * SKYSCAN logo: isometric block with a LiDAR pulse beacon, wordmark and subline.
 * @param {'sm'|'lg'} size
 * @param {boolean} subline show "URBAN LIDAR INTELLIGENCE"
 */
export default function Logo({ size = 'sm', subline = true, animate = true, className }) {
  const big = size === 'lg'
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <IsoCity unit={big ? 5 : 2.6} animate={animate} strokeWidth={big ? 1 : 0.75} title="SKYSCAN logo" />
      <span className="flex flex-col leading-none">
        <span className={cn('font-semibold tracking-[0.18em]', big ? 'text-3xl' : 'text-[17px]')}>
          <span className="text-teal">SKY</span>
          <span className="text-orange">SCAN</span>
        </span>
        {subline && (
          <span className={cn('mt-1 font-mono tracking-[0.2em] text-muted', big ? 'text-xs' : 'text-[8.5px]')}>
            URBAN LIDAR INTELLIGENCE
          </span>
        )}
      </span>
    </span>
  )
}

/**
 * Aerial imagery helpers: status labels for the per-change imagery check,
 * default years, and the year timeline shown over the map.
 */
import { cn } from '@/utils'

export const IMAGERY_STATUS = {
  confirmed: {
    label: 'Confirmed',
    tone: 'text-teal',
    hint: 'The imagery here changed more than at 90% of unchanged buildings of similar height.',
  },
  likely: {
    label: 'Likely',
    tone: 'text-teal',
    hint: 'The imagery here changed more than at 75% of unchanged buildings of similar height.',
  },
  not_visible: {
    label: 'Not visible',
    tone: 'text-muted',
    hint: 'The imagery changed no more than at typical unchanged buildings. Height-only changes often look like this.',
  },
  vegetation: {
    label: 'Likely vegetation',
    tone: 'text-[#9DBF5A]',
    hint: 'Mostly vegetation in the near-infrared, so probably a tree rather than a building.',
  },
  too_small: { label: 'Too small', tone: 'text-muted', hint: 'Too few image pixels inside the footprint to judge.' },
  no_imagery: { label: 'No imagery', tone: 'text-muted', hint: 'No image years bracket the two surveys here.' },
}

export const IMAGERY_FILTERS = [
  { value: 'all', label: 'All changes' },
  { value: 'seen', label: 'Confirmed or likely in imagery' },
  { value: 'confirmed', label: 'Confirmed in imagery' },
  { value: 'noveg', label: 'Hide likely vegetation' },
]

const SEEN = ['confirmed', 'likely']

/** Mapbox filter expression and JS predicate for the imagery filter. */
export function imageryFilterExpr(value) {
  if (value === 'seen') return ['in', ['coalesce', ['get', 'imagery_status'], ''], ['literal', SEEN]]
  if (value === 'confirmed') return ['==', ['get', 'imagery_status'], 'confirmed']
  if (value === 'noveg') return ['!=', ['coalesce', ['get', 'imagery_status'], ''], 'vegetation']
  return true
}
export function imageryFilterTest(value, props) {
  if (value === 'seen') return SEEN.includes(props.imagery_status)
  if (value === 'confirmed') return props.imagery_status === 'confirmed'
  if (value === 'noveg') return props.imagery_status !== 'vegetation'
  return true
}

/** Years with an image, and sensible left/right defaults for a job. */
export function imageryDefaults(job) {
  const im = job?.stats?.imagery
  const years = (im?.available && im.years?.map((y) => y.year)) || []
  if (!years.length) return { years, left: null, right: null }
  const ref = im.corroboration?.reference_years
  if (ref?.length === 2 && years.includes(ref[0]) && years.includes(ref[1])) return { years, left: ref[0], right: ref[1] }
  const survey = job.stats?.dataset_year
  const near = survey ? years.reduce((a, y) => (Math.abs(y - survey) < Math.abs(a - survey) ? y : a), years[0]) : years[0]
  return { years, left: years[0], right: job.mode === 'measure' ? near : years[years.length - 1] }
}

/**
 * Year strip over the map: image years as buttons, the two LiDAR surveys as
 * markers, and for a selected change the year it became visible.
 */
export function ImageryTimeline({ years, lidarYears = [], year, onYear, selected, provider }) {
  const first = selected?.imagery_first_year
  const start = selected?.imagery_window_start
  const marks = [...new Set([...years, ...lidarYears])].sort((a, b) => a - b)
  return (
    <div className="floating flex items-center gap-2 px-3 py-2" role="group" aria-label="Aerial imagery years">
      <span className="label-mono mr-1 hidden text-muted md:inline">{provider || 'Imagery'}</span>
      {marks.map((y) => {
        const hasImage = years.includes(y)
        const lidar = lidarYears.includes(y)
        const isFirst = first === y
        const inWindow = start != null && first != null && y > start && y <= first
        return (
          <div key={y} className="flex flex-col items-center gap-0.5">
            {hasImage ? (
              <button
                type="button"
                onClick={() => onYear(y)}
                aria-pressed={year === y}
                title={isFirst ? 'First image in which the selected change is visible' : `Show the ${y} image`}
                className={cn(
                  'num h-7 rounded-control border-hair px-2 text-xs transition-colors',
                  year === y ? 'border-fg bg-raised text-fg' : 'border-line text-muted hover:text-fg',
                  isFirst && 'border-orange text-orange',
                  inWindow && !isFirst && 'border-dashed border-orange/60'
                )}
              >
                {y}
              </button>
            ) : (
              <span className="num flex h-7 items-center px-1 text-xs text-disabled">{y}</span>
            )}
            <span className={cn('font-mono text-[9px] leading-none', lidar ? 'text-teal' : 'invisible')} aria-hidden={!lidar}>
              {lidar ? 'LIDAR' : '·'}
            </span>
          </div>
        )
      })}
      {first != null && (
        <span className="ml-1 hidden max-w-[11rem] text-xs leading-tight text-orange lg:inline">
          Visible from {first}
          {start != null ? `, not in ${start}` : ''}
        </span>
      )}
    </div>
  )
}

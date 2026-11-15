/**
 * SKYSCAN component kit, built from the design package's DesignSystem and
 * COMPONENTS.md. Every interactive control is a real button/input/a, at least
 * 44px tall; icon-only buttons carry aria-label; toggles are role="switch".
 */
import { useEffect, useId, useRef, useState } from 'react'
import { cn, formatNumber } from '@/utils'

/* ------------------------------------------------------------------ icons */

export const Icon = {
  map: <path d="M2 4l4-1.5 4 1.5 4-1.5v9.5l-4 1.5-4-1.5-4 1.5zM6 2.5V12M10 4v9.5" />,
  cube: <path d="M8 1.5l5.5 3v7L8 14.5l-5.5-3v-7zM2.5 4.5L8 7.5l5.5-3M8 7.5v7" />,
  rect: <rect x="2.5" y="3.5" width="11" height="9" />,
  polygon: <path d="M3 5l5-3 5 4-2 7H4z" />,
  trash: <path d="M3.5 4.5h9M6 4.5V3h4v1.5M5 4.5l.5 8h5l.5-8" />,
  download: <path d="M8 2v8M4.5 7L8 10.5 11.5 7M3 13.5h10" />,
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  menu: <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />,
  arrow: <path d="M3 8h10M9 4l4 4-4 4" />,
  chevron: <path d="M3 5l4 4 4-4" />,
  screenshot: <path d="M3 5.5V3.5h2M13 5.5V3.5h-2M3 10.5v2h2M13 10.5v2h-2M5.5 8h5" />,
  csv: <path d="M3 2.5h7l3 3v8H3zM10 2.5v3h3M5 8h6M5 10.5h6" />,
  search: <path d="M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10zM14 14l-3.5-3.5" />,
  orbit: (
    <>
      <ellipse cx="8" cy="8" rx="6" ry="2.5" />
      <circle cx="8" cy="8" r="1" fill="currentColor" />
    </>
  ),
  pan: <path d="M8 2v12M2 8h12M6 4l2-2 2 2M6 12l2 2 2-2M4 6L2 8l2 2M12 6l2 2-2 2" />,
  top: <path d="M3 3h10v10H3zM3 8h10M8 3v10" />,
  reset: <path d="M3 8a5 5 0 1 0 1.6-3.7M3 2.5V5h2.5" />,
  compare: <path d="M5 3.5L2 7l3 3.5M9 3.5L12 7l-3 3.5" />,
  check: <path d="M2.5 6.5l2.5 2.5 4.5-5" />,
}

export function Svg({ name, size = 16, strokeWidth = 1.25, className }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={className}
    >
      {Icon[name]}
    </svg>
  )
}

export function PointsIcon({ size = 16 }) {
  const pts = [[3, 4], [7, 2.5], [11, 5], [13.5, 9], [5, 8], [9, 9.5], [3, 12], [7.5, 13], [12, 13]]
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      {pts.map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="1" />
      ))}
    </svg>
  )
}

/* ------------------------------------------------------------- loading */

export function Spinner({ size = 16, className, label }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)} role={label ? 'status' : undefined}>
      <svg
        className="animate-spin"
        width={size}
        height={size}
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M8 2a6 6 0 1 0 6 6" />
      </svg>
      {label}
    </span>
  )
}

export function SkeletonLines({ widths = ['100%', '82%', '56%'] }) {
  return (
    <div className="flex w-full flex-col gap-2" aria-hidden="true">
      {widths.map((w) => (
        <div key={w} className="skeleton-bar h-2.5" style={{ width: w }} />
      ))}
    </div>
  )
}

/* ------------------------------------------------------------- controls */

/** Segmented switcher: role=group, buttons with aria-pressed. */
export function Segmented({ label, options, value, onChange, disabled = false, size = 'md', className }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn('inline-flex flex-wrap gap-0.5 rounded-card border-hair border-line-strong bg-void p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value
        const off = disabled || o.disabled
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={active}
            disabled={off}
            title={typeof o.disabled === 'string' ? o.disabled : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-target items-center gap-2 rounded-control border-hair px-4 font-medium transition-colors',
              size === 'sm' ? 'text-[13px]' : 'text-sm',
              active ? 'border-teal bg-teal-fill text-teal' : 'border-transparent text-muted hover:text-fg',
              off && !active && 'cursor-not-allowed text-disabled hover:text-disabled'
            )}
          >
            {o.icon}
            {o.label}
            {o.count != null && <span className="font-mono text-xs">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Layer toggle row: one button role=switch with swatch, label and switch. */
export function SwitchRow({ label, checked, onChange, swatch, disabled = false, hint }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'flex h-target w-full items-center gap-3 rounded-control px-2 text-left text-sm transition-colors',
        disabled ? 'cursor-not-allowed text-disabled' : 'text-fg hover:bg-raised'
      )}
    >
      {swatch !== undefined && <span className="h-2.5 w-2.5 shrink-0" style={swatch} aria-hidden="true" />}
      <span className="flex-1">{label}</span>
      {hint && <span className="font-mono text-xs text-muted">{hint}</span>}
      <span
        aria-hidden="true"
        className={cn(
          'relative h-[18px] w-8 shrink-0 rounded-full border-hair',
          disabled ? 'border-line bg-sunken' : checked ? 'border-teal bg-teal/20' : 'border-line-strong bg-raised'
        )}
      >
        <span
          className={cn(
            'absolute top-[2.5px] h-[11px] w-[11px] rounded-full transition-all',
            checked ? 'right-[3px] bg-teal' : 'left-[3px]',
            !checked && (disabled ? 'bg-line-strong' : 'bg-muted')
          )}
        />
      </span>
    </button>
  )
}

/** Native range slider with label and a mono value above. */
export function Slider({ label, value, display, min, max, step = 1, onChange, disabled = false, highlight = false }) {
  const id = useId()
  return (
    <div className={disabled ? 'text-disabled' : undefined}>
      <div className="flex items-baseline justify-between text-[13px]">
        <label htmlFor={id} className={disabled ? undefined : 'text-fg'}>
          {label}
        </label>
        <span className={cn('num text-[13px]', highlight ? 'text-orange' : 'text-fg')}>{display ?? value}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

/** Labelled select (44px). */
export function SelectField({ label, value, onChange, options, disabled, placeholder }) {
  return (
    <label className="flex flex-col gap-1.5 text-xs text-muted">
      {label}
      <select
        className="input pr-8"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/* ------------------------------------------------------------- data */

/** Stat card: mono label and value. key=true renders the one orange value. */
export function StatCard({ label, value, unit, keyValue = false, loading = false, skeletonWidth = '60%' }) {
  return (
    <div className="rounded-control border-hair border-line bg-raised p-3">
      <div className="dt-mono">{label}</div>
      {loading ? (
        <div className="skeleton-bar mt-3 h-[26px]" style={{ width: skeletonWidth }} aria-hidden="true" />
      ) : (
        <div className={cn('num mt-2 text-[26px] leading-tight', keyValue ? 'text-orange' : 'text-fg')}>
          {value ?? '-'}
          {unit && <span className="text-[13px] text-muted"> {unit}</span>}
        </div>
      )}
    </div>
  )
}

/** Section heading inside panels. */
export function SectionLabel({ children, className, as: As = 'h2' }) {
  return <As className={cn('label-mono m-0', className)}>{children}</As>
}

/** Two-column key/value list, values right-aligned in mono. */
export function KeyValues({ items, className }) {
  return (
    <dl className={cn('m-0 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]', className)}>
      {items.map(([k, v, tone]) => (
        <div key={k} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className={cn('num m-0 text-right', tone === 'orange' ? 'text-orange' : tone === 'teal' ? 'text-teal' : 'text-fg')}>
            {v}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Height histogram (SVG): 5 m bins to 50+, hairline grid, teal bars, the
 * selected building's bin orange with its value above.
 */
export function HeightHistogram({ heights, selectedHeight, binSize = 5, maxBin = 50, loading = false }) {
  const nBins = maxBin / binSize + 1
  const counts = new Array(nBins).fill(0)
  for (const h of heights) counts[Math.min(Math.floor(h / binSize), nBins - 1)] += 1
  const top = Math.max(1, ...counts)
  const nice = niceMax(top)
  const x0 = 34
  const x1 = 288
  const yBase = 130
  const yTop = 20
  const bw = (x1 - x0) / nBins
  const sel = selectedHeight != null ? Math.min(Math.floor(selectedHeight / binSize), nBins - 1) : null
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(nice * f))
  const y = (v) => yBase - (v / nice) * (yBase - yTop)

  if (loading) {
    return (
      <div className="animate-skeleton flex h-[132px] items-end gap-1.5 border-b-stroke border-line-strong" aria-hidden="true">
        {[24, 70, 100, 60, 30, 14, 8, 4].map((h, i) => (
          <div key={i} className="flex-1 bg-line" style={{ height: `${h}%` }} />
        ))}
      </div>
    )
  }

  const busiest = counts.indexOf(top)
  const describe = `Histogram of ${heights.length} building heights in ${binSize} m bins. Most buildings are ${busiest * binSize} to ${(busiest + 1) * binSize} m tall.${
    sel != null ? ` The selected building falls in the ${sel * binSize} to ${(sel + 1) * binSize} m bin.` : ''
  }`
  return (
    <svg viewBox="0 0 296 168" className="block h-auto w-full" role="img" aria-label={describe}>
      <g fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#8C9BB3" textAnchor="end">
        {ticks
          .slice()
          .reverse()
          .map((t) => (
            <text key={t} x="28" y={y(t) + 3.5}>
              {t >= 1000 ? `${formatNumber(t / 1000, t % 1000 ? 1 : 0)}k` : formatNumber(t)}
            </text>
          ))}
      </g>
      <g stroke="#1C2940" strokeWidth=".5">
        {ticks.slice(1).map((t) => (
          <line key={t} x1={x0} x2={x1} y1={y(t)} y2={y(t)} />
        ))}
      </g>
      <line x1={x0} x2={x1} y1={yBase} y2={yBase} stroke="#2A3A57" strokeWidth=".75" />
      {counts.map((c, i) =>
        c > 0 ? (
          <rect
            key={i}
            x={x0 + i * bw + 3}
            y={y(c)}
            width={bw - 6}
            height={yBase - y(c)}
            fill={i === sel ? '#FF6B35' : '#00C9A7'}
            fillOpacity={i === sel ? 1 : 0.85}
          />
        ) : null
      )}
      {sel != null && (
        <text
          x={x0 + sel * bw + bw / 2}
          y={y(counts[sel]) - 6}
          textAnchor="middle"
          fontFamily="JetBrains Mono, monospace"
          fontSize="10"
          fill="#FF6B35"
        >
          {selectedHeight.toFixed(1)} m
        </text>
      )}
      <g fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#8C9BB3">
        {[0, 10, 20, 30, 40].map((v) => (
          <text key={v} x={x0 + (v / binSize) * bw} y="145">
            {v}
          </text>
        ))}
        <text x={x0 + (maxBin / binSize) * bw - 2} y="145">
          {maxBin}+
        </text>
        <text x="159" y="162" textAnchor="middle">
          Height (m)
        </text>
      </g>
    </svg>
  )
}

function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v))
  for (const m of [1, 2, 2.5, 4, 5, 10]) if (m * p >= v) return m * p
  return 10 * p
}

/* ------------------------------------------------------------- progress */

function StepDot({ state }) {
  if (state === 'done')
    return (
      <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full bg-teal">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#031411" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {Icon.check}
        </svg>
      </span>
    )
  if (state === 'active')
    return (
      <span className="inline-flex h-5 w-5 flex-none items-center justify-center rounded-full border-[1.5px] border-orange">
        <span className="animate-skeleton h-2 w-2 rounded-full bg-orange" />
      </span>
    )
  return <span className="h-5 w-5 flex-none rounded-full border-stroke border-disabled" />
}

/**
 * Progress stepper. steps: [{label, state: done|active|queued, detail, percent}]
 * variant: vertical (processing card) | horizontal.
 */
export function ProgressStepper({ steps, variant = 'vertical' }) {
  if (variant === 'horizontal') {
    return (
      <ol className="m-0 flex list-none flex-wrap gap-y-4 p-0">
        {steps.map((s, i) => (
          <li key={s.label} className="flex min-w-0 flex-[1_1_120px] flex-col gap-2">
            <div className="flex items-center gap-2">
              <StepDot state={s.state} />
              <span
                className={cn('h-px flex-1', i === steps.length - 1 ? 'bg-transparent' : s.state === 'done' ? 'bg-teal' : 'bg-line-strong')}
                style={{ height: '0.5px' }}
              />
            </div>
            <div className={cn('text-[13px]', s.state === 'queued' && 'text-muted')}>{s.label}</div>
            <div className={cn('font-mono text-[11px]', s.state === 'done' ? 'text-teal' : s.state === 'active' ? 'text-orange' : 'text-muted')}>
              {s.state === 'done' ? 'DONE' : s.state === 'active' ? `${s.percent ?? ''}${s.percent != null ? '%' : 'RUNNING'}` : 'QUEUED'}
            </div>
          </li>
        ))}
      </ol>
    )
  }
  return (
    <ol className="m-0 flex list-none flex-col p-0">
      {steps.map((s, i) => (
        <li key={s.label} className={cn('flex gap-3 border-t-hair border-line', i === steps.length - 1 ? 'pt-2.5' : 'py-2.5')}>
          <StepDot state={s.state} />
          <div className="min-w-0 flex-1">
            <div className={cn('flex justify-between gap-2 text-sm', s.state === 'queued' && 'text-muted')}>
              <span>{s.label}</span>
              <span
                className={cn(
                  'font-mono text-xs',
                  s.state === 'done' ? 'text-teal' : s.state === 'active' ? 'text-orange' : 'text-muted'
                )}
              >
                {s.state === 'done' ? 'DONE' : s.state === 'active' ? (s.percent != null ? `${s.percent}%` : 'RUNNING') : 'QUEUED'}
              </span>
            </div>
            {s.detail && <div className="mt-0.5 font-mono text-xs text-muted">{s.detail}</div>}
            {s.state === 'active' && s.percent != null && (
              <div className="mt-2 h-0.5 bg-line">
                <div className="h-0.5 bg-orange transition-all duration-700" style={{ width: `${s.percent}%` }} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  )
}

/* ------------------------------------------------------------- empty states */

export function EmptyState({ icon = 'area', title, children, action }) {
  const art =
    icon === 'area' ? (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5E6E87" strokeWidth="1" strokeDasharray="3 3" strokeLinejoin="round" aria-hidden="true">
        <path d="M8 18l14-10 18 8-4 22-24 4z" />
      </svg>
    ) : icon === 'building' ? (
      <svg width="40" height="40" viewBox="0 0 40 40" fill="none" stroke="#5E6E87" strokeWidth="1" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6l12 6v16l-12 6-12-6V12z" strokeDasharray="3 3" />
        <path d="M8 12l12 6 12-6M20 18v16" strokeDasharray="3 3" />
      </svg>
    ) : (
      <svg width="48" height="48" viewBox="0 0 48 48" fill="none" stroke="#5E6E87" strokeWidth="1" strokeLinejoin="round" aria-hidden="true">
        <rect x="8" y="22" width="12" height="18" />
        <rect x="26" y="14" width="14" height="26" strokeDasharray="3 3" />
      </svg>
    )
  return (
    <div className="flex flex-col items-start gap-3">
      {art}
      <div>
        <h3 className="m-0 text-[15px] font-medium">{title}</h3>
        {children && <p className="mt-1.5 text-[13px] leading-normal text-muted">{children}</p>}
      </div>
      {action}
    </div>
  )
}

/* ------------------------------------------------------------- export menu */

/** Export button with a menu: items [{label, ext, icon, onSelect | href}]. */
export function ExportMenu({ items, disabled = false, align = 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    const onDoc = (e) => !ref.current?.contains(e.target) && setOpen(false)
    const onKey = (e) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={disabled ? 'btn-secondary' : 'btn-primary'}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <Svg name="download" strokeWidth={1.5} />
        Export
        <Svg name="chevron" size={14} strokeWidth={1.5} />
      </button>
      {open && (
        <ul
          role="menu"
          className={cn(
            'floating absolute z-40 mt-1.5 w-60 list-none p-1',
            align === 'right' ? 'right-0' : 'left-0'
          )}
        >
          {items.map((it) => {
            const content = (
              <>
                <Svg name={it.icon} />
                <span className="flex-1">{it.label}</span>
                <span className="font-mono text-[11px] text-muted">{it.ext}</span>
              </>
            )
            const cls =
              'flex min-h-target w-full items-center gap-3 rounded-control px-3 py-1.5 text-left text-sm text-fg no-underline hover:bg-raised hover:text-fg'
            return (
              <li key={it.label} role="none">
                {it.href ? (
                  <a role="menuitem" className={cls} href={it.href} download onClick={() => setOpen(false)}>
                    {content}
                  </a>
                ) : (
                  <button
                    role="menuitem"
                    type="button"
                    className={cls}
                    onClick={() => {
                      setOpen(false)
                      it.onSelect?.()
                    }}
                  >
                    {content}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/** Status dot + mono text (e.g. "Complete · 38 s"). */
export function StatusChip({ tone = 'teal', pulse = false, children }) {
  return (
    <span className="inline-flex items-center gap-2 font-mono text-xs text-muted">
      <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'orange' ? 'bg-orange' : 'bg-teal', pulse && 'animate-skeleton')} />
      {children}
    </span>
  )
}

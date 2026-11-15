import { useEffect, useRef, useState } from 'react'
import { Spinner } from '@/components/ui'
import { useDebounce } from '@/hooks'
import { cn, formatNumber } from '@/utils'
import { MAPBOX_TOKEN } from './MapView'

/** Accessible segmented control. */
export function Segmented({ label, options, value, onChange, disabled = {} }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border bg-ink-850 p-0.5">
      {options.map((o) => {
        const active = o.value === value
        const off = Boolean(disabled[o.value])
        return (
          <button
            key={o.value}
            role="radio"
            aria-checked={active}
            disabled={off}
            title={typeof disabled[o.value] === 'string' ? disabled[o.value] : undefined}
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded px-3 py-1 text-xs font-medium transition-colors',
              active ? 'bg-ink-700 text-teal' : 'text-muted hover:text-fg',
              off && 'cursor-not-allowed opacity-40'
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

const Icon = {
  rect: <path d="M4 6h16v12H4z" />,
  poly: <path d="M5 18l2-11 8-3 4 9-6 6z" />,
  clear: <path d="M6 6l12 12M18 6L6 18" />,
}

function ToolButton({ icon, label, active, onClick, disabled }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        'flex h-8 w-8 items-center justify-center rounded border transition-colors',
        active ? 'border-orange text-orange' : 'border-line text-muted hover:border-line-strong hover:text-fg',
        disabled && 'opacity-40'
      )}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.3">
        {Icon[icon]}
      </svg>
    </button>
  )
}

/**
 * Draw tools, live area readout with the limit, and the run / sample buttons.
 */
export function DrawToolbar({ drawMode, setDrawMode, areaKm2, limitKm2, canRun, running, onRun, runLabel, onSample, sampleLabel, note }) {
  const over = areaKm2 > limitKm2
  return (
    <div className="panel w-72 p-3">
      <div className="flex items-center gap-2">
        <span className="label mr-auto">Area</span>
        <ToolButton icon="rect" label="Draw a rectangle" active={drawMode === 'rectangle'} onClick={() => setDrawMode('rectangle')} />
        <ToolButton icon="poly" label="Draw a polygon" active={drawMode === 'polygon'} onClick={() => setDrawMode('polygon')} />
        <ToolButton icon="clear" label="Clear the area" onClick={() => setDrawMode('clear')} disabled={!areaKm2} />
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <span className={cn('num text-2xl', over ? 'text-orange' : 'text-fg')} aria-live="polite">
          {areaKm2 ? formatNumber(areaKm2, areaKm2 < 0.1 ? 3 : 2) : '0.00'}
        </span>
        <span className="num text-xs text-muted">/ {limitKm2} km² max</span>
      </div>
      <div className="mt-1 h-0.5 w-full bg-ink-700">
        <div className={cn('h-full', over ? 'bg-orange' : 'bg-teal')} style={{ width: `${Math.min((areaKm2 / limitKm2) * 100, 100)}%` }} />
      </div>
      {over && (
        <p role="alert" className="mt-2 text-xs text-orange">
          Over the {limitKm2} km² limit. Draw a smaller area.
        </p>
      )}
      {!areaKm2 && <p className="mt-2 text-xs text-muted">Draw inside the teal coverage. Esc cancels.</p>}
      {note && <p className="mt-2 text-xs text-muted">{note}</p>}
      <div className="mt-3 flex gap-2">
        <button className="btn-primary flex-1" disabled={!canRun || over || running} onClick={onRun}>
          {running && <Spinner size="sm" className="text-ink-950" />}
          {runLabel}
        </button>
      </div>
      {onSample && (
        <button className="btn-ghost mt-1 w-full text-xs" onClick={onSample}>
          {sampleLabel}
        </button>
      )}
    </div>
  )
}

/** Place search (Mapbox geocoding) plus the showcase cities. */
export function CitySearch({ cities = [], onPick }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [active, setActive] = useState(0)
  const debounced = useDebounce(q, 300)
  const box = useRef(null)

  useEffect(() => {
    if (!debounced || debounced.length < 3 || !MAPBOX_TOKEN) {
      setResults([])
      return
    }
    const ctrl = new AbortController()
    setLoading(true)
    const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(debounced)}&limit=5&types=place,locality,neighborhood,address&access_token=${MAPBOX_TOKEN}`
    fetch(url, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { features: [] }))
      .then((d) =>
        setResults(
          (d.features || []).map((f) => ({
            label: f.properties.full_address || f.properties.name,
            center: f.geometry.coordinates,
            bbox: f.properties.bbox,
          }))
        )
      )
      .catch(() => {})
      .finally(() => setLoading(false))
    return () => ctrl.abort()
  }, [debounced])

  const local = cities
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()))
    .map((c) => ({ label: `${c.name} · showcase`, center: c.center, zoom: c.default_zoom, city: c }))
  const items = [...local, ...results]

  const pick = (item) => {
    onPick(item)
    setQ('')
    setOpen(false)
  }

  return (
    <div className="relative w-64" ref={box}>
      <input
        className="input py-1.5"
        placeholder="Search a city or address"
        value={q}
        aria-label="Search a place"
        aria-expanded={open}
        aria-controls="place-results"
        role="combobox"
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
          setOpen(true)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, items.length - 1))
          if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
          if (e.key === 'Enter' && items[active]) pick(items[active])
          if (e.key === 'Escape') setOpen(false)
        }}
      />
      {loading && <Spinner size="sm" className="absolute right-2 top-2" />}
      {open && items.length > 0 && (
        <ul id="place-results" role="listbox" className="panel absolute z-30 mt-1 max-h-72 w-full overflow-auto py-1">
          {items.map((it, i) => (
            <li
              key={`${it.label}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={() => pick(it)}
              className={cn('cursor-pointer px-3 py-1.5 text-sm', i === active ? 'bg-ink-700 text-teal' : 'text-fg')}
            >
              {it.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const STAGES = {
  measure: [
    ['queued', 'Queued'],
    ['fetching', 'Streaming points'],
    ['classifying', 'Ground and trees'],
    ['rasterizing', 'Surface models'],
    ['vectorizing', 'Footprints'],
    ['validating', 'Validation'],
  ],
  change: [
    ['queued', 'Queued'],
    ['fetching', 'Streaming points'],
    ['classifying', 'Ground and trees'],
    ['rasterizing', 'Surface models'],
    ['vectorizing', 'Footprints'],
    ['comparing', 'Comparing surveys'],
  ],
}

/** Stepper driven by the job's real status, progress and stage message. */
export function ProcessingStepper({ job, mode, onCancel }) {
  const stages = STAGES[mode]
  const idx = Math.max(0, stages.findIndex(([s]) => s === job.status))
  return (
    <div className="panel w-80 p-4" role="status" aria-live="polite">
      <div className="flex items-center justify-between">
        <span className="label text-orange">Scanning</span>
        <span className="num text-sm text-fg">{job.progress}%</span>
      </div>
      <div className="relative mt-2 h-0.5 w-full overflow-hidden bg-ink-700">
        <div className="absolute inset-y-0 left-0 bg-orange transition-all duration-700" style={{ width: `${job.progress}%` }} />
      </div>
      <ol className="mt-3 space-y-1.5">
        {stages.map(([s, label], i) => (
          <li key={s} className="flex items-center gap-2 text-xs">
            <span
              className={cn(
                'h-1.5 w-1.5 rounded-full',
                i < idx ? 'bg-teal' : i === idx ? 'animate-pulse bg-orange' : 'bg-ink-600'
              )}
            />
            <span className={i === idx ? 'text-fg' : i < idx ? 'text-muted' : 'text-faint'}>{label}</span>
          </li>
        ))}
      </ol>
      {job.stage_message && <p className="mt-3 text-xs text-muted">{job.stage_message}</p>}
      {onCancel && (
        <button className="btn-ghost mt-2 px-0 text-xs" onClick={onCancel}>
          Hide and keep browsing
        </button>
      )}
    </div>
  )
}

import { useMemo } from 'react'
import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { cn, formatNumber } from '@/utils'
import { HEIGHT_STOPS } from './layers'

export function Metric({ label, value, unit, tone }) {
  return (
    <div>
      <div className="label">{label}</div>
      <div className={cn('num mt-1 text-lg', tone === 'orange' ? 'text-orange' : tone === 'teal' ? 'text-teal' : 'text-fg')}>
        {value}
        {unit && <span className="ml-1 text-xs text-muted">{unit}</span>}
      </div>
    </div>
  )
}

export function Slider({ label, value, min, max, step, unit, onChange }) {
  const id = `f-${label.replace(/\s/g, '-')}`
  return (
    <div>
      <div className="flex justify-between text-xs">
        <label htmlFor={id} className="text-muted">
          {label}
        </label>
        <span className="num text-fg">
          {value}
          {unit}
        </span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full accent-teal"
      />
    </div>
  )
}

function colorFor(h) {
  let c = HEIGHT_STOPS[0][1]
  for (const [stop, col] of HEIGHT_STOPS) if (h >= stop) c = col
  return c
}

const BINS = [0, 5, 10, 15, 20, 30, 50, 100, Infinity]

export function HeightChart({ features }) {
  const data = useMemo(() => {
    const counts = BINS.slice(0, -1).map((from, i) => ({
      name: BINS[i + 1] === Infinity ? `${from}+` : `${from}-${BINS[i + 1]}`,
      from,
      count: 0,
    }))
    for (const f of features) {
      const h = f.properties.height_m
      const i = BINS.findIndex((b, j) => h >= b && h < BINS[j + 1])
      if (i >= 0) counts[i].count += 1
    }
    return counts
  }, [features])
  return (
    <div className="h-36" aria-label="Height distribution chart">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -24 }}>
          <XAxis dataKey="name" tick={{ fill: '#8A97AD', fontSize: 10, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={{ stroke: 'rgba(148,163,184,.25)' }} />
          <YAxis allowDecimals={false} tick={{ fill: '#8A97AD', fontSize: 10, fontFamily: 'JetBrains Mono' }} tickLine={false} axisLine={false} />
          <Tooltip
            cursor={{ fill: 'rgba(148,163,184,.08)' }}
            contentStyle={{ background: '#0D1524', border: '1px solid rgba(148,163,184,.25)', borderRadius: 6, fontSize: 12 }}
            labelFormatter={(l) => `${l} m`}
            formatter={(v) => [v, 'buildings']}
          />
          <Bar dataKey="count" isAnimationActive={false}>
            {data.map((d) => (
              <Cell key={d.name} fill={colorFor(d.from + 1)} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function AccuracyCard({ validation, showReference, onToggleReference }) {
  if (!validation) return null
  if (!validation.available) {
    return (
      <section className="rounded-md border p-3">
        <h3 className="label">Accuracy</h3>
        <p className="mt-2 text-xs text-muted">{validation.reason || 'No reference footprints for this area.'}</p>
      </section>
    )
  }
  const pct = (v) => (v == null ? '-' : v.toFixed(2))
  return (
    <section className="rounded-md border p-3">
      <div className="flex items-center justify-between">
        <h3 className="label">Accuracy vs {validation.source === 'osm' ? 'OpenStreetMap' : 'Overture'}</h3>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
          <input type="checkbox" checked={showReference} onChange={onToggleReference} className="accent-orange" />
          Overlay
        </label>
      </div>
      <dl className="mt-3 grid grid-cols-4 gap-2">
        <Metric label="Precision" value={pct(validation.precision)} />
        <Metric label="Recall" value={pct(validation.recall)} />
        <Metric label="F1" value={pct(validation.f1)} tone="teal" />
        <Metric label="IoU" value={pct(validation.mean_iou)} />
      </dl>
      <p className="mt-3 text-xs text-muted">
        {validation.true_positives} of {validation.reference} reference buildings matched (IoU ≥ {validation.iou_threshold}).{' '}
        {validation.height_compared > 0 ? (
          <>
            Height error <span className="num text-fg">{validation.height_mae_m} m</span> (mean absolute, n=
            {validation.height_compared}).
          </>
        ) : (
          'The reference has no heights here.'
        )}
      </p>
      {showReference && (
        <p className="mt-2 flex gap-3 text-[11px] text-muted">
          <span className="flex items-center gap-1"><i className="inline-block h-0 w-4 border-t border-dashed border-fg" /> matched</span>
          <span className="flex items-center gap-1"><i className="inline-block h-0 w-4 border-t border-dashed border-orange" /> missed</span>
        </p>
      )}
    </section>
  )
}

export function BuildingCard({ building, onClose }) {
  if (!building) return null
  return (
    <section className="rounded-md border border-orange/60 p-3" aria-label="Selected building">
      <div className="flex items-center justify-between">
        <h3 className="label text-orange">Selected building</h3>
        <button onClick={onClose} className="text-xs text-muted hover:text-fg" aria-label="Clear selection">
          Close
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <Metric label="Height" value={formatNumber(building.height_m, 1)} unit="m" />
        <Metric label="Max" value={formatNumber(building.max_height_m, 1)} unit="m" />
        <Metric label="Floors" value={`~${building.est_floors}`} />
        <Metric label="Area" value={formatNumber(building.area_m2)} unit="m²" />
        <Metric label="Volume" value={formatNumber(building.volume_m3)} unit="m³" />
        <Metric label="Confidence" value={formatNumber(building.confidence, 2)} />
      </dl>
    </section>
  )
}

export function ExportBar({ geojsonUrl, csvUrl, onScreenshot }) {
  return (
    <div className="flex flex-wrap gap-2">
      <a className="btn-secondary px-3 py-1.5 text-xs" href={geojsonUrl} download>
        GeoJSON
      </a>
      <a className="btn-secondary px-3 py-1.5 text-xs" href={csvUrl} download>
        CSV
      </a>
      <button className="btn-secondary px-3 py-1.5 text-xs" onClick={onScreenshot}>
        Screenshot
      </button>
    </div>
  )
}

/**
 * Right panel for Measure results. `features` are the buildings after filters.
 */
export default function MeasurePanel({
  job,
  features,
  total,
  filters,
  setFilters,
  selected,
  onCloseSelected,
  showReference,
  onToggleReference,
  exportUrls,
  onScreenshot,
}) {
  const st = job.stats || {}
  const footprint = features.reduce((s, f) => s + f.properties.area_m2, 0)
  const volume = features.reduce((s, f) => s + f.properties.volume_m3, 0)
  return (
    <div className="space-y-4">
      <header>
        <p className="label">{job.dataset?.name}</p>
        <p className="mt-1 text-xs text-muted">
          Surveyed {job.dataset?.acquisition_year ?? 'year unknown'} · {st.method === 'class6' ? 'survey building class' : 'nDSM method'} ·{' '}
          <span className="num">{st.processing_seconds}s</span>
        </p>
      </header>
      <dl className="grid grid-cols-3 gap-3">
        <Metric label="Buildings" value={formatNumber(features.length)} />
        <Metric label="Footprint" value={formatNumber(footprint / 1000, 1)} unit="k m²" />
        <Metric label="Volume" value={formatNumber(volume / 1e6, 2)} unit="M m³" />
      </dl>
      {features.length !== total && <p className="text-xs text-muted">{total - features.length} hidden by filters.</p>}
      <section>
        <h3 className="label mb-2">Height distribution (m)</h3>
        {features.length ? <HeightChart features={features} /> : <p className="text-xs text-muted">No buildings match the filters.</p>}
      </section>
      <BuildingCard building={selected} onClose={onCloseSelected} />
      <AccuracyCard validation={st.validation} showReference={showReference} onToggleReference={onToggleReference} />
      <section className="space-y-3 rounded-md border p-3">
        <h3 className="label">Filters</h3>
        <Slider label="Min height" unit=" m" min={0} max={50} step={1} value={filters.minHeight} onChange={(v) => setFilters({ ...filters, minHeight: v })} />
        <Slider label="Min area" unit=" m²" min={0} max={500} step={5} value={filters.minArea} onChange={(v) => setFilters({ ...filters, minArea: v })} />
        <Slider label="Min confidence" min={0} max={1} step={0.05} value={filters.minConfidence} onChange={(v) => setFilters({ ...filters, minConfidence: v })} />
      </section>
      <ExportBar geojsonUrl={exportUrls.geojson} csvUrl={exportUrls.csv} onScreenshot={onScreenshot} />
    </div>
  )
}

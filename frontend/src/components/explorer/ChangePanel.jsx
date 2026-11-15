import { useMemo, useState } from 'react'
import { cn, formatNumber } from '@/utils'
import { CHANGE_BY_KEY, CHANGE_TYPES } from './changeTypes'
import { ExportBar, Metric, Slider } from './MeasurePanel'

export function ChangeBadge({ type }) {
  const t = CHANGE_BY_KEY[type]
  if (!t) return null
  return (
    <span className="chip border-current" style={{ color: t.color }}>
      <span aria-hidden="true">{t.icon}</span>
      {t.label}
    </span>
  )
}

const signed = (v, digits = 0) => (v == null ? '-' : `${v > 0 ? '+' : ''}${formatNumber(v, digits)}`)
const height = (v) => (v == null ? 'none' : `${formatNumber(v, 1)} m`)

const SORTS = {
  area: (a, b) => b.properties.area_m2 - a.properties.area_m2,
  height: (a, b) => Math.abs(b.properties.delta_height_m) - Math.abs(a.properties.delta_height_m),
  volume: (a, b) => Math.abs(b.properties.volume_delta_m3) - Math.abs(a.properties.volume_delta_m3),
  type: (a, b) => a.properties.change_type.localeCompare(b.properties.change_type),
}

export function ChangeDetail({ change, before, after, onClose }) {
  if (!change) return null
  return (
    <section className="rounded-md border border-fg/40 p-3" aria-label="Selected change">
      <div className="flex items-center justify-between">
        <ChangeBadge type={change.change_type} />
        <button onClick={onClose} className="text-xs text-muted hover:text-fg" aria-label="Clear selection">
          Close
        </button>
      </div>
      <dl className="mt-3 grid grid-cols-3 gap-3">
        <Metric label={`Height ${before}`} value={height(change.height_before_m)} />
        <Metric label={`Height ${after}`} value={height(change.height_after_m)} />
        <Metric label="Change" value={`${signed(change.delta_height_m, 1)} m`} />
        <Metric label="Area" value={formatNumber(change.area_m2)} unit="m²" />
        <Metric label="Volume" value={signed(change.volume_delta_m3)} unit="m³" />
        <Metric label="Confidence" value={formatNumber(change.confidence, 2)} />
      </dl>
    </section>
  )
}

/** Right panel for Change results. `features` are the changes after filters. */
export default function ChangePanel({ job, features, total, filters, setFilters, selected, onSelect, exportUrls, onScreenshot }) {
  const [sort, setSort] = useState('area')
  const st = job.stats || {}
  const yb = st.before?.year
  const ya = st.after?.year
  const counts = useMemo(() => {
    const c = Object.fromEntries(CHANGE_TYPES.map((t) => [t.key, 0]))
    features.forEach((f) => (c[f.properties.change_type] += 1))
    return c
  }, [features])
  const netVolume = features.reduce((s, f) => s + f.properties.volume_delta_m3, 0)
  const netFootprint = features.reduce((s, f) => {
    const t = f.properties.change_type
    return s + (t === 'new' || t === 'extended' ? 1 : t === 'demolished' || t === 'reduced' ? -1 : 0) * f.properties.area_m2
  }, 0)
  const sorted = useMemo(() => [...features].sort(SORTS[sort]), [features, sort])

  const toggleType = (key) =>
    setFilters({ ...filters, types: filters.types.includes(key) ? filters.types.filter((t) => t !== key) : [...filters.types, key] })

  return (
    <div className="space-y-4">
      <header>
        <p className="label">
          {yb} → {ya}
        </p>
        <p className="mt-1 text-xs text-muted">
          {st.before?.dataset} ({formatNumber(st.before?.observed_density_ppm2, 1)} pts/m²) vs {st.after?.dataset} (
          {formatNumber(st.after?.observed_density_ppm2, 1)} pts/m²)
        </p>
      </header>

      <div className="grid grid-cols-3 gap-2" role="group" aria-label="Filter by change type">
        {CHANGE_TYPES.map((t) => {
          const on = filters.types.includes(t.key)
          return (
            <button
              key={t.key}
              onClick={() => toggleType(t.key)}
              aria-pressed={on}
              className={cn('rounded-md border px-2 py-1.5 text-left transition-opacity', on ? 'opacity-100' : 'opacity-40')}
              style={{ borderColor: on ? t.color : undefined }}
            >
              <span className="flex items-center gap-1 text-[11px]" style={{ color: t.color }}>
                <span aria-hidden="true">{t.icon}</span>
                {t.label}
              </span>
              <span className="num text-lg text-fg">{counts[t.key]}</span>
            </button>
          )
        })}
      </div>

      <dl className="grid grid-cols-2 gap-3">
        <Metric label="Net volume" value={signed(netVolume)} unit="m³" tone={netVolume >= 0 ? 'teal' : 'orange'} />
        <Metric label="Net footprint" value={signed(netFootprint)} unit="m²" tone={netFootprint >= 0 ? 'teal' : 'orange'} />
      </dl>
      <p className="text-xs text-muted">
        Surveys aligned by <span className="num text-fg">{signed(st.vertical_offset_m, 2)} m</span>
        {st.vertical_noise_m != null && (
          <>
            {' '}(ground noise <span className="num text-fg">±{st.vertical_noise_m} m</span>)
          </>
        )}
        . {features.length !== total && `${total - features.length} changes hidden by filters.`}
      </p>

      <ChangeDetail change={selected} before={yb} after={ya} onClose={() => onSelect(null)} />

      <section className="rounded-md border">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="label">Changes</h3>
          <label className="flex items-center gap-1 text-xs text-muted">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded border bg-ink-700 px-1 py-0.5 text-xs text-fg">
              <option value="area">Area</option>
              <option value="height">Height change</option>
              <option value="volume">Volume change</option>
              <option value="type">Type</option>
            </select>
          </label>
        </div>
        {sorted.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted">No changes match the filters.</p>
        ) : (
          <ul className="max-h-64 overflow-y-auto">
            {sorted.map((f) => {
              const p = f.properties
              return (
                <li key={f.id}>
                  <button
                    onClick={() => onSelect(p, f)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-xs last:border-b-0 hover:bg-ink-700',
                      selected?.id === p.id && 'bg-ink-700'
                    )}
                  >
                    <ChangeBadge type={p.change_type} />
                    <span className="num text-muted">{formatNumber(p.area_m2)} m²</span>
                    <span className="num w-16 text-right text-fg">{signed(p.delta_height_m, 1)} m</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="rounded-md border p-3">
        <h3 className="label mb-2">Filters</h3>
        <Slider label="Min size" unit=" m²" min={0} max={500} step={10} value={filters.minArea} onChange={(v) => setFilters({ ...filters, minArea: v })} />
      </section>

      <ExportBar geojsonUrl={exportUrls.geojson} csvUrl={exportUrls.csv} onScreenshot={onScreenshot} />
    </div>
  )
}

/**
 * Explorer sidebar (Explorer.dc.html): Dataset, Area of interest, Surveys
 * (Change), Layers, Filters and the run button. Locked while processing
 * (Explorer-Processing.dc.html).
 */
import { useEffect, useRef, useState } from 'react'
import { Alert } from '@/components/ui'
import { SectionLabel, SelectField, Slider, Spinner, Svg, SwitchRow } from '@/components/ui/kit'
import { useDebounce } from '@/hooks'
import { cn, formatNumber } from '@/utils'
import { CHANGE_TYPES } from './changeTypes'
import { IMAGERY_FILTERS } from './imagery'
import { MAPBOX_TOKEN } from './MapView'

/** Places SKYSCAN can process: showcases first, then other covered areas. */
export const PLACES = [
  { id: 'midtown-manhattan', label: 'New York, USA · showcase', city: 'midtown-manhattan' },
  { id: 'denver-union-station', label: 'Denver, USA · change showcase', city: 'denver-union-station' },
  { id: 'amsterdam', label: 'Amsterdam, NL', center: [4.879, 52.3378], zoom: 15.5 },
  { id: 'seattle', label: 'Seattle, USA', center: [-122.3145, 47.625], zoom: 16 },
  { id: 'chicago', label: 'Chicago, USA', center: [-87.644, 41.92], zoom: 16 },
  { id: 'los-angeles', label: 'Los Angeles, USA', center: [-118.2605, 34.0475], zoom: 15.5 },
]

function Section({ title, children, className }) {
  return (
    <section className={cn('flex flex-col gap-3 border-b-hair border-line p-4', className)}>
      <SectionLabel>{title}</SectionLabel>
      {children}
    </section>
  )
}

/** Mapbox place search (combobox). */
function PlaceSearch({ onPick, disabled }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [loading, setLoading] = useState(false)
  const debounced = useDebounce(q, 300)
  useEffect(() => {
    if (!debounced || debounced.length < 3 || !MAPBOX_TOKEN) {
      setResults([])
      return undefined
    }
    const ctrl = new AbortController()
    setLoading(true)
    fetch(
      `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(debounced)}&limit=5&types=place,locality,neighborhood,address&access_token=${MAPBOX_TOKEN}`,
      { signal: ctrl.signal }
    )
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
  const pick = (it) => {
    onPick(it)
    setQ('')
    setOpen(false)
  }
  return (
    <div className="relative">
      <label className="flex flex-col gap-1.5 text-xs text-muted">
        Search a place
        <span className="relative">
          <input
            className="input pl-9"
            value={q}
            disabled={disabled}
            placeholder="City or address"
            role="combobox"
            aria-expanded={open && results.length > 0}
            aria-controls="place-results"
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onChange={(e) => {
              setQ(e.target.value)
              setActive(0)
              setOpen(true)
            }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, results.length - 1))
              if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0))
              if (e.key === 'Enter' && results[active]) pick(results[active])
              if (e.key === 'Escape') setOpen(false)
            }}
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            {loading ? <Spinner size={14} /> : <Svg name="search" size={14} />}
          </span>
        </span>
      </label>
      {open && results.length > 0 && (
        <ul id="place-results" role="listbox" className="floating absolute z-30 mt-1 w-full list-none p-1">
          {results.map((r, i) => (
            <li
              key={`${r.label}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={() => pick(r)}
              className={cn(
                'flex min-h-target cursor-pointer items-center rounded-control px-3 text-sm',
                i === active ? 'bg-raised text-fg' : 'text-muted'
              )}
            >
              {r.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function surveyLabel(d) {
  return `${d.name} · ${d.acquisition_year ?? 'year unknown'}`
}

export default function Sidebar({
  mode,
  locked,
  onCancel,
  cancelling,
  place,
  onPlace,
  onSearchPick,
  surveys,
  surveyHint,
  source,
  setSource,
  pair,
  setPair,
  drawMode,
  setDrawMode,
  aoi,
  areaKm2,
  limitKm2,
  layers,
  setLayers,
  imagery,
  hasResults,
  filters,
  setFilters,
  changeFilters,
  setChangeFilters,
  canRun,
  running,
  onRun,
  note,
  errors,
  sample,
  onSample,
}) {
  const over = areaKm2 > limitKm2
  const full = (surveys.data?.results || []).filter((d) => d.covers_whole_area)
  const dated = full.filter((d) => d.acquisition_year)
  const chosen = full.find((d) => String(d.id) === String(source)) || full[0]
  const verts = aoi ? aoi.coordinates[0].length - 1 : 0
  const scrollTop = useRef(null)

  const yearOf = (id) => dated.find((d) => d.id === id)?.acquisition_year
  const gap = pair.before && pair.after ? yearOf(pair.after) - yearOf(pair.before) : null
  const minGap = surveys.data?.min_years_apart ?? 3

  return (
    <aside
      ref={scrollTop}
      aria-label="Explorer controls"
      className="flex max-w-full flex-[1_1_312px] flex-col overflow-y-auto border-r-hair border-line bg-panel lg:max-w-[312px]"
    >
      <Section title="Dataset">
        <SelectField
          label="City"
          value={place}
          disabled={locked}
          onChange={onPlace}
          placeholder="Choose a city"
          options={PLACES.map((p) => ({ value: p.id, label: p.label }))}
        />
        <PlaceSearch onPick={onSearchPick} disabled={locked} />
        {mode === 'measure' && (
          <>
            <SelectField
              label="Source"
              value={source ?? ''}
              disabled={locked || full.length < 2}
              onChange={setSource}
              placeholder={full.length ? 'Newest covering the area' : 'No survey found yet'}
              options={full.map((d) => ({ value: d.id, label: surveyLabel(d) }))}
            />
            {chosen && (
              <div className="font-mono text-xs text-muted">
                ≈{formatNumber(chosen.point_density_ppm2, 0)} pts/m² · {chosen.license?.split(' (')[0]} ·{' '}
                {chosen.provider === 'ahn' ? 'LAZ tiles' : 'EPT'}
              </div>
            )}
          </>
        )}
        {!full.length && surveyHint && <p className="m-0 text-xs text-muted">{surveyHint}</p>}
      </Section>

      <Section title="Area of interest">
        <div role="group" aria-label="Draw tool" className="flex gap-1.5">
          {[
            ['rectangle', 'rect', 'Rect', 'Draw a rectangle'],
            ['polygon', 'polygon', 'Polygon', 'Draw a polygon'],
          ].map(([value, icon, label, aria]) => (
            <button
              key={value}
              type="button"
              aria-pressed={drawMode === value}
              aria-label={aria}
              disabled={locked}
              onClick={() => setDrawMode(value)}
              className={cn('btn-secondary flex-1 px-2 text-[13px]', drawMode === value && 'btn-toggle-on')}
            >
              <Svg name={icon} />
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label="Clear area"
            className="btn-secondary w-target px-0"
            disabled={locked || !aoi}
            onClick={() => setDrawMode('clear')}
          >
            <Svg name="trash" />
          </button>
        </div>
        <dl className="m-0 grid grid-cols-3 gap-2">
          <div>
            <dt className="dt-mono tracking-[0.1em]">AREA</dt>
            <dd className={cn('num m-0 mt-1 text-[13px]', over && 'text-orange')} aria-live="polite">
              {areaKm2 ? `${formatNumber(areaKm2, areaKm2 < 0.1 ? 3 : 2)} km²` : '-'}
            </dd>
          </div>
          <div>
            <dt className="dt-mono tracking-[0.1em]">LIMIT</dt>
            <dd className="num m-0 mt-1 text-[13px]">{limitKm2} km²</dd>
          </div>
          <div>
            <dt className="dt-mono tracking-[0.1em]">{locked ? 'LOCKED' : 'VERTS'}</dt>
            <dd className={cn('num m-0 mt-1 text-[13px]', locked && 'text-orange')}>{locked ? 'YES' : verts || '-'}</dd>
          </div>
        </dl>
        {over && (
          <p role="alert" className="m-0 text-xs text-orange">
            Over the {limitKm2} km² limit. Draw a smaller area.
          </p>
        )}
        {!aoi && !locked && <p className="m-0 text-xs text-muted">Draw inside the teal coverage. Esc cancels drawing.</p>}
      </Section>

      {mode === 'change' && aoi && surveys.data && !locked && (
        <Section title="Surveys">
          {surveys.data.change_possible ? (
            <>
              <p className="m-0 font-mono text-xs text-muted">Years here: {surveys.data.years.join(', ')}</p>
              {['before', 'after'].map((k) => (
                <SelectField
                  key={k}
                  label={k === 'before' ? 'Before' : 'After'}
                  value={pair[k] ?? ''}
                  onChange={(v) => setPair({ ...pair, [k]: v ? Number(v) : null })}
                  placeholder="Choose a survey"
                  options={dated.map((d) => ({ value: d.id, label: surveyLabel(d) }))}
                />
              ))}
              {gap != null &&
                (gap < minGap ? (
                  <p role="alert" className="m-0 text-xs text-orange">
                    Pick a Before survey at least {minGap} years earlier than After.
                  </p>
                ) : (
                  <p className="m-0 font-mono text-xs text-teal">{gap} years apart</p>
                ))}
            </>
          ) : (
            <div role="alert" className="flex flex-col gap-1.5 text-[13px]">
              <span className="text-fg">Change is not available here.</span>
              <span className="text-muted">{surveys.data.change_reason}</span>
              <span className="text-xs text-muted">
                {surveys.data.years?.length ? `Survey years here: ${surveys.data.years.join(', ')}. ` : ''}It needs two surveys at least{' '}
                {minGap} years apart that each cover the whole area.
              </span>
            </div>
          )}
        </Section>
      )}

      <section className="flex flex-col gap-1 border-b-hair border-line px-2 pb-2 pt-4">
        <SectionLabel className="mx-2 mb-2">Layers</SectionLabel>
        {mode === 'measure' ? (
          <>
            <SwitchRow
              label="Building footprints"
              checked={layers.buildings}
              disabled={locked || !hasResults}
              onChange={(v) => setLayers({ ...layers, buildings: v })}
              swatch={{ border: '.75px solid #00C9A7', background: 'rgba(0,201,167,.3)' }}
            />
            <SwitchRow
              label="Height labels"
              checked={layers.labels}
              disabled={locked || !hasResults}
              onChange={(v) => setLayers({ ...layers, labels: v })}
              swatch={{ border: '.75px solid #FF6B35' }}
            />
            <SwitchRow
              label="Reference footprints"
              checked={layers.reference}
              disabled={locked || !hasResults}
              onChange={(v) => setLayers({ ...layers, reference: v })}
              swatch={{ border: '.75px dashed #E8EEF6' }}
            />
          </>
        ) : (
          <SwitchRow
            label="Swipe between surveys"
            checked={layers.swipe}
            disabled={locked || !hasResults}
            onChange={(v) => setLayers({ ...layers, swipe: v })}
            swatch={{ borderLeft: '.75px solid #E8EEF6' }}
          />
        )}
        <SwitchRow
          label="Aerial imagery"
          checked={layers.imagery && Boolean(imagery?.years.length)}
          disabled={locked || !imagery?.years.length}
          onChange={(v) => setLayers({ ...layers, imagery: v })}
          swatch={{ border: '.75px solid #E8B45C', background: 'linear-gradient(135deg,#3B4A3A,#6B6452)' }}
        />
        {layers.imagery && imagery?.years.length > 0 && !locked && (
          <div className="mx-2 mb-1 flex flex-col gap-2">
            {(imagery.twoSides ? ['left', 'right'] : ['right']).map((side) => (
              <SelectField
                key={side}
                label={imagery.twoSides ? (side === 'left' ? 'Left of the swipe' : 'Right of the swipe') : 'Image year'}
                value={imagery.value[side] ?? ''}
                onChange={(v) => imagery.onChange(Number(v), side)}
                options={imagery.years.map((y) => ({ value: y, label: String(y) }))}
              />
            ))}
            {imagery.provider && <p className="m-0 font-mono text-[11px] text-muted">{imagery.provider}</p>}
          </div>
        )}
        {imagery?.reason && <p className="mx-2 mb-1 mt-0 text-xs text-muted">{imagery.reason}</p>}
        <SwitchRow
          label="LiDAR coverage"
          checked={layers.coverage}
          disabled={locked}
          onChange={(v) => setLayers({ ...layers, coverage: v })}
          swatch={{ border: '.75px solid #00C9A7', background: 'rgba(0,201,167,.1)' }}
        />
        <SwitchRow
          label="Basemap"
          checked={layers.basemap}
          disabled={locked}
          onChange={(v) => setLayers({ ...layers, basemap: v })}
          swatch={{ border: '.75px solid #2A3A57', background: '#0D1627' }}
        />
      </section>

      <section className="flex flex-col gap-1 p-4">
        <SectionLabel className="mb-2">{locked ? 'Filters applied' : 'Filters'}</SectionLabel>
        {mode === 'measure' ? (
          <>
            <Slider
              label="Min height"
              value={filters.minHeight}
              display={`${filters.minHeight.toFixed(1)} m`}
              min={0}
              max={50}
              step={0.5}
              disabled={locked}
              onChange={(v) => setFilters({ ...filters, minHeight: v })}
            />
            <Slider
              label="Min area"
              value={filters.minArea}
              display={`${filters.minArea} m²`}
              min={0}
              max={200}
              step={5}
              disabled={locked}
              onChange={(v) => setFilters({ ...filters, minArea: v })}
            />
            <Slider
              label="Min confidence"
              value={filters.minConfidence}
              display={filters.minConfidence.toFixed(2)}
              min={0}
              max={1}
              step={0.05}
              disabled={locked}
              onChange={(v) => setFilters({ ...filters, minConfidence: v })}
            />
          </>
        ) : (
          <>
            <div role="group" aria-label="Change types" className="mb-2 grid grid-cols-2 gap-1">
              {CHANGE_TYPES.map((t) => {
                const on = changeFilters.types.includes(t.key)
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    disabled={locked}
                    onClick={() =>
                      setChangeFilters({
                        ...changeFilters,
                        types: on ? changeFilters.types.filter((k) => k !== t.key) : [...changeFilters.types, t.key],
                      })
                    }
                    className={cn(
                      'flex h-target items-center gap-2 rounded-control border-hair px-2.5 text-[13px] transition-colors',
                      on ? 'bg-raised' : 'border-line text-disabled'
                    )}
                    style={on ? { borderColor: t.color } : undefined}
                  >
                    <span aria-hidden="true" style={{ color: on ? t.color : undefined }}>
                      {t.icon}
                    </span>
                    {t.label}
                  </button>
                )
              })}
            </div>
            <Slider
              label="Min size"
              value={changeFilters.minArea}
              display={`${changeFilters.minArea} m²`}
              min={0}
              max={500}
              step={10}
              disabled={locked}
              onChange={(v) => setChangeFilters({ ...changeFilters, minArea: v })}
            />
            {imagery?.years.length > 0 && (
              <SelectField
                label="Imagery check"
                value={changeFilters.imagery}
                disabled={locked}
                onChange={(v) => setChangeFilters({ ...changeFilters, imagery: v })}
                options={IMAGERY_FILTERS}
              />
            )}
          </>
        )}
        {locked ? (
          <>
            <p className="m-0 mt-3 text-[13px] leading-normal text-muted">
              Layers and filters unlock when processing finishes. You can leave this tab; the job keeps running.
            </p>
            <button type="button" className="btn-secondary mt-3 w-full" onClick={onCancel} disabled={cancelling}>
              {cancelling ? <Spinner size={14} /> : null}
              Cancel processing
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-primary mt-3 w-full" disabled={!canRun || over || running} onClick={onRun}>
              {running && <Spinner size={16} />}
              {mode === 'measure' ? 'Measure buildings' : 'Detect change'}
            </button>
            {note && <p className="m-0 mt-2 text-xs text-muted">{note}</p>}
            {sample && (
              <button type="button" className="btn-ghost mt-1 w-full text-[13px]" onClick={onSample}>
                Try a sample area: {sample.name}
              </button>
            )}
          </>
        )}
        {errors.filter(Boolean).map((e) => (
          <Alert key={e} variant="error" className="mt-3">
            {e}
          </Alert>
        ))}
      </section>
    </aside>
  )
}

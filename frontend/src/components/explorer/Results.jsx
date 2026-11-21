/**
 * Right-hand results panel (Explorer.dc.html), its processing skeletons
 * (Explorer-Processing.dc.html), and the Change variant.
 */
import { useMemo, useState } from 'react'
import { Alert } from '@/components/ui'
import { EmptyState, HeightHistogram, KeyValues, SectionLabel, Spinner, StatCard, StatusChip, Svg } from '@/components/ui/kit'
import { cn, formatNumber } from '@/utils'
import { centroid } from '@/utils/geo'
import { CHANGE_BY_KEY, CHANGE_TYPES } from './changeTypes'
import { IMAGERY_STATUS } from './imagery'
import { buildingCode } from './MapChrome'

/** Change mode: how the aerial imagery check came out across all changes. */
function ChangeImageryBlock({ imagery }) {
  if (!imagery) return null
  const c = imagery.corroboration
  return (
    <Block aria-label="Aerial imagery check">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="m-0 text-sm font-medium">Aerial imagery check</h3>
        {imagery.provider && <span className="font-mono text-[11px] text-muted">{imagery.provider.name}</span>}
      </div>
      {!imagery.available || !c?.reference_years ? (
        <p className="m-0 text-[13px] text-muted">{c?.reason || imagery.reason || 'No aerial imagery was available.'}</p>
      ) : (
        <>
          <KeyValues
            items={[
              ['Images', imagery.years.map((y) => y.year).join(', ')],
              ['Compared', `${c.reference_years[0]} → ${c.reference_years[1]}`],
              ...['confirmed', 'likely', 'not_visible', 'vegetation', 'too_small']
                .filter((k) => c.totals?.[k])
                .map((k) => [IMAGERY_STATUS[k].label, formatNumber(c.totals[k]), k === 'confirmed' ? 'orange' : undefined]),
            ]}
          />
          <p className="m-0 mt-2.5 text-xs leading-normal text-muted">
            Each change is ranked against {formatNumber(c.controls)} unchanged buildings of similar height: how much did the imagery change
            there between {c.reference_years[0]} and {c.reference_years[1]} compared with them? Confirmed beats 90% of them, likely 75%.
            Photos differ from year to year even where nothing changed, and height-only changes are often not visible from above.
          </p>
        </>
      )}
    </Block>
  )
}

/** Measure mode: the NDVI vegetation check and the image years on offer. */
function MeasureImageryBlock({ imagery }) {
  const veg = imagery?.vegetation
  if (!imagery || (!imagery.available && !veg?.available)) {
    const reason = imagery?.reason || veg?.reason
    return reason ? (
      <Block>
        <SectionLabel as="h3">Aerial imagery</SectionLabel>
        <p className="m-0 mt-2 text-[13px] text-muted">{reason}</p>
      </Block>
    ) : null
  }
  return (
    <Block aria-label="Aerial imagery">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="m-0 text-sm font-medium">Aerial imagery</h3>
        {imagery.provider && <span className="font-mono text-[11px] text-muted">{imagery.provider.name}</span>}
      </div>
      <KeyValues
        items={[
          ...(imagery.years?.length ? [['Images', imagery.years.map((y) => y.year).join(', ')]] : []),
          ...(veg?.available
            ? [
                ['Vegetation check', `${veg.year} image`],
                [veg.applied ? 'Removed as trees' : 'Flagged as trees', formatNumber(veg.applied ? veg.removed : veg.flagged)],
              ]
            : veg?.reason
              ? [['Vegetation check', 'not run']]
              : []),
        ]}
      />
      {veg?.available && (
        <p className="m-0 mt-2.5 text-xs leading-normal text-muted">
          Footprints under 30 m that are mostly vegetation in the near-infrared are treated as tree crowns, not buildings.
        </p>
      )}
      {!veg?.available && veg?.reason && <p className="m-0 mt-2.5 text-xs text-muted">{veg.reason}</p>}
    </Block>
  )
}

function imageryRows(p) {
  const s = IMAGERY_STATUS[p.imagery_status]
  if (!s) return []
  const rank = p.imagery_score != null ? ` · beats ${Math.round(p.imagery_score * 100)}%` : ''
  const rows = [['Imagery', `${s.label}${rank}`, p.imagery_status === 'confirmed' ? 'orange' : undefined]]
  if (p.imagery_first_year)
    rows.push([
      'Visible from',
      p.imagery_window_start ? `${p.imagery_first_year} (not in ${p.imagery_window_start})` : `${p.imagery_first_year}`,
    ])
  return rows
}

function Shell({ status, children }) {
  return (
    <aside
      aria-label="Results"
      className="flex max-w-full flex-[1_1_328px] flex-col overflow-y-auto border-l-hair border-line bg-panel lg:max-w-[328px]"
    >
      <header className="flex items-center justify-between gap-2 border-b-hair border-line p-4">
        <h2 className="m-0 font-display text-lg font-medium">Results</h2>
        {status}
      </header>
      {children}
    </aside>
  )
}

function Block({ children, className, ...rest }) {
  return (
    <section className={cn('border-b-hair border-line p-4', className)} {...rest}>
      {children}
    </section>
  )
}

function ExportButtons({ onScreenshot, geojsonUrl }) {
  return (
    <section className="mt-auto flex gap-2 p-4">
      <button type="button" className="btn-secondary flex-1" onClick={onScreenshot}>
        <Svg name="screenshot" />
        Screenshot
      </button>
      <a className="btn-primary flex-1" href={geojsonUrl} download>
        GeoJSON
        <Svg name="download" strokeWidth={1.5} />
      </a>
    </section>
  )
}

/** Skeleton state while a job runs, and the idle state before any job. */
export function PendingResults({ processing, mode }) {
  return (
    <Shell
      status={
        processing ? (
          <StatusChip tone="orange" pulse>
            Processing
          </StatusChip>
        ) : (
          <StatusChip>Ready</StatusChip>
        )
      }
    >
      {processing ? (
        <>
          <Block className="grid grid-cols-2 gap-2" aria-label="Loading statistics">
            {(mode === 'change' ? ['NEW', 'DEMOLISHED', 'RAISED', 'NET VOLUME'] : ['BUILDINGS', 'FOOTPRINT', 'MEDIAN H', 'TALLEST']).map(
              (l, i) => (
                <StatCard key={l} label={l} loading skeletonWidth={`${[70, 60, 50, 55][i]}%`} />
              )
            )}
          </Block>
          <Block>
            <h3 className="m-0 mb-3 text-sm font-medium">{mode === 'change' ? 'Changes' : 'Height distribution'}</h3>
            <HeightHistogram heights={[]} loading />
            <p className="m-0 mt-2.5 font-mono text-xs text-muted">Available when processing finishes</p>
          </Block>
          <Block className="border-b-0">
            <EmptyState icon="building" title="No building selected">
              Click a {mode === 'change' ? 'change' : 'footprint'} on the map once processing completes to see its details.
            </EmptyState>
          </Block>
        </>
      ) : (
        <Block className="border-b-0">
          <EmptyState icon="area" title="Draw an area to begin">
            Use the rectangle or polygon tool in the sidebar. Areas up to {mode === 'change' ? '0.5' : '1'} km² are supported, or try a
            sample area.
          </EmptyState>
        </Block>
      )}
    </Shell>
  )
}

export function FailedResults({ job }) {
  return (
    <Shell status={<StatusChip tone="orange">{job.error === 'Cancelled.' ? 'Cancelled' : 'Failed'}</StatusChip>}>
      <Block className="border-b-0">
        <EmptyState icon="results" title={job.error === 'Cancelled.' ? 'Processing cancelled' : 'Processing failed'}>
          {job.error || 'The job could not finish.'} Draw an area and run it again.
        </EmptyState>
      </Block>
    </Shell>
  )
}

function AccuracyBlock({ validation }) {
  if (!validation) return null
  if (!validation.available)
    return (
      <Block>
        <SectionLabel as="h3">Accuracy</SectionLabel>
        <p className="m-0 mt-2 text-[13px] text-muted">{validation.reason || 'No reference footprints for this area.'}</p>
      </Block>
    )
  const f = (v) => (v == null ? '-' : v.toFixed(2))
  return (
    <Block>
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="m-0 text-sm font-medium">Accuracy vs {validation.source === 'osm' ? 'OpenStreetMap' : 'Overture'}</h3>
        <span className="font-mono text-[11px] text-muted">IoU ≥ {validation.iou_threshold}</span>
      </div>
      <KeyValues
        items={[
          ['Precision', f(validation.precision)],
          ['Recall', f(validation.recall)],
          ['F1', f(validation.f1)],
          ['Mean IoU', f(validation.mean_iou)],
          [
            'Height error',
            validation.height_compared ? `${validation.height_mae_m} m (n=${validation.height_compared})` : 'no reference heights',
          ],
        ]}
      />
      <p className="m-0 mt-2.5 text-xs text-muted">
        {validation.true_positives} of {validation.reference} reference buildings matched. Turn on “Reference footprints” to compare
        outlines.
      </p>
    </Block>
  )
}

/** Measure results. features: buildings after filters; all: before filters. */
export function MeasureResults({ job, layer, features, all, selected, onClearFilters, onScreenshot, geojsonUrl }) {
  const st = job.stats || {}
  const heights = useMemo(() => features.map((f) => f.properties.height_m), [features])
  const sorted = useMemo(() => [...heights].sort((a, b) => a - b), [heights])
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null
  const tallest = sorted.length ? sorted[sorted.length - 1] : null
  const footprintHa = features.reduce((s, f) => s + f.properties.area_m2, 0) / 1e4
  const sel = selected?.properties
  const rank = sel ? Math.round((sorted.filter((h) => h < sel.height_m).length / Math.max(sorted.length, 1)) * 100) : null
  const c = selected ? centroid(selected.geometry) : null

  return (
    <Shell status={<StatusChip>Complete · {Math.round(st.processing_seconds ?? 0)} s</StatusChip>}>
      {layer.loading && (
        <Block>
          <Spinner label="Loading buildings" className="text-sm text-muted" />
        </Block>
      )}
      {layer.error && (
        <Block>
          <Alert variant="error">Could not load buildings: {layer.error}</Alert>
        </Block>
      )}
      {layer.data && (
        <>
          <Block className="grid grid-cols-2 gap-2">
            <StatCard label="BUILDINGS" value={formatNumber(features.length)} keyValue />
            <StatCard label="FOOTPRINT" value={formatNumber(footprintHa, 1)} unit="ha" />
            <StatCard label="MEDIAN H" value={median != null ? formatNumber(median, 1) : '-'} unit={median != null ? 'm' : undefined} />
            <StatCard label="TALLEST" value={tallest != null ? formatNumber(tallest, 1) : '-'} unit={tallest != null ? 'm' : undefined} />
          </Block>
          {features.length === 0 ? (
            <Block>
              <EmptyState
                icon="results"
                title="No buildings match"
                action={
                  all.length > 0 && (
                    <button type="button" className="btn-secondary" onClick={onClearFilters}>
                      Reset filters
                    </button>
                  )
                }
              >
                {all.length > 0
                  ? `All ${formatNumber(all.length)} buildings are below the current filters. Lower them to see results.`
                  : 'No buildings were detected in this area.'}
              </EmptyState>
            </Block>
          ) : (
            <Block>
              <div className="mb-2 flex items-baseline justify-between">
                <h3 className="m-0 text-sm font-medium">Height distribution</h3>
                <span className="font-mono text-[11px] text-muted">5 m bins</span>
              </div>
              <HeightHistogram heights={heights} selectedHeight={sel?.height_m} />
              {all.length !== features.length && (
                <p className="m-0 mt-2 font-mono text-xs text-muted">{formatNumber(all.length - features.length)} hidden by filters</p>
              )}
            </Block>
          )}
          <Block>
            {sel ? (
              <>
                <div className="mb-3 flex items-baseline justify-between">
                  <h3 className="m-0 text-sm font-medium">Selected building</h3>
                  <span className="font-mono text-xs text-muted">{buildingCode(sel.id)}</span>
                </div>
                <KeyValues
                  items={[
                    ['Height', `${formatNumber(sel.height_m, 1)} m`, 'orange'],
                    ['Footprint', `${formatNumber(sel.area_m2)} m²`],
                    ['Floors', `~${sel.est_floors}`],
                    ['Volume', `${formatNumber(sel.volume_m3)} m³`],
                    ['Rank', `Taller than ${rank}%`],
                    ['Confidence', formatNumber(sel.confidence, 2)],
                    ...(sel.ndvi != null ? [['NDVI', formatNumber(sel.ndvi, 2)]] : []),
                    ['Centroid', `${c[1].toFixed(5)}, ${c[0].toFixed(5)}`],
                  ]}
                />
              </>
            ) : (
              <EmptyState icon="building" title="No building selected">
                Click a footprint on the map to see its height, area and point count.
              </EmptyState>
            )}
          </Block>
          <AccuracyBlock validation={st.validation} />
          <MeasureImageryBlock imagery={st.imagery} />
        </>
      )}
      <ExportButtons onScreenshot={onScreenshot} geojsonUrl={geojsonUrl} />
    </Shell>
  )
}

const signed = (v, d = 0) => (v == null ? '-' : `${v > 0 ? '+' : ''}${formatNumber(v, d)}`)

const SORTS = {
  area: (a, b) => b.properties.area_m2 - a.properties.area_m2,
  height: (a, b) => Math.abs(b.properties.delta_height_m) - Math.abs(a.properties.delta_height_m),
  volume: (a, b) => Math.abs(b.properties.volume_delta_m3) - Math.abs(a.properties.volume_delta_m3),
  type: (a, b) => a.properties.change_type.localeCompare(b.properties.change_type),
}

export function ChangeBadge({ type }) {
  const t = CHANGE_BY_KEY[type]
  if (!t) return null
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-badge border-hair px-1.5 py-0.5 font-mono text-[11px]"
      style={{ color: t.color, borderColor: t.color }}
    >
      <span aria-hidden="true">{t.icon}</span>
      {t.label}
    </span>
  )
}

/** Change results: counts, net totals, sortable list, selected change. */
export function ChangeResults({ job, layer, features, selected, onSelect, onScreenshot, geojsonUrl }) {
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
  const list = useMemo(() => [...features].sort(SORTS[sort]), [features, sort])
  const sel = selected?.properties

  return (
    <Shell
      status={
        <StatusChip>
          {yb} → {ya} · {Math.round(st.processing_seconds ?? 0)} s
        </StatusChip>
      }
    >
      {layer.loading && (
        <Block>
          <Spinner label="Loading changes" className="text-sm text-muted" />
        </Block>
      )}
      {layer.error && (
        <Block>
          <Alert variant="error">Could not load changes: {layer.error}</Alert>
        </Block>
      )}
      {layer.data && (
        <>
          <Block className="grid grid-cols-2 gap-2">
            <StatCard label="NEW" value={formatNumber(counts.new)} keyValue />
            <StatCard label="DEMOLISHED" value={formatNumber(counts.demolished)} />
            <StatCard label="RAISED / EXT." value={formatNumber(counts.raised + counts.extended)} />
            <StatCard label="NET VOLUME" value={signed(netVolume / 1000, 0)} unit="k m³" />
          </Block>
          <Block>
            <KeyValues
              items={[
                ['Surveys', `${yb} → ${ya}`],
                [
                  'Densities',
                  `${formatNumber(st.before?.observed_density_ppm2, 1)} / ${formatNumber(st.after?.observed_density_ppm2, 1)} pts/m²`,
                ],
                ['Vertical alignment', `${signed(st.vertical_offset_m, 2)} m`],
                ['Ground noise', st.vertical_noise_m != null ? `±${st.vertical_noise_m} m` : '-'],
              ]}
            />
          </Block>
          {sel && (
            <Block aria-label="Selected change">
              <div className="mb-3 flex items-center justify-between">
                <ChangeBadge type={sel.change_type} />
                <span className="font-mono text-xs text-muted">{buildingCode(sel.id, 'CHG')}</span>
              </div>
              <KeyValues
                items={[
                  [`Height ${yb}`, sel.height_before_m == null ? 'none' : `${formatNumber(sel.height_before_m, 1)} m`],
                  [`Height ${ya}`, sel.height_after_m == null ? 'none' : `${formatNumber(sel.height_after_m, 1)} m`],
                  ['Change', `${signed(sel.delta_height_m, 1)} m`, 'orange'],
                  ['Area', `${formatNumber(sel.area_m2)} m²`],
                  ['Volume', `${signed(sel.volume_delta_m3)} m³`],
                  ['Confidence', formatNumber(sel.confidence, 2)],
                  ...imageryRows(sel),
                ]}
              />
              {IMAGERY_STATUS[sel.imagery_status] && (
                <p className="m-0 mt-2.5 text-xs leading-normal text-muted">{IMAGERY_STATUS[sel.imagery_status].hint}</p>
              )}
            </Block>
          )}
          <ChangeImageryBlock imagery={st.imagery} />
          <section className="border-b-hair border-line">
            <div className="flex items-center justify-between px-4 pb-2 pt-4">
              <h3 className="m-0 text-sm font-medium">
                Changes <span className="font-mono text-xs text-muted">{features.length}</span>
              </h3>
              <label className="flex items-center gap-2 text-xs text-muted">
                Sort
                <select
                  value={sort}
                  onChange={(e) => setSort(e.target.value)}
                  className="h-9 rounded-control border-hair border-line-strong bg-raised px-2 text-xs text-fg"
                >
                  <option value="area">Area</option>
                  <option value="height">Height change</option>
                  <option value="volume">Volume change</option>
                  <option value="type">Type</option>
                </select>
              </label>
            </div>
            {list.length === 0 ? (
              <div className="px-4 pb-4">
                <EmptyState icon="results" title="No changes match">
                  {layer.data.features.length
                    ? 'Turn change types back on or lower the minimum size.'
                    : `No building changes between ${yb} and ${ya} in this area.`}
                </EmptyState>
              </div>
            ) : (
              <ul className="m-0 max-h-72 list-none overflow-y-auto p-0">
                {list.map((f) => {
                  const p = f.properties
                  return (
                    <li key={f.id}>
                      <button
                        type="button"
                        onClick={() => onSelect(f)}
                        aria-current={sel?.id === p.id}
                        className={cn(
                          'flex min-h-target w-full items-center justify-between gap-2 border-t-hair border-line px-4 text-left text-xs hover:bg-raised',
                          sel?.id === p.id && 'bg-raised'
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
        </>
      )}
      <ExportButtons onScreenshot={onScreenshot} geojsonUrl={geojsonUrl} />
    </Shell>
  )
}

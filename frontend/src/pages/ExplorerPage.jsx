import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Navbar from '@/components/layout/Navbar'
import { Alert, Spinner } from '@/components/ui'
import { CitySearch, DrawToolbar, ProcessingStepper, Segmented } from '@/components/explorer/controls'
import { AoiLayer, BuildingsLayer, CoverageLayer, ReferenceLayer } from '@/components/explorer/layers'
import MapView from '@/components/explorer/MapView'
import MeasurePanel from '@/components/explorer/MeasurePanel'
import { useJob } from '@/hooks/useJob'
import { SkyscanService } from '@/services'
import { getErrorMessage } from '@/utils'
import { bbox, polygonAreaKm2 } from '@/utils/geo'

export const LIMITS = { measure: 1.0, change: 0.5 }
const DEFAULT_FILTERS = { minHeight: 0, minArea: 0, minConfidence: 0 }

function apiError(err) {
  const d = err?.response?.data
  if (d && typeof d === 'object') {
    const first = Object.values(d).flat()[0]
    if (typeof first === 'string') return first
  }
  return getErrorMessage(err)
}

export function useResults(job, layer, params) {
  const [state, setState] = useState({ data: null, loading: false, error: null })
  const key = JSON.stringify(params || {})
  useEffect(() => {
    if (!job || job.status !== 'done') {
      setState({ data: null, loading: false, error: null })
      return undefined
    }
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))
    SkyscanService.getJobLayer(job.id, layer, JSON.parse(key))
      .then((data) => !cancelled && setState({ data, loading: false, error: null }))
      .catch((err) => !cancelled && setState({ data: null, loading: false, error: getErrorMessage(err) }))
    return () => {
      cancelled = true
    }
  }, [job?.id, job?.status, layer, key]) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

export default function ExplorerPage() {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'change' ? 'change' : 'measure'
  const jobId = params.get('job')
  const citySlug = params.get('city')

  const mapRef = useRef(null)
  const [cities, setCities] = useState([])
  const [view, setView] = useState('3d')
  const [drawMode, setDrawMode] = useState(null)
  const [aoi, setAoi] = useState(null)
  const [surveys, setSurveys] = useState({ data: null, loading: false, error: null })
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [selected, setSelected] = useState(null)
  const [showReference, setShowReference] = useState(false)
  const [hideStepper, setHideStepper] = useState(false)

  const { job, error: jobError } = useJob(jobId)
  const running = job && !['done', 'failed'].includes(job.status)
  const areaKm2 = aoi ? polygonAreaKm2(aoi) : 0
  const limit = LIMITS[mode]

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params)
      Object.entries(patch).forEach(([k, v]) => (v == null ? next.delete(k) : next.set(k, v)))
      setParams(next, { replace: false })
    },
    [params, setParams]
  )

  // Showcase cities for search and samples.
  useEffect(() => {
    SkyscanService.getCities({ is_showcase: true }).then(setCities).catch(() => setCities([]))
  }, [])

  // ?city=slug opens that showcase's precomputed job.
  useEffect(() => {
    if (!citySlug || jobId || !cities.length) return
    const city = cities.find((c) => c.slug === citySlug)
    if (city?.showcase_job) setParam({ job: city.showcase_job.id, mode: city.showcase_mode })
  }, [citySlug, cities, jobId, setParam])

  // Fly to the job area when a job loads.
  const flownTo = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!map || !job?.aoi || flownTo.current === job.id) return
    flownTo.current = job.id
    const [w, s, e, n] = bbox(job.aoi)
    map.fitBounds([[w, s], [e, n]], { padding: { top: 80, bottom: 80, left: 340, right: 420 }, pitch: view === '3d' ? 55 : 0, duration: 1200 })
  }, [job, view])

  // Camera pitch follows the 2D / 3D switch.
  useEffect(() => {
    const map = mapRef.current
    if (map && view !== 'points') map.easeTo({ pitch: view === '3d' ? 55 : 0, duration: 600 })
  }, [view])

  // Which surveys cover the drawn area.
  useEffect(() => {
    if (!aoi || areaKm2 > limit) {
      setSurveys({ data: null, loading: false, error: null })
      return undefined
    }
    let cancelled = false
    setSurveys({ data: null, loading: true, error: null })
    SkyscanService.getSurveys({ aoi })
      .then((data) => !cancelled && setSurveys({ data, loading: false, error: null }))
      .catch((err) => !cancelled && setSurveys({ data: null, loading: false, error: apiError(err) }))
    return () => {
      cancelled = true
    }
  }, [aoi, areaKm2, limit])

  const buildings = useResults(job, 'buildings', mode === 'measure' ? { epoch: 'single' } : null)
  const reference = useResults(showReference ? job : null, 'reference')

  const filterExpr = useMemo(
    () => [
      'all',
      ['>=', ['get', 'height_m'], filters.minHeight],
      ['>=', ['get', 'area_m2'], filters.minArea],
      ['>=', ['get', 'confidence'], filters.minConfidence],
    ],
    [filters]
  )
  const filtered = useMemo(
    () =>
      (buildings.data?.features || []).filter(
        (f) =>
          f.properties.height_m >= filters.minHeight &&
          f.properties.area_m2 >= filters.minArea &&
          f.properties.confidence >= filters.minConfidence
      ),
    [buildings.data, filters]
  )

  const coveredSurvey = surveys.data?.results?.find((d) => d.covers_whole_area) || surveys.data?.results?.[0]
  const noCoverage = surveys.data && surveys.data.count === 0

  const run = async () => {
    setSubmitError(null)
    setSubmitting(true)
    try {
      const created = await SkyscanService.createJob({ mode, aoi })
      setSelected(null)
      setFilters(DEFAULT_FILTERS)
      setHideStepper(false)
      setParam({ job: created.id, city: null })
      setDrawMode('clear')
      setAoi(null)
    } catch (err) {
      setSubmitError(apiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const sample = cities.find((c) => c.showcase_mode === mode && c.showcase_job)
  const loadSample = () => {
    if (!sample) return
    setSelected(null)
    setDrawMode('clear')
    setAoi(null)
    setParam({ job: sample.showcase_job.id, city: sample.slug })
  }

  const screenshot = () => {
    const canvas = mapRef.current?.getCanvas()
    if (!canvas) return
    const a = document.createElement('a')
    a.href = canvas.toDataURL('image/png')
    a.download = `skyscan-${mode}-${(job?.id || 'map').slice(0, 8)}.png`
    a.click()
  }

  const switchMode = (m) => {
    setSelected(null)
    setParam({ mode: m, job: null, city: null })
  }

  const note = surveys.loading
    ? 'Checking LiDAR coverage…'
    : surveys.error
      ? surveys.error
      : noCoverage
        ? 'No LiDAR survey covers this area. Draw inside the teal coverage.'
        : coveredSurvey
          ? `Survey: ${coveredSurvey.name} (${coveredSurvey.acquisition_year ?? 'year unknown'})`
          : null

  return (
    <div className="flex h-screen flex-col bg-ink-900">
      <Navbar compact />
      <div className="relative flex-1 overflow-hidden">
        <MapView
          className="absolute inset-0"
          drawMode={drawMode}
          onAoiDrawn={(g) => {
            setAoi(g)
            setDrawMode(null)
          }}
          onDrawCleared={() => setAoi(null)}
          onReady={(map) => (mapRef.current = map)}
        >
          {(map) => (
            <>
              <CoverageLayer map={map} visible={!job || running} />
              <AoiLayer map={map} aoi={job?.aoi && !aoi ? job.aoi : null} />
              {mode === 'measure' && (
                <>
                  <BuildingsLayer
                    map={map}
                    data={buildings.data}
                    view={view}
                    filter={filterExpr}
                    selectedId={selected?.id}
                    onSelect={setSelected}
                  />
                  <ReferenceLayer map={map} data={reference.data} visible={showReference} />
                </>
              )}
            </>
          )}
        </MapView>

        {/* Top controls */}
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-wrap items-start gap-2 p-3">
          <div className="pointer-events-auto">
            <Segmented
              label="Mode"
              value={mode}
              onChange={switchMode}
              options={[
                { value: 'measure', label: 'Measure' },
                { value: 'change', label: 'Change' },
              ]}
            />
          </div>
          <div className="pointer-events-auto">
            <CitySearch
              cities={cities}
              onPick={(it) => {
                const map = mapRef.current
                if (!map) return
                if (it.bbox) map.fitBounds([[it.bbox[0], it.bbox[1]], [it.bbox[2], it.bbox[3]]], { maxZoom: 15 })
                else map.flyTo({ center: it.center, zoom: it.zoom || 15 })
              }}
            />
          </div>
          {mode === 'measure' && (
            <div className="pointer-events-auto">
              <Segmented
                label="View"
                value={view}
                onChange={setView}
                options={[
                  { value: '2d', label: '2D' },
                  { value: '3d', label: '3D' },
                ]}
              />
            </div>
          )}
        </div>

        {/* Left: draw tools or processing */}
        <div className="absolute left-3 top-16 z-20 space-y-3">
          {running && !hideStepper ? (
            <ProcessingStepper job={job} mode={mode} onCancel={() => setHideStepper(true)} />
          ) : (
            <DrawToolbar
              drawMode={drawMode}
              setDrawMode={setDrawMode}
              areaKm2={areaKm2}
              limitKm2={limit}
              canRun={Boolean(aoi) && !noCoverage && !surveys.loading}
              running={submitting}
              onRun={run}
              runLabel={mode === 'measure' ? 'Measure buildings' : 'Detect change'}
              onSample={sample ? loadSample : undefined}
              sampleLabel={`Try a sample area: ${sample?.name ?? ''}`}
              note={note}
            />
          )}
          {submitError && (
            <Alert variant="error" className="w-72">
              {submitError}
            </Alert>
          )}
          {jobError && (
            <Alert variant="error" className="w-72">
              Could not load the job: {jobError}
            </Alert>
          )}
          {job?.status === 'failed' && (
            <Alert variant="error" className="w-72">
              {job.error || 'The job failed.'}
            </Alert>
          )}
        </div>

        {/* Right: results */}
        {job?.status === 'done' && mode === 'measure' && (
          <aside className="panel absolute bottom-3 right-3 top-3 z-20 w-96 overflow-y-auto p-4" aria-label="Results">
            {buildings.loading && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner size="sm" /> Loading buildings
              </div>
            )}
            {buildings.error && <Alert variant="error">Could not load buildings: {buildings.error}</Alert>}
            {buildings.data && buildings.data.features.length === 0 && (
              <p className="text-sm text-muted">No buildings were found in this area.</p>
            )}
            {buildings.data && buildings.data.features.length > 0 && (
              <MeasurePanel
                job={job}
                features={filtered}
                total={buildings.data.features.length}
                filters={filters}
                setFilters={setFilters}
                selected={selected}
                onCloseSelected={() => setSelected(null)}
                showReference={showReference}
                onToggleReference={() => setShowReference((v) => !v)}
                exportUrls={{
                  geojson: SkyscanService.exportUrl(job.id, 'geojson'),
                  csv: SkyscanService.exportUrl(job.id, 'csv'),
                }}
                onScreenshot={screenshot}
              />
            )}
            {reference.loading && <p className="mt-2 text-xs text-muted">Loading reference footprints…</p>}
            {reference.error && <p className="mt-2 text-xs text-orange">Reference footprints: {reference.error}</p>}
          </aside>
        )}
      </div>
    </div>
  )
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Navbar from '@/components/layout/Navbar'
import { Alert, Spinner } from '@/components/ui'
import { CitySearch, DrawToolbar, ProcessingStepper, Segmented } from '@/components/explorer/controls'
import { AoiLayer, BuildingsLayer, ChangesLayer, CoverageLayer, ReferenceLayer } from '@/components/explorer/layers'
import ChangePanel from '@/components/explorer/ChangePanel'
import { CHANGE_TYPES } from '@/components/explorer/changeTypes'
import CompareSwipe from '@/components/explorer/CompareSwipe'
import MapView from '@/components/explorer/MapView'
import MeasurePanel from '@/components/explorer/MeasurePanel'
import { PointCloudLegend, PointCloudOverlay, usePointCloud } from '@/components/explorer/PointCloud'
import SurveyPicker from '@/components/explorer/SurveyPicker'
import { useJob } from '@/hooks/useJob'
import { SkyscanService } from '@/services'
import { getErrorMessage } from '@/utils'
import { bbox, polygonAreaKm2 } from '@/utils/geo'

export const LIMITS = { measure: 1.0, change: 0.5 }
const DEFAULT_FILTERS = { minHeight: 0, minArea: 0, minConfidence: 0 }
const DEFAULT_CHANGE_FILTERS = { types: CHANGE_TYPES.map((t) => t.key), minArea: 0 }

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
  const [changeFilters, setChangeFilters] = useState(DEFAULT_CHANGE_FILTERS)
  const [pair, setPair] = useState({ before: null, after: null })
  const [compare, setCompare] = useState(true)
  const [colorBy, setColorBy] = useState('classification')
  const [pcEpoch, setPcEpoch] = useState('after')

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

  // Camera pitch follows the 2D / 3D / point cloud switch.
  useEffect(() => {
    const map = mapRef.current
    if (map) map.easeTo({ pitch: view === '2d' ? 0 : view === 'points' ? 60 : 55, duration: 600 })
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

  const isMeasureJob = job?.mode === 'measure'
  const isChangeJob = job?.mode === 'change'
  const points = view === 'points'
  const cloud = usePointCloud(job?.status === 'done' ? job.id : null, isChangeJob ? pcEpoch : 'single', points)
  const buildings = useResults(isMeasureJob ? job : null, 'buildings', { epoch: 'single' })
  const reference = useResults(showReference && isMeasureJob ? job : null, 'reference')
  const changes = useResults(isChangeJob ? job : null, 'changes')
  const before = useResults(isChangeJob ? job : null, 'buildings', { epoch: 'before' })
  const after = useResults(isChangeJob ? job : null, 'buildings', { epoch: 'after' })

  // Default survey pair whenever the surveys for a new area arrive.
  useEffect(() => {
    const dp = surveys.data?.default_pair
    setPair(dp ? { before: dp[0], after: dp[1] } : { before: null, after: null })
  }, [surveys.data])

  const changeFilterExpr = useMemo(
    () => [
      'all',
      ['in', ['get', 'change_type'], ['literal', changeFilters.types]],
      ['>=', ['get', 'area_m2'], changeFilters.minArea],
    ],
    [changeFilters]
  )
  const filteredChanges = useMemo(
    () =>
      (changes.data?.features || []).filter(
        (f) => changeFilters.types.includes(f.properties.change_type) && f.properties.area_m2 >= changeFilters.minArea
      ),
    [changes.data, changeFilters]
  )

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
  const changeBlocked = mode === 'change' && surveys.data && !surveys.data.change_possible
  const pairYears = (id) => surveys.data?.results?.find((d) => d.id === id)?.acquisition_year
  const pairInvalid =
    mode === 'change' &&
    surveys.data?.change_possible &&
    (!(pair.before && pair.after) ||
      pairYears(pair.after) - pairYears(pair.before) < (surveys.data.min_years_apart ?? 3))

  const run = async () => {
    setSubmitError(null)
    setSubmitting(true)
    try {
      const body = { mode, aoi }
      if (mode === 'change' && pair.before && pair.after) {
        body.dataset_before = pair.before
        body.dataset = pair.after
      }
      const created = await SkyscanService.createJob(body)
      setSelected(null)
      setFilters(DEFAULT_FILTERS)
      setChangeFilters(DEFAULT_CHANGE_FILTERS)
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

  const flyToFeature = (f) => {
    const map = mapRef.current
    if (!map || !f?.geometry) return
    const [w, s, e, n] = bbox(f.geometry)
    map.fitBounds([[w, s], [e, n]], { padding: { top: 120, bottom: 120, left: 360, right: 460 }, maxZoom: 18, duration: 900 })
  }

  const note = surveys.loading
    ? 'Checking LiDAR coverage…'
    : surveys.error
      ? surveys.error
      : noCoverage
        ? 'No LiDAR survey covers this area. Draw inside the teal coverage.'
        : mode === 'change'
          ? null
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
                    visible={!points}
                  />
                  <ReferenceLayer map={map} data={reference.data} visible={showReference} />
                </>
              )}
              {mode === 'change' && isChangeJob && (
                <>
                  {/* Left of the swipe: the earlier survey. Without the swipe: the later one. */}
                  <BuildingsLayer
                    map={map}
                    id="bld-main"
                    data={compare && !points ? before.data : after.data}
                    view={view}
                    opacity={0.7}
                    visible={!points}
                  />
                  <ChangesLayer
                    map={map}
                    data={changes.data}
                    view={view}
                    filter={changeFilterExpr}
                    selectedId={selected?.id}
                    onSelect={setSelected}
                    visible={!points}
                  />
                  {compare && !points && job.status === 'done' && (
                    <CompareSwipe
                      mainMap={map}
                      leftLabel={job.stats?.before?.year ?? 'Before'}
                      rightLabel={job.stats?.after?.year ?? 'After'}
                    >
                      {(m2) => (
                        <>
                          <BuildingsLayer map={m2} id="bld-after" data={after.data} view={view} opacity={0.7} />
                          <ChangesLayer map={m2} data={changes.data} view={view} filter={changeFilterExpr} selectedId={selected?.id} />
                        </>
                      )}
                    </CompareSwipe>
                  )}
                </>
              )}
              {points && cloud.pc && <PointCloudOverlay map={map} pc={cloud.pc} colorBy={colorBy} />}
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
          <div className="pointer-events-auto">
            <Segmented
              label="View"
              value={view}
              onChange={setView}
              options={[
                { value: '2d', label: '2D' },
                { value: '3d', label: '3D' },
                { value: 'points', label: 'Point Cloud' },
              ]}
              disabled={{ points: job?.status === 'done' ? false : 'Run or load a job to see its point cloud' }}
            />
          </div>
          {mode === 'change' && isChangeJob && job.status === 'done' && !points && (
            <label className="pointer-events-auto flex items-center gap-2 rounded-md border bg-ink-850 px-3 py-1.5 text-xs text-muted">
              <input type="checkbox" checked={compare} onChange={() => setCompare((c) => !c)} className="accent-teal" />
              Swipe {job.stats?.before?.year} | {job.stats?.after?.year}
            </label>
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
              canRun={Boolean(aoi) && !noCoverage && !surveys.loading && !changeBlocked && !pairInvalid}
              running={submitting}
              onRun={run}
              runLabel={mode === 'measure' ? 'Measure buildings' : 'Detect change'}
              onSample={sample ? loadSample : undefined}
              sampleLabel={`Try a sample area: ${sample?.name ?? ''}`}
              note={note}
            />
          )}
          {mode === 'change' && aoi && surveys.data && !running && (
            <SurveyPicker surveys={surveys.data} pair={pair} setPair={setPair} />
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
        {points && job?.status === 'done' && (
          <div className="panel absolute bottom-10 left-3 z-20 w-72 space-y-3 p-3" aria-label="Point cloud">
            <div className="flex items-center justify-between">
              <span className="label">Point cloud</span>
              {cloud.pc && <span className="num text-[11px] text-muted">{cloud.pc.header.count.toLocaleString()} pts</span>}
            </div>
            <Segmented
              label="Colour points by"
              value={colorBy}
              onChange={setColorBy}
              options={[
                { value: 'classification', label: 'Class' },
                { value: 'height', label: 'Height' },
                { value: 'intensity', label: 'Intensity' },
              ]}
            />
            {isChangeJob && (
              <Segmented
                label="Survey"
                value={pcEpoch}
                onChange={setPcEpoch}
                options={[
                  { value: 'before', label: String(job.stats?.before?.year ?? 'Before') },
                  { value: 'after', label: String(job.stats?.after?.year ?? 'After') },
                ]}
              />
            )}
            {cloud.loading && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Spinner size="sm" /> Loading points
              </div>
            )}
            {cloud.error && <p className="text-xs text-orange">Point cloud unavailable: {cloud.error}</p>}
            <PointCloudLegend pc={cloud.pc} colorBy={colorBy} />
          </div>
        )}

        {job?.status === 'done' && mode === 'change' && isChangeJob && (
          <aside className="panel absolute bottom-3 right-3 top-3 z-20 w-96 overflow-y-auto p-4" aria-label="Results">
            {changes.loading && (
              <div className="flex items-center gap-2 text-sm text-muted">
                <Spinner size="sm" /> Loading changes
              </div>
            )}
            {changes.error && <Alert variant="error">Could not load changes: {changes.error}</Alert>}
            {changes.data && changes.data.features.length === 0 && (
              <p className="text-sm text-muted">
                No building changes between {job.stats?.before?.year} and {job.stats?.after?.year} in this area.
              </p>
            )}
            {changes.data && changes.data.features.length > 0 && (
              <ChangePanel
                job={job}
                features={filteredChanges}
                total={changes.data.features.length}
                filters={changeFilters}
                setFilters={setChangeFilters}
                selected={selected}
                onSelect={(p, f) => {
                  setSelected(p)
                  if (f) flyToFeature(f)
                }}
                exportUrls={{
                  geojson: SkyscanService.exportUrl(job.id, 'geojson', { layer: 'changes' }),
                  csv: SkyscanService.exportUrl(job.id, 'csv', { layer: 'changes' }),
                }}
                onScreenshot={screenshot}
              />
            )}
          </aside>
        )}

        {job?.status === 'done' && mode === 'measure' && isMeasureJob && (
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

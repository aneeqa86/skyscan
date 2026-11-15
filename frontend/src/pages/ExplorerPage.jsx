/**
 * Explorer (Explorer.dc.html, Explorer-Processing.dc.html, PointCloud.dc.html):
 * top bar, controls sidebar, map, results panel. Measure and Change modes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CHANGE_TYPES } from '@/components/explorer/changeTypes'
import CompareSwipe from '@/components/explorer/CompareSwipe'
import {
  AoiLayer,
  BuildingsLayer,
  ChangesLayer,
  CoverageLayer,
  ReferenceLayer,
  ScanLineLayer,
  setBasemapVisible,
} from '@/components/explorer/layers'
import { BuildingPopup, CoordScale, Legend, MapChip, ZoomControls } from '@/components/explorer/MapChrome'
import MapView from '@/components/explorer/MapView'
import PointCloudView from '@/components/explorer/PointCloud'
import ProcessingCard from '@/components/explorer/ProcessingCard'
import { ChangeResults, FailedResults, MeasureResults, PendingResults } from '@/components/explorer/Results'
import Sidebar, { PLACES } from '@/components/explorer/Sidebar'
import TopBar from '@/components/explorer/TopBar'
import { useDebounce } from '@/hooks'
import { useJob } from '@/hooks/useJob'
import { SkyscanService } from '@/services'
import { formatNumber, getErrorMessage } from '@/utils'
import { bbox, polygonAreaKm2 } from '@/utils/geo'

export const LIMITS = { measure: 1.0, change: 0.5 }
const DEFAULT_FILTERS = { minHeight: 0, minArea: 0, minConfidence: 0 }
const DEFAULT_CHANGE_FILTERS = {
  types: CHANGE_TYPES.map((t) => t.key),
  minArea: 0,
}
const DEFAULT_LAYERS = {
  buildings: true,
  labels: false,
  reference: false,
  swipe: true,
  coverage: true,
  basemap: true,
}

function apiError(err) {
  const d = err?.response?.data
  if (d && typeof d === 'object') {
    const first = Object.values(d).flat()[0]
    if (typeof first === 'string') return first
  }
  return getErrorMessage(err)
}

export function useResults(job, layer, params) {
  const [state, setState] = useState({
    data: null,
    loading: false,
    error: null,
  })
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

function initialViewFrom(params) {
  const lon = Number(params.get('lon'))
  const lat = Number(params.get('lat'))
  if (!params.get('lon') || !Number.isFinite(lon) || !Number.isFinite(lat)) return undefined
  return { center: [lon, lat], zoom: Number(params.get('zoom')) || 15 }
}

export default function ExplorerPage() {
  const [params, setParams] = useSearchParams()
  const mode = params.get('mode') === 'change' ? 'change' : 'measure'
  const jobId = params.get('job')
  const citySlug = params.get('city')
  const [initialView] = useState(() => initialViewFrom(params))

  const mapRef = useRef(null)
  const [mapReady, setMapReady] = useState(false)
  const [center, setCenter] = useState(null)
  const [cities, setCities] = useState([])
  const [view, setView] = useState('3d')
  const [drawMode, setDrawMode] = useState(null)
  const [aoi, setAoi] = useState(null)
  const [surveys, setSurveys] = useState({
    data: null,
    loading: false,
    error: null,
  })
  const [source, setSource] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState(null)
  const [cancelling, setCancelling] = useState(false)
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [changeFilters, setChangeFilters] = useState(DEFAULT_CHANGE_FILTERS)
  const [layers, setLayers] = useState(DEFAULT_LAYERS)
  const [selected, setSelected] = useState(null) // GeoJSON feature
  const [pair, setPair] = useState({ before: null, after: null })

  const { job, error: jobError } = useJob(jobId)
  const running = Boolean(job && !['done', 'failed'].includes(job.status))
  const done = job?.status === 'done'
  const areaKm2 = aoi ? polygonAreaKm2(aoi) : 0
  const limit = LIMITS[mode]
  const isMeasureJob = job?.mode === 'measure'
  const isChangeJob = job?.mode === 'change'
  const points = view === 'points' && done

  const setParam = useCallback(
    (patch) => {
      const next = new URLSearchParams(params)
      Object.entries(patch).forEach(([k, v]) => (v == null ? next.delete(k) : next.set(k, v)))
      setParams(next, { replace: false })
    },
    [params, setParams]
  )

  useEffect(() => {
    SkyscanService.getCities({ is_showcase: true })
      .then(setCities)
      .catch(() => setCities([]))
  }, [])

  // ?city=slug opens that showcase's precomputed job.
  useEffect(() => {
    if (!citySlug || jobId || !cities.length) return
    const city = cities.find((c) => c.slug === citySlug)
    if (city?.showcase_job) setParam({ job: city.showcase_job.id, mode: city.showcase_mode })
  }, [citySlug, cities, jobId, setParam])

  // Track the map centre for the survey lookup when no area is drawn.
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map) return undefined
    const update = () => {
      const c = map.getCenter()
      // Below city zoom a point lookup means little; ask the user to zoom in.
      setCenter(map.getZoom() < 9 ? 'far' : [Number(c.lng.toFixed(4)), Number(c.lat.toFixed(4))])
    }
    update()
    map.on('moveend', update)
    return () => map.off('moveend', update)
  }, [mapReady])
  const debouncedCenter = useDebounce(center, 500)

  // Fly to the job area when a job loads.
  const flownTo = useRef(null)
  useEffect(() => {
    const map = mapRef.current
    if (!mapReady || !map || !job?.aoi || flownTo.current === job.id) return
    flownTo.current = job.id
    const [w, s, e, n] = bbox(job.aoi)
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 60, pitch: view === '2d' ? 0 : 55, duration: 1200 }
    )
  }, [job, view, mapReady])

  // Camera pitch follows the 2D / 3D switch.
  useEffect(() => {
    const map = mapRef.current
    if (map && view !== 'points') map.easeTo({ pitch: view === '2d' ? 0 : 55, duration: 600 })
  }, [view])

  useEffect(() => {
    if (mapReady && mapRef.current) setBasemapVisible(mapRef.current, layers.basemap)
  }, [layers.basemap, mapReady])

  // Leave the point cloud view if the job has no points to show.
  useEffect(() => {
    if (view === 'points' && !done) setView('3d')
  }, [view, done])

  // Which surveys cover the drawn area (or, with no area, the map centre).
  useEffect(() => {
    if (aoi && areaKm2 > limit) {
      setSurveys({ data: null, loading: false, error: null })
      return undefined
    }
    if (!aoi && !debouncedCenter) return undefined
    if (!aoi && debouncedCenter === 'far') {
      setSurveys({ data: null, loading: false, error: null, far: true })
      return undefined
    }
    let cancelled = false
    setSurveys((s) => ({ ...s, loading: true, error: null }))
    const req = aoi ? { aoi } : { lon: debouncedCenter[0], lat: debouncedCenter[1] }
    SkyscanService.getSurveys(req)
      .then((data) => {
        if (cancelled) return
        // A point lookup has no full-area check; treat each survey as covering it.
        const results = aoi
          ? data.results
          : (data.results || []).map((d) => ({
              ...d,
              covers_whole_area: true,
            }))
        setSurveys({
          data: { ...data, results, point: !aoi },
          loading: false,
          error: null,
        })
      })
      .catch((err) => {
        if (cancelled) return
        const msg = aoi ? apiError(err) : 'Could not check coverage at the map centre. Draw an area to check it.'
        setSurveys({ data: null, loading: false, error: msg })
      })
    return () => {
      cancelled = true
    }
  }, [aoi, areaKm2, limit, debouncedCenter])

  // Default survey pair whenever surveys for a new area arrive.
  useEffect(() => {
    const dp = surveys.data?.default_pair
    setPair(dp ? { before: dp[0], after: dp[1] } : { before: null, after: null })
  }, [surveys.data])

  const buildings = useResults(isMeasureJob ? job : null, 'buildings', {
    epoch: 'single',
  })
  const reference = useResults(layers.reference && isMeasureJob ? job : null, 'reference')
  const changes = useResults(isChangeJob ? job : null, 'changes')
  const before = useResults(isChangeJob ? job : null, 'buildings', {
    epoch: 'before',
  })
  const after = useResults(isChangeJob ? job : null, 'buildings', {
    epoch: 'after',
  })

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
  const changeFilterExpr = useMemo(
    () => ['all', ['in', ['get', 'change_type'], ['literal', changeFilters.types]], ['>=', ['get', 'area_m2'], changeFilters.minArea]],
    [changeFilters]
  )
  const filteredChanges = useMemo(
    () =>
      (changes.data?.features || []).filter(
        (f) => changeFilters.types.includes(f.properties.change_type) && f.properties.area_m2 >= changeFilters.minArea
      ),
    [changes.data, changeFilters]
  )

  const pointLookup = surveys.data?.point
  const noCoverage = surveys.data && surveys.data.count === 0
  const changeBlocked = mode === 'change' && aoi && surveys.data && !pointLookup && !surveys.data.change_possible
  const yearOf = (id) => surveys.data?.results?.find((d) => d.id === id)?.acquisition_year
  const pairInvalid =
    mode === 'change' &&
    aoi &&
    surveys.data?.change_possible &&
    (!(pair.before && pair.after) || yearOf(pair.after) - yearOf(pair.before) < (surveys.data.min_years_apart ?? 3))

  const run = async () => {
    setSubmitError(null)
    setSubmitting(true)
    try {
      const body = { mode, aoi }
      if (mode === 'change' && pair.before && pair.after) {
        body.dataset_before = pair.before
        body.dataset = pair.after
      }
      if (mode === 'measure' && source) body.dataset = Number(source)
      const created = await SkyscanService.createJob(body)
      setSelected(null)
      setFilters(DEFAULT_FILTERS)
      setChangeFilters(DEFAULT_CHANGE_FILTERS)
      setParam({ job: created.id, city: null })
      setDrawMode('clear')
      setAoi(null)
    } catch (err) {
      setSubmitError(apiError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    setCancelling(true)
    try {
      await SkyscanService.cancelJob(job.id)
    } catch (err) {
      setSubmitError(apiError(err))
    } finally {
      setCancelling(false)
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

  const place = PLACES.find((p) => p.city && p.city === citySlug)?.id ?? ''
  const pickPlace = (id) => {
    const p = PLACES.find((x) => x.id === id)
    if (!p) return
    setSelected(null)
    if (p.city) {
      setDrawMode('clear')
      setAoi(null)
      setParam({ city: p.city, job: null, mode: null })
      return
    }
    mapRef.current?.flyTo({
      center: p.center,
      zoom: p.zoom,
      pitch: view === '2d' ? 0 : 45,
      duration: 1400,
    })
  }
  const pickSearch = (it) => {
    const map = mapRef.current
    if (!map) return
    if (it.bbox)
      map.fitBounds(
        [
          [it.bbox[0], it.bbox[1]],
          [it.bbox[2], it.bbox[3]],
        ],
        { maxZoom: 16 }
      )
    else map.flyTo({ center: it.center, zoom: 16 })
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
    setView((v) => (v === 'points' ? '3d' : v))
    setParam({ mode: m, job: null, city: null })
  }

  // Mapbox hands back tile-clipped features; select the full one from the layer data.
  const selectById = (data, id) => setSelected(data?.features?.find((f) => f.properties.id === id) ?? null)

  const flyToFeature = (f) => {
    const map = mapRef.current
    if (!map || !f?.geometry) return
    const [w, s, e, n] = bbox(f.geometry)
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 120, maxZoom: 18, duration: 900 }
    )
  }

  const exportLayer = isChangeJob ? 'changes' : undefined
  const exportItems = done
    ? [
        {
          label: 'GeoJSON',
          ext: '.geojson',
          icon: 'download',
          href: SkyscanService.exportUrl(job.id, 'geojson', {
            layer: exportLayer,
          }),
        },
        {
          label: 'CSV',
          ext: '.csv',
          icon: 'csv',
          href: SkyscanService.exportUrl(job.id, 'csv', { layer: exportLayer }),
        },
        {
          label: 'Screenshot',
          ext: '.png',
          icon: 'screenshot',
          onSelect: screenshot,
        },
      ]
    : []

  const surveyHint = surveys.far
    ? 'Zoom in to a city to see which surveys cover it.'
    : surveys.loading
      ? 'Checking LiDAR coverage…'
      : surveys.error
        ? surveys.error
        : noCoverage
          ? aoi
            ? 'No LiDAR survey covers this area. Draw inside the teal coverage.'
            : 'No LiDAR survey covers the map centre. Pan to the teal coverage.'
          : null
  const note = !aoi
    ? mode === 'measure'
      ? 'Draw an area up to 1 km² to measure its buildings.'
      : 'Draw an area up to 0.5 km² to compare two surveys.'
    : null

  const isMeasureView = mode === 'measure' && isMeasureJob
  const isChangeView = mode === 'change' && isChangeJob
  const results = running ? (
    <PendingResults processing mode={mode} />
  ) : job?.status === 'failed' ? (
    <FailedResults job={job} />
  ) : done && isMeasureView ? (
    <MeasureResults
      job={job}
      layer={buildings}
      features={filtered}
      all={buildings.data?.features || []}
      selected={selected}
      onClearFilters={() => setFilters(DEFAULT_FILTERS)}
      onScreenshot={screenshot}
      geojsonUrl={SkyscanService.exportUrl(job.id, 'geojson')}
    />
  ) : done && isChangeView ? (
    <ChangeResults
      job={job}
      layer={changes}
      features={filteredChanges}
      selected={selected}
      onSelect={(f) => {
        setSelected(f)
        flyToFeature(f)
      }}
      onScreenshot={screenshot}
      geojsonUrl={SkyscanService.exportUrl(job.id, 'geojson', {
        layer: 'changes',
      })}
    />
  ) : (
    <PendingResults mode={mode} />
  )

  const counter = running
    ? `${mode === 'change' ? 'COMPARING' : 'SCANNING'} · ${job.progress ?? 0}%`
    : done && isMeasureView && buildings.data
      ? `${formatNumber(filtered.length)} BUILDINGS`
      : done && isChangeView && changes.data
        ? `${formatNumber(filteredChanges.length)} CHANGES`
        : null

  return (
    <div className="flex min-h-screen flex-col bg-void lg:h-screen">
      <TopBar
        mode={mode}
        onMode={switchMode}
        view={view}
        onView={setView}
        locked={running}
        pointsAvailable={done}
        exportItems={exportItems}
      />
      <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
        {/* The point cloud view is full-bleed (PointCloud.dc.html). */}
        {!points && (
          <Sidebar
            mode={mode}
            locked={running}
            onCancel={cancel}
            cancelling={cancelling}
            place={place}
            onPlace={pickPlace}
            onSearchPick={pickSearch}
            surveys={surveys}
            surveyHint={surveyHint}
            source={source}
            setSource={setSource}
            pair={pair}
            setPair={setPair}
            drawMode={drawMode}
            setDrawMode={setDrawMode}
            aoi={aoi}
            areaKm2={areaKm2}
            limitKm2={limit}
            layers={layers}
            setLayers={setLayers}
            hasResults={done}
            filters={filters}
            setFilters={setFilters}
            changeFilters={changeFilters}
            setChangeFilters={setChangeFilters}
            canRun={Boolean(aoi) && !noCoverage && !surveys.loading && !changeBlocked && !pairInvalid}
            running={submitting}
            onRun={run}
            note={note}
            errors={[submitError, jobError && `Could not load the job: ${jobError}`]}
            sample={sample}
            onSample={loadSample}
          />
        )}

        <main className="relative h-[70vh] min-w-0 flex-[1_1_480px] bg-mapbg lg:h-auto" aria-label="Map">
          <MapView
            className="absolute inset-0"
            initialView={initialView}
            drawMode={drawMode}
            onAoiDrawn={(g) => {
              setAoi(g)
              setDrawMode(null)
            }}
            onDrawCleared={() => setAoi(null)}
            onReady={(map) => {
              mapRef.current = map
              setMapReady(true)
            }}
          >
            {(map) => (
              <>
                <CoverageLayer map={map} visible={layers.coverage && !points} />
                <AoiLayer map={map} aoi={job?.aoi && !aoi ? job.aoi : null} />
                {running && <ScanLineLayer map={map} aoi={job.aoi} progress={job.progress ?? 0} />}
                {mode === 'measure' && (
                  <>
                    <BuildingsLayer
                      map={map}
                      data={buildings.data}
                      view={view}
                      filter={filterExpr}
                      selectedId={selected?.properties?.id}
                      onSelect={(p) => selectById(buildings.data, p.id)}
                      visible={layers.buildings && !points}
                      labels={layers.labels}
                    />
                    <ReferenceLayer map={map} data={reference.data} visible={layers.reference && !points} />
                  </>
                )}
                {mode === 'change' && isChangeJob && (
                  <>
                    <BuildingsLayer
                      map={map}
                      id="bld-main"
                      data={layers.swipe ? before.data : after.data}
                      view={view}
                      opacity={0.7}
                      visible={!points}
                      neutral
                    />
                    <ChangesLayer
                      map={map}
                      data={changes.data}
                      view={view}
                      filter={changeFilterExpr}
                      selectedId={selected?.properties?.id}
                      onSelect={(p) => selectById(changes.data, p.id)}
                      visible={!points}
                    />
                    {layers.swipe && !points && done && (
                      <CompareSwipe
                        mainMap={map}
                        leftLabel={job.stats?.before?.year ?? 'Before'}
                        rightLabel={job.stats?.after?.year ?? 'After'}
                      >
                        {(m2) => (
                          <>
                            <BuildingsLayer map={m2} id="bld-after" data={after.data} view={view} opacity={0.7} neutral />
                            <ChangesLayer
                              map={m2}
                              data={changes.data}
                              view={view}
                              filter={changeFilterExpr}
                              selectedId={selected?.properties?.id}
                            />
                          </>
                        )}
                      </CompareSwipe>
                    )}
                  </>
                )}
                {points && <PointCloudView key={job.id} map={map} job={job} buildings={buildings.data} />}
              </>
            )}
          </MapView>

          {running && (
            <div className="absolute left-1/2 top-4 z-10 -translate-x-1/2">
              <ProcessingCard job={job} mode={mode} />
            </div>
          )}
          {mapReady && !points && (
            <>
              {counter && (
                <div className="absolute left-4 top-4 z-10">
                  <MapChip tone={running ? 'orange' : 'teal'} pulse={running}>
                    {counter}
                  </MapChip>
                </div>
              )}
              <div className="absolute right-4 top-4 z-10">
                <ZoomControls map={mapRef.current} />
              </div>
              {(done || mode === 'measure') && (
                <div className="absolute bottom-10 right-4 z-10 hidden sm:block">
                  <Legend mode={mode} view={view} showReference={layers.reference} />
                </div>
              )}
              <div className="absolute bottom-3 left-4 z-10">
                <CoordScale map={mapRef.current} />
              </div>
              {mode === 'measure' && selected && (
                <BuildingPopup
                  map={mapRef.current}
                  feature={selected}
                  onClose={() => setSelected(null)}
                  onZoom={() => flyToFeature(selected)}
                />
              )}
            </>
          )}
        </main>

        {!points && results}
      </div>
    </div>
  )
}

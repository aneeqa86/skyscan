/**
 * Point cloud viewer (PointCloud.dc.html): full-bleed points over the map,
 * colour-mode panel with legend, cloud settings, view tools and a split
 * slider. Measure: raw grayscale | detected colour with roofs outlined.
 * Change: earlier survey | later survey.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { COORDINATE_SYSTEM, Deck } from '@deck.gl/core'
import { PathLayer, PointCloudLayer, TextLayer } from '@deck.gl/layers'
import { Segmented, SectionLabel, Slider, Spinner, Svg, SwitchRow } from '@/components/ui/kit'
import { SkyscanService } from '@/services'
import { formatNumber, getErrorMessage } from '@/utils'
import { bbox } from '@/utils/geo'
import { CLASS_GROUPS, classShares, colors, decodePointCloud, footprintMask, positions, selectPoints } from '@/utils/pointcloud'

/** Fetch and decode a job's point cloud for one epoch (cached per job/epoch). */
export function usePointCloud(jobId, epoch, enabled) {
  const cache = useRef(new Map())
  const [state, setState] = useState({ pc: null, loading: false, error: null })
  useEffect(() => {
    if (!enabled || !jobId) return undefined
    const key = `${jobId}:${epoch}`
    if (cache.current.has(key)) {
      setState({ pc: cache.current.get(key), loading: false, error: null })
      return undefined
    }
    let cancelled = false
    setState({ pc: null, loading: true, error: null })
    SkyscanService.getPointCloud(jobId, epoch)
      .then((buf) => {
        const pc = decodePointCloud(buf)
        cache.current.set(key, pc)
        if (!cancelled) setState({ pc, loading: false, error: null })
      })
      .catch((err) => !cancelled && setState({ pc: null, loading: false, error: getErrorMessage(err) }))
    return () => {
      cancelled = true
    }
  }, [jobId, epoch, enabled])
  return state
}

function cloudLayer(id, pc, data, pointSize) {
  return new PointCloudLayer({
    id,
    data: {
      length: data.count,
      attributes: {
        getPosition: { value: data.pos, size: 3 },
        getColor: { value: data.col, size: 3, normalized: true },
      },
    },
    coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
    coordinateOrigin: [pc.header.center[0], pc.header.center[1], 0],
    pointSize,
    sizeUnits: 'pixels',
  })
}

const outerRing = (g) => (g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0])

/** Roof outlines at roof height; the tallest roof in orange with its reading. */
function roofLayers(buildings) {
  if (!buildings?.features?.length) return []
  let tallest = buildings.features[0]
  const paths = []
  for (const f of buildings.features) {
    if (f.properties.height_m > tallest.properties.height_m) tallest = f
    const ring = outerRing(f.geometry)
    paths.push({
      path: ring.map(([x, y]) => [x, y, f.properties.height_m]),
      top: false,
    })
  }
  paths.push({
    path: outerRing(tallest.geometry).map(([x, y]) => [x, y, tallest.properties.height_m]),
    top: true,
  })
  const [w, s, e, n] = bbox(tallest.geometry)
  return [
    new PathLayer({
      id: 'roofs',
      data: paths,
      getPath: (d) => d.path,
      getColor: (d) => (d.top ? [255, 107, 53] : [232, 238, 246, 200]),
      getWidth: (d) => (d.top ? 2 : 0.8),
      widthUnits: 'pixels',
    }),
    new TextLayer({
      id: 'roof-tag',
      data: [
        {
          pos: [(w + e) / 2, (s + n) / 2, tallest.properties.height_m + 6],
          text: `ROOF HEIGHT ${tallest.properties.height_m.toFixed(1)} m`,
        },
      ],
      getPosition: (d) => d.pos,
      getText: (d) => d.text,
      getColor: [255, 107, 53],
      getSize: 12,
      fontFamily: 'JetBrains Mono, monospace',
      background: true,
      getBackgroundColor: [7, 11, 20, 230],
      backgroundPadding: [6, 4],
      getBorderColor: [255, 107, 53],
      getBorderWidth: 1,
    }),
  ]
}

function useCloudData(pc, by, settings, gray, mask) {
  const idx = useMemo(() => (pc ? selectPoints(pc, settings, mask) : null), [pc, settings, mask])
  const pos = useMemo(() => (pc ? positions(pc, idx) : null), [pc, idx])
  const col = useMemo(() => (pc ? colors(pc, by, idx, gray, mask) : null), [pc, by, idx, gray, mask])
  return pc ? { count: idx.length, pos, col } : null
}

/** A deck.gl canvas over the map, following its camera, clipped to one side. */
function useSyncedDeck(map, holder) {
  const deck = useRef(null)
  useEffect(() => {
    const viewState = () => {
      const c = map.getCenter()
      return {
        longitude: c.lng,
        latitude: c.lat,
        zoom: map.getZoom(),
        pitch: map.getPitch(),
        bearing: map.getBearing(),
      }
    }
    deck.current = new Deck({
      parent: holder.current,
      controller: false,
      viewState: viewState(),
      layers: [],
      parameters: { clearColor: [0, 0, 0, 0] },
      style: { pointerEvents: 'none' },
    })
    const sync = () => deck.current?.setProps({ viewState: viewState() })
    map.on('move', sync)
    return () => {
      map.off('move', sync)
      deck.current?.finalize()
      deck.current = null
    }
  }, [map, holder])
  return deck
}

function Legend({ pc, mode, mask }) {
  const shares = useMemo(() => (pc ? classShares(pc, mask) : null), [pc, mask])
  if (mode === 'height')
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex h-2.5">
          {['#2B4C7E', '#2A8FA8', '#00C9A7', '#E8B45C', '#FF6B35'].map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="flex justify-between font-mono text-xs text-muted">
          <span>0 m</span>
          <span>nDSM</span>
          <span>45 m</span>
        </div>
      </div>
    )
  if (mode === 'intensity')
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex h-2.5">
          {['#3A4558', '#6E788C', '#98A2B3', '#C4CCD8', '#F1F4F9'].map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="flex justify-between font-mono text-xs text-muted">
          <span>0</span>
          <span>return intensity</span>
          <span>255</span>
        </div>
      </div>
    )
  return (
    <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px]">
      {CLASS_GROUPS.map((g) => (
        <li key={g.key} className="flex items-center gap-2.5">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: g.color }} />
          <span className="flex-1">{g.label}</span>
          <span className="font-mono text-xs text-muted">{shares ? `${(shares[g.key] * 100).toFixed(1)}%` : '-'}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * The viewer. map: the Mapbox map; job: finished job; buildings: GeoJSON of
 * detected buildings (Measure), shown as roof outlines on the detected side.
 */
export default function PointCloudView({ map, job, buildings, epochs }) {
  const change = job.mode === 'change'
  const [mode, setMode] = useState('class')
  const [split, setSplit] = useState(50)
  const [pointSize, setPointSize] = useState(2)
  const [density, setDensity] = useState(100)
  const [groups, setGroups] = useState({
    ground: true,
    vegetation: true,
    buildings: true,
    other: true,
  })
  const [tool, setTool] = useState('orbit')
  const left = usePointCloud(job.id, change ? 'before' : 'single', true)
  const right = usePointCloud(job.id, change ? 'after' : 'single', true)
  const by = mode === 'class' ? 'classification' : mode
  const settings = useMemo(() => ({ stride: Math.max(1, Math.round(100 / density)), groups }), [density, groups])
  // Measure: points inside detected footprints become buildings on the detected side.
  const mask = useMemo(() => (!change && right.pc ? footprintMask(right.pc, buildings) : null), [change, right.pc, buildings])
  const leftData = useCloudData(left.pc, by, settings, !change, null)
  const rightData = useCloudData(right.pc, by, settings, false, mask)

  const leftHolder = useRef(null)
  const rightHolder = useRef(null)
  const leftDeck = useSyncedDeck(map, leftHolder)
  const rightDeck = useSyncedDeck(map, rightHolder)
  useEffect(() => {
    leftDeck.current?.setProps({
      layers: left.pc && leftData ? [cloudLayer('left', left.pc, leftData, pointSize)] : [],
    })
  }, [leftDeck, left.pc, leftData, pointSize])
  useEffect(() => {
    const layers =
      right.pc && rightData ? [cloudLayer('right', right.pc, rightData, pointSize), ...(change ? [] : roofLayers(buildings))] : []
    rightDeck.current?.setProps({ layers })
  }, [rightDeck, right.pc, rightData, pointSize, buildings, change])

  // Camera: frame the area, pitched, on entry.
  const reset = () => {
    const [w, s, e, n] = bbox(job.aoi)
    map.fitBounds(
      [
        [w, s],
        [e, n],
      ],
      { padding: 120, pitch: 60, bearing: -20, duration: 900 }
    )
  }
  useEffect(reset, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (tool === 'pan') map.dragRotate.disable()
    else map.dragRotate.enable()
    return () => map.dragRotate.enable()
  }, [map, tool])

  const loading = left.loading || right.loading
  const error = left.error || right.error
  const pc = right.pc || left.pc
  const years = [job.stats?.before?.year, job.stats?.after?.year]
  const labels = change ? [String(years[0] ?? 'BEFORE'), String(years[1] ?? 'AFTER')] : ['RAW POINTS', 'DETECTED BUILDINGS']

  return (
    <>
      <div
        ref={leftHolder}
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
        aria-hidden="true"
      />
      <div
        ref={rightHolder}
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{ clipPath: `inset(0 0 0 ${split}%)` }}
        aria-hidden="true"
      />
      <div className="pointer-events-none absolute inset-y-0 z-[6] border-l-stroke border-fg" style={{ left: `${split}%` }}>
        <span className="absolute left-[-14px] top-1/2 -mt-3.5 flex h-7 w-7 items-center justify-center rounded-full border-stroke border-fg bg-panel text-fg">
          <Svg name="compare" size={14} />
        </span>
      </div>
      <div className="absolute left-1/2 top-4 z-10 flex -translate-x-1/2 gap-2 font-mono text-[11px] tracking-[0.12em]">
        <span className="floating px-2.5 py-2 text-muted">{labels[0]}</span>
        <span className="rounded-card border-hair border-teal bg-panel px-2.5 py-2 text-teal">{labels[1]}</span>
      </div>

      <section
        aria-label="Color mode and legend"
        className="floating absolute left-4 top-4 z-10 flex w-[264px] max-w-[calc(100%-32px)] flex-col gap-3.5 p-4"
      >
        <SectionLabel>Color mode</SectionLabel>
        <Segmented
          label="Color mode"
          value={mode}
          onChange={setMode}
          size="sm"
          className="grid grid-cols-3"
          options={[
            { value: 'class', label: 'Class' },
            { value: 'height', label: 'Height' },
            { value: 'intensity', label: 'Intensity' },
          ]}
        />
        <div className="border-t-hair border-line pt-3.5">
          <SectionLabel as="h3" className="mb-2.5">
            Legend
          </SectionLabel>
          <Legend pc={right.pc || left.pc} mode={mode} mask={mask} />
        </div>
      </section>

      <section
        aria-label="Cloud settings"
        className="floating absolute right-4 top-4 z-10 flex w-[264px] max-w-[calc(100%-32px)] flex-col gap-1 p-4"
      >
        <SectionLabel className="mb-2">Point cloud</SectionLabel>
        <dl className="m-0 mb-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[13px]">
          <dt className="text-muted">Points</dt>
          <dd className="num m-0 text-right">{pc ? formatNumber(rightData?.count ?? pc.header.count) : '-'}</dd>
          <dt className="text-muted">{change ? 'Changes' : 'Buildings'}</dt>
          <dd className="num m-0 text-right text-orange">
            {formatNumber(change ? job.stats?.change_count : (buildings?.features?.length ?? 0))}
          </dd>
          <dt className="text-muted">CRS</dt>
          <dd className="num m-0 text-right">{pc ? `EPSG:${pc.header.epsg}` : '-'}</dd>
        </dl>
        <div className="border-t-hair border-line pt-2">
          <Slider
            label="Point size"
            value={pointSize}
            display={`${pointSize.toFixed(1)} px`}
            min={1}
            max={6}
            step={0.5}
            onChange={setPointSize}
          />
          <Slider label="Density" value={density} display={`${density}%`} min={5} max={100} step={5} onChange={setDensity} />
        </div>
        <div className="-mx-2 border-t-hair border-line pt-1">
          {CLASS_GROUPS.map((g) => (
            <SwitchRow key={g.key} label={g.label} checked={groups[g.key]} onChange={(v) => setGroups({ ...groups, [g.key]: v })} />
          ))}
        </div>
        {loading && <Spinner label="Loading points" className="mt-2 text-xs text-muted" />}
        {error && <p className="m-0 mt-2 text-xs text-orange">Point cloud unavailable: {error}</p>}
      </section>

      <div className="floating absolute bottom-10 right-4 z-10 flex overflow-hidden">
        {[
          [
            'orbit',
            'Orbit',
            () =>
              map.easeTo({
                bearing: map.getBearing() + 45,
                pitch: Math.max(map.getPitch(), 50),
                duration: 700,
              }),
          ],
          ['pan', 'Pan', null],
          ['top', 'Top-down view', () => map.easeTo({ pitch: 0, bearing: 0, duration: 700 })],
          ['reset', 'Reset view', reset],
        ].map(([key, label, act], i) => (
          <button
            key={key}
            type="button"
            aria-label={label}
            aria-pressed={key === 'orbit' || key === 'pan' ? tool === key : undefined}
            onClick={() => {
              if (key === 'orbit' || key === 'pan') setTool(key)
              act?.()
            }}
            className={`flex h-target w-target items-center justify-center ${i < 3 ? 'border-r-hair border-line-strong' : ''} ${tool === key ? 'text-teal' : 'text-muted hover:text-fg'}`}
          >
            <Svg name={key} />
          </button>
        ))}
      </div>

      <section
        aria-label={change ? 'Earlier and later survey' : 'Before and after'}
        className="floating absolute bottom-10 left-1/2 z-10 w-[min(560px,calc(100%-32px))] -translate-x-1/2 px-4 pb-2.5 pt-1.5"
      >
        <div className="flex items-center gap-3.5">
          <span className="whitespace-nowrap font-mono text-[11px] tracking-[0.1em] text-muted">{change ? years[0] : 'RAW'}</span>
          <input
            type="range"
            min={0}
            max={100}
            value={split}
            onChange={(e) => setSplit(Number(e.target.value))}
            aria-label="Split position"
          />
          <span className="whitespace-nowrap font-mono text-[11px] tracking-[0.1em] text-teal">{change ? years[1] : 'DETECTED'}</span>
        </div>
        <div className="-mt-1 text-center font-mono text-[11px] text-muted">
          Drag to compare ·{' '}
          {pc
            ? `${Math.abs(pc.header.center[1]).toFixed(4)}°${pc.header.center[1] >= 0 ? 'N' : 'S'} ${Math.abs(pc.header.center[0]).toFixed(4)}°${pc.header.center[0] >= 0 ? 'E' : 'W'}`
            : ''}
        </div>
      </section>
      {epochs}
    </>
  )
}

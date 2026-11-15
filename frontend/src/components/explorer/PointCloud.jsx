import { useEffect, useMemo, useRef, useState } from 'react'
import { COORDINATE_SYSTEM } from '@deck.gl/core'
import { PointCloudLayer } from '@deck.gl/layers'
import { MapboxOverlay } from '@deck.gl/mapbox'
import { SkyscanService } from '@/services'
import { getErrorMessage } from '@/utils'
import { CLASS_COLORS, colors, decodePointCloud, HEIGHT_RAMP, positions } from '@/utils/pointcloud'

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

/** deck.gl PointCloudLayer drawn over the Mapbox map through MapboxOverlay. */
export function PointCloudOverlay({ map, pc, colorBy }) {
  const overlay = useRef(null)
  const pos = useMemo(() => (pc ? positions(pc) : null), [pc])
  const col = useMemo(() => (pc ? colors(pc, colorBy) : null), [pc, colorBy])

  useEffect(() => {
    // Overlaid (deck's own canvas, camera-synced) rather than interleaved:
    // buildings are hidden in this view, and interleaving did not attach
    // its custom layer reliably with Mapbox GL v3.
    overlay.current = new MapboxOverlay({ interleaved: false, layers: [] })
    map.addControl(overlay.current)
    return () => {
      if (map.getStyle()) map.removeControl(overlay.current)
      overlay.current = null
    }
  }, [map])

  useEffect(() => {
    if (!overlay.current) return
    const layers = pc
      ? [
          new PointCloudLayer({
            id: 'skyscan-points',
            data: {
              length: pc.header.count,
              attributes: {
                getPosition: { value: pos, size: 3 },
                getColor: { value: col, size: 3, normalized: true },
              },
            },
            coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
            coordinateOrigin: [pc.header.center[0], pc.header.center[1], 0],
            pointSize: 1.6,
            sizeUnits: 'pixels',
            updateTriggers: { getColor: colorBy },
          }),
        ]
      : []
    overlay.current.setProps({ layers })
  }, [pc, pos, col, colorBy])
  return null
}

function swatch(rgb) {
  return `rgb(${rgb.map(Math.round).join(',')})`
}

/** Legend for the current colouring; only classes present in the cloud are listed. */
export function PointCloudLegend({ pc, colorBy }) {
  if (!pc) return null
  if (colorBy === 'height') {
    return (
      <div>
        <div
          className="h-2 w-full rounded-sm"
          style={{
            background: `linear-gradient(to right, ${HEIGHT_RAMP.map(([h, c]) => `${swatch(c)} ${(h / 150) * 100}%`).join(',')})`,
          }}
        />
        <div className="num mt-1 flex justify-between text-[10px] text-muted">
          <span>0 m</span>
          <span>30</span>
          <span>80</span>
          <span>150+ m</span>
        </div>
      </div>
    )
  }
  if (colorBy === 'intensity') {
    return (
      <div>
        <div className="h-2 w-full rounded-sm" style={{ background: 'linear-gradient(to right, rgb(40,40,40), rgb(254,254,254))' }} />
        <div className="mt-1 flex justify-between text-[10px] text-muted">
          <span>Low return</span>
          <span>High return</span>
        </div>
      </div>
    )
  }
  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-1">
      {pc.header.classes.map((c) => {
        const k = CLASS_COLORS[c]
        return (
          <li key={c} className="flex items-center gap-1.5 text-[11px] text-fg">
            <span className="h-2 w-2 rounded-sm" style={{ background: swatch(k?.color || [91, 104, 128]) }} />
            {k?.label || `Class ${c}`}
          </li>
        )
      })}
    </ul>
  )
}

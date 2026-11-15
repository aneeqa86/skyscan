/**
 * Map overlays from the Explorer design: location chip, zoom buttons, scale +
 * live coordinates, legend, and the building popup anchored to its footprint.
 */
import { useEffect, useState } from 'react'
import { KeyValues, Svg } from '@/components/ui/kit'
import { cn, formatNumber } from '@/utils'
import { centroid } from '@/utils/geo'
import { CHANGE_TYPES } from './changeTypes'
import { HEIGHT_STEPS } from './layers'

export function MapChip({ children, tone = 'teal', pulse = false }) {
  return (
    <div className="floating flex h-9 items-center gap-2.5 px-3 font-mono text-xs text-fg">
      <span className={cn('h-1.5 w-1.5 rounded-full', tone === 'orange' ? 'bg-orange' : 'bg-teal', pulse && 'animate-skeleton')} />
      {children}
    </div>
  )
}

export function ZoomControls({ map }) {
  return (
    <div className="floating flex flex-col overflow-hidden">
      <button type="button" aria-label="Zoom in" className="flex h-target w-target items-center justify-center border-b-hair border-line-strong text-fg hover:text-teal" onClick={() => map?.zoomIn()}>
        <Svg name="plus" />
      </button>
      <button type="button" aria-label="Zoom out" className="flex h-target w-target items-center justify-center text-fg hover:text-teal" onClick={() => map?.zoomOut()}>
        <Svg name="minus" />
      </button>
    </div>
  )
}

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1000000]

/** Scale bar + live cursor coordinates (EPSG:4326). */
export function CoordScale({ map }) {
  const [cursor, setCursor] = useState(null)
  const [scale, setScale] = useState({ px: 64, label: '' })
  useEffect(() => {
    if (!map) return undefined
    const update = () => {
      const lat = map.getCenter().lat
      const mPerPx = (40075016.686 * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom())
      const target = mPerPx * 72
      const nice = NICE.reduce((best, v) => (v <= target ? v : best), NICE[0])
      setScale({ px: Math.round(nice / mPerPx), label: nice >= 1000 ? `${nice / 1000} km` : `${nice} m` })
    }
    const move = (e) => setCursor(e.lngLat)
    update()
    map.on('move', update)
    map.on('mousemove', move)
    return () => {
      map.off('move', update)
      map.off('mousemove', move)
    }
  }, [map])
  const c = cursor || map?.getCenter()
  return (
    <div className="floating flex flex-wrap items-center gap-4 px-3 py-2 font-mono text-xs text-muted">
      <span className="flex items-center gap-2">
        <span className="block h-1.5 border-stroke border-t-0 border-muted" style={{ width: scale.px }} />
        {scale.label}
      </span>
      {c && (
        <span className="text-fg">
          {Math.abs(c.lat).toFixed(5)}°{c.lat >= 0 ? 'N' : 'S'}  {Math.abs(c.lng).toFixed(5)}°{c.lng >= 0 ? 'E' : 'W'}
        </span>
      )}
      <span>EPSG:4326</span>
    </div>
  )
}

function Sw({ style }) {
  return <span className="h-2.5 w-2.5 shrink-0" style={style} aria-hidden="true" />
}

/** Legend for the current mode and view. */
export function Legend({ mode, view, showReference }) {
  if (mode === 'change') {
    return (
      <div className="floating flex flex-col gap-1.5 px-3 py-2.5 text-xs text-muted">
        {CHANGE_TYPES.map((t) => (
          <span key={t.key} className="flex items-center gap-2">
            <Sw style={{ border: `.75px solid ${t.color}`, background: `${t.color}4D` }} />
            <span aria-hidden="true" style={{ color: t.color }}>{t.icon}</span>
            {t.label}
          </span>
        ))}
        <span className="flex items-center gap-2">
          <Sw style={{ border: '.75px solid #5E6E87', background: '#1C2940' }} />
          Unchanged building
        </span>
      </div>
    )
  }
  if (view === '3d') {
    return (
      <div className="floating flex flex-col gap-1.5 px-3 py-2.5 text-xs text-muted">
        <span className="label-mono">Height</span>
        <div className="flex h-2.5 w-40">
          {HEIGHT_STEPS.map(([, c]) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
        <div className="flex justify-between font-mono text-[11px]">
          <span>0 m</span>
          <span>18</span>
          <span>36+ m</span>
        </div>
      </div>
    )
  }
  return (
    <div className="floating flex flex-col gap-1.5 px-3 py-2.5 text-xs text-muted">
      <span className="flex items-center gap-2">
        <Sw style={{ border: '.75px solid #00C9A7', background: 'rgba(0,201,167,.3)' }} />
        Detected building
      </span>
      <span className="flex items-center gap-2">
        <Sw style={{ border: '.75px solid #FF6B35', background: 'rgba(255,107,53,.3)' }} />
        Selected
      </span>
      <span className="flex items-center gap-2">
        <span className="h-0 w-2.5 border-t border-dashed border-teal" aria-hidden="true" />
        Area of interest
      </span>
      {showReference && (
        <span className="flex items-center gap-2">
          <span className="h-0 w-2.5 border-t border-dashed border-orange-light" aria-hidden="true" />
          Reference, not matched
        </span>
      )}
    </div>
  )
}

export function buildingCode(id, prefix = 'BLD') {
  return `${prefix}-${String(id).padStart(6, '0')}`
}

/**
 * Building popup (252px) anchored beside the selected footprint, following
 * the map as it moves. feature: GeoJSON feature of the selected building.
 */
export function BuildingPopup({ map, feature, onClose, onZoom }) {
  const [pos, setPos] = useState(null)
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!map || !feature) return undefined
    const [lon, lat] = centroid(feature.geometry)
    const place = () => {
      const p = map.project([lon, lat])
      setPos({ x: p.x, y: p.y })
    }
    place()
    map.on('move', place)
    return () => map.off('move', place)
  }, [map, feature])
  useEffect(() => setCopied(false), [feature])
  if (!feature || !pos) return null
  const p = feature.properties
  const canvas = map.getCanvas().getBoundingClientRect()
  const width = 252
  const left = pos.x + 28 + width > canvas.width ? pos.x - 28 - width : pos.x + 28
  const top = Math.min(Math.max(pos.y - 130, 64), canvas.height - 300)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ type: 'Feature', geometry: feature.geometry, properties: p }))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }
  return (
    <>
      <div
        className="pointer-events-none absolute z-10 border-t-hair border-orange"
        style={{ left: left > pos.x ? pos.x : pos.x - 28, top: pos.y, width: 28 }}
        aria-hidden="true"
      />
      <section aria-label="Building details" className="floating absolute z-20 p-3.5" style={{ left, top, width }}>
        <header className="mb-2.5 flex items-center justify-between">
          <div>
            <div className="dt-mono tracking-[0.14em]">BUILDING</div>
            <div className="mt-0.5 font-mono text-sm text-fg">{buildingCode(p.id)}</div>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-2.5 -mt-2.5 flex h-target w-target items-center justify-center rounded-control text-muted hover:text-fg">
            <Svg name="close" />
          </button>
        </header>
        <div className="flex items-baseline gap-1.5 border-b-hair border-line pb-2.5">
          <span className="font-mono text-[34px] leading-none text-orange">{formatNumber(p.height_m, 1)}</span>
          <span className="font-mono text-[13px] text-muted">m height</span>
        </div>
        <KeyValues
          className="my-3"
          items={[
            ['Footprint', `${formatNumber(p.area_m2)} m²`],
            ['Max height', `${formatNumber(p.max_height_m, 1)} m`],
            ['Floors', `~${p.est_floors}`],
            ['LiDAR points', formatNumber(p.point_count)],
          ]}
        />
        <div className="flex gap-1.5">
          <button type="button" className="btn-secondary h-target flex-1 px-2 text-[13px]" onClick={onZoom}>
            Zoom to
          </button>
          <button type="button" className="btn-secondary h-target flex-1 px-2 text-[13px]" onClick={copy}>
            {copied ? 'Copied' : 'Copy GeoJSON'}
          </button>
        </div>
      </section>
    </>
  )
}

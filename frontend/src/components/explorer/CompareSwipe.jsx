import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import { MAP_STYLE } from './MapView'

/**
 * Swipe comparison: a second map, synced to the main one and clipped to the
 * right of a divider. The main map shows the earlier survey, this one the later.
 */
export default function CompareSwipe({ mainMap, leftLabel, rightLabel, children }) {
  const container = useRef(null)
  const [map, setMap] = useState(null)
  const [pos, setPos] = useState(50)
  const dragging = useRef(false)

  useEffect(() => {
    if (!container.current) return undefined
    const m = new mapboxgl.Map({
      container: container.current,
      style: MAP_STYLE,
      center: mainMap.getCenter(),
      zoom: mainMap.getZoom(),
      pitch: mainMap.getPitch(),
      bearing: mainMap.getBearing(),
      interactive: false,
      attributionControl: false,
      antialias: true,
    })
    if (import.meta.env.DEV) window.__skyscanCompareMap = m // debugging aid in development only
    const sync = () =>
      m.jumpTo({ center: mainMap.getCenter(), zoom: mainMap.getZoom(), pitch: mainMap.getPitch(), bearing: mainMap.getBearing() })
    mainMap.on('move', sync)
    // The map can measure its container before the clipped wrapper has its
    // final size and then never paints a first frame (so 'load' never fires).
    // Resize on the next frame, and accept the first idle with a loaded style.
    let ready = false
    const onReady = () => {
      if (ready || !m.isStyleLoaded()) return
      ready = true
      sync()
      setMap(m)
    }
    m.on('load', onReady)
    m.on('idle', onReady)
    const raf = requestAnimationFrame(() => {
      m.resize()
      m.triggerRepaint()
    })
    return () => {
      cancelAnimationFrame(raf)
      mainMap.off('move', sync)
      setMap(null)
      m.remove()
    }
  }, [mainMap])

  useEffect(() => {
    const move = (e) => {
      if (!dragging.current || !container.current) return
      const r = container.current.getBoundingClientRect()
      setPos(Math.min(98, Math.max(2, ((e.clientX - r.left) / r.width) * 100)))
    }
    const up = () => (dragging.current = false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  return (
    <>
      <div
        className="pointer-events-none absolute inset-0 z-[5]"
        style={{ clipPath: `inset(0 0 0 ${pos}%)` }}
        aria-hidden="true"
      >
        <div ref={container} className="h-full w-full" />
      </div>
      {map && children?.(map)}
      <div className="pointer-events-none absolute inset-y-0 z-[6]" style={{ left: `${pos}%` }}>
        <div className="absolute inset-y-0 -ml-px w-px bg-fg/70" />
        <button
          type="button"
          onPointerDown={(e) => {
            dragging.current = true
            e.preventDefault()
          }}
          className="pointer-events-auto absolute top-1/2 -ml-4 flex h-8 w-8 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-fg/70 bg-ink-800 text-xs text-fg"
          aria-label="Drag to compare surveys"
          tabIndex={-1}
        >
          ⇆
        </button>
        <span className="chip absolute top-16 -translate-x-[calc(100%+8px)] whitespace-nowrap border-line bg-ink-800 text-fg">{leftLabel}</span>
        <span className="chip absolute top-16 translate-x-2 whitespace-nowrap border-line bg-ink-800 text-fg">{rightLabel}</span>
      </div>
      <label className="sr-only" htmlFor="compare-pos">
        Compare position
      </label>
      <input
        id="compare-pos"
        type="range"
        min={2}
        max={98}
        value={Math.round(pos)}
        onChange={(e) => setPos(Number(e.target.value))}
        className="sr-only focus:not-sr-only focus:absolute focus:bottom-14 focus:left-1/2 focus:z-30 focus:w-64 focus:-translate-x-1/2"
      />
    </>
  )
}

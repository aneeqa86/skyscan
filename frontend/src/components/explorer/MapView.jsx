import { useEffect, useRef, useState } from 'react'
import mapboxgl from 'mapbox-gl'
import MapboxDraw from '@mapbox/mapbox-gl-draw'
import 'mapbox-gl/dist/mapbox-gl.css'
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css'
import DrawRectangle from './drawRectangle'

export const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN
export const MAP_STYLE = 'mapbox://styles/mapbox/dark-v11'

const DRAW_STYLES = [
  {
    id: 'skyscan-draw-fill',
    type: 'fill',
    filter: ['all', ['==', '$type', 'Polygon']],
    paint: { 'fill-color': '#FF6B35', 'fill-opacity': 0.06 },
  },
  {
    id: 'skyscan-draw-line',
    type: 'line',
    filter: ['all', ['==', '$type', 'Polygon']],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': '#FF6B35', 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
  },
  {
    id: 'skyscan-draw-line-active',
    type: 'line',
    filter: ['all', ['==', '$type', 'LineString']],
    paint: { 'line-color': '#FF6B35', 'line-width': 1.5, 'line-dasharray': [2, 1.5] },
  },
  {
    id: 'skyscan-draw-vertex',
    type: 'circle',
    filter: ['all', ['==', 'meta', 'vertex'], ['==', '$type', 'Point']],
    paint: { 'circle-radius': 4, 'circle-color': '#070B14', 'circle-stroke-color': '#FF6B35', 'circle-stroke-width': 1.5 },
  },
]

/**
 * MapView owns the Mapbox map and the draw control. Data layers are children
 * that receive the map through a render prop: {(map) => <Layer map={map} />}.
 */
export default function MapView({ initialView, drawMode, onAoiDrawn, onDrawCleared, onReady, children, className }) {
  const container = useRef(null)
  const drawRef = useRef(null)
  const [map, setMap] = useState(null)
  const [failure, setFailure] = useState(MAPBOX_TOKEN ? null : 'missing-token')
  const callbacks = useRef({})
  callbacks.current = { onAoiDrawn, onDrawCleared, onReady }

  useEffect(() => {
    if (!MAPBOX_TOKEN || !container.current) return undefined
    mapboxgl.accessToken = MAPBOX_TOKEN
    let m
    try {
      m = new mapboxgl.Map({
        container: container.current,
        style: MAP_STYLE,
        center: initialView?.center ?? [-98.5, 39.5],
        zoom: initialView?.zoom ?? 3.6,
        pitch: initialView?.pitch ?? 0,
        antialias: true,
        preserveDrawingBuffer: true, // screenshot export
        attributionControl: false,
      })
    } catch (err) {
      setFailure(err?.message || 'webgl')
      return undefined
    }
    m.addControl(new mapboxgl.NavigationControl({ visualizePitch: true }), 'bottom-right')
    m.addControl(new mapboxgl.ScaleControl({ unit: 'metric' }), 'bottom-left')
    m.addControl(
      new mapboxgl.AttributionControl({
        compact: true,
        customAttribution: 'LiDAR: USGS 3DEP · Footprints: Overture Maps, © OpenStreetMap contributors',
      })
    )
    const draw = new MapboxDraw({
      displayControlsDefault: false,
      modes: { ...MapboxDraw.modes, draw_rectangle: DrawRectangle },
      styles: DRAW_STYLES,
    })
    m.addControl(draw)
    drawRef.current = draw

    const emit = () => {
      const fc = draw.getAll()
      const poly = fc.features.find((f) => f.geometry?.type === 'Polygon' && f.geometry.coordinates[0]?.length >= 4)
      if (poly) callbacks.current.onAoiDrawn?.(poly.geometry)
    }
    m.on('draw.create', (e) => {
      // Keep one area at a time.
      const keep = e.features[0]?.id
      draw.getAll().features.forEach((f) => f.id !== keep && draw.delete(f.id))
      emit()
    })
    m.on('draw.update', emit)
    m.on('draw.delete', () => callbacks.current.onDrawCleared?.())
    m.on('error', (e) => {
      if (e?.error?.status === 401) setFailure('bad-token')
    })
    if (import.meta.env.DEV) window.__skyscanMap = m // debugging aid in development only
    m.on('load', () => {
      setMap(m)
      callbacks.current.onReady?.(m, draw)
    })
    return () => {
      setMap(null)
      m.remove()
    }
    // The map is created once; view changes go through the map API.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Switch draw mode on request.
  useEffect(() => {
    const draw = drawRef.current
    if (!map || !draw) return
    if (drawMode === 'rectangle') {
      draw.deleteAll()
      draw.changeMode('draw_rectangle')
    } else if (drawMode === 'polygon') {
      draw.deleteAll()
      draw.changeMode('draw_polygon')
    } else if (drawMode === 'clear') {
      draw.deleteAll()
      draw.changeMode('simple_select')
    }
  }, [drawMode, map])

  return (
    <div className={className}>
      {/* Mapbox sets position: relative on its container, so position a wrapper instead. */}
      <div className="absolute inset-0">
        <div ref={container} className="h-full w-full" data-testid="map" />
      </div>
      {failure && <MapFailure kind={failure} />}
      {map && children?.(map, drawRef.current)}
    </div>
  )
}

function MapFailure({ kind }) {
  const text =
    kind === 'missing-token'
      ? 'Add a Mapbox public token as VITE_MAPBOX_TOKEN in frontend/.env.local and restart the dev server.'
      : kind === 'bad-token'
        ? 'Mapbox rejected the token in VITE_MAPBOX_TOKEN. Check it on account.mapbox.com.'
        : 'The map could not start. Your browser may not support WebGL.'
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center bg-ink-900/90 p-6">
      <div className="max-w-md rounded-lg border bg-ink-800 p-5 text-sm">
        <p className="label text-orange">Map unavailable</p>
        <p className="mt-2 text-fg">{text}</p>
      </div>
    </div>
  )
}

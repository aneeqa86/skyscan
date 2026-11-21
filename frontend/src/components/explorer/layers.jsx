/**
 * Mapbox layers for the explorer, styled to the design: teal footprints with
 * the selected building in orange (2D), a stepped height ramp (3D), dashed
 * teal area of interest, and an orange scan line while a job runs.
 */
import { useEffect, useRef } from 'react'
import { SkyscanService } from '@/services'
import { changeColorExpr } from './changeTypes'

const EMPTY = { type: 'FeatureCollection', features: [] }

/** Stepped height ramp, 0 to 45 m (design tokens h0..h4). Shared with legends. */
export const HEIGHT_STEPS = [
  [0, '#2B4C7E'],
  [9, '#2A8FA8'],
  [18, '#00C9A7'],
  [27, '#E8B45C'],
  [36, '#FF6B35'],
]
const heightColor = ['step', ['coalesce', ['get', 'height_m'], 0], HEIGHT_STEPS[0][1], ...HEIGHT_STEPS.slice(1).flat()]

const OURS = /^(coverage|aoi|scan|reference|changes|labels|bld|buildings|imagery)/

function ensureSource(map, id, spec) {
  if (!map.getSource(id)) map.addSource(id, spec)
  return map.getSource(id)
}

function removeLayers(map, ids) {
  ids.forEach((id) => map.getLayer(id) && map.removeLayer(id))
}

function setVisible(map, ids, visible) {
  ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none'))
}

function firstSymbol(map) {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id
}

/** Show or hide every basemap layer (everything that is not ours). */
export function setBasemapVisible(map, visible) {
  for (const l of map.getStyle().layers) {
    if (l.type === 'background' || OURS.test(l.id) || l.id.startsWith('gl-draw')) continue
    map.setLayoutProperty(l.id, 'visibility', visible ? 'visible' : 'none')
  }
}

/**
 * Aerial image for one year, pinned to the job area by its four corners.
 * Sits above the basemap and below every SKYSCAN layer.
 */
export function ImageryLayer({ map, url, corners, visible = true, opacity = 0.9 }) {
  useEffect(() => {
    if (!url || !corners) return undefined
    const src = map.getSource('imagery')
    if (src) src.updateImage({ url, coordinates: corners })
    else map.addSource('imagery', { type: 'image', url, coordinates: corners })
    if (!map.getLayer('imagery-raster')) {
      const ours = map.getStyle().layers.find((l) => l.id !== 'imagery-raster' && (OURS.test(l.id) || l.id.startsWith('gl-draw')))
      map.addLayer(
        { id: 'imagery-raster', type: 'raster', source: 'imagery', paint: { 'raster-fade-duration': 150 } },
        ours?.id ?? firstSymbol(map)
      )
    }
    return undefined
  }, [map, url, corners])
  useEffect(() => {
    if (map.getLayer('imagery-raster')) {
      map.setLayoutProperty('imagery-raster', 'visibility', visible && url ? 'visible' : 'none')
      map.setPaintProperty('imagery-raster', 'raster-opacity', opacity)
    }
  }, [map, url, visible, opacity])
  useEffect(
    () => () => {
      if (!map.getStyle()) return
      removeLayers(map, ['imagery-raster'])
      if (map.getSource('imagery')) map.removeSource('imagery')
    },
    [map]
  )
  return null
}

export function CoverageLayer({ map, visible = true }) {
  useEffect(() => {
    ensureSource(map, 'coverage', { type: 'vector', tiles: [SkyscanService.coverageTiles()], maxzoom: 12 })
    const before = firstSymbol(map)
    if (!map.getLayer('coverage-fill'))
      map.addLayer(
        {
          id: 'coverage-fill',
          type: 'fill',
          source: 'coverage',
          'source-layer': 'coverage',
          paint: { 'fill-color': '#00C9A7', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.07, 14, 0.02] },
        },
        before
      )
    if (!map.getLayer('coverage-line'))
      map.addLayer(
        {
          id: 'coverage-line',
          type: 'line',
          source: 'coverage',
          'source-layer': 'coverage',
          paint: { 'line-color': '#00C9A7', 'line-opacity': 0.35, 'line-width': 0.5 },
        },
        before
      )
    return () => {
      if (map.getStyle()) removeLayers(map, ['coverage-fill', 'coverage-line'])
    }
  }, [map])
  useEffect(() => {
    setVisible(map, ['coverage-fill', 'coverage-line'], visible)
  }, [map, visible])
  return null
}

/** Area of interest of a loaded job: dashed teal outline. */
export function AoiLayer({ map, aoi }) {
  useEffect(() => {
    const src = ensureSource(map, 'aoi', { type: 'geojson', data: EMPTY })
    if (!map.getLayer('aoi-line'))
      map.addLayer({
        id: 'aoi-line',
        type: 'line',
        source: 'aoi',
        paint: { 'line-color': '#00C9A7', 'line-width': 1.2, 'line-dasharray': [3.5, 2.5] },
      })
    src.setData(aoi ? { type: 'Feature', geometry: aoi, properties: {} } : EMPTY)
  }, [map, aoi])
  useEffect(() => () => map.getStyle() && removeLayers(map, ['aoi-line']), [map])
  return null
}

/**
 * Orange scan line sweeping the area west to east with the job's progress
 * (Explorer-Processing design). progress: 0..100.
 */
export function ScanLineLayer({ map, aoi, progress }) {
  useEffect(() => {
    ensureSource(map, 'scan', { type: 'geojson', data: EMPTY })
    ensureSource(map, 'scan-done', { type: 'geojson', data: EMPTY })
    if (!map.getLayer('scan-done-fill'))
      map.addLayer({ id: 'scan-done-fill', type: 'fill', source: 'scan-done', paint: { 'fill-color': '#00C9A7', 'fill-opacity': 0.06 } })
    if (!map.getLayer('scan-line'))
      map.addLayer({ id: 'scan-line', type: 'line', source: 'scan', paint: { 'line-color': '#FF6B35', 'line-width': 1.5 } })
    return () => {
      if (map.getStyle()) removeLayers(map, ['scan-line', 'scan-done-fill'])
    }
  }, [map])
  useEffect(() => {
    if (!aoi) {
      map.getSource('scan')?.setData(EMPTY)
      map.getSource('scan-done')?.setData(EMPTY)
      return
    }
    const ring = aoi.coordinates[0]
    const xs = ring.map((c) => c[0])
    const ys = ring.map((c) => c[1])
    const [w, e, s, n] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const x = w + ((e - w) * Math.min(Math.max(progress, 0), 100)) / 100
    map.getSource('scan')?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: [
          [x, s],
          [x, n],
        ],
      },
    })
    map.getSource('scan-done')?.setData({
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [w, s],
            [x, s],
            [x, n],
            [w, n],
            [w, s],
          ],
        ],
      },
    })
  }, [map, aoi, progress])
  return null
}

/**
 * Buildings: flat teal footprints (2D) or extruded by height on the stepped
 * ramp (3D). Selected in orange. neutral: grey context buildings (Change).
 * labels: show the height at each footprint.
 */
export function BuildingsLayer({
  map,
  id = 'buildings',
  data,
  view,
  filter,
  selectedId,
  onSelect,
  visible = true,
  opacity = 0.92,
  neutral = false,
  labels = false,
}) {
  const ids = [`${id}-fill`, `${id}-extrusion`, `${id}-outline`, `${id}-selected-fill`, `${id}-selected`, `${id}-labels`]
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    ensureSource(map, id, { type: 'geojson', data: EMPTY, promoteId: 'id' })
    const before = firstSymbol(map)
    const fill = neutral ? '#1C2940' : 'rgba(0, 201, 167, 0.16)'
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': fill } }, before)
    map.addLayer({
      id: `${id}-extrusion`,
      type: 'fill-extrusion',
      source: id,
      paint: {
        'fill-extrusion-color': neutral ? '#2A3550' : heightColor,
        'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 0],
        'fill-extrusion-opacity': opacity,
        'fill-extrusion-vertical-gradient': true,
      },
    })
    map.addLayer({
      id: `${id}-outline`,
      type: 'line',
      source: id,
      paint: { 'line-color': neutral ? '#5E6E87' : '#00C9A7', 'line-width': 0.8, 'line-opacity': neutral ? 0.6 : 0.9 },
    })
    map.addLayer({
      id: `${id}-selected-fill`,
      type: 'fill',
      source: id,
      filter: ['==', ['id'], -1],
      paint: { 'fill-color': 'rgba(255, 107, 53, 0.28)' },
    })
    map.addLayer({
      id: `${id}-selected`,
      type: 'line',
      source: id,
      filter: ['==', ['id'], -1],
      paint: { 'line-color': '#FF6B35', 'line-width': 1.5 },
    })
    map.addLayer({
      id: `${id}-labels`,
      type: 'symbol',
      source: id,
      minzoom: 15,
      layout: {
        'text-field': ['concat', ['to-string', ['round', ['get', 'height_m']]], ' m'],
        'text-size': 10,
        'text-font': ['DIN Pro Medium', 'Arial Unicode MS Regular'],
        'text-allow-overlap': false,
        visibility: 'none',
      },
      paint: { 'text-color': '#E8EEF6', 'text-halo-color': '#070B14', 'text-halo-width': 1 },
    })
    const click = (e) => {
      const f = e.features?.[0]
      if (f) select.current?.(f.properties, f)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    for (const layer of [`${id}-fill`, `${id}-extrusion`]) {
      map.on('click', layer, click)
      map.on('mouseenter', layer, enter)
      map.on('mouseleave', layer, leave)
    }
    return () => {
      for (const layer of [`${id}-fill`, `${id}-extrusion`]) {
        map.off('click', layer, click)
        map.off('mouseenter', layer, enter)
        map.off('mouseleave', layer, leave)
      }
      if (map.getStyle()) {
        removeLayers(map, ids)
        if (map.getSource(id)) map.removeSource(id)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, id, neutral])

  useEffect(() => {
    map.getSource(id)?.setData(data || EMPTY)
  }, [map, id, data])

  useEffect(() => {
    const three = view === '3d'
    setVisible(map, [`${id}-fill`], visible && !three)
    setVisible(map, [`${id}-extrusion`], visible && three)
    setVisible(map, [`${id}-outline`, `${id}-selected`], visible)
    setVisible(map, [`${id}-selected-fill`], visible && !three)
    setVisible(map, [`${id}-labels`], visible && labels)
  }, [map, id, view, visible, labels])

  useEffect(() => {
    const f = filter || true
    for (const layer of [`${id}-fill`, `${id}-extrusion`, `${id}-outline`, `${id}-labels`]) map.getLayer(layer) && map.setFilter(layer, f)
  }, [map, id, filter])

  useEffect(() => {
    for (const l of [`${id}-selected`, `${id}-selected-fill`]) map.getLayer(l) && map.setFilter(l, ['==', ['id'], selectedId ?? -1])
  }, [map, id, selectedId])

  return null
}

/** Reference footprints used for validation: matched faint, missed orange-light. */
export function ReferenceLayer({ map, data, visible }) {
  useEffect(() => {
    ensureSource(map, 'reference', { type: 'geojson', data: EMPTY })
    map.addLayer({
      id: 'reference-line',
      type: 'line',
      source: 'reference',
      paint: {
        'line-color': ['case', ['get', 'matched'], '#E8EEF6', '#FFB08C'],
        'line-width': 0.9,
        'line-dasharray': [2, 1.5],
      },
    })
    return () => {
      if (map.getStyle()) {
        removeLayers(map, ['reference-line'])
        map.getSource('reference') && map.removeSource('reference')
      }
    }
  }, [map])
  useEffect(() => {
    map.getSource('reference')?.setData(data || EMPTY)
  }, [map, data])
  useEffect(() => {
    setVisible(map, ['reference-line'], visible)
  }, [map, visible])
  return null
}

/** Change polygons coloured by type; extruded to the taller survey's height in 3D. */
export function ChangesLayer({ map, data, view, filter, selectedId, onSelect, visible = true }) {
  const ids = ['changes-fill', 'changes-extrusion', 'changes-line', 'changes-selected']
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    ensureSource(map, 'changes', { type: 'geojson', data: EMPTY, promoteId: 'id' })
    const before = firstSymbol(map)
    map.addLayer(
      { id: 'changes-fill', type: 'fill', source: 'changes', paint: { 'fill-color': changeColorExpr, 'fill-opacity': 0.5 } },
      before
    )
    map.addLayer({
      id: 'changes-extrusion',
      type: 'fill-extrusion',
      source: 'changes',
      paint: {
        'fill-extrusion-color': changeColorExpr,
        'fill-extrusion-height': ['max', ['coalesce', ['get', 'height_after_m'], 0], ['coalesce', ['get', 'height_before_m'], 0]],
        'fill-extrusion-opacity': 0.8,
      },
    })
    map.addLayer({ id: 'changes-line', type: 'line', source: 'changes', paint: { 'line-color': changeColorExpr, 'line-width': 1 } })
    map.addLayer({
      id: 'changes-selected',
      type: 'line',
      source: 'changes',
      filter: ['==', ['id'], -1],
      paint: { 'line-color': '#E8EEF6', 'line-width': 2 },
    })
    const click = (e) => {
      const f = e.features?.[0]
      if (f) select.current?.(f.properties, f)
    }
    const enter = () => (map.getCanvas().style.cursor = 'pointer')
    const leave = () => (map.getCanvas().style.cursor = '')
    for (const l of ['changes-fill', 'changes-extrusion']) {
      map.on('click', l, click)
      map.on('mouseenter', l, enter)
      map.on('mouseleave', l, leave)
    }
    return () => {
      for (const l of ['changes-fill', 'changes-extrusion']) {
        map.off('click', l, click)
        map.off('mouseenter', l, enter)
        map.off('mouseleave', l, leave)
      }
      if (map.getStyle()) {
        removeLayers(map, ids)
        map.getSource('changes') && map.removeSource('changes')
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map])

  useEffect(() => {
    map.getSource('changes')?.setData(data || EMPTY)
  }, [map, data])
  useEffect(() => {
    const three = view === '3d'
    setVisible(map, ['changes-fill'], visible && !three)
    setVisible(map, ['changes-extrusion'], visible && three)
    setVisible(map, ['changes-line', 'changes-selected'], visible)
  }, [map, view, visible])
  useEffect(() => {
    for (const l of ['changes-fill', 'changes-extrusion', 'changes-line']) map.getLayer(l) && map.setFilter(l, filter || true)
  }, [map, filter])
  useEffect(() => {
    map.getLayer('changes-selected') && map.setFilter('changes-selected', ['==', ['id'], selectedId ?? -1])
  }, [map, selectedId])
  return null
}

import { useEffect, useRef } from 'react'
import { SkyscanService } from '@/services'
import { changeColorExpr } from './changeTypes'

const EMPTY = { type: 'FeatureCollection', features: [] }

/** Height ramp shared by the map and the legend (metres -> colour). */
export const HEIGHT_STOPS = [
  [0, '#0B3D3A'],
  [5, '#00715E'],
  [12, '#00A88C'],
  [25, '#00C9A7'],
  [60, '#7FE3D2'],
  [150, '#E6FBF7'],
]
const heightColor = ['interpolate', ['linear'], ['coalesce', ['get', 'height_m'], 0], ...HEIGHT_STOPS.flat()]

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

/** First symbol layer of the basemap: data goes below labels. */
function beforeLabels(map) {
  return map.getStyle().layers.find((l) => l.type === 'symbol')?.id
}

export function CoverageLayer({ map, visible = true }) {
  useEffect(() => {
    ensureSource(map, 'coverage', { type: 'vector', tiles: [SkyscanService.coverageTiles()], maxzoom: 12 })
    const before = beforeLabels(map)
    if (!map.getLayer('coverage-fill'))
      map.addLayer(
        {
          id: 'coverage-fill',
          type: 'fill',
          source: 'coverage',
          'source-layer': 'coverage',
          paint: { 'fill-color': '#00C9A7', 'fill-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.08, 14, 0.02] },
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
          paint: { 'line-color': '#00C9A7', 'line-opacity': 0.35, 'line-width': 0.6 },
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

export function AoiLayer({ map, aoi }) {
  useEffect(() => {
    const src = ensureSource(map, 'aoi', { type: 'geojson', data: EMPTY })
    if (!map.getLayer('aoi-line'))
      map.addLayer({
        id: 'aoi-line',
        type: 'line',
        source: 'aoi',
        paint: { 'line-color': '#FF6B35', 'line-width': 1.2, 'line-dasharray': [2, 1.5] },
      })
    src.setData(aoi ? { type: 'Feature', geometry: aoi, properties: {} } : EMPTY)
  }, [map, aoi])
  useEffect(() => () => map.getStyle() && removeLayers(map, ['aoi-line']), [map])
  return null
}

/**
 * Buildings as flat polygons (2D) or extruded by height (3D), coloured by height.
 * id: unique prefix (several epochs can be on the map at once).
 */
/**
 * neutral: draw buildings in grey (context for Change mode, so the change
 * colours carry the meaning instead of competing with the height ramp).
 */
export function BuildingsLayer({ map, id = 'buildings', data, view, filter, selectedId, onSelect, visible = true, opacity = 0.92, neutral = false }) {
  const ids = [`${id}-fill`, `${id}-extrusion`, `${id}-outline`, `${id}-selected`]
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    ensureSource(map, id, { type: 'geojson', data: EMPTY, promoteId: 'id' })
    const before = beforeLabels(map)
    const color = neutral ? '#2A3550' : heightColor
    map.addLayer({ id: `${id}-fill`, type: 'fill', source: id, paint: { 'fill-color': color, 'fill-opacity': 0.85 } }, before)
    map.addLayer({
      id: `${id}-extrusion`,
      type: 'fill-extrusion',
      source: id,
      paint: {
        'fill-extrusion-color': color,
        'fill-extrusion-height': ['coalesce', ['get', 'height_m'], 0],
        'fill-extrusion-opacity': opacity,
        'fill-extrusion-vertical-gradient': true,
      },
    })
    map.addLayer({
      id: `${id}-outline`,
      type: 'line',
      source: id,
      paint: { 'line-color': neutral ? '#5B6880' : '#00C9A7', 'line-width': 0.5, 'line-opacity': 0.6 },
    })
    map.addLayer({
      id: `${id}-selected`,
      type: 'line',
      source: id,
      filter: ['==', ['id'], -1],
      paint: { 'line-color': '#FF6B35', 'line-width': 2 },
    })
    const click = (e) => {
      const f = e.features?.[0]
      if (f) select.current?.(f.properties)
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
  }, [map, id])

  useEffect(() => {
    map.getSource(id)?.setData(data || EMPTY)
  }, [map, id, data])

  useEffect(() => {
    const three = view === '3d'
    setVisible(map, [`${id}-fill`], visible && !three)
    setVisible(map, [`${id}-extrusion`], visible && three)
    setVisible(map, [`${id}-outline`, `${id}-selected`], visible)
  }, [map, id, view, visible])

  useEffect(() => {
    const f = filter || true
    for (const layer of [`${id}-fill`, `${id}-extrusion`, `${id}-outline`]) map.getLayer(layer) && map.setFilter(layer, f)
  }, [map, id, filter])

  useEffect(() => {
    map.getLayer(`${id}-selected`) && map.setFilter(`${id}-selected`, ['==', ['id'], selectedId ?? -1])
  }, [map, id, selectedId])

  return null
}

/** Reference footprints used for validation: matched ones faint, missed ones orange. */
export function ReferenceLayer({ map, data, visible }) {
  useEffect(() => {
    ensureSource(map, 'reference', { type: 'geojson', data: EMPTY })
    map.addLayer({
      id: 'reference-line',
      type: 'line',
      source: 'reference',
      paint: {
        'line-color': ['case', ['get', 'matched'], '#E6EDF7', '#FF6B35'],
        'line-width': 1,
        'line-dasharray': [1.5, 1],
        'line-opacity': 0.9,
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

/** Change polygons coloured by type; extruded to the taller epoch's height in 3D. */
export function ChangesLayer({ map, data, view, filter, selectedId, onSelect, visible = true }) {
  const ids = ['changes-fill', 'changes-extrusion', 'changes-line', 'changes-selected']
  const select = useRef(onSelect)
  select.current = onSelect

  useEffect(() => {
    ensureSource(map, 'changes', { type: 'geojson', data: EMPTY, promoteId: 'id' })
    const before = beforeLabels(map)
    map.addLayer({ id: 'changes-fill', type: 'fill', source: 'changes', paint: { 'fill-color': changeColorExpr, 'fill-opacity': 0.55 } }, before)
    map.addLayer({
      id: 'changes-extrusion',
      type: 'fill-extrusion',
      source: 'changes',
      paint: {
        'fill-extrusion-color': changeColorExpr,
        'fill-extrusion-height': ['max', ['coalesce', ['get', 'height_after_m'], 0], ['coalesce', ['get', 'height_before_m'], 0]],
        'fill-extrusion-opacity': 0.75,
      },
    })
    map.addLayer({ id: 'changes-line', type: 'line', source: 'changes', paint: { 'line-color': changeColorExpr, 'line-width': 1 } })
    map.addLayer({
      id: 'changes-selected',
      type: 'line',
      source: 'changes',
      filter: ['==', ['id'], -1],
      paint: { 'line-color': '#E6EDF7', 'line-width': 2.5 },
    })
    const click = (e) => {
      const f = e.features?.[0]
      if (f) select.current?.(f.properties)
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

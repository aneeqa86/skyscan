/**
 * A rectangle mode for mapbox-gl-draw: press, drag (or click twice), release.
 * Produces an ordinary Polygon feature.
 */
import { rectangle } from '@/utils/geo'

const DrawRectangle = {
  onSetup() {
    const rect = this.newFeature({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [[]] } })
    this.addFeature(rect)
    this.clearSelectedFeatures()
    this.updateUIClasses({ mouse: 'add' })
    this.setActionableState({ trash: true })
    return { rect, start: null }
  },
  _update(state, e) {
    const g = rectangle(state.start, [e.lngLat.lng, e.lngLat.lat])
    state.rect.incomingCoords(g.coordinates)
  },
  onMouseDown(state, e) {
    e.preventDefault()
    if (!state.start) state.start = [e.lngLat.lng, e.lngLat.lat]
  },
  onDrag(state, e) {
    if (state.start) this._update(state, e)
  },
  onMouseMove(state, e) {
    if (state.start) this._update(state, e)
  },
  onMouseUp(state, e) {
    if (!state.start) return
    const [x, y] = state.start
    if (Math.abs(e.lngLat.lng - x) < 1e-6 && Math.abs(e.lngLat.lat - y) < 1e-6) return // a click: wait for the second
    this._update(state, e)
    this.changeMode('simple_select', { featureIds: [state.rect.id] })
  },
  onClick(state, e) {
    if (state.start && (e.lngLat.lng !== state.start[0] || e.lngLat.lat !== state.start[1])) {
      this._update(state, e)
      this.changeMode('simple_select', { featureIds: [state.rect.id] })
    }
  },
  onKeyUp(state, e) {
    if (e.keyCode === 27) {
      this.deleteFeature([state.rect.id], { silent: true })
      this.changeMode('simple_select')
    }
  },
  onStop(state) {
    this.updateUIClasses({ mouse: 'none' })
    this.activateUIButton()
    if (this.getFeature(state.rect.id) === undefined) return
    if (state.rect.isValid()) {
      this.map.fire('draw.create', { features: [state.rect.toGeoJSON()] })
    } else {
      this.deleteFeature([state.rect.id], { silent: true })
    }
  },
  onTrash(state) {
    this.deleteFeature([state.rect.id], { silent: true })
    this.changeMode('simple_select')
  },
  toDisplayFeatures(state, geojson, display) {
    const isActive = geojson.properties.id === state.rect.id
    geojson.properties.active = isActive ? 'true' : 'false'
    if (!isActive || geojson.geometry.coordinates[0]?.length) display(geojson)
  },
}

export default DrawRectangle

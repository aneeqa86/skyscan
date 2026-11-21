import api, { API_BASE } from './api'

/** Absolute URL for things the browser or Mapbox fetches directly (tiles, downloads). */
export function apiUrl(path) {
  const base = API_BASE.startsWith('http') ? API_BASE : `${window.location.origin}${API_BASE}`
  return `${base.replace(/\/$/, '')}${path}`
}

const SkyscanService = {
  async getCities(params = {}) {
    const { data } = await api.get('/cities/', { params })
    return data.results ?? data
  },

  async getCity(slug) {
    const { data } = await api.get(`/cities/${slug}/`)
    return data
  },

  /** Surveys covering a polygon (GeoJSON) or a point, with Change-mode availability. */
  async getSurveys({ aoi, lon, lat } = {}) {
    const params = aoi ? { aoi: JSON.stringify(aoi) } : { lon, lat }
    const { data } = await api.get('/datasets/', { params })
    return data
  },

  async createJob(body) {
    const { data } = await api.post('/jobs/', body)
    return data
  },

  async cancelJob(id) {
    const { data } = await api.post(`/jobs/${id}/cancel/`)
    return data
  },

  async getJob(id) {
    const { data } = await api.get(`/jobs/${id}/`)
    return data
  },

  /** layer: buildings | changes | reference */
  async getJobLayer(id, layer, params = {}) {
    // Showcase layers are several MB of GeoJSON; allow slow connections.
    const { data } = await api.get(`/jobs/${id}/${layer}/`, { params, timeout: 120000 })
    return data
  },

  async getPointCloud(id, epoch) {
    const { data } = await api.get(`/jobs/${id}/pointcloud/`, {
      params: epoch ? { epoch } : {},
      responseType: 'arraybuffer',
      timeout: 120000,
    })
    return data
  },

  exportUrl(id, format, { layer, epoch } = {}) {
    const q = new URLSearchParams({ format })
    if (layer) q.set('layer', layer)
    if (epoch) q.set('epoch', epoch)
    return apiUrl(`/jobs/${id}/export/?${q}`)
  },

  /** One year's aerial image for a job area (placed by job.stats.imagery.corners). */
  imageryUrl(id, year) {
    return apiUrl(`/jobs/${id}/imagery/${year}/`)
  },

  coverageTiles() {
    return apiUrl('/tiles/coverage/{z}/{x}/{y}.mvt')
  },
}

export default SkyscanService

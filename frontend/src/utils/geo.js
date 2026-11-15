const R = 6378137

/** Geodesic area of a GeoJSON Polygon ring set, in km² (spherical approximation). */
export function polygonAreaKm2(geometry) {
  if (!geometry || geometry.type !== 'Polygon') return 0
  const ringArea = (ring) => {
    let total = 0
    for (let i = 0; i < ring.length - 1; i++) {
      const [lon1, lat1] = ring[i]
      const [lon2, lat2] = ring[i + 1]
      total += toRad(lon2 - lon1) * (2 + Math.sin(toRad(lat1)) + Math.sin(toRad(lat2)))
    }
    return Math.abs((total * R * R) / 2)
  }
  const [outer, ...holes] = geometry.coordinates
  const m2 = ringArea(outer) - holes.reduce((s, h) => s + ringArea(h), 0)
  return m2 / 1e6
}

const toRad = (d) => (d * Math.PI) / 180

export function bbox(geojson) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const visit = (c) => {
    if (typeof c[0] === 'number') {
      minX = Math.min(minX, c[0])
      minY = Math.min(minY, c[1])
      maxX = Math.max(maxX, c[0])
      maxY = Math.max(maxY, c[1])
    } else c.forEach(visit)
  }
  const geoms =
    geojson.type === 'FeatureCollection'
      ? geojson.features.map((f) => f.geometry)
      : geojson.type === 'Feature'
        ? [geojson.geometry]
        : [geojson]
  geoms.filter(Boolean).forEach((g) => visit(g.coordinates))
  return [minX, minY, maxX, maxY]
}

export function centroid(geometry) {
  const [a, b, c, d] = bbox(geometry)
  return [(a + c) / 2, (b + d) / 2]
}

export function rectangle([x0, y0], [x1, y1]) {
  const w = Math.min(x0, x1)
  const e = Math.max(x0, x1)
  const s = Math.min(y0, y1)
  const n = Math.max(y0, y1)
  return { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }
}

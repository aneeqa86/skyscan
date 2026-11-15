/**
 * Decode SKYSCAN's compact point cloud (see backend apps/lidar/pipeline/pointcloud.py):
 *   uint32 header_len | JSON header (padded to 4 bytes) |
 *   float32 xyz[n*3] | uint16 hag_cm[n] | uint8 classification[n] | uint8 intensity[n]
 */
export function decodePointCloud(buffer) {
  const view = new DataView(buffer)
  const headerLen = view.getUint32(0, true)
  const header = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 4, headerLen)))
  const n = header.count
  let off = 4 + headerLen
  const xyz = new Float32Array(buffer, off, n * 3)
  off += n * 12
  const hagCm = new Uint16Array(buffer, off, n)
  off += n * 2
  const classification = new Uint8Array(buffer, off, n)
  off += n
  const intensity = new Uint8Array(buffer, off, n)
  return { header, xyz, hagCm, classification, intensity }
}

/** ASPRS classes we label, with colours from the design tokens. */
export const CLASS_COLORS = {
  1: { label: 'Unclassified', color: [94, 110, 135] },
  2: { label: 'Ground', color: [111, 127, 156] },
  3: { label: 'Low vegetation', color: [157, 191, 90] },
  4: { label: 'Medium vegetation', color: [157, 191, 90] },
  5: { label: 'High vegetation', color: [157, 191, 90] },
  6: { label: 'Building', color: [0, 201, 167] },
  9: { label: 'Water', color: [43, 76, 126] },
  17: { label: 'Bridge deck', color: [232, 180, 92] },
}
const OTHER = [94, 110, 135]

/** Class groups used for the legend percentages and the class toggles. */
export const CLASS_GROUPS = [
  { key: 'ground', label: 'Ground', classes: [2], color: '#6F7F9C' },
  {
    key: 'vegetation',
    label: 'Vegetation',
    classes: [3, 4, 5],
    color: '#9DBF5A',
  },
  { key: 'buildings', label: 'Buildings', classes: [6], color: '#00C9A7' },
  {
    key: 'other',
    label: 'Unclassified and other',
    classes: null,
    color: '#5E6E87',
  },
]

export function groupOf(cls) {
  for (const g of CLASS_GROUPS) if (g.classes?.includes(cls)) return g.key
  return 'other'
}

/** Stepped height ramp 0 to 45 m (tokens h0..h4). */
export const HEIGHT_RAMP = [
  [0, [43, 76, 126]],
  [9, [42, 143, 168]],
  [18, [0, 201, 167]],
  [27, [232, 180, 92]],
  [36, [255, 107, 53]],
]
/** Intensity ramp (tokens i0..i4), interpolated over 0..255. */
const INTENSITY = [
  [58, 69, 88],
  [110, 120, 140],
  [152, 162, 179],
  [196, 204, 216],
  [241, 244, 249],
]

function heightColor(h) {
  let c = HEIGHT_RAMP[0][1]
  for (const [stop, col] of HEIGHT_RAMP) if (h >= stop) c = col
  return c
}

function intensityColor(v) {
  const t = (v / 255) * (INTENSITY.length - 1)
  const i = Math.min(Math.floor(t), INTENSITY.length - 2)
  const f = t - i
  const a = INTENSITY[i]
  const b = INTENSITY[i + 1]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]
}

/**
 * Mark points that fall inside detected building footprints (and stand above
 * the ground), by drawing the footprints onto a raster in the cloud's metre
 * grid. Lets the "detected" side show SKYSCAN's result even where the survey
 * has no building class. Returns a Uint8Array (1 = building) or null.
 */
export function footprintMask(pc, buildings, minHag = 2) {
  if (!buildings?.features?.length || typeof document === 'undefined') return null
  const n = pc.header.count
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i < n; i++) {
    const x = pc.xyz[i * 3]
    const y = pc.xyz[i * 3 + 1]
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const res = Math.max(0.5, Math.max(maxX - minX, maxY - minY) / 4096)
  const w = Math.ceil((maxX - minX) / res) + 1
  const h = Math.ceil((maxY - minY) / res) + 1
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return null
  const [lon0, lat0] = pc.header.center
  const mx = 111320 * Math.cos((lat0 * Math.PI) / 180)
  const my = 110540
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  for (const f of buildings.features) {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates
    for (const poly of polys)
      for (const ring of poly)
        ring.forEach(([lon, lat], k) => {
          const px = ((lon - lon0) * mx - minX) / res
          const py = (maxY - (lat - lat0) * my) / res
          if (k === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        })
  }
  ctx.fill('evenodd')
  const img = ctx.getImageData(0, 0, w, h).data
  const mask = new Uint8Array(n)
  for (let i = 0; i < n; i++) {
    if (pc.hagCm[i] / 100 < minHag) continue
    const px = Math.floor((pc.xyz[i * 3] - minX) / res)
    const py = Math.floor((maxY - pc.xyz[i * 3 + 1]) / res)
    mask[i] = img[(py * w + px) * 4] > 127 ? 1 : 0
  }
  return mask
}

const classOf = (pc, i, mask) => (mask?.[i] ? 6 : pc.classification[i])

/** Share of points per class group (for the legend). */
export function classShares(pc, mask = null) {
  const n = pc.header.count
  const counts = Object.fromEntries(CLASS_GROUPS.map((g) => [g.key, 0]))
  for (let i = 0; i < n; i++) counts[groupOf(classOf(pc, i, mask))] += 1
  return Object.fromEntries(Object.entries(counts).map(([k, c]) => [k, n ? c / n : 0]))
}

/**
 * Indices of the points to draw: every `stride`-th point (density) whose class
 * group is switched on.
 */
export function selectPoints(pc, { stride = 1, groups = null } = {}, mask = null) {
  const n = pc.header.count
  const out = []
  for (let i = 0; i < n; i += stride) {
    if (!groups || groups[groupOf(classOf(pc, i, mask))]) out.push(i)
  }
  return Uint32Array.from(out)
}

/** Positions in metres around the area centre, z = height above ground. */
export function positions(pc, idx) {
  const n = idx ? idx.length : pc.header.count
  const out = new Float32Array(n * 3)
  for (let k = 0; k < n; k++) {
    const i = idx ? idx[k] : k
    out[k * 3] = pc.xyz[i * 3]
    out[k * 3 + 1] = pc.xyz[i * 3 + 1]
    out[k * 3 + 2] = pc.hagCm[i] / 100
  }
  return out
}

/**
 * RGB colours per point for 'classification' | 'height' | 'intensity'.
 * gray: render the same colours as luminance (the "raw points" side).
 * mask: footprintMask(); masked points are drawn as buildings.
 */
export function colors(pc, by, idx, gray = false, mask = null) {
  const n = idx ? idx.length : pc.header.count
  const out = new Uint8Array(n * 3)
  for (let k = 0; k < n; k++) {
    const i = idx ? idx[k] : k
    let c
    if (by === 'height') c = heightColor(pc.hagCm[i] / 100)
    else if (by === 'intensity') c = intensityColor(pc.intensity[i])
    else c = CLASS_COLORS[classOf(pc, i, mask)]?.color || OTHER
    if (gray) {
      const l = 0.85 * (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2])
      c = [l, l, l]
    }
    out[k * 3] = c[0]
    out[k * 3 + 1] = c[1]
    out[k * 3 + 2] = c[2]
  }
  return out
}

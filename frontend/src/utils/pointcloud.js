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

/** ASPRS classes we label, with brand-consistent colours. */
export const CLASS_COLORS = {
  1: { label: 'Unclassified', color: [138, 151, 173] },
  2: { label: 'Ground', color: [120, 104, 86] },
  3: { label: 'Low vegetation', color: [74, 140, 82] },
  4: { label: 'Medium vegetation', color: [62, 160, 90] },
  5: { label: 'High vegetation', color: [46, 125, 70] },
  6: { label: 'Building', color: [0, 201, 167] },
  9: { label: 'Water', color: [59, 130, 246] },
  17: { label: 'Bridge deck', color: [255, 176, 140] },
}
const OTHER = [91, 104, 128]

/** Height ramp (metres above ground), shared with the legend. */
export const HEIGHT_RAMP = [
  [0, [120, 104, 86]],
  [3, [11, 61, 58]],
  [10, [0, 168, 140]],
  [30, [0, 201, 167]],
  [80, [127, 227, 210]],
  [150, [255, 107, 53]],
]

function ramp(h) {
  for (let i = 1; i < HEIGHT_RAMP.length; i++) {
    const [h1, c1] = HEIGHT_RAMP[i]
    const [h0, c0] = HEIGHT_RAMP[i - 1]
    if (h <= h1) {
      const t = (h - h0) / (h1 - h0)
      return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t]
    }
  }
  return HEIGHT_RAMP[HEIGHT_RAMP.length - 1][1]
}

/** Positions in metres around the area centre, z = height above ground. */
export function positions(pc) {
  const n = pc.header.count
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    out[i * 3] = pc.xyz[i * 3]
    out[i * 3 + 1] = pc.xyz[i * 3 + 1]
    out[i * 3 + 2] = pc.hagCm[i] / 100
  }
  return out
}

/** RGB colours per point for 'classification' | 'height' | 'intensity'. */
export function colors(pc, by) {
  const n = pc.header.count
  const out = new Uint8Array(n * 3)
  for (let i = 0; i < n; i++) {
    let c
    if (by === 'height') c = ramp(pc.hagCm[i] / 100)
    else if (by === 'intensity') {
      const v = 40 + pc.intensity[i] * 0.84
      c = [v, v, v]
    } else c = CLASS_COLORS[pc.classification[i]]?.color || OTHER
    out[i * 3] = c[0]
    out[i * 3 + 1] = c[1]
    out[i * 3 + 2] = c[2]
  }
  return out
}

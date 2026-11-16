import { describe, expect, it } from 'vitest'
import { colors, decodePointCloud, positions } from './pointcloud'

/** Build a buffer exactly as the backend encoder does. */
function encode(points, header = {}) {
  const n = points.length
  let hb = new TextEncoder().encode(JSON.stringify({ version: 1, count: n, center: [-122.3, 47.6], classes: [2, 6], ...header }))
  const pad = (4 - (hb.length % 4)) % 4
  hb = new Uint8Array([...hb, ...new Array(pad).fill(32)])
  const buf = new ArrayBuffer(4 + hb.length + n * 12 + n * 2 + n * 2)
  const dv = new DataView(buf)
  dv.setUint32(0, hb.length, true)
  new Uint8Array(buf, 4, hb.length).set(hb)
  let off = 4 + hb.length
  points.forEach((p, i) => {
    dv.setFloat32(off + i * 12, p.x, true)
    dv.setFloat32(off + i * 12 + 4, p.y, true)
    dv.setFloat32(off + i * 12 + 8, p.z, true)
  })
  off += n * 12
  points.forEach((p, i) => dv.setUint16(off + i * 2, p.hag * 100, true))
  off += n * 2
  points.forEach((p, i) => dv.setUint8(off + i, p.cls))
  off += n
  points.forEach((p, i) => dv.setUint8(off + i, p.int))
  return buf
}

describe('point cloud decoding', () => {
  const buf = encode([
    { x: -10.5, y: 4, z: 0.2, hag: 0, cls: 2, int: 10 },
    { x: 3.25, y: -7, z: 21.5, hag: 21.5, cls: 6, int: 255 },
  ])

  it('reads header, coordinates and attributes', () => {
    const pc = decodePointCloud(buf)
    expect(pc.header.count).toBe(2)
    expect(pc.header.center).toEqual([-122.3, 47.6])
    expect(Array.from(pc.xyz.slice(3, 6))).toEqual([3.25, -7, 21.5])
    expect(Array.from(pc.classification)).toEqual([2, 6])
    expect(pc.hagCm[1]).toBe(2150)
  })

  it('places points at height above ground and colours them', () => {
    const pc = decodePointCloud(buf)
    expect(Array.from(positions(pc).slice(3))).toEqual([3.25, -7, 21.5])
    expect(Array.from(colors(pc, 'classification').slice(3))).toEqual([0, 201, 167]) // building teal
    const inten = colors(pc, 'intensity')
    expect(inten[3]).toBeGreaterThan(inten[0])
  })

  it('colours classes outside the legend groups as "other", matching the legend', () => {
    // Class 17 (bridge deck, or a vendor class in older surveys) and 9 (water) sit in "Unclassified and other".
    const pc = decodePointCloud(
      encode([
        { x: 0, y: 0, z: 5, hag: 5, cls: 17, int: 0 },
        { x: 1, y: 0, z: 0, hag: 0, cls: 9, int: 0 },
        { x: 2, y: 0, z: 0, hag: 0, cls: 1, int: 0 },
      ])
    )
    const c = Array.from(colors(pc, 'classification'))
    expect(c).toEqual([94, 110, 135, 94, 110, 135, 94, 110, 135])
  })
})

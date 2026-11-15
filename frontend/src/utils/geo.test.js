import { describe, expect, it } from 'vitest'
import { bbox, polygonAreaKm2, rectangle } from './geo'

describe('geo utils', () => {
  it('computes polygon area in km²', () => {
    // 0.01° x 0.01° at the equator is about 1.11 km x 1.11 km.
    const sq = rectangle([0, 0], [0.01, 0.01])
    expect(polygonAreaKm2(sq)).toBeCloseTo(1.2364, 2)
    // Shrinks with latitude.
    expect(polygonAreaKm2(rectangle([0, 60], [0.01, 60.01]))).toBeCloseTo(0.618, 2)
  })

  it('normalises rectangle corners and computes bbox', () => {
    const r = rectangle([2, 3], [1, 1])
    expect(bbox(r)).toEqual([1, 1, 2, 3])
    expect(polygonAreaKm2(null)).toBe(0)
  })
})

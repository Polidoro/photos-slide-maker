import { expect, test } from 'vitest'
import { bilateralField, frameField, hysteresisMask, levelOf, medianField, brushFreeze, removeSmall, thawLowest, thresholdsOf, tone } from './image'

test('median removes a speck and keeps a hard edge', () => {
  const w = 9, h = 9
  const f = Float32Array.from({ length: w * h }, (_, i) => (i % w < 4 ? 0 : 1)) // left black, right white
  f[4 * w + 1] = 1 // single white speck in the black half
  const m = medianField(f, w, h, 1)
  expect(m[4 * w + 1]).toBe(0)
  expect(m[4 * w + 3]).toBe(0)
  expect(m[4 * w + 4]).toBe(1)
  expect(m[0]).toBe(0) // corner (clamped window) unchanged
  expect(m[w * h - 1]).toBe(1)
})

test('percent thresholds -> levels', () => {
  const t = thresholdsOf([10, 50])
  expect(t).toEqual([0.1, 0.5])
  expect([0, 0.1, 0.3, 0.5, 1].map((v) => levelOf(v, t))).toEqual([0, 1, 1, 2, 2])
})

test('removeSmall drops islands and fills holes below the area', () => {
  const w = 8, h = 6
  const m = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 4; x < w; x++) m[y * w + x] = 1 // right half on
  m[2 * w + 1] = 1 // 1-px island on the left
  m[3 * w + 6] = 0 // 1-px hole on the right
  const r = removeSmall(m, w, 3)
  expect(r[2 * w + 1]).toBe(0)
  expect(r[3 * w + 6]).toBe(1)
  expect(Array.from(r).reduce((a, b) => a + b)).toBe(4 * h)
})

test('bilateral reduces noise but keeps a step edge', () => {
  const w = 20, h = 10
  let seed = 1
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.1
  const f = Float32Array.from({ length: w * h }, (_, i) => (i % w < 10 ? 0.2 : 0.8) + rnd())
  const g = bilateralField(f, w, h, 3, 0.1)
  const spread = (a: Float32Array, lo: number, hi: number) => { let s = 0; for (let y = 0; y < h; y++) for (let x = lo; x < hi; x++) s += Math.abs(a[y * w + x] - (x < 10 ? 0.2 : 0.8)); return s }
  expect(spread(g, 0, w)).toBeLessThan(spread(f, 0, w) / 2) // noise down
  expect(g[5 * w + 9]).toBeLessThan(0.35) // edge pixels not pulled across
  expect(g[5 * w + 10]).toBeGreaterThan(0.65)
})

test('hysteresis: band pixels join a touching on-region, isolated band pixels stay off', () => {
  const w = 6
  //            sure-on  band  band  off   band  off
  const f = Float32Array.from([0.9, 0.52, 0.48, 0.1, 0.5, 0.1])
  expect(Array.from(hysteresisMask(f, w, 0.5, 0.05))).toEqual([1, 1, 1, 0, 0, 0])
})

test('frameField: layer units, 1 mm border, taper, mixed corners', () => {
  const w = 11, h = 11, p = { thresholds: [50], layerHeightMm: 0.25, widthMm: 10, heightMm: null } // 1 mm = 1 px, top j = 3
  const f = new Float32Array(w * h).fill(1) // all image level 1 -> j = 1
  const none = frameField(f, w, h, { ...p, frame: 'none' })
  expect(none.heights[0]).toBe(1)
  expect(none.thresholds).toEqual([0.5])
  expect(none.baseMm + none.maxHeightMm).toBeCloseTo(0.5) // 2 layers: 0.25 and 0.50 mm
  expect(levelOf(frameField(Float32Array.of(0.5), 1, 1, { ...p, frame: 'none' }).heights[0], none.thresholds)).toBe(1)
  expect(levelOf(frameField(Float32Array.of(0.49), 1, 1, { ...p, frame: 'none' }).heights[0], none.thresholds)).toBe(0)
  const flat = frameField(f, w, h, { ...p, frame: 'flat' })
  expect(flat.heights[0]).toBe(3)
  expect(flat.heights[w + 1]).toBe(1) // inside the 1 px border untouched
  const tapered = frameField(f, w, h, { ...p, frame: 'tapered' })
  expect(tapered.heights[5 * w]).toBe(0) // outer edge: one layer
  const mixed = frameField(f, w, h, { ...p, frame: 'mixed' })
  expect(mixed.heights[5 * w]).toBe(3) // side: flat
  expect(mixed.heights[0]).toBe(0) // corner follows the taper
})

test('tone: defaults are identity; each knob moves the right part of the range', () => {
  const d = { lightness: 0, gamma: 1, shadows: 0, highlights: 0 }
  for (const v of [0, 0.25, 0.5, 1]) expect(tone(v, d)).toBeCloseTo(v)
  expect(tone(0.5, { ...d, lightness: 20 })).toBeCloseTo(0.7)
  expect(tone(0.25, { ...d, gamma: 2 })).toBeCloseTo(0.5)
  expect(tone(0, { ...d, shadows: 100 })).toBeCloseTo(0.5)
  expect(tone(1, { ...d, shadows: 100 })).toBeCloseTo(1) // shadows leave white alone
  expect(tone(1, { ...d, highlights: -100 })).toBeCloseTo(0.5)
  expect(tone(0, { ...d, highlights: -100 })).toBeCloseTo(0) // highlights leave black alone
})

test('thawLowest releases one level at a time and ends with null', () => {
  const f = { from: 1, w: 2, h: 1, levels: Uint8Array.from([1, 2]) }
  const t = thawLowest(f, 3)!
  expect(t.from).toBe(2)
  expect(Array.from(t.levels)).toEqual([255, 2])
  expect(thawLowest(t, 3)).toBeNull()
})

test('frameField base: fixed depth and void for masked pixels', () => {
  const p = { frame: 'none' as const, thresholds: [50], layerHeightMm: 0.2, widthMm: 10, heightMm: null }
  const mask = Uint8Array.of(1, 0)
  const fixed = frameField(Float32Array.of(0.1, 0.1), 2, 1, p, { mask, level: 4 }) // 1 mm at 0.2 mm layers
  expect(fixed.heights[0]).toBe(4)
  expect(fixed.heights[1]).toBeLessThan(1)
  expect(fixed.maxHeightMm).toBeCloseTo(0.8) // thresholds grew to cover the base level (top = base layer + 4 more)
  const none = frameField(Float32Array.of(0.1, 0.1), 2, 1, p, { mask, level: -1 })
  expect(none.heights[0]).toBe(-1)
})

test('flipDepth mirrors image levels but not the frame', () => {
  const p = { frame: 'flat' as const, thresholds: [50], layerHeightMm: 0.5, widthMm: 10, heightMm: null, flipDepth: true }
  const f = Float32Array.from({ length: 25 }, (_, i) => (i === 12 ? 0.1 : 0.9)) // 5x5, dark centre, light elsewhere
  const { heights, thresholds } = frameField(f, 5, 5, p)
  expect(levelOf(heights[12], thresholds)).toBe(1) // dark -> top image level
  expect(levelOf(heights[6], thresholds)).toBe(0) // light interior -> bottom
  expect(levelOf(heights[0], thresholds)).toBe(1) // 1 mm frame at 0.5 mm layers is level 1 either way
})

test('brushFreeze: erase drops to the frozen level below or frees; add claims pixels from every level', () => {
  const f = { from: 1, w: 3, h: 1, levels: Uint8Array.from([2, 2, 1]) }
  expect(Array.from(brushFreeze(f, 2, 0, 0, 0.5, 'erase').levels)).toEqual([1, 2, 1]) // level 1 is frozen: drop to it
  expect(Array.from(brushFreeze(f, 1, 2, 0, 0.5, 'erase').levels)).toEqual([2, 2, 255]) // nothing frozen below: free
  expect(Array.from(brushFreeze(f, 2, 0, 0, 5, 'erase').levels)).toEqual([1, 1, 1]) // big brush, only level-2 pixels change
  expect(Array.from(brushFreeze({ ...f, levels: Uint8Array.from([255, 1, 2]) }, 1, 1, 0, 5, 'add').levels)).toEqual([1, 1, 1]) // add: free, lower and higher all become this level
  expect(f.levels[0]).toBe(2) // input untouched
})

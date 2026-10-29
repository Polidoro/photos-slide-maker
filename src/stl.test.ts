import { expect, test } from 'vitest'
import { buildStl } from './stl'
import { frameField } from './image'

const opts = { widthMm: 10, maxHeightMm: 5, baseMm: 2, thresholds: [1 / 6, 0.5, 5 / 6] }

function check(buf: ArrayBuffer) {
  const dv = new DataView(buf)
  const n = dv.getUint32(80, true)
  expect(buf.byteLength).toBe(84 + 50 * n)
  const directed = new Set<string>()
  let volume = 0
  for (let t = 0; t < n; t++) {
    const o = 84 + 50 * t
    const f = (i: number) => dv.getFloat32(o + 4 * i, true)
    expect(Math.hypot(f(0), f(1), f(2)), `zero normal in tri ${t}`).toBeCloseTo(1)
    const v = [0, 1, 2].map((k) => [f(3 + 3 * k), f(4 + 3 * k), f(5 + 3 * k)])
    const [a, b, c] = v
    volume += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6
    for (let k = 0; k < 3; k++) {
      const key = `${v[k]}|${v[(k + 1) % 3]}`
      expect(directed.has(key), `duplicate directed edge ${key}`).toBe(false)
      directed.add(key)
    }
  }
  for (const key of directed) {
    const [p, q] = key.split('|')
    expect(directed.has(`${q}|${p}`), `unmatched edge ${key}`).toBe(true)
  }
  expect(volume).toBeGreaterThan(0)
  return n
}

test('2x2 flat heightmap is a box', () => {
  expect(check(buildStl(new Float32Array([0, 0, 0, 0]), 2, 2, opts))).toBe(14) // 2 top + 4 bottom + 8 walls
  expect(check(buildStl(new Float32Array([1, 1, 1, 1]), 2, 2, opts))).toBe(38) // walls have one band per level: 4 edges * 4 bands * 2
})

test('terraced mesh is watertight and consistently oriented', () => {
  const w = 6, h = 5
  const heights = Float32Array.from({ length: w * h }, (_, i) => ((i * 7) % 11) / 10)
  check(buildStl(heights, w, h, opts))
  // values exactly on thresholds, big jumps, and a saddle
  check(buildStl(new Float32Array([0, 1, 1 / 6, 0.5, 1, 0, 0.5, 5 / 6, 0, 1, 1, 0]), 4, 3, opts))
  check(buildStl(heights, w, h, { ...opts, thresholds: Array.from({ length: 11 }, (_, k) => 0.05 + k * 0.09) }))
  check(buildStl(heights, w, h, { ...opts, thresholds: [0.2, 0.21, 0.9] })) // uneven spacing
})

test('framed meshes are watertight', () => {
  const w = 20, h = 15
  const f = Float32Array.from({ length: w * h }, (_, i) => ((i % w) / w + Math.floor(i / w) / h) / 2)
  for (const frame of ['flat', 'tapered', 'mixed'] as const) {
    const { heights, ...o } = frameField(f, w, h, { frame, thresholds: [25, 50, 75], layerHeightMm: 0.15, widthMm: 20, heightMm: null })
    check(buildStl(heights, w, h, o))
  }
})

import type { Params } from './store'

/** Working grid long edge: one pixel per half nozzle width at the chosen print width, clamped for cost. */
export const gridSize = (widthMm: number, nozzleMm: number) => Math.min(1024, Math.max(64, Math.round(widthMm / (nozzleMm / 2))))
const MAX_BLUR = 0.05 // fraction of the long edge at 100% smoothing
const ALPHA_CUTOFF = 128 // below this a pixel is "transparent"

/** Scale an image to fit `longEdge` pixels on its longer side. */
export function fit(image: { width: number; height: number }, longEdge: number, min = 2) {
  const scale = longEdge / Math.max(image.width, image.height)
  return { w: Math.max(min, Math.round(image.width * scale)), h: Math.max(min, Math.round(image.height * scale)) }
}

/** Call fn for each 4-connected neighbour of pixel i without allocating. */
function neighbours(i: number, w: number, n: number, fn: (j: number) => void) {
  const x = i % w
  if (i >= w) fn(i - w)
  if (i + w < n) fn(i + w)
  if (x > 0) fn(i - 1)
  if (x < w - 1) fn(i + 1)
}

/** Gaussian blur of a 0..1 field via the native canvas filter, mirror-padded so edges don't fade. */
function blurField(src: Float32Array, w: number, h: number, radiusPx: number): Float32Array {
  const img = new ImageData(w, h)
  for (let i = 0; i < src.length; i++) {
    const v = Math.round(src[i] * 255)
    img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v
    img.data[4 * i + 3] = 255
  }
  const one = new OffscreenCanvas(w, h)
  one.getContext('2d')!.putImageData(img, 0, 0)
  const p = Math.ceil(3 * radiusPx) // padding: beyond 3 sigma the kernel is negligible
  const tile = new OffscreenCanvas(w + 2 * p, h + 2 * p)
  const tc = tile.getContext('2d')!
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      tc.setTransform(i ? -1 : 1, 0, 0, j ? -1 : 1, p + i * w + (i ? w : 0), p + j * h + (j ? h : 0))
      tc.drawImage(one, 0, 0)
    }
  const ctx = new OffscreenCanvas(w, h).getContext('2d')!
  ctx.filter = `blur(${radiusPx}px)`
  ctx.drawImage(tile, -p, -p)
  const { data } = ctx.getImageData(0, 0, w, h)
  return Float32Array.from(src, (_, i) => data[4 * i] / 255)
}

/** True if any pixel would be treated as transparent (checked on a 64px thumbnail). */
export function hasAlpha(image: ImageBitmap): boolean {
  const { w, h } = fit(image, 64, 1)
  const ctx = new OffscreenCanvas(w, h).getContext('2d')!
  ctx.drawImage(image, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  for (let i = 3; i < data.length; i += 4) if (data[i] < ALPHA_CUTOFF) return true
  return false
}

/**
 * Frozen top layers: every level >= `from` is pinned to what it was when frozen. `levels[i]` is the pinned level of grid
 * pixel i, or 255 where the live pipeline still decides. Stored at the grid size it was captured at and nearest-sampled
 * onto the current grid, so it survives width/nozzle changes. Plain arrays so it round-trips through IndexedDB.
 */
export type Freeze = { from: number; w: number; h: number; levels: Uint8Array }
const FREE = 255

/** Live pixels in a frozen level drop to the highest unfrozen level, then the frozen pixels are painted back. */
function applyFreeze(heights: Float32Array, w: number, h: number, thresholds: number[], f: Freeze | null): Float32Array {
  if (!f) return heights
  const edges = [0, ...thresholds, 1]
  const centre = (k: number) => (edges[k] + edges[k + 1]) / 2 // band centre maps to exactly level k in frameField
  const top = f.from - 1
  const out = heights.slice()
  if (top >= 0) for (let i = 0; i < out.length; i++) if (levelOf(out[i], thresholds) > top) out[i] = centre(top)
  for (let y = 0; y < h; y++) {
    const sy = Math.floor((y * f.h) / h) * f.w
    for (let x = 0; x < w; x++) {
      const lv = f.levels[sy + Math.floor((x * f.w) / w)]
      if (lv !== FREE) out[y * w + x] = centre(Math.min(lv, thresholds.length))
    }
  }
  return out
}

/** Capture the current output's levels >= `from` as a Freeze (composited over any existing freeze). */
export function captureFreeze(image: ImageBitmap, params: PipelineParams, current: Freeze | null, from: number): Freeze {
  const { heights, w, h, opts } = sampleHeights(image, params, current)
  const top = params.thresholds.length
  const levels = Uint8Array.from(heights, (v) => { const k = Math.min(top, levelOf(v, opts.thresholds)); return k >= from ? k : FREE })
  return { from, w, h, levels }
}

/** Release the lowest frozen level; null once nothing is left frozen. */
export function thawLowest(f: Freeze, layers: number): Freeze | null {
  const from = f.from + 1
  if (from >= layers) return null
  return { ...f, from, levels: f.levels.map((k) => (k === f.from ? FREE : k)) }
}

/** The quantized grayscale as pixels: what the preview shows and the PNG export saves. Frame levels above the image's top print white. */
export function quantizedImage(image: ImageBitmap, params: PipelineParams, freeze: Freeze | null = null): ImageData {
  const { heights, w, h, opts } = sampleHeights(image, params, freeze)
  const steps = params.thresholds.length
  const px = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < heights.length; i++) {
    if (heights[i] < 0) continue // void: transparent
    const v = Math.round((levelOf(heights[i], opts.thresholds) / steps) * 255)
    px[4 * i] = px[4 * i + 1] = px[4 * i + 2] = v
    px[4 * i + 3] = 255
  }
  return new ImageData(px, w, h)
}

/** Quantization thresholds in 0..1 from the percent values in the store. */
export const thresholdsOf = (percent: number[]) => percent.map((b) => b / 100)
/** Number of thresholds at or below v = the level. */
export function levelOf(v: number, thresholds: number[]) {
  let n = 0
  for (let k = 0; k < thresholds.length; k++) if (v >= thresholds[k]) n++
  return n
}
/** Piecewise-linear map through the knots (xs[i], ys[i]), xs ascending. */
function piecewise(xs: number[], ys: number[]) {
  return (S: number) => {
    let j = 0
    while (j < xs.length - 2 && S > xs[j + 1]) j++
    const f = (S - xs[j]) / (xs[j + 1] - xs[j] || 1)
    return ys[j] + f * (ys[j + 1] - ys[j])
  }
}
/** Map a continuous level sum S (0..steps) back to the 0..1 scale, so S = k-0.5 lands on threshold k. */
const levelToField = (thresholds: number[]) => piecewise([0, ...thresholds.map((_, k) => k + 0.5), thresholds.length], [0, ...thresholds, 1])

/**
 * Convert the 0..1 field to layer-index units and add the frame. Level j prints at z = (j+1)·layerHeight;
 * image level k is j = k (the darkest level is the single base layer), the 1 mm frame is j = round(1/lh)-1, and a taper
 * runs linearly from that at the inner edge down to j = 0 (one layer) at the outer edge. Returns the mesher
 * options: thresholds at half-integers, one level per print layer.
 */
export function frameField(src: Float32Array, w: number, h: number, p: Pick<PipelineParams, 'frame' | 'thresholds' | 'layerHeightMm' | 'widthMm' | 'heightMm'> & { flipDepth?: boolean }, base?: { mask: Uint8Array; level: number }) {
  const T = thresholdsOf(p.thresholds), L = T.length + 1
  let heights = src.map(piecewise([0, ...T, 1], [0, ...T.map((_, i) => i + 0.5), L - 1]))
  if (p.flipDepth) heights = heights.map((v) => L - 1 - v) // image levels only; frame and base are applied after
  // Transparent pixels at a fixed layer (or -1 = void, left out of the mesh). The frame still wins at the edges.
  if (base) for (let i = 0; i < heights.length; i++) if (base.mask[i]) heights[i] = base.level
  const top = Math.round(1 / p.layerHeightMm) - 1
  const heightMm = p.heightMm ?? (p.widthMm * (h - 1)) / (w - 1)
  const mmx = p.widthMm / (w - 1), mmy = heightMm / (h - 1) // grid pitch in mm per axis
  if (p.frame !== 'none')
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dx = Math.min(x, w - 1 - x) * mmx, dy = Math.min(y, h - 1 - y) * mmy, d = Math.min(dx, dy) // mm to nearest edge
        const taper = (d: number) => top * d
        let u: number | null = null
        if (p.frame === 'flat') { if (d < 1) u = top }
        else if (p.frame === 'tapered') { if (d < 1) u = taper(d) }
        else if (dy < 1) u = taper(dy) // mixed: tapered top/bottom win in the corners
        else if (dx < 1) u = top
        if (u !== null) heights[y * w + x] = u
      }
  const n = Math.max(L - 1, p.frame === 'none' ? 0 : top, base?.level ?? 0) + 1
  const thresholds = Array.from({ length: n - 1 }, (_, j) => j + 0.5)
  return { heights, thresholds, baseMm: p.layerHeightMm, maxHeightMm: (n - 1) * p.layerHeightMm, widthMm: p.widthMm, heightMm }
}

/** Flip 4-connected groups of on-pixels (islands) and then off-pixels (holes) with area < minArea. */
export function removeSmall(mask: Uint8Array, w: number, minArea: number): Uint8Array {
  const out = Uint8Array.from(mask)
  const n = out.length
  const seen = new Uint8Array(n)
  const stack = new Int32Array(n)
  const comp = new Int32Array(n)
  for (const target of [1, 0]) {
    seen.fill(0)
    for (let s = 0; s < n; s++) {
      if (seen[s] || out[s] !== target) continue
      let top = 0, size = 0
      stack[top++] = s
      seen[s] = 1
      while (top) {
        const i = stack[--top]
        comp[size++] = i
        neighbours(i, w, n, (j) => { if (!seen[j] && out[j] === target) { seen[j] = 1; stack[top++] = j } })
      }
      if (size < minArea) for (let k = 0; k < size; k++) out[comp[k]] = 1 - target
    }
  }
  return out
}

/** Run a per-layer operation: split the field into one mask per threshold, apply fn, force nesting, merge back. */
function viaMasks(heights: Float32Array, thresholds: number[], fn: (mask: Uint8Array, t: number) => ArrayLike<number>): Float32Array {
  const sum = new Float32Array(heights.length)
  let prev: ArrayLike<number> | null = null
  for (const t of thresholds) {
    let g = fn(Uint8Array.from(heights, (v) => (v >= t ? 1 : 0)), t)
    if (prev) { const p = prev; g = Float32Array.from(g, (v, i) => Math.min(v, p[i])) }
    for (let i = 0; i < sum.length; i++) sum[i] += g[i]
    prev = g
  }
  return sum.map(levelToField(thresholds))
}

/**
 * Bilateral filter: each pixel averages neighbours weighted by distance AND intensity similarity, so flat/graded
 * areas are denoised while edges (dissimilar neighbours) stay sharp. sigmaR is the intensity tolerance (0..1).
 */
export function bilateralField(src: Float32Array, w: number, h: number, radius: number, sigmaR: number): Float32Array {
  const r = Math.max(1, Math.round(radius))
  const step = Math.max(1, Math.ceil(r / 6)) // ponytail: sparse window above r=6 keeps cost ~169 samples/pixel
  const sigmaS = r / 2
  const rangeLut = Float32Array.from({ length: 256 }, (_, d) => Math.exp(-((d / 255) ** 2) / (2 * sigmaR * sigmaR)))
  const dxs: number[] = [], dys: number[] = [], wss: number[] = []
  for (let dy = -r; dy <= r; dy += step)
    for (let dx = -r; dx <= r; dx += step) { dxs.push(dx); dys.push(dy); wss.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigmaS * sigmaS))) }
  const out = new Float32Array(src.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x, v = src[i]
      let sum = 0, wsum = 0
      for (let k = 0; k < dxs.length; k++) {
        const xx = x + dxs[k], yy = y + dys[k]
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue
        const u = src[yy * w + xx]
        const wt = wss[k] * rangeLut[Math.min(255, Math.round(Math.abs(u - v) * 255))]
        sum += wt * u
        wsum += wt
      }
      out[i] = sum / wsum
    }
  return out
}

/**
 * Hysteresis mask for threshold t with dead band ±m: pixels >= t+m are on, < t-m are off, and the band between
 * is on only where it touches (4-connected) an on region. Stops noise near a threshold from flickering levels.
 */
export function hysteresisMask(src: Float32Array, w: number, t: number, m: number): Uint8Array {
  const n = src.length
  const out = Uint8Array.from(src, (v) => (v >= t + m ? 1 : 0))
  const band = Uint8Array.from(src, (v) => (v >= t - m && v < t + m ? 1 : 0))
  const stack = new Int32Array(n)
  let top = 0
  for (let i = 0; i < n; i++) if (out[i]) stack[top++] = i
  while (top) {
    const i = stack[--top]
    neighbours(i, w, n, (j) => { if (band[j] && !out[j]) { out[j] = 1; stack[top++] = j } })
  }
  return out // ponytail: band pixels touching an on-region join it; a nearest-side rule could replace this
}

/** Square-window median of a 0..1 field, edge-preserving. Huang's sliding histogram on 8-bit values: O(radius) per pixel. */
export function medianField(src: Float32Array, w: number, h: number, radius: number): Float32Array {
  const r = Math.max(1, Math.round(radius))
  const q = Uint8Array.from(src, (v) => Math.round(Math.min(1, Math.max(0, v)) * 255))
  const out = new Float32Array(src.length)
  const hist = new Int32Array(256)
  const at = (x: number, y: number) => q[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))] // clamp to edge
  const half = ((2 * r + 1) * (2 * r + 1)) >> 1
  for (let y = 0; y < h; y++) {
    hist.fill(0)
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) hist[at(dx, y + dy)]++
    for (let x = 0; x < w; x++) {
      if (x > 0) for (let dy = -r; dy <= r; dy++) { hist[at(x - r - 1, y + dy)]--; hist[at(x + r, y + dy)]++ }
      let acc = 0, m = 0
      while ((acc += hist[m]) <= half) m++
      out[y * w + x] = m / 255
    }
  }
  return out
}

export type PipelineParams = Pick<Params, 'contrast' | 'saturation' | 'lightness' | 'gamma' | 'shadows' | 'highlights' | 'median' | 'bilateral' | 'edgeTolerance' | 'smoothing' | 'hysteresis' | 'invert' | 'levelMin' | 'levelMax' | 'minFeatureMm' | 'background' | 'baseMm' | 'widthMm' | 'heightMm' | 'nozzleMm' | 'thresholds' | 'frame' | 'layerHeightMm'>

/** Tone curve on a 0..1 gray: lightness shifts, gamma bends midtones (>1 brightens), shadows/highlights lift or crush each end. */
export function tone(l: number, p: Pick<PipelineParams, 'lightness' | 'gamma' | 'shadows' | 'highlights'>) {
  l = Math.min(1, Math.max(0, l + p.lightness / 100))
  l = l ** (1 / p.gamma)
  l += (p.shadows / 200) * (1 - l) ** 2 + (p.highlights / 200) * l ** 2
  return Math.min(1, Math.max(0, l))
}

function computeHeights(image: ImageBitmap, p: PipelineParams, freeze: Freeze | null, flipDepth: boolean) {
  const { w, h } = fit(image, gridSize(p.widthMm, p.nozzleMm))
  const ctx = new OffscreenCanvas(w, h).getContext('2d')!
  // Native filters: saturate() reweights the channels feeding the gray conversion, so it still matters for a grayscale result.
  ctx.filter = `contrast(${1 + p.contrast / 100}) saturate(${1 + p.saturation / 100})`
  ctx.drawImage(image, 0, 0, w, h)
  const { data } = ctx.getImageData(0, 0, w, h)
  let heights: Float32Array = new Float32Array(w * h)
  const transparent = new Uint8Array(w * h) // alpha is ignored during processing and applied at the end
  const lo = p.levelMin / 100, span = (p.levelMax - p.levelMin) / 100
  for (let i = 0; i < heights.length; i++) {
    const l = tone((0.299 * data[4 * i] + 0.587 * data[4 * i + 1] + 0.114 * data[4 * i + 2]) / 255, p)
    heights[i] = lo + (p.invert ? 1 - l : l) * span
    transparent[i] = data[4 * i + 3] < ALPHA_CUTOFF ? 1 : 0
  }

  const thresholds = thresholdsOf(p.thresholds)
  const px = (pct100: number) => (pct100 / 100) * MAX_BLUR * Math.max(w, h)
  const mr = px(p.median), br = px(p.bilateral), sr = px(p.smoothing)

  // 1. Denoise the field (edge-preserving filters run first so later per-layer steps see clean data).
  if (mr > 0) heights = medianField(heights, w, h, mr) // ponytail: ~100 ms at 512px grid, radius 25
  if (br > 0) heights = bilateralField(heights, w, h, br, Math.max(0.005, p.edgeTolerance / 100))

  // 2. Settle band boundaries: hysteresis around each threshold, per layer.
  const m = p.hysteresis / 100
  if (m > 0) { const src = heights; heights = viaMasks(src, thresholds, (_, t) => hysteresisMask(src, w, t, m)) }

  // 3. Remove islands and holes smaller than the minimum feature, per layer.
  const minPx = (p.minFeatureMm * (w - 1)) / p.widthMm
  if (minPx > 0) heights = viaMasks(heights, thresholds, (mask) => removeSmall(mask, w, minPx * minPx))

  // 4. Layer-mask blur smooths each layer's outline (blur mask, cut at 0.5) so no intermediate layers appear at edges.
  if (sr > 0) heights = viaMasks(heights, thresholds, (mask) => blurField(Float32Array.from(mask), w, h, sr))

  // Transparent pixels become the background gray, bypassing invert, levels and smoothing.
  for (let i = 0; i < heights.length; i++) if (transparent[i]) heights[i] = p.background / 100

  // 4b. Frozen layers override whatever the live pipeline produced for them.
  heights = applyFreeze(heights, w, h, thresholds, freeze)

  // 5. Frame and convert to layer units (the mesher's field). A fixed base depth overrides the gray for transparent pixels.
  const base = { mask: transparent, level: p.baseMm === 'none' ? -1 : Math.max(0, Math.round(p.baseMm / p.layerHeightMm) - 1) }
  const { heights: framed, ...opts } = frameField(heights, w, h, { ...p, flipDepth }, base)
  return { heights: framed, w, h, opts }
}

// Single-entry memo: the preview and the STL build ask for the same result back to back.
// `flipDepth` is passed only by the STL build, so the preview, PNG and freeze captures keep black = lowest.
let last: { image: ImageBitmap; key: string; freeze: Freeze | null; result: ReturnType<typeof computeHeights> } | null = null
export function sampleHeights(image: ImageBitmap, p: PipelineParams, freeze: Freeze | null = null, flipDepth = false) {
  const key = JSON.stringify(p) + flipDepth
  if (last && last.image === image && last.key === key && last.freeze === freeze) return last.result
  const result = computeHeights(image, p, freeze, flipDepth)
  last = { image, key, freeze, result }
  return result
}

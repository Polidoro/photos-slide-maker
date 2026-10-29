import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { temporal } from 'zundo'
import { allImages, deleteImage, putImage } from './db'
import { hasAlpha, type Locks } from './image'

export type Params = {
  contrast: number; saturation: number // -100..100, applied as canvas filters before the gray conversion
  lightness: number; gamma: number; shadows: number; highlights: number // tone curve on the gray value; see tone() in image.ts
  median: number; bilateral: number // denoise radii in percent, applied first (median, then bilateral); 0 = off
  edgeTolerance: number // bilateral range sigma, percent of intensity
  smoothing: number // outline (layer-mask) smoothing radius in percent, applied last
  widthMm: number; invert: boolean
  heightMm: number | null // null = linked to widthMm by the image aspect ratio
  hysteresis: number // dead band around each threshold, percent of intensity; 0 = off
  levelMin: number; levelMax: number // percent; intensity is rescaled into this range
  minFeatureMm: number // islands/holes narrower than this are removed from every layer; 0 = off
  background: number // percent gray that transparent pixels become; independent of invert and levels
  thresholds: number[] // percent, ascending, length layers-1
  layerHeightMm: number // printer layer height; one layer per colour level, the darkest being the base
  nozzleMm: number // nozzle width; grid pitch is half of it
  frame: 'none' | 'flat' | 'tapered' | 'mixed' // 1 mm border; flat = 1 mm high, tapered = 1 mm down to one layer at the edge, mixed = flat sides, tapered top/bottom
}
export type Img = { id: number; bitmap: ImageBitmap; name: string; hasAlpha: boolean }

const respace = (layers: number) => Array.from({ length: layers - 1 }, (_, k) => Math.round(((k + 1) * 100) / layers))
const DEFAULTS: Params = { contrast: 0, saturation: 0, lightness: 0, gamma: 1, shadows: 0, highlights: 0, median: 0, bilateral: 0, edgeTolerance: 10, smoothing: 0, hysteresis: 0, widthMm: 164, heightMm: 128, invert: false, levelMin: 0, levelMax: 100, minFeatureMm: 0, background: 0, thresholds: respace(4), layerHeightMm: 0.15, nozzleMm: 0.4, frame: 'none' }
const PARAM_KEYS = Object.keys(DEFAULTS) as (keyof Params)[]
export const pickParams = (s: Params): Params => Object.fromEntries(PARAM_KEYS.map((k) => [k, s[k]])) as Params
const FRAMES = ['none', 'flat', 'tapered', 'mixed']
/** Structural check for pasted state: every param present with the right type, nothing else required. */
export const isParams = (x: unknown): x is Params => {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return PARAM_KEYS.every((k) =>
    k === 'heightMm' ? o[k] === null || typeof o[k] === 'number'
    : k === 'thresholds' ? Array.isArray(o[k]) && (o[k] as unknown[]).every((t) => typeof t === 'number')
    : k === 'frame' ? FRAMES.includes(o[k] as string)
    : typeof o[k] === typeof DEFAULTS[k])
}

type State = Params & {
  images: Img[]
  index: number
  configs: Record<number, Params> // params per image id; the top-level params mirror configs[current image]
  locks: Locks // frozen layer masks for the current image, by level; in memory only, cleared on image switch or layer-count change
  setLock: (level: number, mask: ImageBitmap | undefined) => void
  setDragging: (b: boolean) => void // pauses undo history while a slider is dragged
  addImage: (file: File) => Promise<void>
  hydrate: () => Promise<void>
  select: (index: number) => void
  remove: (index: number) => void
  clear: () => void
  reset: () => void
  setParams: (p: Params) => void
  setLayers: (n: number) => void
  setParam: <K extends keyof Params>(key: K, value: Params[K]) => void
}

// Undo history: only the params (what triggers an STL build). Paused while a slider is dragged;
// on release one entry (the pre-drag state) is pushed if anything changed.
const LIMIT = 100
let dragStart: Params | null = null
const same = (a: Params, b: Params) => JSON.stringify(a) === JSON.stringify(b)
// Switch to another image: load its saved params (or defaults) and drop undo history, which belongs to the old image.
const swap = (s: Pick<State, 'images' | 'configs'>, index: number) => {
  const id = s.images[index]?.id
  queueMicrotask(() => useStore.temporal.getState().clear())
  return { index, locks: [] as Locks, ...((id !== undefined && s.configs[id]) || DEFAULTS) }
}

export const useStore = create<State>()(
  temporal(
    persist(
      (set, get) => ({
        ...DEFAULTS,
        images: [],
        index: -1,
        configs: {},
        locks: [],
        setLock: (level, mask) => set((s) => { const locks = s.locks.slice(); locks[level] = mask; return { locks } }),
        setDragging: (b) => {
          const t = useStore.temporal
          if (b && !dragStart) {
            dragStart = pickParams(get())
            t.getState().pause()
          } else if (!b && dragStart) {
            const start = dragStart
            dragStart = null
            t.getState().resume()
            if (!same(start, pickParams(get())))
              t.setState((ts) => ({ pastStates: [...ts.pastStates, start].slice(-LIMIT), futureStates: [] }))
          }
        },
        addImage: async (file) => {
          const rec = { id: Date.now(), name: file.name, blob: file }
          const bitmap = await createImageBitmap(file)
          await putImage(rec)
          set((s) => { const images = [...s.images, { id: rec.id, bitmap, name: rec.name, hasAlpha: hasAlpha(bitmap) }]; return { images, ...swap({ ...s, images }, s.images.length) } })
        },
        hydrate: async () => {
          const recs = await allImages()
          const images = await Promise.all(recs.map(async (r) => { const bitmap = await createImageBitmap(r.blob); return { id: r.id, name: r.name, bitmap, hasAlpha: hasAlpha(bitmap) } }))
          set((s) => ({ images, ...swap({ ...s, images }, Math.min(s.index, images.length - 1)) }))
        },
        select: (index) => set((s) => swap(s, index)),
        remove: (i) => {
          const id = get().images[i].id
          deleteImage(id)
          set((s) => {
            const images = s.images.filter((_, k) => k !== i)
            const { [id]: _gone, ...configs } = s.configs
            const index = i < s.index ? s.index - 1 : Math.min(s.index, images.length - 1)
            return { images, configs, ...swap({ images, configs }, index) }
          })
        },
        clear: () => set((s) => swap(s, -1)),
        reset: () => set(DEFAULTS),
        setParams: (p) => set(pickParams(p)),
        setLayers: (n) => set({ thresholds: respace(n), locks: [] }),
        setParam: (key, value) => set({ [key]: value }),
      }),
      {
        name: 'shademaker',
        partialize: ({ images: _i, locks: _l, ...rest }) => rest, // params + index + configs; images live in IndexedDB, locks in memory
      },
    ),
    { limit: LIMIT, partialize: pickParams, equality: same },
  ),
)

// Mirror every param change (sliders, undo/redo, pasted state) into the current image's saved config.
useStore.subscribe((s, prev) => {
  const img = s.images[s.index]
  if (img && !same(pickParams(s), pickParams(prev))) useStore.setState({ configs: { ...s.configs, [img.id]: pickParams(s) } })
})

export const selectImage = (s: State): Img | undefined => s.images[s.index]

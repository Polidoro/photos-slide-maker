import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { temporal } from 'zundo'
import { allImages, deleteImage, patchImage, putImage } from './db'
import { type Freeze, hasAlpha, maxLayers } from './image'

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
  backgroundLayers: number // print layers of transparent pixels (the background layer), at most 1 mm
  thresholds: number[] // percent, ascending, length layers-1
  levelLayers: number[] // print layers per colour level, length layers; level k prints at levelLayers[k] layer heights, at most 1 mm
  layerHeightMm: number // printer layer height
  nozzleMm: number // nozzle width; grid pitch is half of it
  flipDepth: boolean // STL only: black prints highest and white lowest; preview, PNG and boundaries are unchanged
  frame: 'none' | 'flat' | 'tapered' | 'mixed' // 1 mm border; flat = 1 mm high, tapered = 1 mm down to one layer at the edge, mixed = flat sides, tapered top/bottom
}
export type Img = { id: number; bitmap: ImageBitmap; name: string; hasAlpha: boolean; freeze: Freeze | null }

const respace = (layers: number) => Array.from({ length: layers - 1 }, (_, k) => Math.round(((k + 1) * 100) / layers))
const ladder = (layers: number, lh: number) => Array.from({ length: layers }, (_, k) => Math.min(k + 1, maxLayers(lh))) // one more print layer per level, capped at 1 mm
const above = (layers: number, lh: number) => Math.min(layers + 1, maxLayers(lh)) // background: one print layer above the ladder's top
export const DEFAULTS: Params = { contrast: 0, saturation: 0, lightness: 0, gamma: 1, shadows: 0, highlights: 0, median: 0, bilateral: 0, edgeTolerance: 10, smoothing: 0, hysteresis: 0, widthMm: 164, heightMm: 128, invert: false, levelMin: 0, levelMax: 100, minFeatureMm: 0, backgroundLayers: above(4, 0.15), thresholds: respace(4), levelLayers: ladder(4, 0.15), layerHeightMm: 0.15, nozzleMm: 0.4, flipDepth: true, frame: 'mixed' }
const PARAM_KEYS = Object.keys(DEFAULTS) as (keyof Params)[]
export const pickParams = (s: Params): Params => Object.fromEntries(PARAM_KEYS.map((k) => [k, s[k]])) as Params
const FRAMES = ['none', 'flat', 'tapered', 'mixed']
/** Structural check for pasted state: every param present with the right type, nothing else required. */
export const isParams = (x: unknown): x is Params => {
  if (!x || typeof x !== 'object') return false
  const o = x as Record<string, unknown>
  return PARAM_KEYS.every((k) =>
    k === 'heightMm' ? o[k] === null || typeof o[k] === 'number'
    : k === 'thresholds' || k === 'levelLayers' ? Array.isArray(o[k]) && (o[k] as unknown[]).every((t) => typeof t === 'number')
    : k === 'frame' ? FRAMES.includes(o[k] as string)
    : typeof o[k] === typeof DEFAULTS[k])
}

export type Format = 'stl' | '3mf'

type State = Params & {
  images: Img[]
  index: number
  configs: Record<number, Params> // params per image id; the top-level params mirror configs[current image]
  autogen: boolean // rebuild the STL automatically after each change
  tab: 'images' | 'layers' // sidebar tab
  setTab: (t: 'images' | 'layers') => void
  editLevel: number | null // locked layer shown alone in the preview for editing; UI only
  setEditLevel: (k: number | null) => void
  setAutogen: (b: boolean) => void
  format: Format // export file format; persisted, not part of the undo history
  setFormat: (f: Format) => void
  setFreeze: (f: Freeze | null) => void // on the current image; also written to IndexedDB. Clears stroke history.
  strokes: { past: Freeze[]; future: Freeze[] } // undo/redo for eraser strokes on the current image; UI only
  commitStroke: (f: Freeze) => void // setFreeze that records the previous freeze for undo
  undoStroke: () => void
  redoStroke: () => void
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
const NO_STROKES = { past: [], future: [] }
// Switch to another image: load its saved params (or defaults) and drop undo history, which belongs to the old image.
const swap = (s: Pick<State, 'images' | 'configs'>, index: number) => {
  const id = s.images[index]?.id
  queueMicrotask(() => useStore.temporal.getState().clear())
  return { index, editLevel: null, strokes: NO_STROKES, ...((id !== undefined && s.configs[id]) || DEFAULTS) }
}

export const useStore = create<State>()(
  temporal(
    persist(
      (set, get) => ({
        ...DEFAULTS,
        images: [],
        index: -1,
        configs: {},
        autogen: true,
        tab: 'images',
        setTab: (tab) => set({ tab }),
        editLevel: null,
        setEditLevel: (editLevel) => set({ editLevel }),
        setAutogen: (autogen) => set({ autogen }),
        format: 'stl',
        setFormat: (format) => set({ format }),
        setFreeze: (freeze) => {
          const img = get().images[get().index]
          if (!img) return
          patchImage(img.id, { freeze })
          set((s) => ({ images: s.images.map((i) => (i.id === img.id ? { ...i, freeze } : i)), strokes: NO_STROKES }))
        },
        strokes: NO_STROKES,
        commitStroke: (f) => {
          const prev = get().images[get().index]?.freeze
          const { past } = get().strokes
          get().setFreeze(f)
          if (prev) set({ strokes: { past: [...past, prev].slice(-LIMIT), future: [] } })
        },
        undoStroke: () => {
          const { past, future } = get().strokes, cur = get().images[get().index]?.freeze
          if (!past.length || !cur) return
          get().setFreeze(past[past.length - 1])
          set({ strokes: { past: past.slice(0, -1), future: [...future, cur] } })
        },
        redoStroke: () => {
          const { past, future } = get().strokes, cur = get().images[get().index]?.freeze
          if (!future.length || !cur) return
          get().setFreeze(future[future.length - 1])
          set({ strokes: { past: [...past, cur], future: future.slice(0, -1) } })
        },
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
          set((s) => { const images = [...s.images, { id: rec.id, bitmap, name: rec.name, hasAlpha: hasAlpha(bitmap), freeze: null }]; return { images, ...swap({ ...s, images }, s.images.length) } })
        },
        hydrate: async () => {
          const recs = await allImages()
          const images = await Promise.all(recs.map(async (r) => { const bitmap = await createImageBitmap(r.blob); return { id: r.id, name: r.name, bitmap, hasAlpha: hasAlpha(bitmap), freeze: r.freeze && 'bits' in r.freeze ? r.freeze : null } })) // pre-bits freezes (from/levels) are dropped
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
        setLayers: (n) => { set({ thresholds: respace(n), levelLayers: ladder(n, get().layerHeightMm), backgroundLayers: above(n, get().layerHeightMm) }); get().setFreeze(null) }, // level indices change meaning, so a freeze can't carry over
        setParam: (key, value) => set({ [key]: value }),
      }),
      {
        name: 'shademaker',
        version: 3,
        migrate: (persisted) => {
          // v2 dropped the fixed base depth (baseMm) for per-level print heights; v3 dropped the background gray for a background height
          const s = persisted as State
          const fix = (p: Params) => { const { baseMm: _b, background: _g, ...rest } = p as Params & { baseMm?: unknown; background?: unknown }; return { ...rest, levelLayers: rest.levelLayers ?? ladder(rest.thresholds.length + 1, rest.layerHeightMm), backgroundLayers: rest.backgroundLayers ?? above(rest.thresholds.length + 1, rest.layerHeightMm) } }
          return { ...fix(s), configs: Object.fromEntries(Object.entries(s.configs ?? {}).map(([k, v]) => [k, fix(v)])) }
        },
        partialize: ({ images: _i, editLevel: _e, strokes: _s, ...rest }) => rest, // params + index + configs + autogen + tab; images (and their freeze) live in IndexedDB
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
/** Index of the background layer (the image's transparent pixels) in the layer list, or null without alpha. */
export const selectBackground = (s: State): number | null => (s.images[s.index]?.hasAlpha ? s.thresholds.length + 1 : null)
/** The layer being edited (locked or not, or the background), or null if none or it no longer exists. */
export const selectEditLevel = (s: State): number | null =>
  s.editLevel !== null && s.editLevel <= s.thresholds.length + (selectBackground(s) ? 1 : 0) ? s.editLevel : null
/** The layer the brush paints on: an image layer being edited; the background has no mask to paint. */
export const selectBrushLevel = (s: State): number | null => {
  const k = selectEditLevel(s)
  return k !== null && k <= s.thresholds.length ? k : null
}
/** Print layers of image level k, clamped to 1 mm; flipDepth mirrors the ladder, as the STL does. */
export const levelLayersAt = (p: Params, k: number) => {
  const i = p.flipDepth ? p.thresholds.length - k : k
  return Math.min(maxLayers(p.layerHeightMm), p.levelLayers[i] ?? i + 1)
}

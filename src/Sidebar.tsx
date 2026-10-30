import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { captureFreeze, fit, layerImages, thaw } from './image'
import { pickParams, selectEditLevel, selectImage, useStore } from './store'

function Thumb({ bitmap }: { bitmap: ImageBitmap }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const { w, h } = fit(bitmap, 96, 1)
    c.width = w
    c.height = h
    c.getContext('2d')!.drawImage(bitmap, 0, 0, c.width, c.height)
  }, [bitmap])
  return <canvas ref={ref} className="block max-h-24 max-w-full object-contain" />
}

/** Draw a layer mask white on dark gray at thumbnail size. */
function drawMask(c: HTMLCanvasElement, data: ImageData) {
  const { w, h } = fit(data, 128, 1)
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  ctx.fillStyle = '#555'
  ctx.fillRect(0, 0, w, h)
  const src = new OffscreenCanvas(data.width, data.height)
  src.getContext('2d')!.putImageData(data, 0, 0)
  ctx.drawImage(src, 0, 0, w, h)
}

const tab = (on: boolean) => `flex-1 border-b-2 px-2 py-1 text-sm ${on ? 'border-blue-600 font-semibold' : 'border-transparent text-gray-500'}`

function Layers() {
  const image = useStore(selectImage)
  const params = useStore(useShallow(pickParams))
  const freeze = image?.freeze ?? null
  const editLevel = useStore(selectEditLevel)
  const setEditLevel = useStore((s) => s.setEditLevel)
  const setFreeze = useStore((s) => s.setFreeze)
  const layers = params.thresholds.length + 1
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])
  // One frame of throttling, like the preview; one pipeline run (memoised) yields every layer.
  useEffect(() => {
    if (!image) return
    const id = requestAnimationFrame(() => layerImages(image.bitmap, params, freeze).forEach((data, j) => { const c = canvases.current[j]; if (c) drawMask(c, data) }))
    return () => cancelAnimationFrame(id)
  }, [image, params, freeze])
  if (!image) return <p className="p-2 text-xs text-gray-500">No image</p>
  const lock = (k: number, merge = false) => captureFreeze(image.bitmap, params, freeze, k, merge)
  const btn = (on: boolean) => `rounded border p-1 disabled:opacity-30 ${on ? 'border-blue-600 bg-blue-600 text-white' : 'border-gray-400'}`
  // Top layer first; layer 0 is the base slab (present everywhere), so it isn't listed.
  return Array.from({ length: layers - 1 }, (_, j) => {
    const k = j + 1
    const locked = freeze?.locked.includes(k) ?? false
    return (
      <div
        key={k}
        onClick={() => setEditLevel(editLevel === k ? null : k)}
        title={editLevel === k ? 'Show full preview' : 'Edit this layer'}
        className={`shrink-0 cursor-pointer rounded border-2 p-1 ${k === editLevel ? 'border-blue-600' : 'border-transparent'}`}
      >
        <canvas ref={(c) => { canvases.current[j] = c }} className="block h-auto w-full" />
        <div className="flex justify-between pt-1">
          <button
            aria-label={locked ? `Unlock layer ${k}` : `Lock layer ${k}`}
            aria-pressed={locked}
            onClick={(e) => { e.stopPropagation(); setFreeze(locked ? thaw(freeze!, k) : lock(k)) }}
            className={btn(locked)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="4" y="11" width="16" height="10" rx="2" fill={locked ? 'currentColor' : 'none'} />
              <path d={locked ? 'M8 11V7a4 4 0 0 1 8 0v4' : 'M8 11V7a4 4 0 0 1 7.5-2'} />
            </svg>
          </button>
          <button
            aria-label={`Add the preview's pixels to locked layer ${k}`}
            disabled={!locked}
            onClick={(e) => { e.stopPropagation(); setFreeze(lock(k, true)) }}
            className={btn(false)}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>
    )
  }).reverse()
}

export function Sidebar() {
  const images = useStore((s) => s.images)
  const index = useStore((s) => s.index)
  const select = useStore((s) => s.select)
  const remove = useStore((s) => s.remove)
  const clear = useStore((s) => s.clear)
  const view = useStore((s) => s.tab)
  const setView = useStore((s) => s.setTab)

  return (
    <nav className="flex w-full flex-col gap-2 md:w-32">
      <div className="flex">
        <button className={tab(view === 'images')} onClick={() => setView('images')}>Images</button>
        <button className={tab(view === 'layers')} onClick={() => setView('layers')}>Layers</button>
      </div>
      <div className="flex flex-row gap-2 overflow-auto md:flex-col">
        {view === 'layers' ? (
          <Layers />
        ) : (
          <>
            {images.map((img, i) => (
              <div
                key={img.id}
                onClick={() => select(i)}
                title={img.name}
                className={`shrink-0 cursor-pointer rounded border-2 p-1 ${i === index ? 'border-blue-600' : 'border-transparent'}`}
              >
                <div className="relative mx-auto w-fit">
                  <Thumb bitmap={img.bitmap} />
                  <button
                    aria-label={`Remove ${img.name}`}
                    onClick={(e) => { e.stopPropagation(); remove(i) }}
                    className="absolute top-0.5 right-0.5 rounded bg-white/80 p-0.5 opacity-50 hover:opacity-100 dark:bg-black/60"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6" />
                    </svg>
                  </button>
                </div>
                <p className="truncate text-xs text-gray-500 dark:text-gray-400">{img.name}</p>
              </div>
            ))}
            <button
              onClick={clear}
              disabled={index === -1}
              className="shrink-0 rounded border border-dashed border-gray-400 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-gray-600"
            >
              + NEW
            </button>
          </>
        )}
      </div>
    </nav>
  )
}

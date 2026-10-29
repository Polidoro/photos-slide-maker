import { useEffect, useRef } from 'react'
import { fit } from './image'
import { useStore } from './store'

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

export function Sidebar() {
  const images = useStore((s) => s.images)
  const index = useStore((s) => s.index)
  const select = useStore((s) => s.select)
  const remove = useStore((s) => s.remove)
  const clear = useStore((s) => s.clear)

  return (
    <nav className="flex w-full flex-row gap-2 overflow-auto md:w-32 md:flex-col">
      <button
        onClick={clear}
        disabled={index === -1}
        className="shrink-0 rounded border border-dashed border-gray-400 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-gray-600"
      >
        + NEW
      </button>
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
    </nav>
  )
}

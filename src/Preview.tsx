import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { quantizedImage } from './image'
import { pickParams, selectImage, useStore } from './store'

export function Preview({ opacity }: { opacity: number }) {
  const image = useStore(selectImage)?.bitmap
  const params = useStore(useShallow(pickParams))
  const locks = useStore((s) => s.locks)
  const ref = useRef<HTMLCanvasElement>(null)
  const src = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (!image) return
    const c = src.current!
    c.width = image.width
    c.height = image.height
    c.getContext('2d')!.drawImage(image, 0, 0)
  }, [image])

  // One frame of throttling coalesces slider ticks that arrive faster than the pipeline runs.
  useEffect(() => {
    if (!image) return
    const id = requestAnimationFrame(() => {
      const img = quantizedImage(image, params, locks)
      const canvas = ref.current!
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d')!.putImageData(img, 0, 0)
    })
    return () => cancelAnimationFrame(id)
  }, [image, params, locks])

  return (
    <div className="relative w-fit max-w-full">
      <canvas ref={ref} className="block h-auto max-h-[50vh] w-auto max-w-full [image-rendering:pixelated]" />
      <canvas ref={src} style={{ opacity }} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  )
}

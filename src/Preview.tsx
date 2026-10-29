import { useEffect, useRef } from 'react'
import { useShallow } from 'zustand/shallow'
import { quantizedImage } from './image'
import { pickParams, selectImage, useStore } from './store'

export function Preview({ opacity }: { opacity: number }) {
  const img = useStore(selectImage)
  const image = img?.bitmap
  const freeze = img?.freeze ?? null
  const checker = useStore((s) => (img?.hasAlpha ?? false) && s.baseMm === 'none') // transparent pixels in the output: show a checkerboard behind them
  const params = useStore(useShallow(pickParams))
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
      const img = quantizedImage(image, params, freeze)
      const canvas = ref.current!
      canvas.width = img.width
      canvas.height = img.height
      canvas.getContext('2d')!.putImageData(img, 0, 0)
    })
    return () => cancelAnimationFrame(id)
  }, [image, params, freeze])

  return (
    <div className="relative w-fit max-w-full">
      <canvas
        ref={ref}
        className={`block h-auto max-h-[50vh] w-auto max-w-full [image-rendering:pixelated] ${checker ? 'bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-[image:linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%),linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%)] dark:bg-[image:linear-gradient(45deg,#555_25%,transparent_25%,transparent_75%,#555_75%),linear-gradient(45deg,#555_25%,transparent_25%,transparent_75%,#555_75%)]' : ''}`}
      />
      <canvas ref={src} style={{ opacity }} className="pointer-events-none absolute inset-0 h-full w-full" />
    </div>
  )
}

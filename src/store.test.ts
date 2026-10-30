import { expect, test, vi } from 'vitest'

vi.mock('./db', () => ({ putImage: async () => {}, deleteImage: async () => {}, allImages: async () => [], patchImage: async () => {} })) // no IndexedDB in node
import { isParams, useStore } from './store'

test('undo/redo tracks params, one entry per drag, ignores non-param state', () => {
  const s = useStore.getState()
  const t = useStore.temporal.getState()
  t.clear()
  s.setParam('widthMm', 120)
  s.setParam('widthMm', 120) // identical: deduplicated
  s.setDragging(true)
  s.setParam('smoothing', 10)
  s.setParam('smoothing', 20)
  s.setParam('smoothing', 30)
  s.setDragging(false)
  s.setDragging(true)
  s.setDragging(false) // drag with no change: no entry
  expect(useStore.temporal.getState().pastStates.length).toBe(2)
  t.undo()
  expect(useStore.getState().smoothing).toBe(0)
  expect(useStore.getState().widthMm).toBe(120)
  t.undo()
  expect(useStore.getState().widthMm).toBe(164)
  t.redo()
  expect(useStore.getState().widthMm).toBe(120)
})

test('params are kept per image and restored on select', () => {
  const images = [{ id: 1 }, { id: 2 }] as never[]
  useStore.setState({ images, index: 0, configs: {} })
  const s = useStore.getState()
  s.setParam('widthMm', 50)
  s.select(1)
  expect(useStore.getState().widthMm).toBe(164) // fresh image: defaults
  s.setParam('widthMm', 70)
  s.select(0)
  expect(useStore.getState().widthMm).toBe(50)
  s.select(1)
  expect(useStore.getState().widthMm).toBe(70)
  expect(isParams(useStore.getState().configs[1])).toBe(true)
  expect(isParams({ ...useStore.getState().configs[1], frame: 'round' })).toBe(false)
})

test('eraser strokes undo/redo independently of params, and any other freeze change clears them', () => {
  const f = (k: number) => ({ locked: [k], w: 1, h: 1, bits: Uint16Array.of(1 << k) })
  useStore.setState({ images: [{ id: 9, freeze: f(2) }] as never[], index: 0, strokes: { past: [], future: [] } })
  const s = useStore.getState()
  s.commitStroke(f(3))
  s.commitStroke(f(4))
  expect(useStore.getState().images[0].freeze!.locked[0]).toBe(4)
  s.undoStroke()
  expect(useStore.getState().images[0].freeze!.locked[0]).toBe(3)
  s.redoStroke()
  expect(useStore.getState().images[0].freeze!.locked[0]).toBe(4)
  s.undoStroke(); s.undoStroke(); s.undoStroke() // past the start is a no-op
  expect(useStore.getState().images[0].freeze!.locked[0]).toBe(2)
  s.setFreeze(f(1)) // lock/thaw: history gone
  expect(useStore.getState().strokes.past.length).toBe(0)
})

import { expect, test } from 'vitest'
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

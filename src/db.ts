// Minimal IndexedDB store for uploaded image files, so the image list survives a refresh.
import type { Freeze } from './image'
export type ImageRecord = { id: number; name: string; blob: Blob; freeze?: Freeze | null }

let db: Promise<IDBDatabase> | undefined
function open() {
  return (db ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open('shademaker', 1)
    r.onupgradeneeded = () => r.result.createObjectStore('images', { keyPath: 'id' })
    r.onsuccess = () => res(r.result)
    r.onerror = () => rej(r.error)
  }))
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>) {
  const db = await open()
  return new Promise<T>((res, rej) => {
    const req = fn(db.transaction('images', mode).objectStore('images'))
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
}

export const putImage = (rec: ImageRecord) => run('readwrite', (s) => s.put(rec))
export const deleteImage = (id: number) => run('readwrite', (s) => s.delete(id))
export const allImages = () => run<ImageRecord[]>('readonly', (s) => s.getAll())
export async function patchImage(id: number, patch: Partial<ImageRecord>) {
  const rec = await run<ImageRecord | undefined>('readonly', (s) => s.get(id))
  if (rec) await putImage({ ...rec, ...patch })
}

import { expect, test } from 'vitest'
import { buildMesh, encodeStl } from './stl'
import { encode3mf } from './threemf'

/** Read the zip's local headers and inflate each entry, so the container is checked without a zip library. */
async function unzip(buf: ArrayBuffer) {
  const dv = new DataView(buf), out: Record<string, string> = {}
  for (let off = 0; dv.getUint32(off, true) === 0x04034b50; ) {
    const size = dv.getUint32(off + 18, true), n = dv.getUint16(off + 26, true)
    const name = new TextDecoder().decode(new Uint8Array(buf, off + 30, n))
    const data = new Uint8Array(buf.slice(off + 30 + n, off + 30 + n + size))
    out[name] = await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).text()
    off += 30 + n + size
  }
  expect(dv.getUint32(dv.byteLength - 22, true)).toBe(0x06054b50) // end-of-central-directory record is where it should be
  return out
}

test('3mf is a zip holding an indexed, watertight copy of the mesh', async () => {
  const w = 6, h = 5
  const heights = Float32Array.from({ length: w * h }, (_, i) => ((i * 7) % 11) / 10)
  const mesh = buildMesh(heights, w, h, { widthMm: 10, maxHeightMm: 5, baseMm: 2, thresholds: [1 / 6, 0.5, 5 / 6] })
  const buf = await encode3mf(mesh)
  expect(buf.byteLength).toBeLessThan(encodeStl(mesh).byteLength)
  const files = await unzip(buf)
  expect(Object.keys(files)).toEqual(['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model'])
  const xml = files['3D/3dmodel.model']
  expect(xml.match(/<vertex /g)!.length).toBeLessThan(mesh.length / 3)
  const edges = new Set<string>()
  for (const [, a, b, c] of xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"\/>/g))
    for (const e of [`${a}|${b}`, `${b}|${c}`, `${c}|${a}`]) { expect(edges.has(e), `duplicate ${e}`).toBe(false); edges.add(e) }
  expect(edges.size).toBe(mesh.length / 3)
  for (const e of edges) { const [p, q] = e.split('|'); expect(edges.has(`${q}|${p}`), `unmatched ${e}`).toBe(true) }
})

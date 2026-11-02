/**
 * 3MF from a flat triangle list (9 floats per triangle). Vertices are deduplicated by exact coordinates (the mesher
 * emits bit-identical floats for a shared vertex; rounding would merge the anti-sliver vertices and break the mesh)
 * and the XML is deflated with the browser's CompressionStream into a hand-rolled zip, so no dependency.
 */
export async function encode3mf(m: number[]): Promise<ArrayBuffer> {
  const index = new Map<string, number>()
  const verts: string[] = []
  const id = (x: number, y: number, z: number) => {
    const k = `${x},${y},${z}`
    let i = index.get(k)
    if (i === undefined) { i = verts.length; index.set(k, i); verts.push(`<vertex x="${x}" y="${y}" z="${z}"/>`) }
    return i
  }
  const tris: string[] = []
  for (let i = 0; i < m.length; i += 9) {
    const a = id(m[i], m[i + 1], m[i + 2]), b = id(m[i + 3], m[i + 4], m[i + 5]), c = id(m[i + 6], m[i + 7], m[i + 8])
    tris.push(`<triangle v1="${a}" v2="${b}" v3="${c}"/>`)
  }
  const model =
    `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">` +
    `<resources><object id="1" type="model"><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object></resources>` +
    `<build><item objectid="1"/></build></model>`
  return zip([
    ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>`],
    ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`],
    ['3D/3dmodel.model', model],
  ])
}

const CRC = Uint32Array.from({ length: 256 }, (_, n) => { for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; return n >>> 0 })
function crc32(b: Uint8Array) {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

const deflate = (b: Uint8Array<ArrayBuffer>) => new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer()

/** Minimal zip writer: deflated entries, no timestamps, no zip64. ponytail: fine up to 4 GB; the mesh dies long before that. */
async function zip(entries: [string, string][]): Promise<ArrayBuffer> {
  const enc = new TextEncoder()
  const parts: Uint8Array<ArrayBuffer>[] = [], central: Uint8Array<ArrayBuffer>[] = []
  let offset = 0
  for (const [name, text] of entries) {
    const raw = enc.encode(text), data = new Uint8Array(await deflate(raw)), nm = enc.encode(name), crc = crc32(raw)
    const head = (sig: number, extra: number) => {
      const h = new DataView(new ArrayBuffer(extra))
      h.setUint32(0, sig, true)
      return h
    }
    const local = head(0x04034b50, 30)
    local.setUint16(4, 20, true); local.setUint16(8, 8, true) // version 2.0, deflate
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, raw.length, true); local.setUint16(26, nm.length, true)
    const cd = head(0x02014b50, 46)
    cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(10, 8, true)
    cd.setUint32(16, crc, true); cd.setUint32(20, data.length, true); cd.setUint32(24, raw.length, true); cd.setUint16(28, nm.length, true); cd.setUint32(42, offset, true)
    parts.push(new Uint8Array(local.buffer), nm, data)
    central.push(new Uint8Array(cd.buffer), nm)
    offset += 30 + nm.length + data.length
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0)
  const end = new DataView(new ArrayBuffer(22))
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true)
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true)
  return new Blob([...parts, ...central, end.buffer as ArrayBuffer]).arrayBuffer()
}

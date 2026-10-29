import cdt2d from 'cdt2d'

export type Opts = { widthMm: number; heightMm?: number; maxHeightMm: number; baseMm: number; thresholds: number[] } // thresholds ascending, 0..1; heightMm defaults to the grid aspect

type V = { x: number; y: number; v: number; e: number; k: number } // e: original edge index of outgoing edge, -1 = chord at threshold k

/**
 * Terraced mesh. `heights` is the continuous 0..1 field; level = number of thresholds at or below it.
 * Every grid cell is split into two triangles; each triangle is clipped by the level thresholds
 * (linear field, so all regions are convex). The clipped regions supply the sub-pixel contour
 * vertices, walls and border bands; their outline edges are chained into rings per level and each
 * terrace is triangulated once as a polygon with holes (earcut), so flat areas cost no triangles.
 */
export function buildMesh(heights: Float32Array, w: number, h: number, { widthMm, heightMm, maxHeightMm, baseMm, thresholds }: Opts): number[] {
  const steps = thresholds.length
  const s = widthMm / (w - 1)
  const sy = heightMm ? heightMm / (h - 1) : s
  const zOf = (k: number) => (k < 0 ? 0 : baseMm + (k * maxHeightMm) / steps)
  const thr = (k: number) => thresholds[k - 1] // boundary between level k-1 and k
  const levels = Uint8Array.from(heights, (v) => { let n = 0; for (const t of thresholds) if (v >= t) n++; return n })
  const lvl = (i: number) => levels[i]
  const X = (i: number) => (i % w) * s
  const Y = (i: number) => (h - 1 - Math.floor(i / w)) * sy // image top at +Y so the print is not mirrored
  const out: number[] = []
  // Y is flipped relative to image rows, so swap b/c to keep normals outward.
  const tri = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number) =>
    out.push(ax, ay, az, cx, cy, cz, bx, by, bz)

  // Canonical crossing of threshold k on the pixel edge a–b: same floats from either side.
  function cross(a: number, b: number, k: number) {
    const [p, q] = a < b ? [a, b] : [b, a]
    const vp = heights[p], vq = heights[q]
    // ponytail: clamp keeps a value exactly on a threshold from producing a zero-area sliver
    const f = Math.min(1 - 1e-4, Math.max(1e-4, (thr(k) - vp) / (vq - vp)))
    return { x: X(p) + f * (X(q) - X(p)), y: Y(p) + f * (Y(q) - Y(p)) }
  }

  // Sutherland–Hodgman against v >= thr(k) (above) or v < thr(k) (!above). Chords have v == some threshold, never crossed.
  function clip(poly: V[], edges: [number, number][], k: number, above: boolean): V[] {
    const t = thr(k)
    const res: V[] = []
    for (let i = 0; i < poly.length; i++) {
      const cur = poly[i], nxt = poly[(i + 1) % poly.length]
      const inC = cur.v >= t === above, inN = nxt.v >= t === above
      if (inC) res.push(cur)
      if (inC !== inN) {
        const [a, b] = edges[cur.e]
        const c = cross(a, b, k)
        res.push({ x: c.x, y: c.y, v: t, e: inC ? -1 : cur.e, k })
      }
    }
    return res
  }

  const ringEdges: number[][] = Array.from({ length: steps + 1 }, () => []) // per level: x0,y0,x1,y1 per directed edge

  function triangle(i0: number, i1: number, i2: number, b0: boolean, b1: boolean, b2: boolean) {
    const edges: [number, number][] = [[i0, i1], [i1, i2], [i2, i0]]
    const boundary = [b0, b1, b2]
    let poly: V[] = [i0, i1, i2].map((i, e) => ({ x: X(i), y: Y(i), v: heights[i], e, k: 0 }))
    const lo = Math.min(lvl(i0), lvl(i1), lvl(i2)), hi = Math.max(lvl(i0), lvl(i1), lvl(i2))
    for (let k = lo; k <= hi; k++) {
      const region = k < hi ? clip(poly, edges, k + 1, false) : poly
      if (k < hi) poly = clip(poly, edges, k + 1, true)
      const z = zOf(k)
      for (let i = 0; i < region.length; i++) {
        const a = region[i], b = region[(i + 1) % region.length]
        // Outline edges (chords and image-border pieces) bound the terrace; interior grid edges are skipped.
        if (a.e === -1 || boundary[a.e]) ringEdges[k].push(a.x, a.y, b.x, b.y)
        if (a.e === -1 && a.k === k + 1) {
          // step wall up to the next terrace, facing the lower side
          const z1 = zOf(k + 1)
          tri(a.x, a.y, z, a.x, a.y, z1, b.x, b.y, z1)
          tri(a.x, a.y, z, b.x, b.y, z1, b.x, b.y, z)
        } else if (a.e >= 0 && boundary[a.e]) {
          // outer wall, one band per level so vertical edges match neighbours exactly
          for (let j = 0; j <= k; j++) {
            const z0 = zOf(j - 1), z1 = zOf(j)
            tri(a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1)
            tri(a.x, a.y, z0, b.x, b.y, z1, a.x, a.y, z1)
          }
        }
      }
    }
  }

  for (let r = 0; r < h - 1; r++)
    for (let c = 0; c < w - 1; c++) {
      const tl = r * w + c, tr = tl + 1, bl = tl + w, br = bl + 1
      // ponytail: fixed TL–BR diagonal; saddle cells resolve toward that diagonal
      triangle(tl, tr, br, r === 0, c === w - 2, false)
      triangle(tl, br, bl, false, r === h - 2, c === 0)
    }

  // tops: one polygon triangulation per terrace ring set
  for (let k = 0; k <= steps; k++) for (const t of triangulate(ringEdges[k])) {
    const z = zOf(k)
    tri(t[0], t[1], z, t[2], t[3], z, t[4], t[5], z)
  }

  // bottom: perimeter (with every crossing) fanned from the center, reversed winding
  const per: number[] = []
  for (let c = 0; c < w - 1; c++) per.push(c)
  for (let r = 0; r < h - 1; r++) per.push(r * w + w - 1)
  for (let c = w - 1; c > 0; c--) per.push((h - 1) * w + c)
  for (let r = h - 1; r > 0; r--) per.push(r * w)
  const ring: { x: number; y: number }[] = []
  for (let i = 0; i < per.length; i++) {
    const a = per[i], b = per[(i + 1) % per.length]
    ring.push({ x: X(a), y: Y(a) })
    const la = lvl(a), lb = lvl(b)
    if (la < lb) for (let k = la + 1; k <= lb; k++) ring.push(cross(a, b, k))
    else for (let k = la; k > lb; k--) ring.push(cross(a, b, k))
  }
  const cx = X(w - 1) / 2, cy = Y(0) / 2
  for (let i = 0; i < ring.length; i++) {
    const p = ring[i], q = ring[(i + 1) % ring.length]
    tri(cx, cy, 0, q.x, q.y, 0, p.x, p.y, 0)
  }
  return out
}

export function buildStl(heights: Float32Array, w: number, h: number, opts: Opts): ArrayBuffer {
  const m = buildMesh(heights, w, h, opts)
  const tris = m.length / 9
  const buf = new ArrayBuffer(84 + 50 * tris)
  const dv = new DataView(buf)
  dv.setUint32(80, tris, true)
  for (let t = 0, off = 84; t < tris; t++, off += 50) {
    const i = 9 * t
    const ux = m[i + 3] - m[i], uy = m[i + 4] - m[i + 1], uz = m[i + 5] - m[i + 2]
    const vx = m[i + 6] - m[i], vy = m[i + 7] - m[i + 1], vz = m[i + 8] - m[i + 2]
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
    const len = Math.hypot(nx, ny, nz) || 1
    dv.setFloat32(off, nx / len, true)
    dv.setFloat32(off + 4, ny / len, true)
    dv.setFloat32(off + 8, nz / len, true)
    for (let j = 0; j < 9; j++) dv.setFloat32(off + 12 + 4 * j, m[i + j], true)
    dv.setUint16(off + 48, 0, true)
  }
  return buf
}

/**
 * Triangulate the terrace bounded by `edges` (x0,y0,x1,y1 per directed edge, region on the right as the Y-flipped
 * mesher emits them). Constrained Delaunay keeps every input vertex and classifies the inside by even-odd parity,
 * so nested rings, holes and touching lobes need no special handling. Returns [ax, ay, bx, by, cx, cy] per triangle
 * with the same winding as the input edges.
 */
export function triangulate(edges: number[]): number[][] {
  if (!edges.length) return []
  const index = new Map<string, number>()
  const points: [number, number][] = []
  const id = (x: number, y: number) => {
    const k = `${x},${y}`
    let i = index.get(k)
    if (i === undefined) { i = points.length; index.set(k, i); points.push([x, y]) }
    return i
  }
  const constraints: [number, number][] = []
  for (let e = 0; e < edges.length; e += 4) constraints.push([id(edges[e], edges[e + 1]), id(edges[e + 2], edges[e + 3])])
  const tris: number[][] = []
  // delaunay: false — the flipping pass is very slow on large rings and flat tops don't need Delaunay quality
  for (const [a, b, c] of cdt2d(points, constraints, { exterior: false, delaunay: false })) {
    const [ax, ay] = points[a], [bx, by] = points[b], [cx, cy] = points[c]
    const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
    if (area === 0) continue
    tris.push(area < 0 ? [ax, ay, bx, by, cx, cy] : [ax, ay, cx, cy, bx, by])
  }
  return tris
}

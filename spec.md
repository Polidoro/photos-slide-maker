# Spec: Heightmap to STL (client-side)

## Goal
A single-page web app that takes a grayscale (or color, converted to grayscale) image and produces a watertight binary STL where each pixel becomes a column whose height is proportional to its intensity. Everything runs in the browser. No server, no upload.

## Stack
- Vite + React 19 + TypeScript (`npm create vite@latest -- --template react-ts`)
- Tailwind CSS v4 via `@tailwindcss/vite`
- Zustand v5 for app state, with the `persist` middleware
- react-range for the multi-handle levels control
- react-tooltip for the slider help icons
- cdt2d for triangulating terrace polygons
- zundo for undo/redo of parameter changes
- Vitest (dev dependency) for the one unit test
- Any other useful runtime dependencies

## Features (in scope)
1. **Load image**: `<input type="file" accept="image/*">` plus drag-and-drop onto the page. Decode with `createImageBitmap`, draw to an offscreen canvas, read pixels with `getImageData`. Alpha is ignored during processing (RGB is used as decoded). After all processing, pixels with alpha below 50% are set to the Background gray, independent of Invert and the levels range.
2. **Grayscale conversion**: luminance `0.299 r + 0.587 g + 0.114 b`, normalized to 0..1.
3. **Parameters** (listed in the order the pipeline applies them; the right-hand controls follow the same order):
   - Invert Image (checkbox, right-aligned on the Range slider's label row). When on, `intensity = 1 - intensity`.
   - Range: a two-handle slider (`react-range`, black-to-white track) for `levelMin`/`levelMax` in percent (default 0–100). Intensity is rescaled into this range after invert.
   - Levels: a full-width multi-handle slider with `layers - 1` handles, stored as `thresholds` in percent (default evenly spaced). A pixel's level is the number of thresholds at or below its intensity. Moving Layers re-spaces them evenly. Handles cannot coincide. The track is shaded with each section's output gray.
   - Layers (slider 2–12, default 4). Number of flat terraces = number of sections in the Levels range.
   - Median (slider 0–10% in 0.01 steps, default 0 = off). Square-window median on the continuous field, radius up to 5% of the long edge, clamp-to-edge; removes speckle. Applied first.
   - Bilateral (slider 0–100%, default 0 = off). Distance × intensity-similarity weighted average (window sparsely sampled above radius 6), radius as above, with an Edge tolerance slider (1–50%, default 10, shown when Bilateral > 0) for the intensity sigma; denoises flat areas, keeps edges. Applied after Median.
   - Band tolerance (slider 0–20% in 0.5 steps, default 0 = off). Hysteresis around each threshold: pixels within ±tolerance of a threshold take the upper level only where they 4-connect to a pixel clearly above it. Stops noise near a threshold from flickering between levels.
   - Min feature (slider 0.00–5.00 mm in 0.01 steps, default 0 = off). After hysteresis, each layer mask has 4-connected islands and holes with area below `(minFeature × px/mm)²` flipped, so nothing narrower than this prints.
   - Outline smoothing (slider 0–10% in 0.01 steps, default 0). Applied last, after Min feature: for every threshold, the binary mask "intensity ≥ threshold" is blurred with the canvas `blur()` filter (radius up to 5% of the long edge, mirror-tiled 3×3 so edges don't fade), masks are forced to nest and summed, and the sum is mapped piecewise-linearly back to the intensity scale so that sum `k-0.5` lands on threshold `k`. Its isolines at the thresholds are the smoothed mask outlines, so no intermediate layers appear along edges. Short grid edge clamped to a minimum of 2.
   - Frame (select: None, Flat, Tapered, Mixed; default None). Applied last: the outer 1 mm of the image is replaced by a border. Flat is 1 mm high (rounded to whole print layers); Tapered slopes from 1 mm at its inner edge down to one layer height at the outer edge, stepped per print layer; Mixed has flat sides and tapered top and bottom, the taper winning in the corners. Width, Height and the rest of the image are unchanged.
   - Background (single-handle slider under Levels, track shaded like Levels so the handle shows which layer transparent pixels land on, shown only for images with an alpha channel; percent, default 0). The gray transparent pixels become.
   - Width / Height in mm (default 164 × 128, so unlinked by default), one row. Both inputs commit on blur or Enter, so a linked partner only changes once typing is done. Width is the X axis (image columns); Height is the Y axis. A link icon between them (on by default) ties Height to Width by the image aspect ratio: editing either sets `widthMm`, rounded to whole mm, and the other is derived. Clicking the icon unlinks (`heightMm` set, icon dimmed) so the two are independent and the model is stretched; the grid keeps the image aspect.
   - Layer Height (select: 0.05 mm steps up to 1.00 mm, default 0.15) and Nozzle (select: 0.2, 0.4, 0.6 mm, default 0.4), one row directly above the Download button. The working grid's long edge is `clamp(round(widthMm / (nozzle/2)), 64, 1024)` pixels, i.e. one pixel per half nozzle width (`gridSize` in `image.ts`). Each colour level is one print layer and the darkest level is the base itself, so total height = `layers * layerHeight`.
4. **Preview**: 2D canvas showing the downsampled, quantized grayscale image. Fills the panel width with `image-rendering: pixelated`. No 3D preview.
5. **Export**: "Download STL" button. Generates binary STL and triggers a download named `<original-name-without-extension>.stl`.
6. **Stats line**: triangle count and file size of the current mesh. The mesh is rebuilt (debounced) when the image changes or when zundo records, undoes or redoes a parameter change, so never mid-drag and never for a no-op change; it is cached for download.
7. **Persistence**: parameters are kept per image (`configs`, keyed by image id; the top-level params mirror the current image's and switching images loads its saved config or the defaults and clears undo history) and persist with the selected index via Zustand `persist` (localStorage). "Copy State" / "Load State" buttons move the current params through the clipboard as JSON, validated by `isParams`. A "Source Opacity" slider on the file-name row overlays the original image (not persisted). The preview is capped at 50% of the viewport height. Each section of the Levels slider is captioned with its print depth, `(level+1) × layerHeight`. Tone sliders (Contrast, Saturation as canvas filters; Lightness, Gamma, Shadows, Highlights via `tone()` in `image.ts`) run before the gray conversion and levels. Dropping an image anywhere in the window adds it as a new image, even when one is loaded. Uploaded files persist as blobs in IndexedDB (`src/db.ts`) and are re-decoded on startup, so the image list survives a refresh.
8. **Undo/redo**: zundo `temporal` middleware tracks only the parameters (the state that triggers an STL build), up to 100 steps, deduplicating identical states. History is paused while a slider is dragged; on release one entry (the pre-drag state) is added if anything changed. Keyboard only: Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z and Ctrl+Y (ignored while focus is in a text input).
9. **Image history**: every loaded image stays in a left sidebar with thumbnails; click to select, trash icon to remove, "+ NEW" returns to the drop zone. A Reset (parameters to defaults) sits above the controls.

## Out of scope
3D preview, ASCII STL, multiple files, routing, server code, tests beyond the one noted below.

## Mesh generation (`src/stl.ts`, pure functions, no React)
```ts
export function buildStl(heights: Float32Array, w: number, h: number, opts: {
  widthMm: number; heightMm?: number; maxHeightMm: number; baseMm: number; thresholds: number[];
}): ArrayBuffer
```
- `heights` is row-major, length `w*h`, a continuous field in layer-index units produced by `frameField` in `image.ts`: image level `k` maps to `k`, thresholds sit at half-integers, and frame cells take their own index. `w, h >= 2`.
- The model is a stack of `thresholds.length + 1` flat terraces. Pixel level = number of thresholds `≤ v`; terrace `k` sits at `z = baseMm + k * maxHeightMm/steps`. `frameField` sets `baseMm = layerHeight` and one level per print layer up to the taller of the image top (`layers * layerHeight`) and the 1 mm frame.
- Terrace outlines are sub-pixel isolines, not pixel edges: each grid cell is split into two triangles (fixed TL–BR diagonal) and each triangle is clipped by the thresholds with linear interpolation along its edges. Crossing points are computed from the canonical pixel pair so neighbouring triangles share identical vertices.
- The clipped regions are not emitted as tops. Their outline edges (chords and image-border pieces) are collected per level and each terrace is triangulated once with `cdt2d` (constrained Delaunay, robust predicates, even-odd interior classification), so flat areas cost no triangles and holes/islands need no special handling. Every outline vertex is kept, so tops match walls exactly.
- Walls: a quad along each chord from the lower to the upper terrace, facing the lower side; along image-border edges, one wall band per level from `z=0` up, so vertical edges always match the neighbour's.
- Bottom: at `z=0`, a fan from the center across the border polygon including every border crossing point, winding reversed.
- Normals: per triangle from the cross product, normalized.
- Output: 80-byte header, uint32 triangle count, then 50 bytes per triangle, little-endian, via `DataView`.
- Must be watertight and consistently oriented: the unit test checks that every directed edge has exactly one reversed twin and the signed volume is positive.

## State (`src/store.ts`)
One Zustand store:
```ts
{
  images: { id: number; bitmap: ImageBitmap; name: string; hasAlpha: boolean }[]; index: number; // -1 = none selected
  contrast: number; saturation: number; lightness: number; gamma: number; shadows: number; highlights: number; median: number; bilateral: number; edgeTolerance: number; smoothing: number; hysteresis: number; widthMm: number; heightMm: number | null; invert: boolean; levelMin: number; levelMax: number; minFeatureMm: number; background: number; thresholds: number[]; layerHeightMm: number; nozzleMm: number; frame: 'none' | 'flat' | 'tapered' | 'mixed';
  addImage(file); hydrate(); select(i); remove(i); clear(); reset(); setLayers(n); setParam<K>(key: K, value: Params[K]);
}
```
Wrapped in `temporal` (params only) and `persist` with `partialize` so parameters and `index` are stored; `images` are rebuilt from IndexedDB by `hydrate()` on mount. Components select one field per `useStore` call. No selector returns a fresh object.

## Components (`src/`)
- `App.tsx`: layout, drop zone wiring.
- `Controls.tsx`: the parameter inputs plus the download button and stats line. Hovering a slider label shows a react-tooltip explaining what it does.
- `Levels.tsx`: the Range and Levels sliders, rendered under the preview for width.
- `Preview.tsx`: canvas that redraws (one-frame throttled) when the image or any parameter changes. Exposes nothing; the export path recomputes heights itself via a shared `sampleHeights(image, params)` helper in `src/image.ts`.
- `image.ts`: `sampleHeights` returns `{ heights, w, h, opts }` (`opts` are the mesher options from `frameField`), memoized on (image, params) so the preview and the STL build share one pipeline run. `quantizedImage` renders it to pixels; `fit` is the shared long-edge scaling.
- `download.ts`: `downloadBlob(buf, name)`.
- `db.ts`: `putImage`, `deleteImage`, `allImages` over one IndexedDB object store.

## UX
- Empty state: large dashed drop zone with "Drop an image or click to choose".
- After load: sidebar left; middle column top-aligned with the file name (left) and input resolution (right) above the preview, then the Range and Levels sliders; controls right. Stacks vertically under 768px.
- Download button disabled until an image is loaded. Show a brief "Generating…" state during build (run `buildStl` in a `setTimeout(0)` or a Web Worker if it blocks the UI noticeably at the 1024 px grid cap; a worker is acceptable but not required).
- Dark mode via Tailwind `dark:` following `prefers-color-scheme`.

## Verification
- `npm run build` and `npx tsc --noEmit` pass with zero errors.
- Vitest tests for `buildStl` (box triangle count, watertight/oriented terraced meshes including on-threshold values, saddles and all three frames) and `frameField`.
- Manual: load a photo, export, open in a slicer (PrusaSlicer/Cura/Bambu Studio) with no "mesh repaired" warning.

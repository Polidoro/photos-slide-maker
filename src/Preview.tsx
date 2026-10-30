import { useEffect, useRef } from "react";
import { useShallow } from "zustand/shallow";
import { brushFreeze, captureFreeze, fit, freezeLayerImage, gridSize, layerImage, levelAt, quantizedImage, type BrushMode, type Freeze } from "./image";
import { pickParams, selectEditLevel, selectImage, useStore, type Params } from "./store";

// Edit view: a layer mask (at whatever grid it was captured on) scaled nearest onto the current grid to keep the canvas size steady.
function drawLayer(canvas: HTMLCanvasElement, data: ImageData, image: ImageBitmap, p: Params) {
  const { w, h } = fit(image, gridSize(p.widthMm, p.nozzleMm));
  const layer = new OffscreenCanvas(data.width, data.height);
  layer.getContext("2d")!.putImageData(data, 0, 0);
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(layer, 0, 0, w, h);
}

export function Preview({ opacity, brush, mode, onBrush }: { opacity: number; brush: number; mode: BrushMode; onBrush: (r: number) => void }) {
  const img = useStore(selectImage);
  const image = img?.bitmap;
  const freeze = img?.freeze ?? null;
  // Edit mode: show one locked layer by itself instead of the composited output.
  const editLevel = useStore(selectEditLevel);
  const checker = useStore(
    (s) => editLevel !== null || ((img?.hasAlpha ?? false) && s.baseMm === "none"),
  ); // transparent pixels in the output: show a checkerboard behind them

  const params = useStore(useShallow(pickParams));
  const commitStroke = useStore((s) => s.commitStroke);
  const setEditLevel = useStore((s) => s.setEditLevel);
  // Brush and ring are in cells of the grid a stroke paints on: the freeze's if the layer is locked, else the current grid (it locks on the first stroke).
  const cells = editLevel !== null && freeze?.locked.includes(editLevel) ? freeze.w : image ? fit(image, gridSize(params.widthMm, params.nozzleMm)).w : 1;
  const cursor = useRef<HTMLDivElement>(null); // red ring showing the erase area; moved via the DOM to skip re-renders
  const stroke = useRef<Freeze | null>(null); // in-progress brush stroke; committed to the store on pointer up

  // Wheel over the canvas in edit mode resizes the brush (down = bigger). Native listener so the page scroll can be prevented.
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || editLevel === null) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const next = Math.min(10, Math.max(1, brush + Math.sign(e.deltaY)));
      if (next === brush) return;
      onBrush(next);
      const c = cursor.current;
      if (!c || c.style.display === "none") return;
      const rect = canvas.getBoundingClientRect();
      const d = (2 * next * rect.width) / cells; // resize the ring in place, keeping its centre
      c.style.width = c.style.height = `${d}px`;
      c.style.left = `${e.clientX - rect.left - d / 2}px`;
      c.style.top = `${e.clientY - rect.top - d / 2}px`;
    };
    canvas.addEventListener("wheel", wheel, { passive: false });
    return () => canvas.removeEventListener("wheel", wheel);
  }, [editLevel, cells, onBrush, brush]);
  const ref = useRef<HTMLCanvasElement>(null);
  const src = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!image) return;
    const c = src.current!;
    c.width = image.width;
    c.height = image.height;
    c.getContext("2d")!.drawImage(image, 0, 0);
  }, [image]);

  // One frame of throttling coalesces slider ticks that arrive faster than the pipeline runs.
  useEffect(() => {
    if (!image) return;
    const id = requestAnimationFrame(() => {
      const canvas = ref.current!;
      if (editLevel !== null) return drawLayer(canvas, layerImage(image, params, freeze, editLevel), image, params);
      const img = quantizedImage(image, params, freeze);
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d")!.putImageData(img, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [image, params, freeze, editLevel]);

  // Brush: paint into a local copy and redraw just this canvas per move; one store write (and IndexedDB save) per stroke.
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    const f = stroke.current;
    if (!f || editLevel === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next = brushFreeze(f, editLevel, ((e.clientX - rect.left) / rect.width) * f.w, ((e.clientY - rect.top) / rect.height) * f.h, brush, mode);
    stroke.current = next;
    drawLayer(e.currentTarget, freezeLayerImage(next, editLevel), image!, params);
  }
  const endStroke = () => {
    if (stroke.current && stroke.current !== freeze) commitStroke(stroke.current);
    stroke.current = null;
  };
  function moveCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = cursor.current;
    if (!c) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const d = (2 * brush * rect.width) / cells; // brush is in grid cells; ring is in CSS px
    c.style.display = "block";
    c.style.width = c.style.height = `${d}px`;
    c.style.left = `${e.clientX - rect.left - d / 2}px`;
    c.style.top = `${e.clientY - rect.top - d / 2}px`;
  }

  return (
    <div className="relative w-fit max-w-full">
      <canvas
        ref={ref}
        style={editLevel !== null ? { cursor: "none", touchAction: "none" } : { cursor: "pointer" }}
        onPointerDown={(e) => {
          if (editLevel === null) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          // Editing an unlocked layer locks it first, so the stroke has a mask to paint on.
          stroke.current = freeze?.locked.includes(editLevel) ? freeze : captureFreeze(image!, params, freeze, editLevel);
          paint(e);
        }}
        onClick={(e) => {
          if (editLevel !== null || !image) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const k = levelAt(image, params, freeze, ((e.clientX - rect.left) / rect.width) * e.currentTarget.width, ((e.clientY - rect.top) / rect.height) * e.currentTarget.height);
          if (k >= 0) setEditLevel(k); // transparent pixels belong to no layer
        }}
        onPointerMove={(e) => {
          if (editLevel === null) return;
          moveCursor(e);
          if (e.buttons & 1) paint(e);
        }}
        onPointerLeave={() => cursor.current && (cursor.current.style.display = "none")}
        onPointerUp={endStroke}
        onPointerCancel={endStroke}
        className={`block h-auto max-h-[75vh] w-auto max-w-full [image-rendering:pixelated] ${checker ? "bg-[length:16px_16px] bg-[position:0_0,8px_8px] bg-[image:linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%),linear-gradient(45deg,#ccc_25%,transparent_25%,transparent_75%,#ccc_75%)] dark:bg-[image:linear-gradient(45deg,#555_25%,transparent_25%,transparent_75%,#555_75%),linear-gradient(45deg,#555_25%,transparent_25%,transparent_75%,#555_75%)]" : ""}`}
      />
      {editLevel !== null && (
        <div ref={cursor} className={`pointer-events-none absolute hidden rounded-full border-2 ${mode === "add" ? "border-blue-500" : "border-red-500"}`} />
      )}
      <canvas
        ref={src}
        style={{ opacity: editLevel !== null ? 0 : opacity }}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </div>
  );
}

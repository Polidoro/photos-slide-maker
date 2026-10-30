import { useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/shallow";
import { brushFreeze, freezeLayerImage, quantizedImage, type BrushMode, type Freeze } from "./image";
import { pickParams, selectEditLevel, selectImage, useStore } from "./store";

export function Preview({ opacity, brush, mode }: { opacity: number; brush: number; mode: BrushMode }) {
  const img = useStore(selectImage);
  const image = img?.bitmap;
  const freeze = img?.freeze ?? null;
  // Pencil toggle: show one frozen level by itself instead of the composited output.
  const editLevel = useStore(selectEditLevel);
  // Holding Shift in edit mode targets the level above (if there is one) for viewing, erasing and adding.
  const [shift, setShift] = useState(false);
  const layers = useStore((s) => s.thresholds.length + 1);
  const level = editLevel !== null && shift && editLevel + 1 < layers ? editLevel + 1 : editLevel;
  const brushMode: BrushMode = shift ? "add" : mode; // Shift also forces Add, so a quick Shift-drag fills from the layer above
  useEffect(() => {
    if (editLevel === null) return;
    const on = (e: KeyboardEvent) => e.key === "Shift" && setShift(e.type === "keydown");
    const off = () => setShift(false);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    window.addEventListener("blur", off);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", on);
      window.removeEventListener("blur", off);
      setShift(false);
    };
  }, [editLevel]);
  const checker = useStore(
    (s) => editLevel !== null || ((img?.hasAlpha ?? false) && s.baseMm === "none"),
  ); // transparent pixels in the output: show a checkerboard behind them

  const params = useStore(useShallow(pickParams));
  const commitStroke = useStore((s) => s.commitStroke);
  const cursor = useRef<HTMLDivElement>(null); // red ring showing the erase area; moved via the DOM to skip re-renders
  const stroke = useRef<Freeze | null>(null); // in-progress brush stroke; committed to the store on pointer up
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
      const img =
        level !== null
          ? freezeLayerImage(freeze!, level, params.thresholds.length)
          : quantizedImage(image, params, freeze);
      const canvas = ref.current!;
      canvas.width = img.width;
      canvas.height = img.height;
      canvas.getContext("2d")!.putImageData(img, 0, 0);
    });
    return () => cancelAnimationFrame(id);
  }, [image, params, freeze, level]);

  // Brush: paint into a local copy and redraw just this canvas per move; one store write (and IndexedDB save) per stroke.
  function paint(e: React.PointerEvent<HTMLCanvasElement>) {
    const f = stroke.current;
    if (!f || level === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const next = brushFreeze(f, level, ((e.clientX - rect.left) / rect.width) * f.w, ((e.clientY - rect.top) / rect.height) * f.h, brush, brushMode);
    stroke.current = next;
    e.currentTarget.getContext("2d")!.putImageData(freezeLayerImage(next, level, params.thresholds.length), 0, 0);
  }
  const endStroke = () => {
    if (stroke.current && stroke.current !== freeze) commitStroke(stroke.current);
    stroke.current = null;
  };
  function moveCursor(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = cursor.current;
    if (!c || !freeze) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const d = (2 * brush * rect.width) / freeze.w; // brush is in freeze cells; ring is in CSS px
    c.style.display = "block";
    c.style.width = c.style.height = `${d}px`;
    c.style.left = `${e.clientX - rect.left - d / 2}px`;
    c.style.top = `${e.clientY - rect.top - d / 2}px`;
  }

  return (
    <div className="relative w-fit max-w-full">
      <canvas
        ref={ref}
        style={editLevel !== null ? { cursor: "none", touchAction: "none" } : undefined}
        onPointerDown={(e) => {
          if (editLevel === null || !freeze) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          stroke.current = freeze;
          paint(e);
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
        <div ref={cursor} className={`pointer-events-none absolute hidden rounded-full border-2 ${brushMode === "add" ? "border-blue-500" : "border-red-500"}`} />
      )}
      <canvas
        ref={src}
        style={{ opacity: editLevel !== null ? 0 : opacity }}
        className="pointer-events-none absolute inset-0 h-full w-full"
      />
    </div>
  );
}

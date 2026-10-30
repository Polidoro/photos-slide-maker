import { useEffect, useRef, useState } from "react";
import { Controls } from "./Controls";
import { IconButton, Levels } from "./Levels";
import type { BrushMode } from "./image";
import { Preview } from "./Preview";
import { Sidebar } from "./Sidebar";
import { selectEditLevel, selectImage, useStore } from "./store";

export default function App() {
  const image = useStore(selectImage);
  const addImage = useStore((s) => s.addImage);
  const hydrate = useStore((s) => s.hydrate);
  const setDragging = useStore((s) => s.setDragging);
  const input = useRef<HTMLInputElement>(null);
  const [opacity, setOpacity] = useState(0);
  const [brush, setBrush] = useState(4); // brush radius in freeze cells
  const [mode, setMode] = useState<BrushMode>("erase");
  const editing = useStore(selectEditLevel) !== null;
  useEffect(() => {
    hydrate();
  }, [hydrate]);
  useEffect(() => {
    const up = () => setDragging(false);
    const key = (e: KeyboardEvent) => {
      if (
        !(e.metaKey || e.ctrlKey) ||
        (e.target as HTMLElement).tagName === "INPUT"
      )
        return;
      // While a layer is being edited, undo/redo apply to eraser strokes instead of params.
      const st = useStore.getState();
      const { undo, redo } =
        selectEditLevel(st) !== null
          ? { undo: st.undoStroke, redo: st.redoStroke }
          : useStore.temporal.getState();
      if (e.key === "z" && e.shiftKey) {
        e.preventDefault();
        redo();
      } else if (e.key === "z") {
        e.preventDefault();
        undo();
      } else if (e.key === "y") {
        e.preventDefault();
        redo();
      }
    };
    for (const ev of ["pointerup", "pointercancel", "blur"])
      window.addEventListener(ev, up);
    window.addEventListener("keydown", key);
    return () => {
      for (const ev of ["pointerup", "pointercancel", "blur"])
        window.removeEventListener(ev, up);
      window.removeEventListener("keydown", key);
    };
  }, [setDragging]);

  function load(file: File | undefined) {
    if (file?.type.startsWith("image/")) addImage(file);
  }
  // Window-level so a drop anywhere (even outside <main>, or onto a loaded preview) adds a new image.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      load(e.dataTransfer?.files[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  });

  return (
    <main className="flex min-h-screen flex-col gap-6 bg-white p-6 text-gray-900 md:flex-row dark:bg-gray-900 dark:text-gray-100">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          load(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      <Sidebar />
      <div className="flex flex-1 flex-col items-center gap-4">
        {image ? (
          <>
            <div className="flex w-full items-center justify-between gap-4 text-sm">
              <span className="truncate" title={image.name}>
                {image.name}
              </span>
              {editing ? (
                <label className="flex shrink-0 items-center gap-2">
                  <IconButton label="Erase pixels" active={mode === "erase"} onClick={() => setMode("erase")}>
                    <path d="M20 20H8L3 15a2 2 0 0 1 0-3l9-9a2 2 0 0 1 3 0l5 5a2 2 0 0 1 0 3l-7 7" />
                    <path d="M7 11l6 6" />
                  </IconButton>
                  <IconButton label="Add pixels" active={mode === "add"} onClick={() => setMode("add")}>
                    <path d="M12 5v14M5 12h14" />
                  </IconButton>
                  <input
                    type="range"
                    min={1}
                    max={10}
                    step={1}
                    value={brush}
                    onChange={(e) => setBrush(e.target.valueAsNumber)}
                  />
                  <span className="w-12 tabular-nums text-gray-500 dark:text-gray-400">
                    {brush} px
                  </span>
                </label>
              ) : (
                <label className="flex shrink-0 items-center gap-2">
                  Source Opacity
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={opacity}
                    onChange={(e) => setOpacity(e.target.valueAsNumber)}
                  />
                </label>
              )}
              <span className="shrink-0">
                {image.bitmap.width}×{image.bitmap.height} px
              </span>
            </div>
            <Preview opacity={opacity} brush={brush} mode={mode} onBrush={setBrush} />
            <Levels />
          </>
        ) : (
          <button
            onClick={() => input.current?.click()}
            className="flex h-80 w-full max-w-xl items-center justify-center rounded-xl border-4 border-dashed border-gray-300 text-lg text-gray-500 dark:border-gray-600"
          >
            Drop an image or click to choose
          </button>
        )}
      </div>
      {image && (
        <aside className="w-full md:w-64">
          <Controls />
        </aside>
      )}
    </main>
  );
}

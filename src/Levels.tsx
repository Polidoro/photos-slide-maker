import type React from "react";
import { Range } from "react-range";
import { layerMask } from "./image";
import { pickParams, selectImage, useStore } from "./store";

function Slider({
  label,
  values,
  background,
  onChange,
  right,
  sections,
}: {
  label: string;
  values: number[];
  background: string;
  onChange: (v: number[]) => void;
  right?: React.ReactNode;
  sections?: React.ReactNode[]; // one caption per gap between the track edges and the handles
}) {
  const edges = [0, ...values, 100];
  const setDragging = useStore((s) => s.setDragging);
  return (
    <div className="flex w-full flex-col gap-1 text-sm">
      <div className="flex justify-between">
        <span>
          {label}: {values.join(" · ")}%
        </span>
        {right}
      </div>
      <div onPointerDown={() => setDragging(true)}>
        <Range
          values={values}
          min={0}
          max={100}
          step={1}
          onChange={(v) => {
            if (v.every((x, i) => i === 0 || x > v[i - 1])) onChange(v);
          }}
          renderTrack={({ props, children }) => (
            <div
              onMouseDown={props.onMouseDown}
              onTouchStart={props.onTouchStart}
              style={props.style}
              className="w-full py-2"
            >
              <div
                ref={props.ref}
                className="relative h-5 w-full rounded border border-gray-400"
                style={{ background }}
              >
                {sections?.map((t, k) => (
                  <span
                    key={k}
                    className="pointer-events-none absolute inset-y-0 flex items-center justify-center gap-1 overflow-hidden text-[10px] text-white mix-blend-difference"
                    style={{ left: `${edges[k]}%`, width: `${edges[k + 1] - edges[k]}%` }}
                  >
                    {t}
                  </span>
                ))}
                {children}
              </div>
            </div>
          )}
          renderThumb={({ props, index: i }) => {
            const { key, ...rest } = props;
            return (
              <div
                key={key}
                {...rest}
                aria-label={`${label} handle ${i}`}
                className="h-7 w-3 rounded border border-white bg-blue-600 shadow outline-none"
              />
            );
          }}
        />
      </div>
    </div>
  );
}

/** Padlock toggle inside a slider section. Stops the pointer events so react-range doesn't start a drag. */
function LockButton({ locked, disabled, onClick }: { locked: boolean; disabled: boolean; onClick: () => void }) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <button
      aria-label={locked ? "Unlock layer" : "Lock layer"}
      aria-pressed={locked}
      disabled={disabled}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={`pointer-events-auto shrink-0 disabled:opacity-20 ${locked ? "" : "opacity-50"}`}
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill={locked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <rect x="4" y="11" width="16" height="10" rx="2" />
        <path d={locked ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.5-2"} />
      </svg>
    </button>
  );
}

export function Levels() {
  const levelMin = useStore((s) => s.levelMin);
  const levelMax = useStore((s) => s.levelMax);
  const thresholds = useStore((s) => s.thresholds);
  const background = useStore((s) => s.background);
  const layerHeightMm = useStore((s) => s.layerHeightMm);
  const invert = useStore((s) => s.invert);
  const image = useStore(selectImage);
  const hasAlpha = image?.hasAlpha ?? false;
  const locks = useStore((s) => s.locks);
  const setLock = useStore((s) => s.setLock);
  const setParam = useStore((s) => s.setParam);
  const setLayers = useStore((s) => s.setLayers);
  const layers = thresholds.length + 1;
  const iconBtn = "h-6 w-6 rounded border border-gray-400 leading-none disabled:opacity-40";

  // Each section shows the gray its level prints as.
  const edges = [0, ...thresholds, 100];
  const stops = edges.slice(0, -1).map((a, k) => {
    const g = Math.round((k / (layers - 1)) * 255);
    return `rgb(${g},${g},${g}) ${a}% ${edges[k + 1]}%`;
  });

  return (
    <>
      <Slider
        label="Range"
        values={[levelMin, levelMax]}
        background="linear-gradient(to right, #000, #fff)"
        onChange={([lo, hi]) => {
          setParam("levelMin", lo);
          setParam("levelMax", hi);
        }}
        right={
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={invert}
              onChange={(e) => setParam("invert", e.target.checked)}
            />
            Invert Image
          </label>
        }
      />
      <Slider
        label="Levels"
        values={thresholds}
        background={`linear-gradient(to right, ${stops.join(", ")})`}
        onChange={(v) => setParam("thresholds", v)}
        sections={edges.slice(0, -1).map((_, k) => {
          // Locks grow down from the top layer and release from the bottom of the locked run, so the run stays contiguous.
          const locked = !!locks[k];
          const run = (a: number, b: number) => Array.from({ length: b - a }, (_, j) => !!locks[a + j]); // no holes, unlike slice()
          const enabled = locked ? !run(0, k).some(Boolean) : run(k + 1, layers).every(Boolean);
          return (
            <>
              {((k + 1) * layerHeightMm).toFixed(2)} mm
              <LockButton
                locked={locked}
                disabled={!enabled || !image}
                onClick={() =>
                  locked
                    ? setLock(k, undefined)
                    : createImageBitmap(layerMask(image!.bitmap, pickParams(useStore.getState()), locks, k)).then((m) => setLock(k, m))
                }
              />
            </>
          );
        })}
        right={
          <span className="flex items-center gap-1">
            {layers} layers
            <button aria-label="Fewer layers" className={iconBtn} disabled={layers <= 2} onClick={() => setLayers(layers - 1)}>−</button>
            <button aria-label="More layers" className={iconBtn} disabled={layers >= 12} onClick={() => setLayers(layers + 1)}>+</button>
          </span>
        }
      />
      {hasAlpha && (
        <Slider
          label="Background"
          values={[background]}
          background={`linear-gradient(to right, ${stops.join(", ")})`}
          onChange={([v]) => setParam("background", v)}
        />
      )}
    </>
  );
}

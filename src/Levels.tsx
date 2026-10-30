import type React from "react";
import { Range } from "react-range";
import { captureFreeze, thawLowest } from "./image";
import { pickParams, selectImage, useStore } from "./store";

function Slider({
  label,
  values,
  background,
  onChange,
  right,
  sections,
  readout,
}: {
  label: string;
  values: number[];
  background: string;
  onChange: (v: number[]) => void;
  right?: React.ReactNode;
  readout?: string; // replaces the default "values%" text after the label
  sections?: React.ReactNode[]; // one caption per gap between the track edges and the handles
}) {
  const edges = [0, ...values, 100];
  const setDragging = useStore((s) => s.setDragging);
  return (
    <div className="flex w-full flex-col gap-1 text-sm">
      <div className="flex justify-between">
        <span>
          {label}: {readout ?? `${values.join(" · ")}%`}
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
                className="h-5 w-full rounded border border-gray-400"
                style={{ background }}
              >
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
      {sections && (
        <div className="relative h-4 w-full text-xs text-gray-500 dark:text-gray-400">
          {sections.map((t, k) => (
            <span
              key={k}
              className="absolute inset-y-0 flex items-center justify-center gap-1 overflow-hidden whitespace-nowrap"
              style={{
                left: `${edges[k]}%`,
                width: `${edges[k + 1] - edges[k]}%`,
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

/** Small toggle chip under a slider section. Stops the pointer events so react-range doesn't start a drag. */
export function IconButton({
  label,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode; // svg contents, 24x24 viewBox
}) {
  const stop = (e: React.SyntheticEvent) => e.stopPropagation();
  return (
    <button
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={`pointer-events-auto shrink-0 rounded border p-0.5 disabled:opacity-30 ${
        active
          ? "border-blue-600 bg-blue-600 text-white"
          : "border-gray-400 bg-white text-gray-700 dark:border-gray-500 dark:bg-gray-800 dark:text-gray-200"
      }`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        {children}
      </svg>
    </button>
  );
}

export function Levels() {
  const levelMin = useStore((s) => s.levelMin);
  const levelMax = useStore((s) => s.levelMax);
  const thresholds = useStore((s) => s.thresholds);
  const background = useStore((s) => s.background);
  const baseMm = useStore((s) => s.baseMm);
  const layerHeightMm = useStore((s) => s.layerHeightMm);
  const flipDepth = useStore((s) => s.flipDepth);
  const invert = useStore((s) => s.invert);
  const image = useStore(selectImage);
  const hasAlpha = image?.hasAlpha ?? false;
  const freeze = image?.freeze ?? null;
  const setFreeze = useStore((s) => s.setFreeze);
  const editLevel = useStore((s) => s.editLevel);
  const setEditLevel = useStore((s) => s.setEditLevel);
  const setParam = useStore((s) => s.setParam);
  const setLayers = useStore((s) => s.setLayers);
  const layers = thresholds.length + 1;
  const depth = (k: number) => ((k + 1) * layerHeightMm).toFixed(2); // unflipped depth of level k, as the select's option value
  const baseLevel = baseMm === "none" ? 0 : Math.min(layers - 1, Math.max(0, Math.round(baseMm / layerHeightMm) - 1));
  const iconBtn =
    "h-6 w-6 rounded border border-gray-400 leading-none disabled:opacity-40";

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
          // Everything from `from` up is frozen. Lock extends the run down one level; unlock releases only its lowest level.
          const from = freeze?.from ?? layers;
          const locked = k >= from;
          // Locking level k pins it and every level above it (captureFreeze takes all levels >= k from the composited output).
          const lock = () => setFreeze(captureFreeze(image!.bitmap, pickParams(useStore.getState()), freeze, k));
          return (
            <>
              {((flipDepth ? layers - k : k + 1) * layerHeightMm).toFixed(2)} mm
              <IconButton
                label={locked ? "Unlock layer" : "Lock this layer and those above"}
                active={locked}
                disabled={!image || (locked && k !== from)} // unlock releases only the lowest frozen level
                onClick={() => (locked ? setFreeze(thawLowest(freeze!, layers)) : lock())}
              >
                <rect x="4" y="11" width="16" height="10" rx="2" fill={locked ? "currentColor" : "none"} />
                <path d={locked ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.5-2"} />
              </IconButton>
              <IconButton
                label={editLevel === k ? "Show full preview" : "Edit this layer"}
                active={editLevel === k}
                disabled={!image}
                onClick={() => {
                  if (editLevel === k) return setEditLevel(null);
                  if (!locked) lock();
                  setEditLevel(k);
                }}
              >
                <path d="M17 3l4 4L8 20H4v-4L17 3z" />
                <path d="M14 6l4 4" />
              </IconButton>
            </>
          );
        })}
        right={
          <span className="flex items-center gap-1">
            {layers} layers
            <button
              aria-label="Fewer layers"
              className={iconBtn}
              disabled={layers <= 2}
              onClick={() => setLayers(layers - 1)}
            >
              −
            </button>
            <button
              aria-label="More layers"
              className={iconBtn}
              disabled={layers >= 12}
              onClick={() => setLayers(layers + 1)}
            >
              +
            </button>
          </span>
        }
      />
      {hasAlpha && (
        <Slider
          label="Background"
          readout={
            baseMm === "none"
              ? "None"
              : `${((flipDepth ? layers - baseLevel : baseLevel + 1) * layerHeightMm).toFixed(2)} mm`
          }
          values={[background]}
          background={`linear-gradient(to right, ${stops.join(", ")})`}
          onChange={([v]) => setParam("background", v)}
          right={
            <label className="flex items-center gap-2">
              Base
              <select
              value={baseMm === "none" ? "none" : depth(baseLevel)}
              onChange={(e) => {
                const v = e.target.value;
                setParam("baseMm", v === "none" ? v : Number(v));
              }}
              className="rounded border border-gray-300 bg-white px-2 py-0.5 dark:border-gray-600 dark:bg-gray-800"
            >
              <option value="none">None</option>
              {edges.slice(0, -1).map((_, k) => (
                <option key={k} value={depth(k)}>
                  {((flipDepth ? layers - k : k + 1) * layerHeightMm).toFixed(2)} mm
                </option>
              ))}
            </select>
            </label>
          }
        />
      )}
    </>
  );
}

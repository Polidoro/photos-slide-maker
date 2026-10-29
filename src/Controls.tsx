import { useEffect, useState } from "react";
import { useStore as useZustand } from "zustand";
import { Tooltip } from "react-tooltip";
import "react-tooltip/dist/react-tooltip.css";
import { downloadBlob } from "./download";
import { fit, gridSize, quantizedImage, sampleHeights } from "./image";
import { buildStl } from "./stl";
import { isParams, pickParams, selectImage, useStore } from "./store";

const inputCls =
  "rounded border border-gray-300 bg-white px-2 py-1 dark:border-gray-600 dark:bg-gray-800";
const btnCls =
  "rounded border border-gray-300 px-3 py-1 text-sm disabled:opacity-40 dark:border-gray-600";

/** Range input with the label on the left and the value (or "Off" at 0) on the right. */
function Slider({
  label,
  help,
  value,
  min = 0,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  help: string;
  value: number;
  min?: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  const setDragging = useStore((s) => s.setDragging);
  const decimals = step < 1 ? String(step).split(".")[1].length : 0;
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between">
        <span
          data-tooltip-id="help"
          data-tooltip-content={help}
          className="cursor-help"
        >
          {label}
        </span>
        <span className="text-gray-500 dark:text-gray-400">
          {value === 0 ? "Off" : value.toFixed(decimals) + unit}
        </span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => setDragging(true)}
        onChange={(e) => onChange(e.target.valueAsNumber)}
      />
    </label>
  );
}

/** Whole-mm input that commits on blur or Enter, so a linked partner only updates once typing is done. */
function MmInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  return (
    <input
      key={value}
      type="number"
      min={1}
      step={1}
      defaultValue={value}
      onBlur={(e) => onCommit(Math.max(1, Math.round(e.target.valueAsNumber || 1)))}
      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      className={`${inputCls} w-full`}
    />
  );
}

export function Controls() {
  const img = useStore(selectImage);
  const reset = useStore((s) => s.reset);
  const contrast = useStore((s) => s.contrast);
  const saturation = useStore((s) => s.saturation);
  const lightness = useStore((s) => s.lightness);
  const gamma = useStore((s) => s.gamma);
  const shadows = useStore((s) => s.shadows);
  const highlights = useStore((s) => s.highlights);
  const median = useStore((s) => s.median);
  const bilateral = useStore((s) => s.bilateral);
  const smoothing = useStore((s) => s.smoothing);
  const edgeTolerance = useStore((s) => s.edgeTolerance);
  const hysteresis = useStore((s) => s.hysteresis);
  const widthMm = useStore((s) => s.widthMm);
  const heightMm = useStore((s) => s.heightMm);
  const minFeatureMm = useStore((s) => s.minFeatureMm);
  const layerHeightMm = useStore((s) => s.layerHeightMm);
  const nozzleMm = useStore((s) => s.nozzleMm);
  const frame = useStore((s) => s.frame);
  const setParam = useStore((s) => s.setParam);
  const setParams = useStore((s) => s.setParams);
  // zundo's history arrays change exactly when a tracked param change is recorded, undone or redone.
  const past = useZustand(useStore.temporal, (t) => t.pastStates);
  const future = useZustand(useStore.temporal, (t) => t.futureStates);
  const [stl, setStl] = useState<ArrayBuffer | null>(null);

  const bitmap = img?.bitmap;

  // Rebuild the mesh after a committed param change (never mid-drag) or an image switch; cache it for download.
  useEffect(() => {
    setStl(null);
    if (!bitmap) return;
    const id = setTimeout(() => {
      const s = sampleHeights(bitmap, pickParams(useStore.getState()));
      setStl(buildStl(s.heights, s.w, s.h, s.opts));
    }, 150);
    return () => clearTimeout(id);
  }, [bitmap, past, future]);

  if (!img || !bitmap) return null;
  const stem = img.name.replace(/\.[^.]+$/, "");

  async function downloadPng() {
    const data = quantizedImage(bitmap!, pickParams(useStore.getState()));
    const c = new OffscreenCanvas(data.width, data.height);
    c.getContext("2d")!.putImageData(data, 0, 0);
    downloadBlob(await c.convertToBlob({ type: "image/png" }), stem + ".png");
  }
  const copyState = () => navigator.clipboard.writeText(JSON.stringify(pickParams(useStore.getState())));
  async function loadState() {
    const text = await navigator.clipboard.readText().catch(() => window.prompt("Paste state") ?? "");
    try {
      const p = JSON.parse(text);
      if (isParams(p)) return setParams(p);
    } catch {}
    window.alert("Clipboard does not hold a ShadeMaker state");
  }
  const { w, h } = fit(bitmap, gridSize(widthMm, nozzleMm));
  const aspect = bitmap.height / bitmap.width;
  const depthMm = heightMm ?? Math.round(widthMm * aspect);

  return (
    <div className="flex flex-col gap-4">
      <Slider label="Contrast" help="Stretches (positive) or flattens (negative) the difference between light and dark areas before the image is turned to gray." value={contrast} min={-100} max={100} step={1} unit="%" onChange={(v) => setParam("contrast", v)} />
      <Slider label="Saturation" help="Boosts or removes colour before the gray conversion. Changes how strongly red and blue areas count against green ones; no effect on gray images." value={saturation} min={-100} max={100} step={1} unit="%" onChange={(v) => setParam("saturation", v)} />
      <Slider label="Lightness" help="Shifts every gray value up or down by this amount." value={lightness} min={-100} max={100} step={1} unit="%" onChange={(v) => setParam("lightness", v)} />
      <Slider label="Gamma" help="Bends the midtones without moving black or white. Above 1 brightens midtones; below 1 darkens them." value={gamma} min={0.2} max={3} step={0.01} unit="" onChange={(v) => setParam("gamma", v)} />
      <Slider label="Shadows" help="Lifts (positive) or crushes (negative) the dark end of the range, leaving white untouched." value={shadows} min={-100} max={100} step={1} unit="%" onChange={(v) => setParam("shadows", v)} />
      <Slider label="Highlights" help="Brightens (positive) or pulls down (negative) the light end of the range, leaving black untouched." value={highlights} min={-100} max={100} step={1} unit="%" onChange={(v) => setParam("highlights", v)} />
      <Slider
        label="Median"
        help="Replaces each pixel with the median of its neighbourhood. Removes speckle and grain before the image is split into layers, while keeping hard edges. Value is the window radius as a share of the image size."
        value={median}
        max={10}
        step={0.01}
        unit="%"
        onChange={(v) => setParam("median", v)}
      />
      <Slider
        label="Bilateral"
        help="Averages each pixel with nearby pixels of similar brightness only. Smooths gradients and noise in flat areas without blurring across edges. Value is the radius; use Edge tolerance to set what counts as an edge."
        value={bilateral}
        max={100}
        step={1}
        unit="%"
        onChange={(v) => setParam("bilateral", v)}
      />
      {bilateral > 0 && (
        <Slider
          label="Edge tolerance"
          help="How different in brightness a neighbour must be before the bilateral filter treats it as across an edge and ignores it. Lower keeps more detail; higher smooths more aggressively."
          value={edgeTolerance}
          min={1}
          max={50}
          step={1}
          unit="%"
          onChange={(v) => setParam("edgeTolerance", v)}
        />
      )}
      <Slider
        label="Band tolerance"
        help="Dead band around each level boundary. Pixels within this distance of a boundary join the upper level only where they touch an area clearly above it. Stops noise near a boundary from flickering between two layers."
        value={hysteresis}
        max={20}
        step={0.5}
        unit="%"
        onChange={(v) => setParam("hysteresis", v)}
      />
      <Slider
        label="Min feature"
        help="Removes islands and fills holes narrower than this size, per layer, so the print has no specks smaller than the nozzle can reproduce. Measured in millimetres at the chosen Width."
        value={minFeatureMm}
        max={5}
        step={0.01}
        unit=" mm"
        onChange={(v) => setParam("minFeatureMm", v)}
      />
      <Slider
        label="Outline smoothing"
        help="Rounds the outline of each layer after cleanup, like sanding the corners. Smooths each layer's shape without creating new intermediate layers. Value is the blur radius as a share of the image size."
        value={smoothing}
        max={10}
        step={0.01}
        unit="%"
        onChange={(v) => setParam("smoothing", v)}
      />
      <label className="flex flex-col gap-1 text-sm">
        <span
          data-tooltip-id="help"
          data-tooltip-content="Replaces the outer 1 mm of the image with a border. Flat is 1 mm high; Tapered slopes from 1 mm at the inside down to one layer at the edge; Mixed has flat sides and tapered top and bottom. Size is unchanged."
          className="cursor-help"
        >
          Frame
        </span>
        <select
          value={frame}
          onChange={(e) => setParam("frame", e.target.value as typeof frame)}
          className={`${inputCls} w-full`}
        >
          {(["none", "flat", "tapered", "mixed"] as const).map((v) => (
            <option key={v} value={v}>
              {v[0].toUpperCase() + v.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <Tooltip id="help" className="max-w-64 text-xsl!" />
      <div className="flex justify-between">
        <button className={btnCls} onClick={copyState}>
          Copy State
        </button>
        <button className={btnCls} onClick={loadState}>
          Load State
        </button>
      </div>
      <div className="flex justify-between">
        <button className={btnCls} onClick={reset}>
          Reset All
        </button>
        <button className={btnCls} onClick={downloadPng}>
          Save PNG
        </button>
      </div>

      <div className="pt-24 flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Width
          <MmInput value={widthMm} onCommit={(v) => setParam("widthMm", v)} />
        </label>
        <button
          aria-label={heightMm === null ? "Unlink width and height" : "Link width and height"}
          title={heightMm === null ? "Linked to the image aspect ratio" : "Unlinked"}
          className={`self-end pb-2 ${heightMm === null ? "" : "opacity-30"}`}
          onClick={() => setParam("heightMm", heightMm === null ? depthMm : null)}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
            <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
          </svg>
        </button>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Height
          <MmInput
            value={depthMm}
            onCommit={(v) => {
              if (heightMm === null) setParam("widthMm", Math.max(1, Math.round(v / aspect)));
              else setParam("heightMm", v);
            }}
          />
        </label>
      </div>
      <div className="flex gap-2">
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Layer
          <select
            value={layerHeightMm}
            onChange={(e) => setParam("layerHeightMm", Number(e.target.value))}
            className={`${inputCls} w-full`}
          >
            {Array.from({ length: 20 }, (_, i) => (i + 1) / 20).map((v) => (
              <option key={v} value={v}>
                {v.toFixed(2)} mm
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-1 flex-col gap-1 text-sm">
          Nozzle
          <select
            value={nozzleMm}
            onChange={(e) => setParam("nozzleMm", Number(e.target.value))}
            className={`${inputCls} w-full`}
          >
            {[0.2, 0.4, 0.6].map((v) => (
              <option key={v} value={v}>
                {v.toFixed(1)} mm
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-between">
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {w}×{h}
        </p>
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {stl ? `${(stl.byteLength / 1e6).toFixed(1)} MB` : "…"}
        </p>
      </div>
      <button
        disabled={!stl}
        onClick={() => stl && downloadBlob(stl, stem + ".stl")}
        className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
      >
        {stl ? "Download STL" : "Generating…"}
      </button>
    </div>
  );
}

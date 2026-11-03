import React from 'react';
import {
  Palette,
  Sliders,
  Sparkles,
} from 'lucide-react';
import { useDocumentStore } from '../store/useDocumentStore';
import {
  StrokeCap,
  StrokeJoin,
  VectorShape,
} from '../types/document';

const SWATCH_PALETTE = [
  '#6366f1',
  '#a855f7',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#f8fafc',
  '#64748b',
  '#0f172a',
];

export const RightInspector: React.FC = () => {
  const {
    doc,
    activeStyle,
    setActiveFill,
    setActiveStroke,
    setActiveOpacity,
    updateDocumentMeta,
    updateShapeLive,
    saveHistorySnapshot,
    convertSelectedToPaths,
    addOrUpdateGradient,
  } = useDocumentStore();

  // Find first selected shape if any
  const selectedShape: VectorShape | null = React.useMemo(() => {
    if (doc.selectedShapeIds.length === 0) return null;
    const targetId = doc.selectedShapeIds[0];
    for (const layer of doc.layers) {
      if (layer.type === 'vector') {
        const found = layer.shapes.find((s) => s.id === targetId);
        if (found) return found;
      }
    }
    return null;
  }, [doc.selectedShapeIds, doc.layers]);

  const currentFill = selectedShape
    ? selectedShape.style.fill
    : activeStyle.fill;
  const currentStroke = selectedShape
    ? selectedShape.style.stroke
    : activeStyle.stroke;
  const currentOpacity = selectedShape
    ? selectedShape.style.opacity
    : activeStyle.opacity;

  const activeGradient = doc.gradients.find(
    (g) => g.id === currentFill.gradientId
  ) || doc.gradients[0];

  return (
    <div className="p-3 space-y-4 text-xs border-b border-[#252a3a] overflow-y-auto max-h-[54%]">
      {/* Section 1: Document or Selected Shape Geometry */}
      {!selectedShape ? (
        <div className="space-y-2.5">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
            <Sliders className="w-3.5 h-3.5 text-indigo-400" />
            <span>Artboard Setup</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center justify-between bg-[#181c26] px-2 py-1 rounded border border-[#252a3a]">
              <span className="text-slate-400">W</span>
              <input
                type="number"
                value={doc.width}
                onChange={(e) =>
                  updateDocumentMeta({
                    width: Math.max(100, Number(e.target.value)),
                  })
                }
                className="w-16 bg-transparent text-right text-slate-200 focus:outline-none font-mono"
              />
            </label>
            <label className="flex items-center justify-between bg-[#181c26] px-2 py-1 rounded border border-[#252a3a]">
              <span className="text-slate-400">H</span>
              <input
                type="number"
                value={doc.height}
                onChange={(e) =>
                  updateDocumentMeta({
                    height: Math.max(100, Number(e.target.value)),
                  })
                }
                className="w-16 bg-transparent text-right text-slate-200 focus:outline-none font-mono"
              />
            </label>
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={doc.transparentBackground}
                onChange={(e) =>
                  updateDocumentMeta({
                    transparentBackground: e.target.checked,
                  })
                }
                className="accent-indigo-500"
              />
              <span>Transparent Canvas</span>
            </label>
            {!doc.transparentBackground && (
              <input
                type="color"
                value={doc.backgroundColor}
                onChange={(e) =>
                  updateDocumentMeta({ backgroundColor: e.target.value })
                }
                className="w-6 h-6 rounded cursor-pointer bg-transparent"
                title="Artboard Background Color"
              />
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-400">
              {selectedShape.type.toUpperCase()} Geometry
            </span>
            {selectedShape.type !== 'path' && (
              <button
                onClick={convertSelectedToPaths}
                className="text-[10px] px-1.5 py-0.5 rounded bg-[#232838] hover:bg-indigo-600 text-slate-200 transition"
              >
                Convert to Path
              </button>
            )}
          </div>

          {/* Parametric Controls */}
          {selectedShape.type === 'rect' && (
            <div className="space-y-2">
              <div className="grid grid-cols-2 gap-1.5">
                <label className="prop-input">
                  <span>X</span>
                  <input
                    type="number"
                    value={Math.round(selectedShape.x)}
                    onChange={(e) => {
                      saveHistorySnapshot();
                      updateShapeLive(selectedShape.id, (s) =>
                        s.type === 'rect'
                          ? { ...s, x: Number(e.target.value) }
                          : s
                      );
                    }}
                  />
                </label>
                <label className="prop-input">
                  <span>Y</span>
                  <input
                    type="number"
                    value={Math.round(selectedShape.y)}
                    onChange={(e) => {
                      saveHistorySnapshot();
                      updateShapeLive(selectedShape.id, (s) =>
                        s.type === 'rect'
                          ? { ...s, y: Number(e.target.value) }
                          : s
                      );
                    }}
                  />
                </label>
                <label className="prop-input">
                  <span>W</span>
                  <input
                    type="number"
                    value={Math.round(selectedShape.width)}
                    onChange={(e) => {
                      saveHistorySnapshot();
                      updateShapeLive(selectedShape.id, (s) =>
                        s.type === 'rect'
                          ? { ...s, width: Math.max(1, Number(e.target.value)) }
                          : s
                      );
                    }}
                  />
                </label>
                <label className="prop-input">
                  <span>H</span>
                  <input
                    type="number"
                    value={Math.round(selectedShape.height)}
                    onChange={(e) => {
                      saveHistorySnapshot();
                      updateShapeLive(selectedShape.id, (s) =>
                        s.type === 'rect'
                          ? { ...s, height: Math.max(1, Number(e.target.value)) }
                          : s
                      );
                    }}
                  />
                </label>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-400">Corner Radius</span>
                <input
                  type="range"
                  min={0}
                  max={Math.round(
                    Math.min(selectedShape.width, selectedShape.height) / 2
                  )}
                  value={Math.round(selectedShape.rx)}
                  onChange={(e) => {
                    const rx = Number(e.target.value);
                    updateShapeLive(selectedShape.id, (s) =>
                      s.type === 'rect' ? { ...s, rx, ry: rx } : s
                    );
                  }}
                  className="w-24 accent-indigo-500"
                />
                <span className="font-mono w-8 text-right">
                  {Math.round(selectedShape.rx)}px
                </span>
              </div>
            </div>
          )}

          {selectedShape.type === 'ellipse' && (
            <div className="grid grid-cols-2 gap-1.5">
              <label className="prop-input">
                <span>CX</span>
                <input
                  type="number"
                  value={Math.round(selectedShape.cx)}
                  onChange={(e) =>
                    updateShapeLive(selectedShape.id, (s) =>
                      s.type === 'ellipse'
                        ? { ...s, cx: Number(e.target.value) }
                        : s
                    )
                  }
                />
              </label>
              <label className="prop-input">
                <span>CY</span>
                <input
                  type="number"
                  value={Math.round(selectedShape.cy)}
                  onChange={(e) =>
                    updateShapeLive(selectedShape.id, (s) =>
                      s.type === 'ellipse'
                        ? { ...s, cy: Number(e.target.value) }
                        : s
                    )
                  }
                />
              </label>
              <label className="prop-input">
                <span>RX</span>
                <input
                  type="number"
                  value={Math.round(selectedShape.rx)}
                  onChange={(e) =>
                    updateShapeLive(selectedShape.id, (s) =>
                      s.type === 'ellipse'
                        ? { ...s, rx: Math.max(1, Number(e.target.value)) }
                        : s
                    )
                  }
                />
              </label>
              <label className="prop-input">
                <span>RY</span>
                <input
                  type="number"
                  value={Math.round(selectedShape.ry)}
                  onChange={(e) =>
                    updateShapeLive(selectedShape.id, (s) =>
                      s.type === 'ellipse'
                        ? { ...s, ry: Math.max(1, Number(e.target.value)) }
                        : s
                    )
                  }
                />
              </label>
            </div>
          )}

          {selectedShape.type === 'spline' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-slate-400">Curve Tension</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={selectedShape.tension}
                  onChange={(e) =>
                    updateShapeLive(selectedShape.id, (s) =>
                      s.type === 'spline'
                        ? { ...s, tension: parseFloat(e.target.value) }
                        : s
                    )
                  }
                  className="w-24 accent-indigo-500"
                />
                <span className="font-mono w-9 text-right">
                  {Math.round(selectedShape.tension * 100)}%
                </span>
              </div>
              <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={selectedShape.closed}
                  onChange={(e) => {
                    saveHistorySnapshot();
                    updateShapeLive(selectedShape.id, (s) =>
                      s.type === 'spline'
                        ? { ...s, closed: e.target.checked }
                        : s
                    );
                  }}
                  className="accent-indigo-500"
                />
                <span>Closed Spline Loop</span>
              </label>
            </div>
          )}

          <div className="flex items-center justify-between gap-2">
            <span className="text-slate-400">Rotation</span>
            <input
              type="range"
              min={-180}
              max={180}
              value={Math.round(selectedShape.transform.rotation)}
              onChange={(e) =>
                updateShapeLive(selectedShape.id, (s) => ({
                  ...s,
                  transform: { rotation: Number(e.target.value) },
                }))
              }
              className="w-24 accent-indigo-500"
            />
            <span className="font-mono w-9 text-right">
              {Math.round(selectedShape.transform.rotation)}°
            </span>
          </div>
        </div>
      )}

      <div className="h-[1px] bg-[#252a3a]" />

      {/* Section 2: Fill & Gradients */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
            <Palette className="w-3.5 h-3.5 text-indigo-400" />
            <span>Fill Appearance</span>
          </div>
          <span className="text-[10px] font-mono text-slate-400">
            Op: {Math.round(currentOpacity * 100)}%
          </span>
        </div>

        {/* Fill Type Selector */}
        <div className="grid grid-cols-4 gap-1 bg-[#181c26] p-0.5 rounded border border-[#252a3a] text-[10px]">
          {[
            { id: 'none', label: 'None' },
            { id: 'solid', label: 'Solid' },
            { id: 'linear-gradient', label: 'Linear' },
            { id: 'radial-gradient', label: 'Radial' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() =>
                setActiveFill({
                  type: tab.id as any,
                  gradientId:
                    tab.id === 'linear-gradient' || tab.id === 'radial-gradient'
                      ? currentFill.gradientId || doc.gradients[0]?.id
                      : undefined,
                })
              }
              className={`py-1 rounded font-medium transition ${
                currentFill.type === tab.id
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {currentFill.type === 'solid' && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={currentFill.color}
                onChange={(e) =>
                  setActiveFill({ type: 'solid', color: e.target.value })
                }
                className="w-7 h-7 rounded cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={currentFill.color}
                onChange={(e) =>
                  setActiveFill({ type: 'solid', color: e.target.value })
                }
                className="bg-[#181c26] border border-[#252a3a] rounded px-2 py-1 w-20 font-mono text-slate-200"
              />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={currentFill.opacity}
                onChange={(e) =>
                  setActiveFill({ opacity: parseFloat(e.target.value) })
                }
                className="flex-1 accent-indigo-500"
                title="Fill Opacity"
              />
            </div>

            {/* Quick Swatches */}
            <div className="grid grid-cols-6 gap-1.5 pt-0.5">
              {SWATCH_PALETTE.map((hex) => (
                <button
                  key={hex}
                  onClick={() => setActiveFill({ type: 'solid', color: hex })}
                  className="h-5 rounded border border-white/15 hover:scale-105 transition"
                  style={{ backgroundColor: hex }}
                  title={hex}
                />
              ))}
            </div>
          </div>
        )}

        {(currentFill.type === 'linear-gradient' ||
          currentFill.type === 'radial-gradient') &&
          activeGradient && (
            <div className="space-y-2 bg-[#181c26] p-2 rounded border border-[#252a3a]">
              <div className="flex items-center justify-between gap-1">
                <Sparkles className="w-3.5 h-3.5 text-purple-400" />
                <select
                  value={activeGradient.id}
                  onChange={(e) => {
                    const grad = doc.gradients.find(
                      (g) => g.id === e.target.value
                    );
                    if (grad) {
                      setActiveFill({
                        type:
                          grad.type === 'radial'
                            ? 'radial-gradient'
                            : 'linear-gradient',
                        gradientId: grad.id,
                      });
                    }
                  }}
                  className="flex-1 bg-[#11141c] border border-[#2a3044] rounded px-1.5 py-0.5 text-slate-200 text-[11px]"
                >
                  {doc.gradients.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-between gap-2">
                {activeGradient.stops.map((stop, idx) => (
                  <label
                    key={idx}
                    className="flex items-center gap-1.5 text-[11px] text-slate-300"
                  >
                    <span>Stop {idx + 1}</span>
                    <input
                      type="color"
                      value={stop.color}
                      onChange={(e) => {
                        const nextStops = activeGradient.stops.map((s, i) =>
                          i === idx ? { ...s, color: e.target.value } : s
                        );
                        addOrUpdateGradient({
                          ...activeGradient,
                          stops: nextStops,
                        });
                      }}
                      className="w-6 h-6 rounded cursor-pointer bg-transparent"
                    />
                  </label>
                ))}
              </div>
            </div>
          )}
      </div>

      <div className="h-[1px] bg-[#252a3a]" />

      {/* Section 3: Stroke Controls */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-300">
            Stroke &amp; Line Style
          </span>
          <span className="font-mono text-[11px] text-slate-400">
            {currentStroke.width}px
          </span>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="color"
            value={currentStroke.color}
            onChange={(e) => setActiveStroke({ color: e.target.value })}
            className="w-7 h-7 rounded cursor-pointer bg-transparent"
          />
          <input
            type="range"
            min={0}
            max={24}
            step={0.5}
            value={currentStroke.width}
            onChange={(e) =>
              setActiveStroke({ width: parseFloat(e.target.value) })
            }
            className="flex-1 accent-indigo-500"
            title="Stroke Width"
          />
          <input
            type="number"
            min={0}
            max={100}
            step={0.5}
            value={currentStroke.width}
            onChange={(e) =>
              setActiveStroke({ width: Math.max(0, Number(e.target.value)) })
            }
            className="w-12 bg-[#181c26] border border-[#252a3a] rounded px-1 py-0.5 text-right font-mono"
          />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <span className="text-[10px] text-slate-400 block mb-1">Cap</span>
            <div className="grid grid-cols-3 gap-0.5 bg-[#181c26] p-0.5 rounded border border-[#252a3a] text-[10px]">
              {(['butt', 'round', 'square'] as StrokeCap[]).map((cap) => (
                <button
                  key={cap}
                  onClick={() => setActiveStroke({ cap })}
                  className={`py-0.5 rounded capitalize ${
                    currentStroke.cap === cap
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400'
                  }`}
                >
                  {cap}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="text-[10px] text-slate-400 block mb-1">Join</span>
            <div className="grid grid-cols-3 gap-0.5 bg-[#181c26] p-0.5 rounded border border-[#252a3a] text-[10px]">
              {(['miter', 'round', 'bevel'] as StrokeJoin[]).map((join) => (
                <button
                  key={join}
                  onClick={() => setActiveStroke({ join })}
                  className={`py-0.5 rounded capitalize ${
                    currentStroke.join === join
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-400'
                  }`}
                >
                  {join}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-slate-400 text-[11px]">Pattern</span>
          <div className="flex gap-1">
            {[
              { label: 'Solid', dash: [] },
              { label: 'Dash', dash: [8, 6] },
              { label: 'Dot', dash: [2, 5] },
              { label: 'Long', dash: [14, 6, 3, 6] },
            ].map((preset) => {
              const isSelected =
                JSON.stringify(currentStroke.dashArray) ===
                JSON.stringify(preset.dash);
              return (
                <button
                  key={preset.label}
                  onClick={() => setActiveStroke({ dashArray: preset.dash })}
                  className={`px-2 py-0.5 rounded text-[10px] border transition ${
                    isSelected
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-[#181c26] border-[#252a3a] text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-1">
          <span className="text-slate-400 text-[11px]">Shape Opacity</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.05}
            value={currentOpacity}
            onChange={(e) => setActiveOpacity(parseFloat(e.target.value))}
            className="w-28 accent-indigo-500"
          />
        </div>
      </div>
    </div>
  );
};


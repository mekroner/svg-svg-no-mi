import React from 'react';
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from 'lucide-react';
import { useDocumentStore } from '../store/useDocumentStore';
import { openReferencePngWithDialog } from '../engine/svgIo';

export const LayerTreePanel: React.FC = () => {
  const {
    doc,
    setActiveLayerId,
    setSelectedShapeIds,
    addVectorLayer,
    addReferenceLayer,
    deleteLayer,
    toggleLayerVisibility,
    toggleLayerLock,
    toggleLayerExpanded,
    setLayerOpacity,
    renameLayer,
    reorderLayer,
    toggleShapeVisibility,
    toggleShapeLock,
    renameShape,
    reorderShapeInLayer,
    updateReferenceLayerLive,
    setStatusMessage,
  } = useDocumentStore();

  const handleAddReference = async () => {
    try {
      const res = await openReferencePngWithDialog();
      if (!res) return;
      addReferenceLayer(res);
    } catch (err) {
      setStatusMessage(
        `Failed to load Reference PNG: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  };

  // Display layers top-to-bottom (reverse of render order)
  const displayLayers = [...doc.layers].reverse();

  return (
    <div className="flex-1 flex flex-col min-h-0 text-xs select-none">
      {/* Header */}
      <div className="px-3 py-2 bg-[#151822] border-b border-[#252a3a] flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-slate-300 font-semibold uppercase tracking-wider text-[10px]">
          <Layers className="w-3.5 h-3.5 text-indigo-400" />
          <span>Layers &amp; Reference PNGs</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => addVectorLayer()}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-indigo-600/25 hover:bg-indigo-600/40 border border-indigo-500/40 text-indigo-200 text-[10px] transition"
            title="New Vector Layer"
          >
            <Plus className="w-3 h-3" />
            <span>Layer</span>
          </button>

          <button
            onClick={handleAddReference}
            className="flex items-center gap-1 px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-200 text-[10px] transition"
            title="Import Reference PNG Layer"
          >
            <ImageIcon className="w-3 h-3 text-amber-400" />
            <span>Ref PNG</span>
          </button>
        </div>
      </div>

      {/* Layer Tree List */}
      <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
        {displayLayers.map((layer) => {
          const isActiveLayer = doc.activeLayerId === layer.id;

          if (layer.type === 'reference') {
            return (
              <div
                key={layer.id}
                className="rounded-lg border border-amber-500/30 bg-amber-950/15 p-2 space-y-1.5"
              >
                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <span className="px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold text-[9px]">
                      REF
                    </span>
                    <input
                      type="text"
                      value={layer.name}
                      onChange={(e) => renameLayer(layer.id, e.target.value)}
                      className="bg-transparent text-amber-100 font-medium truncate w-full focus:outline-none focus:bg-[#1c202e] px-1 rounded"
                    />
                  </div>

                  <div className="flex items-center gap-0.5">
                    <button
                      onClick={() => reorderLayer(layer.id, 'up')}
                      className="p-1 text-slate-400 hover:text-slate-200"
                      title="Move Layer Up"
                    >
                      <ArrowUp className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => reorderLayer(layer.id, 'down')}
                      className="p-1 text-slate-400 hover:text-slate-200"
                      title="Move Layer Down"
                    >
                      <ArrowDown className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => toggleLayerLock(layer.id)}
                      className={`p-1 rounded ${
                        layer.locked
                          ? 'text-amber-400 bg-amber-500/15'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                      title={
                        layer.locked
                          ? 'Locked for tracing (Click to unlock & move/resize on canvas)'
                          : 'Unlocked (Click to lock position)'
                      }
                    >
                      {layer.locked ? (
                        <Lock className="w-3 h-3" />
                      ) : (
                        <Unlock className="w-3 h-3" />
                      )}
                    </button>
                    <button
                      onClick={() => toggleLayerVisibility(layer.id)}
                      className="p-1 text-slate-300 hover:text-white"
                      title="Toggle Reference Visibility"
                    >
                      {layer.visible ? (
                        <Eye className="w-3 h-3" />
                      ) : (
                        <EyeOff className="w-3 h-3 text-slate-600" />
                      )}
                    </button>
                    <button
                      onClick={() => deleteLayer(layer.id)}
                      className="p-1 text-rose-400 hover:text-rose-300"
                      title="Remove Reference Layer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Reference Opacity & Controls */}
                <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400 pt-0.5">
                  <span>Opacity</span>
                  <input
                    type="range"
                    min={0.05}
                    max={1}
                    step={0.05}
                    value={layer.opacity}
                    onChange={(e) =>
                      setLayerOpacity(layer.id, parseFloat(e.target.value))
                    }
                    className="flex-1 accent-amber-400"
                  />
                  <span className="font-mono w-8 text-right text-amber-200">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                </div>

                {!layer.locked && (
                  <div className="grid grid-cols-3 gap-1 pt-1 text-[10px]">
                    <label className="prop-input">
                      <span>W</span>
                      <input
                        type="number"
                        value={Math.round(layer.width)}
                        onChange={(e) =>
                          updateReferenceLayerLive(layer.id, {
                            width: Math.max(10, Number(e.target.value)),
                          })
                        }
                      />
                    </label>
                    <label className="prop-input">
                      <span>H</span>
                      <input
                        type="number"
                        value={Math.round(layer.height)}
                        onChange={(e) =>
                          updateReferenceLayerLive(layer.id, {
                            height: Math.max(10, Number(e.target.value)),
                          })
                        }
                      />
                    </label>
                    <label className="prop-input">
                      <span>°</span>
                      <input
                        type="number"
                        value={Math.round(layer.rotation)}
                        onChange={(e) =>
                          updateReferenceLayerLive(layer.id, {
                            rotation: Number(e.target.value),
                          })
                        }
                      />
                    </label>
                  </div>
                )}
              </div>
            );
          }

          // Vector Layer
          const reversedShapes = [...layer.shapes].reverse();
          return (
            <div
              key={layer.id}
              onClick={() => setActiveLayerId(layer.id)}
              className={`rounded-lg border transition ${
                isActiveLayer
                  ? 'border-indigo-500/60 bg-[#191e2d]'
                  : 'border-[#252a3a] bg-[#141722] hover:border-[#32394f]'
              }`}
            >
              {/* Layer Row */}
              <div className="p-2 flex items-center justify-between gap-1">
                <div className="flex items-center gap-1 flex-1 min-w-0">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLayerExpanded(layer.id);
                    }}
                    className="p-0.5 text-slate-400 hover:text-white"
                  >
                    {layer.expanded ? (
                      <ChevronDown className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronRight className="w-3.5 h-3.5" />
                    )}
                  </button>

                  <input
                    type="text"
                    value={layer.name}
                    onChange={(e) => renameLayer(layer.id, e.target.value)}
                    className="bg-transparent font-medium text-slate-200 truncate w-full focus:outline-none focus:bg-[#11141c] px-1 rounded"
                  />
                  <span className="text-[10px] text-slate-500 font-mono">
                    ({layer.shapes.length})
                  </span>
                </div>

                <div
                  className="flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => reorderLayer(layer.id, 'up')}
                    className="p-1 text-slate-400 hover:text-slate-200"
                    title="Move Layer Up"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => reorderLayer(layer.id, 'down')}
                    className="p-1 text-slate-400 hover:text-slate-200"
                    title="Move Layer Down"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => toggleLayerLock(layer.id)}
                    className={`p-1 rounded ${
                      layer.locked
                        ? 'text-amber-400'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                    title="Lock/Unlock Layer"
                  >
                    {layer.locked ? (
                      <Lock className="w-3 h-3" />
                    ) : (
                      <Unlock className="w-3 h-3" />
                    )}
                  </button>
                  <button
                    onClick={() => toggleLayerVisibility(layer.id)}
                    className="p-1 text-slate-300 hover:text-white"
                    title="Show/Hide Layer"
                  >
                    {layer.visible ? (
                      <Eye className="w-3 h-3" />
                    ) : (
                      <EyeOff className="w-3 h-3 text-slate-600" />
                    )}
                  </button>
                  {doc.layers.length > 1 && (
                    <button
                      onClick={() => deleteLayer(layer.id)}
                      className="p-1 text-rose-400 hover:text-rose-300"
                      title="Delete Layer"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Layer Opacity Bar */}
              <div
                className="px-2.5 pb-1.5 flex items-center gap-2 text-[10px] text-slate-400"
                onClick={(e) => e.stopPropagation()}
              >
                <span>Opacity</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={layer.opacity}
                  onChange={(e) =>
                    setLayerOpacity(layer.id, parseFloat(e.target.value))
                  }
                  className="flex-1 accent-indigo-500 h-1"
                />
                <span className="font-mono w-7 text-right">
                  {Math.round(layer.opacity * 100)}%
                </span>
              </div>

              {/* Child Shapes Tree */}
              {layer.expanded && reversedShapes.length > 0 && (
                <div className="border-t border-[#252a3a] bg-[#10131c] px-1.5 py-1 space-y-0.5 rounded-b-lg">
                  {reversedShapes.map((shape) => {
                    const isSelected = doc.selectedShapeIds.includes(shape.id);
                    return (
                      <div
                        key={shape.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveLayerId(layer.id);
                          if (e.shiftKey) {
                            setSelectedShapeIds(
                              isSelected
                                ? doc.selectedShapeIds.filter(
                                    (id) => id !== shape.id
                                  )
                                : [...doc.selectedShapeIds, shape.id]
                            );
                          } else {
                            setSelectedShapeIds([shape.id]);
                          }
                        }}
                        className={`flex items-center justify-between gap-1 px-2 py-1 rounded text-[11px] cursor-pointer transition ${
                          isSelected
                            ? 'bg-indigo-600/30 text-indigo-100 border border-indigo-500/40'
                            : 'text-slate-400 hover:bg-[#1a1f2e] hover:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center gap-1.5 flex-1 min-w-0">
                          <span
                            className="w-2.5 h-2.5 rounded-full border border-white/30 flex-shrink-0"
                            style={{
                              backgroundColor:
                                shape.style.fill.type === 'none'
                                  ? shape.style.stroke.color
                                  : shape.style.fill.color,
                            }}
                          />
                          <input
                            type="text"
                            value={shape.name}
                            onChange={(e) =>
                              renameShape(shape.id, e.target.value)
                            }
                            onClick={(e) => e.stopPropagation()}
                            className="bg-transparent truncate w-full focus:outline-none focus:bg-[#0d1017] px-1 rounded"
                          />
                        </div>

                        <div
                          className="flex items-center gap-0.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() =>
                              reorderShapeInLayer(layer.id, shape.id, 'up')
                            }
                            className="p-0.5 text-slate-500 hover:text-slate-200"
                            title="Bring Forward"
                          >
                            <ArrowUp className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={() =>
                              reorderShapeInLayer(layer.id, shape.id, 'down')
                            }
                            className="p-0.5 text-slate-500 hover:text-slate-200"
                            title="Send Backward"
                          >
                            <ArrowDown className="w-2.5 h-2.5" />
                          </button>
                          <button
                            onClick={() => toggleShapeLock(shape.id)}
                            className={`p-0.5 ${
                              shape.locked
                                ? 'text-amber-400'
                                : 'text-slate-500 hover:text-slate-200'
                            }`}
                          >
                            {shape.locked ? (
                              <Lock className="w-2.5 h-2.5" />
                            ) : (
                              <Unlock className="w-2.5 h-2.5" />
                            )}
                          </button>
                          <button
                            onClick={() => toggleShapeVisibility(shape.id)}
                            className="p-0.5 text-slate-400 hover:text-white"
                          >
                            {shape.visible ? (
                              <Eye className="w-2.5 h-2.5" />
                            ) : (
                              <EyeOff className="w-2.5 h-2.5 text-slate-600" />
                            )}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};


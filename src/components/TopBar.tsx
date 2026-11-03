import React from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Copy,
  Download,
  FilePlus,
  FolderOpen,
  Grid,
  ImagePlus,
  Magnet,
  Redo2,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  Wand2,
} from 'lucide-react';
import { useDocumentStore } from '../store/useDocumentStore';
import {
  deserializeProject,
  exportDocumentToSvg,
  exportPngWithDialog,
  openReferencePngWithDialog,
  openTextWithDialog,
  parseSvgToLayers,
  saveTextWithDialog,
  serializeProject,
} from '../engine/svgIo';

export const TopBar: React.FC = () => {
  const {
    doc,
    past,
    future,
    activeTool,
    zoom,
    undo,
    redo,
    newDocument,
    loadDocument,
    updateDocumentMeta,
    updateSnapConfig,
    updateShapeBuilderOptions,
    updateSplineToolOptions,
    alignSelectedShapes,
    booleanSelectedShapes,
    convertSelectedToPaths,
    duplicateSelectedShapes,
    deleteSelectedShapes,
    addReferenceLayer,
    importVectorLayers,
    resetViewport,
    setStatusMessage,
  } = useDocumentStore();

  const handleOpenProject = async () => {
    try {
      const res = await openTextWithDialog('SVG-SVG-no-Mi Project', [
        'ssnm',
        'json',
      ]);
      if (!res) return;
      const loaded = deserializeProject(res.contents);
      loadDocument(loaded);
    } catch (err) {
      setStatusMessage(
        `Error opening project: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleSaveProject = async () => {
    try {
      const json = serializeProject(doc);
      const fileName = `${doc.name.toLowerCase().replace(/\s+/g, '-')}.ssnm`;
      const ok = await saveTextWithDialog(
        fileName,
        json,
        'SVG-SVG-no-Mi Project',
        ['ssnm']
      );
      if (ok) setStatusMessage(`Saved project "${fileName}"`);
    } catch (err) {
      setStatusMessage(
        `Error saving project: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleImportSvg = async () => {
    try {
      const res = await openTextWithDialog('SVG Vector File', ['svg']);
      if (!res) return;
      const parsed = parseSvgToLayers(res.contents);
      importVectorLayers(
        parsed.layers,
        parsed.gradients,
        false,
        parsed.width,
        parsed.height
      );
    } catch (err) {
      setStatusMessage(
        `SVG import failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleAddReferencePng = async () => {
    try {
      const res = await openReferencePngWithDialog();
      if (!res) return;
      addReferenceLayer(res);
    } catch (err) {
      setStatusMessage(
        `Reference PNG load failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleExportSvg = async () => {
    try {
      const svgText = exportDocumentToSvg(doc, {
        includeReferenceLayers: false,
      });
      const fileName = `${doc.name.toLowerCase().replace(/\s+/g, '-')}.svg`;
      const ok = await saveTextWithDialog(fileName, svgText, 'SVG Document', [
        'svg',
      ]);
      if (ok) {
        setStatusMessage(
          `Exported clean SVG "${fileName}" (Reference PNGs excluded)`
        );
      }
    } catch (err) {
      setStatusMessage(
        `SVG export failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const handleExportPng = async () => {
    try {
      const ok = await exportPngWithDialog(doc, 2);
      if (ok) setStatusMessage('Exported high-res 2x PNG');
    } catch (err) {
      setStatusMessage(
        `PNG export failed: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  };

  const selectedCount = doc.selectedShapeIds.length;

  return (
    <header className="h-12 bg-[#13161f] border-b border-[#252a3a] px-3 flex items-center justify-between gap-2 text-xs select-none z-20">
      {/* Left: Brand & File Operations */}
      <div className="flex items-center gap-1.5">
        <div className="flex items-center gap-2 pr-2 mr-1 border-r border-[#252a3a]">
          <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-inner font-bold text-white text-sm">
            S
          </div>
          <input
            type="text"
            value={doc.name}
            onChange={(e) => updateDocumentMeta({ name: e.target.value })}
            className="bg-transparent hover:bg-[#1c202e] focus:bg-[#1c202e] focus:outline-none focus:ring-1 focus:ring-indigo-500 px-1.5 py-0.5 rounded font-semibold text-slate-200 w-36 truncate"
            title="Document Name"
          />
        </div>

        <button
          onClick={() => newDocument(false)}
          className="tb-btn"
          title="New Blank Canvas"
        >
          <FilePlus className="w-3.5 h-3.5" />
          <span>New</span>
        </button>

        <button
          onClick={() => newDocument(true)}
          className="tb-btn text-indigo-300 hover:text-indigo-200"
          title="Reset with Overlapping Demo Shapes for Shape Builder"
        >
          <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
          <span>Demo</span>
        </button>

        <button
          onClick={handleOpenProject}
          className="tb-btn"
          title="Open Project (.ssnm)"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Open</span>
        </button>

        <button
          onClick={handleSaveProject}
          className="tb-btn"
          title="Save Project (.ssnm) with Reference PNGs & Layers"
        >
          <Save className="w-3.5 h-3.5" />
          <span>Save</span>
        </button>

        <div className="h-4 w-[1px] bg-[#252a3a] mx-1" />

        <button
          onClick={handleImportSvg}
          className="tb-btn"
          title="Import SVG File into Document"
        >
          <Upload className="w-3.5 h-3.5 text-emerald-400" />
          <span>Import SVG</span>
        </button>

        <button
          onClick={handleAddReferencePng}
          className="tb-btn"
          title="Add Reference PNG Layer for Tracing"
        >
          <ImagePlus className="w-3.5 h-3.5 text-amber-400" />
          <span>Ref PNG</span>
        </button>

        <button
          onClick={handleExportSvg}
          className="tb-btn bg-indigo-600/20 border-indigo-500/40 text-indigo-200 hover:bg-indigo-600/30"
          title="Export Clean SVG"
        >
          <Download className="w-3.5 h-3.5 text-indigo-400" />
          <span>Export SVG</span>
        </button>

        <button
          onClick={handleExportPng}
          className="tb-btn"
          title="Export Raster PNG (2x)"
        >
          <Download className="w-3.5 h-3.5 text-cyan-400" />
          <span>PNG</span>
        </button>

        <div className="h-4 w-[1px] bg-[#252a3a] mx-1" />

        <button
          onClick={undo}
          disabled={past.length === 0}
          className="tb-icon-btn disabled:opacity-30"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 className="w-4 h-4" />
        </button>
        <button
          onClick={redo}
          disabled={future.length === 0}
          className="tb-icon-btn disabled:opacity-30"
          title="Redo (Ctrl+Y)"
        >
          <Redo2 className="w-4 h-4" />
        </button>
      </div>

      {/* Center: Contextual Tool Bar */}
      <div className="flex items-center gap-2 bg-[#191d28] px-3 py-1 rounded-lg border border-[#262b3d]">
        {activeTool === 'shape-builder' && (
          <div className="flex items-center gap-3">
            <span className="text-[11px] font-semibold text-indigo-400 flex items-center gap-1">
              <Wand2 className="w-3.5 h-3.5" />
              Shape Builder:
            </span>
            <div className="flex items-center bg-[#11141c] rounded p-0.5 border border-[#2a3044]">
              <button
                onClick={() => updateShapeBuilderOptions({ mode: 'merge' })}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  doc.shapeBuilderOptions.mode === 'merge'
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                + Merge / Fill
              </button>
              <button
                onClick={() => updateShapeBuilderOptions({ mode: 'erase' })}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition ${
                  doc.shapeBuilderOptions.mode === 'erase'
                    ? 'bg-rose-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Or hold Alt while dragging to erase regions & trim overhanging line tails"
              >
                − Erase / Trim (Alt)
              </button>
            </div>

            <div className="flex items-center gap-1.5" title="Auto-close small gaps between open lines/splines">
              <span className="text-slate-400">Gap Tol:</span>
              <input
                type="range"
                min={0}
                max={15}
                step={1}
                value={doc.shapeBuilderOptions.gapTolerance}
                onChange={(e) =>
                  updateShapeBuilderOptions({
                    gapTolerance: Number(e.target.value),
                  })
                }
                className="w-16 accent-indigo-500"
              />
              <span className="text-slate-200 w-7 font-mono">
                {doc.shapeBuilderOptions.gapTolerance}px
              </span>
            </div>

            <select
              value={doc.shapeBuilderOptions.styleMode}
              onChange={(e) =>
                updateShapeBuilderOptions({
                  styleMode: e.target.value as any,
                })
              }
              className="bg-[#11141c] border border-[#2a3044] rounded px-1.5 py-0.5 text-[11px] text-slate-200"
              title="How merged regions choose their fill & stroke"
            >
              <option value="active-or-inherit">Style: Inherit Filled / Active Swatch</option>
              <option value="always-active">Style: Always Use Active Swatch</option>
              <option value="always-inherit">Style: Always Inherit First Touched</option>
            </select>
          </div>
        )}

        {activeTool === 'spline' && (
          <div className="flex items-center gap-3">
            <span className="text-indigo-400 font-semibold">Smooth Spline:</span>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400">Curve Tension:</span>
              <input
                type="range"
                min={0.1}
                max={0.9}
                step={0.05}
                value={doc.splineToolOptions.tension}
                onChange={(e) =>
                  updateSplineToolOptions({
                    tension: parseFloat(e.target.value),
                  })
                }
                className="w-20 accent-indigo-500"
              />
              <span className="font-mono text-slate-200">
                {Math.round(doc.splineToolOptions.tension * 100)}%
              </span>
            </div>
            <span className="text-slate-400 text-[11px]">
              Click points to curve through • Click start point to close • Enter/Esc to finish
            </span>
          </div>
        )}

        {activeTool === 'pen' && (
          <span className="text-slate-300 text-[11px]">
            <strong className="text-indigo-400">Bézier Pen:</strong> Click for sharp corner • Click &amp; drag to pull smooth tangent handles • Click start to close • Enter/Esc to finish
          </span>
        )}

        {activeTool === 'node' && (
          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-indigo-400 font-semibold">Node Edit:</span>
            <span className="text-slate-300">
              Drag anchors/handles • Alt+Click spline point to toggle Smooth/Corner • Double-click segment to add point
            </span>
            {selectedCount > 0 && (
              <button
                onClick={convertSelectedToPaths}
                className="px-2 py-0.5 rounded bg-[#252a3a] hover:bg-indigo-600 text-slate-200 transition"
              >
                Convert to Raw Path
              </button>
            )}
          </div>
        )}

        {activeTool !== 'shape-builder' &&
          activeTool !== 'spline' &&
          activeTool !== 'pen' &&
          activeTool !== 'node' && (
            <div className="flex items-center gap-1">
              {selectedCount >= 2 && (
                <>
                  <button
                    onClick={() => alignSelectedShapes('left')}
                    className="tb-icon-btn"
                    title="Align Left"
                  >
                    <AlignStartVertical className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => alignSelectedShapes('center')}
                    className="tb-icon-btn"
                    title="Align Horizontal Center"
                  >
                    <AlignCenterVertical className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => alignSelectedShapes('right')}
                    className="tb-icon-btn"
                    title="Align Right"
                  >
                    <AlignEndVertical className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => alignSelectedShapes('top')}
                    className="tb-icon-btn"
                    title="Align Top"
                  >
                    <AlignStartHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => alignSelectedShapes('middle')}
                    className="tb-icon-btn"
                    title="Align Vertical Middle"
                  >
                    <AlignCenterHorizontal className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => alignSelectedShapes('bottom')}
                    className="tb-icon-btn"
                    title="Align Bottom"
                  >
                    <AlignEndHorizontal className="w-3.5 h-3.5" />
                  </button>

                  <div className="h-4 w-[1px] bg-[#2a3044] mx-1" />

                  <button
                    onClick={() => booleanSelectedShapes('unite')}
                    className="px-1.5 py-0.5 rounded bg-[#232838] hover:bg-indigo-600 text-slate-200 text-[11px]"
                    title="Boolean Unite Selected"
                  >
                    Unite
                  </button>
                  <button
                    onClick={() => booleanSelectedShapes('subtract')}
                    className="px-1.5 py-0.5 rounded bg-[#232838] hover:bg-indigo-600 text-slate-200 text-[11px]"
                    title="Boolean Subtract"
                  >
                    Subtract
                  </button>
                  <button
                    onClick={() => booleanSelectedShapes('intersect')}
                    className="px-1.5 py-0.5 rounded bg-[#232838] hover:bg-indigo-600 text-slate-200 text-[11px]"
                    title="Boolean Intersect"
                  >
                    Intersect
                  </button>
                  <div className="h-4 w-[1px] bg-[#2a3044] mx-1" />
                </>
              )}

              {selectedCount >= 1 ? (
                <>
                  <button
                    onClick={convertSelectedToPaths}
                    className="px-2 py-0.5 rounded bg-[#232838] hover:bg-indigo-600 text-slate-200 text-[11px]"
                    title="Convert parametric shape/spline to cubic Bézier path"
                  >
                    To Path
                  </button>
                  <button
                    onClick={duplicateSelectedShapes}
                    className="tb-icon-btn"
                    title="Duplicate Selected (Ctrl+D)"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={deleteSelectedShapes}
                    className="tb-icon-btn text-rose-400 hover:text-rose-300"
                    title="Delete Selected (Del)"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              ) : (
                <span className="text-slate-400 text-[11px] px-1">
                  {activeTool === 'eyedropper'
                    ? 'Eyedropper: Click any vector shape or Reference PNG pixel to sample Fill color (Shift+Click for Stroke)'
                    : 'Select shapes or pick a drawing tool — Press Shift+M for Shape Builder'}
                </span>
              )}
            </div>
          )}
      </div>

      {/* Right: Snapping, Grid & Zoom Controls */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() =>
            updateSnapConfig({ enabled: !doc.snapConfig.enabled })
          }
          className={`tb-btn ${
            doc.snapConfig.enabled
              ? 'bg-indigo-600/25 border-indigo-500/50 text-indigo-200'
              : 'opacity-60'
          }`}
          title="Toggle Smart Snapping (Anchors, Intersections, Path Edges)"
        >
          <Magnet className="w-3.5 h-3.5 text-indigo-400" />
          <span>Snap</span>
        </button>

        {doc.snapConfig.enabled && (
          <div className="flex items-center bg-[#181c26] rounded border border-[#252a3a] p-0.5 text-[10px]">
            <button
              onClick={() =>
                updateSnapConfig({
                  snapToAnchors: !doc.snapConfig.snapToAnchors,
                })
              }
              className={`px-1.5 py-0.5 rounded ${
                doc.snapConfig.snapToAnchors
                  ? 'bg-indigo-600/40 text-white'
                  : 'text-slate-500'
              }`}
              title="Snap to Anchor Points & Endpoints"
            >
              Pts
            </button>
            <button
              onClick={() =>
                updateSnapConfig({
                  snapToIntersections: !doc.snapConfig.snapToIntersections,
                })
              }
              className={`px-1.5 py-0.5 rounded ${
                doc.snapConfig.snapToIntersections
                  ? 'bg-indigo-600/40 text-white'
                  : 'text-slate-500'
              }`}
              title="Snap to Curve Intersections"
            >
              Int
            </button>
            <button
              onClick={() =>
                updateSnapConfig({
                  snapToCurves: !doc.snapConfig.snapToCurves,
                })
              }
              className={`px-1.5 py-0.5 rounded ${
                doc.snapConfig.snapToCurves
                  ? 'bg-indigo-600/40 text-white'
                  : 'text-slate-500'
              }`}
              title="Snap onto Path Edges"
            >
              Edge
            </button>
            <button
              onClick={() =>
                updateSnapConfig({
                  snapToGrid: !doc.snapConfig.snapToGrid,
                })
              }
              className={`px-1.5 py-0.5 rounded ${
                doc.snapConfig.snapToGrid
                  ? 'bg-indigo-600/40 text-white'
                  : 'text-slate-500'
              }`}
              title="Snap to Grid"
            >
              Grid
            </button>
          </div>
        )}

        <button
          onClick={() => updateDocumentMeta({ showGrid: !doc.showGrid })}
          className={`tb-icon-btn ${
            doc.showGrid ? 'text-indigo-400 bg-[#1e2333]' : 'text-slate-500'
          }`}
          title="Toggle Canvas Grid"
        >
          <Grid className="w-3.5 h-3.5" />
        </button>

        <button
          onClick={resetViewport}
          className="px-2 py-1 rounded bg-[#191d28] hover:bg-[#232838] border border-[#252a3a] font-mono text-[11px] text-slate-300"
          title="Click to Reset Zoom (90%)"
        >
          {Math.round(zoom * 100)}%
        </button>
      </div>
    </header>
  );
};


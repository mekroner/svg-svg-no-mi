import React from 'react';
import {
  Circle,
  Hand,
  Image,
  Minus,
  MousePointer,
  MousePointerClick,
  PenTool,
  Pipette,
  Spline,
  Square,
  Wand2,
} from 'lucide-react';
import { ToolType } from '../types/document';
import { useDocumentStore } from '../store/useDocumentStore';

interface ToolDef {
  id: ToolType;
  label: string;
  shortcut: string;
  icon: React.ReactNode;
  accent?: boolean;
}

const TOOLS: ToolDef[] = [
  {
    id: 'select',
    label: 'Select & Transform',
    shortcut: 'V',
    icon: <MousePointer className="w-4 h-4" />,
  },
  {
    id: 'node',
    label: 'Node / Direct Edit (Spline & Bézier Points)',
    shortcut: 'A',
    icon: <MousePointerClick className="w-4 h-4" />,
  },
  {
    id: 'rect',
    label: 'Rectangle (Hold Shift for Square)',
    shortcut: 'R',
    icon: <Square className="w-4 h-4" />,
  },
  {
    id: 'ellipse',
    label: 'Circle / Ellipse (Hold Shift for Circle)',
    shortcut: 'O',
    icon: <Circle className="w-4 h-4" />,
  },
  {
    id: 'line',
    label: 'Line Segment (Hold Shift for 45° Angles)',
    shortcut: 'L',
    icon: <Minus className="w-4 h-4 -rotate-45" />,
  },
  {
    id: 'spline',
    label: 'Smooth Point-Pass-Through Spline',
    shortcut: 'S',
    icon: <Spline className="w-4 h-4" />,
  },
  {
    id: 'pen',
    label: 'Classic Cubic Bézier Pen Tool',
    shortcut: 'P',
    icon: <PenTool className="w-4 h-4" />,
  },
  {
    id: 'shape-builder',
    label: 'Shape Builder — Brush across regions to merge, Alt+Brush to erase/trim',
    shortcut: '⇧M',
    icon: <Wand2 className="w-4 h-4" />,
    accent: true,
  },
  {
    id: 'eyedropper',
    label: 'Eyedropper — Sample colors from Shapes or Reference PNGs',
    shortcut: 'I',
    icon: <Pipette className="w-4 h-4" />,
  },
  {
    id: 'reference-transform',
    label: 'Move / Scale Reference PNG Layer',
    shortcut: 'T',
    icon: <Image className="w-4 h-4" />,
  },
  {
    id: 'hand',
    label: 'Pan Canvas (Or hold Spacebar)',
    shortcut: 'H',
    icon: <Hand className="w-4 h-4" />,
  },
];

export const LeftToolbar: React.FC = () => {
  const {
    activeTool,
    setActiveTool,
    activeStyle,
    setActiveFill,
    setActiveStroke,
  } = useDocumentStore();

  return (
    <aside className="w-14 bg-[#13161f] border-r border-[#252a3a] flex flex-col items-center py-2.5 justify-between select-none z-10">
      <div className="flex flex-col items-center gap-1.5 w-full px-1.5">
        {TOOLS.map((tool) => {
          const isActive = activeTool === tool.id;
          return (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              title={`${tool.label} (${tool.shortcut})`}
              className={`relative w-10 h-10 rounded-lg flex items-center justify-center transition group ${
                isActive
                  ? tool.accent
                    ? 'bg-gradient-to-br from-indigo-500 to-purple-600 text-white shadow-md shadow-indigo-900/50'
                    : 'bg-indigo-600 text-white shadow-sm'
                  : tool.accent
                  ? 'bg-indigo-950/50 text-indigo-300 border border-indigo-500/30 hover:bg-indigo-900/60'
                  : 'text-slate-400 hover:bg-[#1e2332] hover:text-slate-200'
              }`}
            >
              {tool.icon}
              <span className="absolute bottom-0.5 right-1 text-[8px] font-mono opacity-60">
                {tool.shortcut}
              </span>
            </button>
          );
        })}
      </div>

      {/* Bottom Swatches: Fill & Stroke */}
      <div className="flex flex-col items-center gap-2 pt-2 border-t border-[#252a3a] w-full">
        <div className="relative w-10 h-10" title="Active Fill & Stroke Colors">
          {/* Fill Swatch */}
          <label
            className="absolute top-0 left-0.5 w-6 h-6 rounded border-2 border-slate-200 shadow cursor-pointer overflow-hidden flex items-center justify-center z-10"
            style={{
              backgroundColor:
                activeStyle.fill.type === 'none'
                  ? '#1a1d28'
                  : activeStyle.fill.color,
            }}
            title="Fill Color"
          >
            {activeStyle.fill.type === 'none' && (
              <div className="w-8 h-[2px] bg-rose-500 rotate-45" />
            )}
            <input
              type="color"
              value={activeStyle.fill.color}
              onChange={(e) =>
                setActiveFill({ type: 'solid', color: e.target.value })
              }
              className="opacity-0 w-0 h-0 absolute"
            />
          </label>

          {/* Stroke Swatch */}
          <label
            className="absolute bottom-0 right-0.5 w-6 h-6 rounded border-2 border-[#13161f] cursor-pointer flex items-center justify-center"
            style={{ backgroundColor: activeStyle.stroke.color }}
            title="Stroke Color"
          >
            <div className="w-2.5 h-2.5 bg-[#13161f] rounded-[1px]" />
            <input
              type="color"
              value={activeStyle.stroke.color}
              onChange={(e) => setActiveStroke({ color: e.target.value })}
              className="opacity-0 w-0 h-0 absolute"
            />
          </label>
        </div>

        <button
          onClick={() =>
            setActiveFill({
              type: activeStyle.fill.type === 'none' ? 'solid' : 'none',
            })
          }
          className={`text-[9px] px-1.5 py-0.5 rounded border transition ${
            activeStyle.fill.type === 'none'
              ? 'border-rose-500/60 text-rose-300 bg-rose-950/30'
              : 'border-[#2a3044] text-slate-400 hover:text-slate-200'
          }`}
          title="Toggle Fill On / None"
        >
          {activeStyle.fill.type === 'none' ? 'No Fill' : 'Filled'}
        </button>
      </div>
    </aside>
  );
};


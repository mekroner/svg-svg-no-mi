import React from 'react';
import { TopBar } from './components/TopBar';
import { LeftToolbar } from './components/LeftToolbar';
import { CanvasViewport } from './components/CanvasViewport';
import { RightInspector } from './components/RightInspector';
import { LayerTreePanel } from './components/LayerTreePanel';

export const App: React.FC = () => {
  return (
    <div className="h-screen w-screen flex flex-col bg-[#0e1015] text-slate-200 overflow-hidden">
      <TopBar />
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <LeftToolbar />
        <CanvasViewport />
        <aside className="w-72 bg-[#13161f] border-l border-[#252a3a] flex flex-col min-h-0 z-10">
          <RightInspector />
          <LayerTreePanel />
        </aside>
      </div>
    </div>
  );
};

export default App;


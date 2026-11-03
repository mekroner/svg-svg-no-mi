# SVG-SVG-no-Mi — Vector Graphics Studio (Tauri v2)

An easy-to-use desktop SVG vector graphics editor built with **Tauri v2**, **React + TypeScript + Vite**, and a **Planar-Graph Geometry Engine** powered by **Paper.js**.

## Key Features

- **Parametric Basic Shapes & Smooth Splines**:
  - **Rectangle (`R`)**, **Circle/Ellipse (`O`)**, **Line (`L`)** remain parametrically editable (dimensions, rounded corner radius `rx`/`ry`) until converted to raw paths or merged in the Shape Builder.
  - **Smooth Point-Pass-Through Spline (`S`)**: Click points and the curve smoothly passes through every point automatically using chord-aware Catmull-Rom tangents (great for tracing Reference PNGs!). Toggle any point between smooth and sharp corner via `Alt+Click` in Node Edit mode (`A`).
  - **Classic Cubic Bézier Pen (`P`)**: Click for sharp corners, click-and-drag to pull out cubic Bézier tangent handles.
- **Illustrator-Style Planar-Graph Shape Builder (`Shift+M`)**:
  - Works on **both overlapping closed shapes AND intersecting open lines/splines**.
  - Splits curves at every intersection to detect enclosed minimal regions and overhanging dangling line tails.
  - **Merge / Extract (`+` Drag)**: Brush across enclosed regions to unite them into a single closed shape, or click a region bounded by open lines/splines to fill and extract it.
  - **Erase / Trim (`Hold Alt` or `−` Mode)**: Brush over enclosed regions to subtract/cut holes, or brush over overhanging line/spline tails to trim them cleanly at their intersection!
  - **Gap Tolerance (`0–15px`)**: Automatically bridges small unintentional gaps between open endpoints so nearly-touching lines still enclose valid regions.
- **Multi-Layer Tree & Reference PNG Layers**:
  - Expandable Vector Layer tree (`VectorLayer`) with per-layer and per-shape visibility, lock, opacity, and z-order reordering.
  - Dedicated **Reference PNG Layers (`ReferenceLayer`)**: Import PNG/JPG reference images, adjust opacity (`45%` default), lock in place while tracing, unlock to move/scale/rotate, and automatically exclude them from clean SVG exports.
- **Eyedropper (`I`)**:
  - Samples fill/stroke colors from vector shapes OR samples exact pixel colors directly from visible Reference PNG layers (`Shift+Click` applies to Stroke).
- **Import, Export & Project Persistence**:
  - Save/Open full `.ssnm` project files (preserving Reference PNGs, layers, and parametric splines).
  - Import external `.svg` files into editable layers and shapes.
  - Export clean standards-compliant `.svg` and high-res `2x` `.png` files.

## Development & Build Commands

### Linux (Ubuntu 24.04) System Prerequisites for Tauri v2
If not already installed, install the WebKitGTK and GTK3 development headers required by Tauri v2 on Ubuntu:
```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```

```bash
# Install dependencies
npm install

# Run unit tests (Vitest)
npm test

# Start web studio dev server
npm run dev

# Launch Tauri desktop window
npm run tauri dev

# Build production Tauri desktop bundle
npm run tauri build
```


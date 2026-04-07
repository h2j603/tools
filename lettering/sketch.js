/* ═══════════════════════════════════════════
   Lettering Tool v5 — Pixel-to-Vector
   Paint pixels on grid → auto-trace outline → smooth bezier → SVG
   ═══════════════════════════════════════════ */
(() => {
    const state = {
        // Canvas
        canvasW: 1080, canvasH: 1080,
        bgColor: '#0c0c0e',
        fillColor: '#e8e8ec',
        // Grid of pixels
        gridCols: 36, gridRows: 36,
        pixels: null, // Uint8Array, 1 = filled
        // Vectorized paths (generated from pixels)
        paths: [], // [{ points:[{x,y}], smoothed:[{x,y,hox,hoy,hix,hiy}] }]
        // Tool
        tool: 'draw', // 'draw' | 'erase' | 'select'
        penMode: 'curve', // 'curve' | 'line' (for manual anchor editing)
        // View
        zoom: 1, panX: 0, panY: 0,
        showGrid: true, showPixels: true, showOutline: true, showFill: true,
        smoothAmount: 0.3,
        // Select state (for editing vectorized anchors)
        activePath: -1,
        dragTarget: null,
        isDragging: false,
        // Ref
        refImage: null, refOpacity: 0.3,
    };

    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas.getContext('2d');
    const canvasArea = document.getElementById('canvas-area');
    let activePointers = new Map();
    let pinchStartDist = 0, pinchStartZoom = 1;
    let isPointerDown = false;
    const HIT_R = 18;

    // ══════════════════════
    // INIT
    // ══════════════════════
    function init() {
        state.pixels = new Uint8Array(state.gridCols * state.gridRows);
        fitView();
        bindPointerEvents();
        bindUI();
        bindKeyboard();
        render();
    }

    function fitView() {
        const aw = canvasArea.clientWidth - 20, ah = canvasArea.clientHeight - 20;
        state.zoom = Math.min(aw / state.canvasW, ah / state.canvasH, 1);
        state.panX = (canvasArea.clientWidth - state.canvasW * state.zoom) / 2;
        state.panY = (canvasArea.clientHeight - state.canvasH * state.zoom) / 2;
        applyTransform(); updateInfo();
    }

    function applyTransform() {
        canvas.width = state.canvasW; canvas.height = state.canvasH;
        canvas.style.width = (state.canvasW * state.zoom) + 'px';
        canvas.style.height = (state.canvasH * state.zoom) + 'px';
        canvas.style.left = state.panX + 'px';
        canvas.style.top = state.panY + 'px';
    }

    function canvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / state.zoom,
            y: (e.clientY - rect.top) / state.zoom,
        };
    }

    function cellSize() {
        return { w: state.canvasW / state.gridCols, h: state.canvasH / state.gridRows };
    }

    function pxIdx(col, row) { return row * state.gridCols + col; }
    function getPx(col, row) {
        if (col < 0 || col >= state.gridCols || row < 0 || row >= state.gridRows) return 0;
        return state.pixels[pxIdx(col, row)];
    }
    function setPx(col, row, val) {
        if (col < 0 || col >= state.gridCols || row < 0 || row >= state.gridRows) return;
        state.pixels[pxIdx(col, row)] = val;
    }

    // ══════════════════════
    // POINTER EVENTS
    // ══════════════════════
    function bindPointerEvents() {
        canvasArea.addEventListener('pointerdown', onDown, { passive: false });
        canvasArea.addEventListener('pointermove', onMove, { passive: false });
        canvasArea.addEventListener('pointerup', onUp);
        canvasArea.addEventListener('pointercancel', onUp);
        canvasArea.addEventListener('wheel', onWheel, { passive: false });
    }

    function onDown(e) {
        e.preventDefault();
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 2) {
            const pts = [...activePointers.values()];
            pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            pinchStartZoom = state.zoom;
            return;
        }
        if (activePointers.size > 2) return;

        isPointerDown = true;
        const pt = canvasCoords(e);
        canvasArea.setPointerCapture(e.pointerId);

        if (state.tool === 'draw' || state.tool === 'erase') {
            paintAt(pt, state.tool === 'draw');
            render();
            return;
        }
        if (state.tool === 'select') {
            const hit = hitTestAnchors(pt);
            if (hit) {
                state.dragTarget = hit;
                state.isDragging = true;
            }
            render();
        }
    }

    function onMove(e) {
        e.preventDefault();
        const prev = activePointers.get(e.pointerId);
        if (!prev) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Pinch
        if (activePointers.size === 2) {
            const pts = [...activePointers.values()];
            const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            const newZoom = Math.max(0.1, Math.min(10, pinchStartZoom * (dist / pinchStartDist)));
            const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
            state.panX += dx / 2; state.panY += dy / 2;
            const ar = canvasArea.getBoundingClientRect();
            const midX = (pts[0].x + pts[1].x) / 2 - ar.left;
            const midY = (pts[0].y + pts[1].y) / 2 - ar.top;
            const cxB = (midX - state.panX) / state.zoom, cyB = (midY - state.panY) / state.zoom;
            state.zoom = newZoom;
            state.panX = midX - cxB * state.zoom; state.panY = midY - cyB * state.zoom;
            applyTransform(); render(); updateInfo();
            return;
        }
        if (!isPointerDown) return;
        const pt = canvasCoords(e);

        if (state.tool === 'draw' || state.tool === 'erase') {
            paintAt(pt, state.tool === 'draw');
            render();
            return;
        }
        if (state.tool === 'select' && state.isDragging && state.dragTarget) {
            const path = state.paths[state.dragTarget.pathIdx];
            if (!path) return;
            const a = path.smoothed[state.dragTarget.anchorIdx];
            if (state.dragTarget.type === 'anchor') { a.x = pt.x; a.y = pt.y; }
            else if (state.dragTarget.type === 'handleOut') { a.hox = pt.x - a.x; a.hoy = pt.y - a.y; }
            else if (state.dragTarget.type === 'handleIn') { a.hix = pt.x - a.x; a.hiy = pt.y - a.y; }
            render();
        }
    }

    function onUp(e) {
        activePointers.delete(e.pointerId);
        if (isPointerDown && (state.tool === 'draw' || state.tool === 'erase')) {
            vectorize(); // re-trace after painting
            render();
        }
        isPointerDown = false;
        state.isDragging = false;
        state.dragTarget = null;
    }

    function onWheel(e) {
        e.preventDefault();
        const ar = canvasArea.getBoundingClientRect();
        const mx = e.clientX - ar.left, my = e.clientY - ar.top;
        const cxB = (mx - state.panX) / state.zoom, cyB = (my - state.panY) / state.zoom;
        state.zoom = Math.max(0.1, Math.min(10, state.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
        state.panX = mx - cxB * state.zoom; state.panY = my - cyB * state.zoom;
        applyTransform(); render(); updateInfo();
    }

    function paintAt(pt, fill) {
        const cs = cellSize();
        const col = Math.floor(pt.x / cs.w);
        const row = Math.floor(pt.y / cs.h);
        setPx(col, row, fill ? 1 : 0);
    }


    // ══════════════════════
    // MARCHING SQUARES — extract contour from pixel grid
    // Returns array of contours, each is array of {x,y} points
    // ══════════════════════
    function marchingSquares() {
        const cs = cellSize();
        const cols = state.gridCols, rows = state.gridRows;
        const visited = new Set();
        const contours = [];

        // For each cell, compute marching squares index
        function cellVal(c, r) { return getPx(c, r); }

        // Find all contour edges
        // We walk the boundary between filled and empty cells
        function traceContour(startC, startR, startEdge) {
            const points = [];
            let c = startC, r = startR, edge = startEdge;
            const maxSteps = cols * rows * 4;
            let steps = 0;

            do {
                const key = `${c},${r},${edge}`;
                if (visited.has(key)) break;
                visited.add(key);

                // Midpoint of edge in canvas coords
                const cx = c * cs.w, cy = r * cs.h;
                let px, py;
                if (edge === 0) { px = cx + cs.w / 2; py = cy; }           // top
                else if (edge === 1) { px = cx + cs.w; py = cy + cs.h / 2; } // right
                else if (edge === 2) { px = cx + cs.w / 2; py = cy + cs.h; } // bottom
                else { px = cx; py = cy + cs.h / 2; }                        // left

                points.push({ x: px, y: py });

                // Walk to next edge (clockwise)
                // Get the 4 corners of current cell: TL, TR, BR, BL
                const tl = cellVal(c, r);
                const tr = cellVal(c + 1, r);
                const br = cellVal(c + 1, r + 1);
                const bl = cellVal(c, r + 1);
                const idx = (tl << 3) | (tr << 2) | (br << 1) | bl;

                // Determine next edge based on marching squares lookup
                let nextEdge = -1, nc = c, nr = r;

                if (edge === 0) { // entered from top
                    if (tr && !br) { nextEdge = 1; }
                    else if (br && !tr) { nextEdge = 1; }
                    else if (bl) { nextEdge = 2; }
                    else { nextEdge = 3; }
                } else if (edge === 1) { // entered from right
                    if (br && !bl) { nextEdge = 2; }
                    else if (bl && !br) { nextEdge = 2; }
                    else if (tl) { nextEdge = 3; }
                    else { nextEdge = 0; }
                } else if (edge === 2) { // entered from bottom
                    if (bl && !tl) { nextEdge = 3; }
                    else if (tl && !bl) { nextEdge = 3; }
                    else if (tr) { nextEdge = 0; }
                    else { nextEdge = 1; }
                } else { // entered from left (3)
                    if (tl && !tr) { nextEdge = 0; }
                    else if (tr && !tl) { nextEdge = 0; }
                    else if (br) { nextEdge = 1; }
                    else { nextEdge = 2; }
                }

                // Move to neighbor cell
                if (nextEdge === 0) { nr = r - 1; nc = c; edge = 2; }
                else if (nextEdge === 1) { nc = c + 1; nr = r; edge = 3; }
                else if (nextEdge === 2) { nr = r + 1; nc = c; edge = 0; }
                else { nc = c - 1; nr = r; edge = 1; }

                c = nc; r = nr;
                steps++;
            } while (steps < maxSteps);

            return points;
        }

        // Scan for boundary edges
        for (let r = -1; r <= rows; r++) {
            for (let c = -1; c <= cols; c++) {
                // Check top edge: if cell is filled and above is empty
                if (cellVal(c, r) && !cellVal(c, r - 1)) {
                    const key = `${c},${r},0`;
                    if (!visited.has(key)) {
                        const contour = traceContour(c, r, 0);
                        if (contour.length >= 3) contours.push(contour);
                    }
                }
            }
        }
        return contours;
    }

    // ══════════════════════
    // SIMPLE CONTOUR TRACE — walk the pixel boundary
    // More reliable than marching squares for grid-aligned pixels
    // ══════════════════════
    function tracePixelOutlines() {
        const cs = cellSize();
        const cols = state.gridCols, rows = state.gridRows;
        const contours = [];

        // Build edge segments between filled and empty
        const edges = []; // [{x1,y1,x2,y2}]
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!getPx(c, r)) continue;
                const x = c * cs.w, y = r * cs.h;
                // Top edge
                if (!getPx(c, r - 1)) edges.push({ x1: x, y1: y, x2: x + cs.w, y2: y });
                // Bottom edge
                if (!getPx(c, r + 1)) edges.push({ x1: x + cs.w, y1: y + cs.h, x2: x, y2: y + cs.h });
                // Left edge
                if (!getPx(c - 1, r)) edges.push({ x1: x, y1: y + cs.h, x2: x, y2: y });
                // Right edge
                if (!getPx(c + 1, r)) edges.push({ x1: x + cs.w, y1: y, x2: x + cs.w, y2: y + cs.h });
            }
        }

        // Chain edges into contours
        const used = new Array(edges.length).fill(false);
        const eps = 0.01;

        function findNext(x, y, skipIdx) {
            for (let i = 0; i < edges.length; i++) {
                if (used[i] || i === skipIdx) continue;
                if (Math.abs(edges[i].x1 - x) < eps && Math.abs(edges[i].y1 - y) < eps) return i;
            }
            return -1;
        }

        for (let start = 0; start < edges.length; start++) {
            if (used[start]) continue;
            const contour = [];
            let idx = start;
            while (idx >= 0 && !used[idx]) {
                used[idx] = true;
                contour.push({ x: edges[idx].x1, y: edges[idx].y1 });
                idx = findNext(edges[idx].x2, edges[idx].y2, idx);
            }
            if (contour.length >= 3) contours.push(contour);
        }

        return contours;
    }

    // ══════════════════════
    // VECTORIZE — pixel outlines → simplified → smoothed bezier
    // ══════════════════════
    function vectorize() {
        const contours = tracePixelOutlines();
        state.paths = contours.map(pts => {
            const simplified = rdpSimplify(pts, state.smoothAmount * cellSize().w * 0.8 + 1);
            const smoothed = smoothAnchors(simplified);
            return { points: pts, smoothed };
        });
        updateInfo();
    }

    // RDP simplification
    function rdpSimplify(pts, epsilon) {
        if (pts.length <= 2) return pts.slice();
        let maxDist = 0, maxIdx = 0;
        const first = pts[0], last = pts[pts.length - 1];
        for (let i = 1; i < pts.length - 1; i++) {
            const d = ptLineDist(pts[i], first, last);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }
        if (maxDist > epsilon) {
            const left = rdpSimplify(pts.slice(0, maxIdx + 1), epsilon);
            const right = rdpSimplify(pts.slice(maxIdx), epsilon);
            return left.slice(0, -1).concat(right);
        }
        return [first, last];
    }

    function ptLineDist(p, a, b) {
        const dx = b.x - a.x, dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy;
        if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
        return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    }

    // Convert simplified points to smooth bezier anchors
    function smoothAnchors(pts) {
        const n = pts.length;
        return pts.map((p, i) => {
            const prev = pts[(i - 1 + n) % n];
            const next = pts[(i + 1) % n];
            const dx = next.x - prev.x, dy = next.y - prev.y;
            const len = Math.hypot(dx, dy) || 1;
            const ux = dx / len, uy = dy / len;
            const dPrev = Math.hypot(p.x - prev.x, p.y - prev.y);
            const dNext = Math.hypot(next.x - p.x, next.y - p.y);
            const sm = state.smoothAmount;
            return {
                x: p.x, y: p.y,
                hix: -ux * dPrev * sm, hiy: -uy * dPrev * sm,
                hox: ux * dNext * sm, hoy: uy * dNext * sm,
            };
        });
    }


    // ══════════════════════
    // HIT TEST (for select tool)
    // ══════════════════════
    function hitTestAnchors(pt) {
        const r = HIT_R / state.zoom;
        for (let pi = 0; pi < state.paths.length; pi++) {
            const path = state.paths[pi];
            for (let ai = 0; ai < path.smoothed.length; ai++) {
                const a = path.smoothed[ai];
                if (Math.hypot(pt.x - (a.x + a.hox), pt.y - (a.y + a.hoy)) < r)
                    return { pathIdx: pi, anchorIdx: ai, type: 'handleOut' };
                if (Math.hypot(pt.x - (a.x + a.hix), pt.y - (a.y + a.hiy)) < r)
                    return { pathIdx: pi, anchorIdx: ai, type: 'handleIn' };
                if (Math.hypot(pt.x - a.x, pt.y - a.y) < r)
                    return { pathIdx: pi, anchorIdx: ai, type: 'anchor' };
            }
        }
        return null;
    }

    // ══════════════════════
    // RENDER
    // ══════════════════════
    function render() {
        const c = ctx;
        c.clearRect(0, 0, canvas.width, canvas.height);

        // Background
        c.fillStyle = state.bgColor;
        c.fillRect(0, 0, state.canvasW, state.canvasH);

        // Reference image
        if (state.refImage) {
            c.save(); c.globalAlpha = state.refOpacity;
            c.drawImage(state.refImage, 0, 0, state.canvasW, state.canvasH);
            c.restore();
        }

        // Grid
        if (state.showGrid) drawGrid(c);

        // Pixels
        if (state.showPixels) drawPixels(c);

        // Vectorized paths — fill
        if (state.showFill) {
            for (const path of state.paths) {
                drawBezierPath(c, path.smoothed, true, false);
            }
        }

        // Vectorized paths — outline
        if (state.showOutline) {
            for (const path of state.paths) {
                drawBezierPath(c, path.smoothed, false, true);
            }
        }

        // Handles (in select mode)
        if (state.tool === 'select') {
            for (const path of state.paths) {
                drawHandles(c, path.smoothed);
            }
        }
    }

    function drawGrid(c) {
        const cs = cellSize();
        const isDark = isColorDark(state.bgColor);
        c.save();
        c.strokeStyle = isDark ? 'rgba(180,200,255,0.18)' : 'rgba(0,0,80,0.12)';
        c.lineWidth = 0.5;
        for (let col = 0; col <= state.gridCols; col++) {
            const x = col * cs.w;
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, state.canvasH); c.stroke();
        }
        for (let row = 0; row <= state.gridRows; row++) {
            const y = row * cs.h;
            c.beginPath(); c.moveTo(0, y); c.lineTo(state.canvasW, y); c.stroke();
        }
        // Center lines
        c.strokeStyle = isDark ? 'rgba(180,200,255,0.4)' : 'rgba(0,0,80,0.3)';
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(state.canvasW / 2, 0); c.lineTo(state.canvasW / 2, state.canvasH); c.stroke();
        c.beginPath(); c.moveTo(0, state.canvasH / 2); c.lineTo(state.canvasW, state.canvasH / 2); c.stroke();
        c.restore();
    }

    function drawPixels(c) {
        const cs = cellSize();
        const isDark = isColorDark(state.bgColor);
        c.save();
        c.fillStyle = isDark ? 'rgba(180,200,255,0.15)' : 'rgba(0,0,80,0.1)';
        for (let r = 0; r < state.gridRows; r++) {
            for (let col = 0; col < state.gridCols; col++) {
                if (getPx(col, r)) {
                    c.fillRect(col * cs.w, r * cs.h, cs.w, cs.h);
                }
            }
        }
        c.restore();
    }

    function drawBezierPath(c, anchors, fill, stroke) {
        if (!anchors || anchors.length < 2) return;
        c.save();
        c.beginPath();
        c.moveTo(anchors[0].x, anchors[0].y);
        for (let i = 0; i < anchors.length; i++) {
            const a0 = anchors[i], a1 = anchors[(i + 1) % anchors.length];
            c.bezierCurveTo(
                a0.x + a0.hox, a0.y + a0.hoy,
                a1.x + a1.hix, a1.y + a1.hiy,
                a1.x, a1.y
            );
        }
        c.closePath();
        if (fill) {
            c.fillStyle = state.fillColor;
            c.globalAlpha = 0.85;
            c.fill('evenodd');
        }
        if (stroke) {
            c.strokeStyle = state.fillColor;
            c.lineWidth = 2;
            c.globalAlpha = 1;
            c.stroke();
        }
        c.restore();
    }

    function drawHandles(c, anchors) {
        if (!anchors) return;
        c.save();
        for (let i = 0; i < anchors.length; i++) {
            const p = anchors[i];
            const hix = p.x + p.hix, hiy = p.y + p.hiy;
            const hox = p.x + p.hox, hoy = p.y + p.hoy;
            // Handle lines
            c.strokeStyle = 'rgba(108,138,255,0.7)';
            c.lineWidth = 1.5; c.setLineDash([]);
            c.beginPath(); c.moveTo(hix, hiy); c.lineTo(p.x, p.y); c.lineTo(hox, hoy); c.stroke();
            // Handle dots
            c.fillStyle = '#6c8aff';
            [{ x: hix, y: hiy }, { x: hox, y: hoy }].forEach(h => {
                c.beginPath(); c.arc(h.x, h.y, 5, 0, Math.PI * 2); c.fill();
            });
            // Anchor square
            const sz = 6;
            c.fillStyle = '#fff'; c.strokeStyle = '#6c8aff'; c.lineWidth = 2;
            c.fillRect(p.x - sz, p.y - sz, sz * 2, sz * 2);
            c.strokeRect(p.x - sz, p.y - sz, sz * 2, sz * 2);
        }
        c.restore();
    }

    // ══════════════════════
    // EXPORT
    // ══════════════════════
    function exportSVG() {
        const svgPaths = state.paths.map(path => {
            const a = path.smoothed;
            if (!a || a.length < 2) return '';
            const r = n => Math.round(n * 100) / 100;
            let d = `M ${r(a[0].x)} ${r(a[0].y)}`;
            for (let i = 0; i < a.length; i++) {
                const a0 = a[i], a1 = a[(i + 1) % a.length];
                d += ` C ${r(a0.x + a0.hox)} ${r(a0.y + a0.hoy)}, ${r(a1.x + a1.hix)} ${r(a1.y + a1.hiy)}, ${r(a1.x)} ${r(a1.y)}`;
            }
            d += ' Z';
            return `  <path d="${d}" fill="${state.fillColor}"/>`;
        }).filter(Boolean);

        const svg = [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${state.canvasW} ${state.canvasH}" width="${state.canvasW}" height="${state.canvasH}">`,
            `  <rect width="100%" height="100%" fill="${state.bgColor}"/>`,
            ...svgPaths,
            `</svg>`
        ].join('\n');
        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.download = `lettering_${Date.now()}.svg`;
        a.href = URL.createObjectURL(blob); a.click();
        URL.revokeObjectURL(a.href);
    }

    function exportPNG() {
        const ec = document.createElement('canvas');
        ec.width = state.canvasW; ec.height = state.canvasH;
        const ex = ec.getContext('2d');
        ex.fillStyle = state.bgColor; ex.fillRect(0, 0, state.canvasW, state.canvasH);
        for (const path of state.paths) drawBezierPath(ex, path.smoothed, true, false);
        const a = document.createElement('a');
        a.download = `lettering_${Date.now()}.png`;
        a.href = ec.toDataURL('image/png'); a.click();
    }

    function showFullscreen() {
        const v = document.getElementById('fullscreen-view');
        const fc = document.getElementById('fullscreenCanvas');
        v.classList.remove('hidden');
        fc.width = state.canvasW; fc.height = state.canvasH;
        const fctx = fc.getContext('2d');
        fctx.fillStyle = state.bgColor; fctx.fillRect(0, 0, state.canvasW, state.canvasH);
        for (const path of state.paths) drawBezierPath(fctx, path.smoothed, true, false);
    }

    // ══════════════════════
    // UTILITY
    // ══════════════════════
    function isColorDark(hex) {
        const c = hex.replace('#', '');
        const r = parseInt(c.substr(0, 2), 16), g = parseInt(c.substr(2, 2), 16), b = parseInt(c.substr(4, 2), 16);
        return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
    }

    function updateInfo() {
        document.getElementById('canvasInfoText').textContent = `${state.canvasW} \u00d7 ${state.canvasH}`;
        document.getElementById('zoomLevel').textContent = `${Math.round(state.zoom * 100)}%`;
        document.getElementById('pathCount').textContent = `paths: ${state.paths.length}`;
    }


    // ══════════════════════
    // THEME
    // ══════════════════════
    window._letteringToggleTheme = function () {
        const root = document.documentElement;
        const isDark = isColorDark(state.bgColor);
        if (isDark) {
            root.style.setProperty('--bg-0', '#f0f0f2');
            root.style.setProperty('--bg-1', '#e8e8ec');
            root.style.setProperty('--bg-2', '#dddde2');
            root.style.setProperty('--bg-3', '#d0d0d6');
            root.style.setProperty('--border', '#c0c0c8');
            root.style.setProperty('--border-hover', '#a0a0a8');
            root.style.setProperty('--text-1', '#111113');
            root.style.setProperty('--text-2', '#444450');
            root.style.setProperty('--text-3', '#777780');
            root.style.setProperty('--accent-dim', '#dde4ff');
            state.bgColor = '#ffffff';
            state.fillColor = '#111113';
        } else {
            root.style.setProperty('--bg-0', '#0c0c0e');
            root.style.setProperty('--bg-1', '#111113');
            root.style.setProperty('--bg-2', '#19191d');
            root.style.setProperty('--bg-3', '#242429');
            root.style.setProperty('--border', '#2a2a30');
            root.style.setProperty('--border-hover', '#3a3a42');
            root.style.setProperty('--text-1', '#e8e8ec');
            root.style.setProperty('--text-2', '#a0a0a8');
            root.style.setProperty('--text-3', '#686870');
            root.style.setProperty('--accent-dim', '#1e2233');
            state.bgColor = '#0c0c0e';
            state.fillColor = '#e8e8ec';
        }
        document.getElementById('bgColor').value = state.bgColor;
        document.getElementById('fillColor').value = state.fillColor;
        render();
    };

    // ══════════════════════
    // UI BINDING
    // ══════════════════════
    function bindUI() {
        const $ = id => document.getElementById(id);

        // Tools
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
            b.addEventListener('click', () => {
                state.tool = b.dataset.tool;
                document.querySelectorAll('.tool-btn[data-tool]').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
                canvasArea.classList.toggle('select-mode', state.tool === 'select');
            });
        });

        // Grid resolution
        $('gridRes').addEventListener('input', e => {
            const v = +e.target.value;
            $('gridResVal').textContent = v;
            state.gridCols = v; state.gridRows = v;
            state.pixels = new Uint8Array(v * v);
            state.paths = [];
            render();
        });

        // Smooth amount
        $('smoothAmount').addEventListener('input', e => {
            state.smoothAmount = +e.target.value / 100;
            $('smoothAmountVal').textContent = state.smoothAmount.toFixed(2);
            vectorize(); render();
        });

        // View toggles
        $('showGrid').addEventListener('change', e => { state.showGrid = e.target.checked; render(); });
        $('showPixels').addEventListener('change', e => { state.showPixels = e.target.checked; render(); });
        $('showOutline').addEventListener('change', e => { state.showOutline = e.target.checked; render(); });
        $('showFill').addEventListener('change', e => { state.showFill = e.target.checked; render(); });

        // Colors
        $('fillColor').addEventListener('input', e => { state.fillColor = e.target.value; render(); });
        $('bgColor').addEventListener('input', e => { state.bgColor = e.target.value; render(); });

        // Vectorize button
        $('vectorizeBtn').addEventListener('click', () => { vectorize(); render(); });

        // Export
        $('exportSvgBtn').addEventListener('click', exportSVG);
        $('exportPngBtn').addEventListener('click', exportPNG);
        $('fullscreenBtn').addEventListener('click', showFullscreen);
        $('closeFullscreen').addEventListener('click', () => $('fullscreen-view').classList.add('hidden'));
        $('fitBtn').addEventListener('click', fitView);

        // Clear
        $('clearBtn').addEventListener('click', () => {
            state.pixels.fill(0);
            state.paths = [];
            render(); updateInfo();
        });

        // Canvas size
        $('resizeBtn').addEventListener('click', () => {
            state.canvasW = Math.max(100, Math.min(4096, +$('canvasW').value));
            state.canvasH = Math.max(100, Math.min(4096, +$('canvasH').value));
            fitView(); render();
        });
        document.querySelectorAll('.size-preset-btn').forEach(b => {
            b.addEventListener('click', () => {
                $('canvasW').value = b.dataset.w; $('canvasH').value = b.dataset.h;
                state.canvasW = +b.dataset.w; state.canvasH = +b.dataset.h;
                fitView(); render();
            });
        });

        // Reference image
        $('refImageInput').addEventListener('change', e => {
            const f = e.target.files[0]; if (!f) return;
            const img = new Image();
            img.onload = () => { state.refImage = img; render(); };
            img.src = URL.createObjectURL(f);
        });
        $('refOpacity').addEventListener('input', e => {
            state.refOpacity = +e.target.value / 100;
            $('refOpacityVal').textContent = state.refOpacity.toFixed(2); render();
        });
        $('removeRefBtn').addEventListener('click', () => { state.refImage = null; render(); });

        window.addEventListener('resize', () => fitView());
    }

    // ══════════════════════
    // KEYBOARD
    // ══════════════════════
    function bindKeyboard() {
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); exportSVG(); }
            if (e.key === 'd' || e.key === 'D') document.querySelector('.tool-btn[data-tool="draw"]').click();
            if (e.key === 'e' || e.key === 'E') document.querySelector('.tool-btn[data-tool="erase"]').click();
            if (e.key === 'v' || e.key === 'V') document.querySelector('.tool-btn[data-tool="select"]').click();
            if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fitView(); }
            if (e.key === 'Escape') document.getElementById('fullscreen-view').classList.add('hidden');
            if (e.key === ' ') { e.preventDefault(); vectorize(); render(); }
        });
    }

    init();
})();

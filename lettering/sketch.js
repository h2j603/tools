/* ═══════════════════════════════════════════
   Lettering Tool v6 — Pixel-to-Vector
   Paint pixels → contour trace → corner detect → bezier fit → SVG
   Inspired by Potrace algorithm + fit-curve (Graphics Gems)
   ═══════════════════════════════════════════ */
(() => {
    const state = {
        canvasW: 1080, canvasH: 1080,
        bgColor: '#0c0c0e', fillColor: '#e8e8ec',
        gridCols: 36, gridRows: 36,
        pixels: null,         // Uint8Array
        paths: [],            // vectorized: [{ raw, anchors }]
        tool: 'draw',         // 'draw'|'erase'|'line'|'fill'|'select'
        mirror: false,
        zoom: 1, panX: 0, panY: 0,
        showGrid: true, showPixels: true, showOutline: true, showFill: true,
        smoothAmount: 0.3,    // 0..1 bezier handle length factor
        cornerThreshold: 0.7, // 0..1 angle threshold for corner detection (Potrace-inspired)
        activePath: -1, dragTarget: null, isDragging: false,
        refImage: null, refOpacity: 0.3,
        // Undo
        history: [], redoStack: [],
        // Line tool state
        lineStart: null,
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
        fitView(); bindPointerEvents(); bindUI(); bindKeyboard(); render();
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
        canvas.style.left = state.panX + 'px'; canvas.style.top = state.panY + 'px';
    }

    function canvasCoords(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom };
    }
    function cellSize() { return { w: state.canvasW / state.gridCols, h: state.canvasH / state.gridRows }; }
    function pxIdx(c, r) { return r * state.gridCols + c; }
    function getPx(c, r) { return (c < 0 || c >= state.gridCols || r < 0 || r >= state.gridRows) ? 0 : state.pixels[pxIdx(c, r)]; }
    function setPx(c, r, v) { if (c >= 0 && c < state.gridCols && r >= 0 && r < state.gridRows) state.pixels[pxIdx(c, r)] = v; }

    function ptToCell(pt) {
        const cs = cellSize();
        return { col: Math.floor(pt.x / cs.w), row: Math.floor(pt.y / cs.h) };
    }

    // ══════════════════════
    // UNDO / REDO
    // ══════════════════════
    function saveUndo() {
        state.history.push(state.pixels.slice());
        if (state.history.length > 60) state.history.shift();
        state.redoStack = [];
    }
    function undo() {
        if (!state.history.length) return;
        state.redoStack.push(state.pixels.slice());
        state.pixels = state.history.pop();
        state.paths = []; render(); updateInfo();
    }
    function redo() {
        if (!state.redoStack.length) return;
        state.history.push(state.pixels.slice());
        state.pixels = state.redoStack.pop();
        state.paths = []; render(); updateInfo();
    }

    // ══════════════════════
    // PAINT TOOLS
    // ══════════════════════
    function paintAt(pt, val) {
        const { col, row } = ptToCell(pt);
        setPx(col, row, val);
        if (state.mirror) setPx(state.gridCols - 1 - col, row, val);
        if (state.paths.length > 0) state.paths = [];
    }

    // Bresenham line for smooth drag painting
    function paintLine(x0, y0, x1, y1, val) {
        const cs = cellSize();
        const c0 = Math.floor(x0 / cs.w), r0 = Math.floor(y0 / cs.h);
        const c1 = Math.floor(x1 / cs.w), r1 = Math.floor(y1 / cs.h);
        const dc = Math.abs(c1 - c0), dr = Math.abs(r1 - r0);
        const sc = c0 < c1 ? 1 : -1, sr = r0 < r1 ? 1 : -1;
        let err = dc - dr, c = c0, r = r0;
        while (true) {
            setPx(c, r, val);
            if (state.mirror) setPx(state.gridCols - 1 - c, r, val);
            if (c === c1 && r === r1) break;
            const e2 = 2 * err;
            if (e2 > -dr) { err -= dr; c += sc; }
            if (e2 < dc) { err += dc; r += sr; }
        }
    }

    // Flood fill (BFS)
    function floodFill(pt) {
        const { col, row } = ptToCell(pt);
        const target = getPx(col, row);
        const fill = target ? 0 : 1;
        if (target === fill) return;
        const q = [[col, row]];
        const visited = new Set();
        visited.add(`${col},${row}`);
        while (q.length) {
            const [c, r] = q.shift();
            if (c < 0 || c >= state.gridCols || r < 0 || r >= state.gridRows) continue;
            if (getPx(c, r) !== target) continue;
            setPx(c, r, fill);
            if (state.mirror) setPx(state.gridCols - 1 - c, r, fill);
            for (const [nc, nr] of [[c-1,r],[c+1,r],[c,r-1],[c,r+1]]) {
                const k = `${nc},${nr}`;
                if (!visited.has(k)) { visited.add(k); q.push([nc, nr]); }
            }
        }
        if (state.paths.length > 0) state.paths = [];
    }

    // ══════════════════════
    // POINTER EVENTS
    // ══════════════════════
    let lastPaintPt = null;

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
            pinchStartZoom = state.zoom; return;
        }
        if (activePointers.size > 2) return;
        isPointerDown = true;
        canvasArea.setPointerCapture(e.pointerId);
        const pt = canvasCoords(e);

        if (state.tool === 'draw' || state.tool === 'erase') {
            saveUndo();
            paintAt(pt, state.tool === 'draw' ? 1 : 0);
            lastPaintPt = pt;
            render(); return;
        }
        if (state.tool === 'fill') {
            saveUndo();
            floodFill(pt);
            render(); return;
        }
        if (state.tool === 'line') {
            if (!state.lineStart) { state.lineStart = ptToCell(pt); }
            else {
                saveUndo();
                const end = ptToCell(pt);
                const cs = cellSize();
                paintLine(state.lineStart.col * cs.w, state.lineStart.row * cs.h, end.col * cs.w, end.row * cs.h, 1);
                state.lineStart = null;
                render();
            }
            return;
        }
        if (state.tool === 'select') {
            const hit = hitTestAnchors(pt);
            if (hit) { state.dragTarget = hit; state.isDragging = true; }
            render();
        }
    }

    function onMove(e) {
        e.preventDefault();
        const prev = activePointers.get(e.pointerId);
        if (!prev) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 2) {
            const pts = [...activePointers.values()];
            const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            const nz = Math.max(0.1, Math.min(10, pinchStartZoom * (dist / pinchStartDist)));
            const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
            state.panX += dx / 2; state.panY += dy / 2;
            const ar = canvasArea.getBoundingClientRect();
            const mx = (pts[0].x + pts[1].x) / 2 - ar.left, my = (pts[0].y + pts[1].y) / 2 - ar.top;
            const cxB = (mx - state.panX) / state.zoom, cyB = (my - state.panY) / state.zoom;
            state.zoom = nz; state.panX = mx - cxB * state.zoom; state.panY = my - cyB * state.zoom;
            applyTransform(); render(); updateInfo(); return;
        }
        if (!isPointerDown) return;
        const pt = canvasCoords(e);

        if (state.tool === 'draw' || state.tool === 'erase') {
            if (lastPaintPt) paintLine(lastPaintPt.x, lastPaintPt.y, pt.x, pt.y, state.tool === 'draw' ? 1 : 0);
            else paintAt(pt, state.tool === 'draw' ? 1 : 0);
            lastPaintPt = pt;
            render(); return;
        }
        if (state.tool === 'select' && state.isDragging && state.dragTarget) {
            const path = state.paths[state.dragTarget.pathIdx];
            if (!path) return;
            const a = path.anchors[state.dragTarget.anchorIdx];
            if (state.dragTarget.type === 'anchor') { a.x = pt.x; a.y = pt.y; }
            else if (state.dragTarget.type === 'handleOut') { a.hox = pt.x - a.x; a.hoy = pt.y - a.y; }
            else if (state.dragTarget.type === 'handleIn') { a.hix = pt.x - a.x; a.hiy = pt.y - a.y; }
            render();
        }
    }

    function onUp(e) {
        activePointers.delete(e.pointerId);
        isPointerDown = false; lastPaintPt = null;
        state.isDragging = false; state.dragTarget = null;
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


    // ══════════════════════
    // CONTOUR TRACING — walk pixel edges to extract outlines
    // ══════════════════════
    function traceContours() {
        const cs = cellSize();
        const cols = state.gridCols, rows = state.gridRows;
        const edges = [];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                if (!getPx(c, r)) continue;
                const x = c * cs.w, y = r * cs.h;
                if (!getPx(c, r-1)) edges.push({ x1:x, y1:y, x2:x+cs.w, y2:y });
                if (!getPx(c, r+1)) edges.push({ x1:x+cs.w, y1:y+cs.h, x2:x, y2:y+cs.h });
                if (!getPx(c-1, r)) edges.push({ x1:x, y1:y+cs.h, x2:x, y2:y });
                if (!getPx(c+1, r)) edges.push({ x1:x+cs.w, y1:y, x2:x+cs.w, y2:y+cs.h });
            }
        }
        // Chain edges
        const used = new Array(edges.length).fill(false);
        const eps = 0.01;
        const contours = [];
        function findNext(x, y) {
            for (let i = 0; i < edges.length; i++) {
                if (used[i]) continue;
                if (Math.abs(edges[i].x1 - x) < eps && Math.abs(edges[i].y1 - y) < eps) return i;
            }
            return -1;
        }
        for (let s = 0; s < edges.length; s++) {
            if (used[s]) continue;
            const contour = [];
            let idx = s;
            while (idx >= 0 && !used[idx]) {
                used[idx] = true;
                contour.push({ x: edges[idx].x1, y: edges[idx].y1 });
                idx = findNext(edges[idx].x2, edges[idx].y2);
            }
            if (contour.length >= 3) contours.push(contour);
        }
        return contours;
    }

    // ══════════════════════
    // CORNER DETECTION (Potrace-inspired)
    // Detects sharp corners based on angle between segments
    // ══════════════════════
    function detectCorners(pts) {
        const n = pts.length;
        const threshold = Math.PI * (1 - state.cornerThreshold); // angle threshold
        const isCorner = new Array(n).fill(false);
        for (let i = 0; i < n; i++) {
            const prev = pts[(i - 1 + n) % n];
            const curr = pts[i];
            const next = pts[(i + 1) % n];
            const a1 = Math.atan2(curr.y - prev.y, curr.x - prev.x);
            const a2 = Math.atan2(next.y - curr.y, next.x - curr.x);
            let angle = Math.abs(a2 - a1);
            if (angle > Math.PI) angle = 2 * Math.PI - angle;
            if (angle > threshold) isCorner[i] = true;
        }
        return isCorner;
    }

    // ══════════════════════
    // BEZIER FITTING (fit-curve / Graphics Gems inspired)
    // Fit cubic bezier to a sequence of points
    // ══════════════════════
    function fitBezierSegment(pts) {
        // Simplified Schneider algorithm
        const n = pts.length;
        if (n <= 2) {
            return pts.map((p, i) => ({
                x: p.x, y: p.y,
                hix: 0, hiy: 0, hox: 0, hoy: 0,
            }));
        }
        // Chord-length parameterization
        const u = [0];
        for (let i = 1; i < n; i++) u.push(u[i-1] + Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y));
        const totalLen = u[n-1] || 1;
        for (let i = 0; i < n; i++) u[i] /= totalLen;

        // Compute tangent at start and end
        const tHat1 = normalize({ x: pts[1].x - pts[0].x, y: pts[1].y - pts[0].y });
        const tHat2 = normalize({ x: pts[n-2].x - pts[n-1].x, y: pts[n-2].y - pts[n-1].y });

        // Fit control points
        const dist = totalLen;
        const cp1 = { x: pts[0].x + tHat1.x * dist / 3, y: pts[0].y + tHat1.y * dist / 3 };
        const cp2 = { x: pts[n-1].x + tHat2.x * dist / 3, y: pts[n-1].y + tHat2.y * dist / 3 };

        return [
            { x: pts[0].x, y: pts[0].y,
              hix: 0, hiy: 0,
              hox: cp1.x - pts[0].x, hoy: cp1.y - pts[0].y },
            { x: pts[n-1].x, y: pts[n-1].y,
              hix: cp2.x - pts[n-1].x, hiy: cp2.y - pts[n-1].y,
              hox: 0, hoy: 0 },
        ];
    }

    function normalize(v) {
        const len = Math.hypot(v.x, v.y) || 1;
        return { x: v.x / len, y: v.y / len };
    }

    // ══════════════════════
    // VECTORIZE — contour → corners → split → bezier fit → merge
    // ══════════════════════
    function vectorize() {
        const contours = traceContours();
        state.paths = contours.map(raw => {
            // Simplify first
            const simplified = rdpSimplify(raw, cellSize().w * 0.3 + 0.5);

            // Detect corners
            const corners = detectCorners(simplified);

            // Split at corners, fit beziers to each segment
            const anchors = [];
            let segStart = 0;
            for (let i = 0; i <= simplified.length; i++) {
                const idx = i % simplified.length;
                if (i === simplified.length || (corners[idx] && i > segStart)) {
                    // Fit bezier to segment from segStart to i
                    const seg = [];
                    for (let j = segStart; j <= Math.min(i, simplified.length - 1); j++) {
                        seg.push(simplified[j % simplified.length]);
                    }
                    if (seg.length >= 2) {
                        const fitted = fitBezierSegment(seg);
                        // Merge: skip first point if we already have anchors
                        const startIdx = anchors.length > 0 ? 1 : 0;
                        for (let f = startIdx; f < fitted.length; f++) {
                            anchors.push(fitted[f]);
                        }
                    }
                    segStart = i;
                }
            }

            // If no corners were found, do smooth fit on whole contour
            if (anchors.length === 0) {
                return { raw, anchors: smoothAnchors(simplified) };
            }

            // Smooth non-corner anchors
            const n = anchors.length;
            for (let i = 0; i < n; i++) {
                const a = anchors[i];
                if (a.hox === 0 && a.hoy === 0 && a.hix === 0 && a.hiy === 0) {
                    // Auto-smooth this anchor
                    const prev = anchors[(i-1+n)%n], next = anchors[(i+1)%n];
                    const dx = next.x - prev.x, dy = next.y - prev.y;
                    const len = Math.hypot(dx, dy) || 1;
                    const ux = dx/len, uy = dy/len;
                    const dP = Math.hypot(a.x-prev.x, a.y-prev.y);
                    const dN = Math.hypot(next.x-a.x, next.y-a.y);
                    a.hix = -ux * dP * state.smoothAmount;
                    a.hiy = -uy * dP * state.smoothAmount;
                    a.hox = ux * dN * state.smoothAmount;
                    a.hoy = uy * dN * state.smoothAmount;
                }
            }

            return { raw, anchors };
        });
        updateInfo();
    }

    function rdpSimplify(pts, eps) {
        if (pts.length <= 2) return pts.slice();
        let md = 0, mi = 0;
        const f = pts[0], l = pts[pts.length-1];
        for (let i = 1; i < pts.length-1; i++) {
            const d = ptLineDist(pts[i], f, l);
            if (d > md) { md = d; mi = i; }
        }
        if (md > eps) {
            const left = rdpSimplify(pts.slice(0, mi+1), eps);
            const right = rdpSimplify(pts.slice(mi), eps);
            return left.slice(0,-1).concat(right);
        }
        return [f, l];
    }

    function ptLineDist(p, a, b) {
        const dx = b.x-a.x, dy = b.y-a.y, ls = dx*dx+dy*dy;
        if (ls === 0) return Math.hypot(p.x-a.x, p.y-a.y);
        const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/ls));
        return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
    }

    function smoothAnchors(pts) {
        const n = pts.length;
        return pts.map((p, i) => {
            const prev = pts[(i-1+n)%n], next = pts[(i+1)%n];
            const dx = next.x-prev.x, dy = next.y-prev.y;
            const len = Math.hypot(dx,dy)||1;
            const ux = dx/len, uy = dy/len;
            const dP = Math.hypot(p.x-prev.x,p.y-prev.y);
            const dN = Math.hypot(next.x-p.x,next.y-p.y);
            const sm = state.smoothAmount;
            return { x:p.x, y:p.y, hix:-ux*dP*sm, hiy:-uy*dP*sm, hox:ux*dN*sm, hoy:uy*dN*sm };
        });
    }


    // ══════════════════════
    // HIT TEST
    // ══════════════════════
    function hitTestAnchors(pt) {
        const r = HIT_R / state.zoom;
        for (let pi = 0; pi < state.paths.length; pi++) {
            const anc = state.paths[pi].anchors;
            for (let ai = 0; ai < anc.length; ai++) {
                const a = anc[ai];
                if (Math.hypot(pt.x-(a.x+a.hox),pt.y-(a.y+a.hoy)) < r) return {pathIdx:pi,anchorIdx:ai,type:'handleOut'};
                if (Math.hypot(pt.x-(a.x+a.hix),pt.y-(a.y+a.hiy)) < r) return {pathIdx:pi,anchorIdx:ai,type:'handleIn'};
                if (Math.hypot(pt.x-a.x,pt.y-a.y) < r) return {pathIdx:pi,anchorIdx:ai,type:'anchor'};
            }
        }
        return null;
    }

    // ══════════════════════
    // RENDER
    // ══════════════════════
    function render() {
        const c = ctx;
        c.clearRect(0,0,canvas.width,canvas.height);
        c.fillStyle = state.bgColor;
        c.fillRect(0,0,state.canvasW,state.canvasH);

        if (state.refImage) { c.save(); c.globalAlpha=state.refOpacity; c.drawImage(state.refImage,0,0,state.canvasW,state.canvasH); c.restore(); }
        if (state.showGrid) drawGrid(c);
        if (state.showPixels) drawPixels(c);

        // Mirror line
        if (state.mirror) {
            c.save(); c.strokeStyle='rgba(108,138,255,0.4)'; c.lineWidth=1.5;
            c.setLineDash([6,6]); c.beginPath();
            c.moveTo(state.canvasW/2,0); c.lineTo(state.canvasW/2,state.canvasH);
            c.stroke(); c.restore();
        }

        // Vectorized paths
        if (state.showFill) for (const p of state.paths) drawBezierPath(c,p.anchors,true,false);
        if (state.showOutline) for (const p of state.paths) drawBezierPath(c,p.anchors,false,true);
        if (state.tool === 'select') for (const p of state.paths) drawHandles(c,p.anchors);

        // Line tool preview
        if (state.tool === 'line' && state.lineStart) {
            const cs = cellSize();
            c.save(); c.fillStyle='rgba(108,138,255,0.5)';
            c.fillRect(state.lineStart.col*cs.w, state.lineStart.row*cs.h, cs.w, cs.h);
            c.restore();
        }
    }

    function drawGrid(c) {
        const cs = cellSize();
        const dk = isColorDark(state.bgColor);
        c.save();
        c.strokeStyle = dk ? 'rgba(180,200,255,0.2)' : 'rgba(0,0,80,0.15)';
        c.lineWidth = 0.5;
        for (let col=0;col<=state.gridCols;col++){const x=col*cs.w;c.beginPath();c.moveTo(x,0);c.lineTo(x,state.canvasH);c.stroke();}
        for (let row=0;row<=state.gridRows;row++){const y=row*cs.h;c.beginPath();c.moveTo(0,y);c.lineTo(state.canvasW,y);c.stroke();}
        c.strokeStyle = dk ? 'rgba(180,200,255,0.45)' : 'rgba(0,0,80,0.35)';
        c.lineWidth=1.5;
        c.beginPath();c.moveTo(state.canvasW/2,0);c.lineTo(state.canvasW/2,state.canvasH);c.stroke();
        c.beginPath();c.moveTo(0,state.canvasH/2);c.lineTo(state.canvasW,state.canvasH/2);c.stroke();
        c.restore();
    }

    function drawPixels(c) {
        const cs = cellSize();
        const hasVec = state.paths.length > 0;
        c.save();
        c.fillStyle = hasVec ? (isColorDark(state.bgColor)?'rgba(180,200,255,0.1)':'rgba(0,0,80,0.06)') : state.fillColor;
        for (let r=0;r<state.gridRows;r++) for (let col=0;col<state.gridCols;col++) if (getPx(col,r)) c.fillRect(col*cs.w,r*cs.h,cs.w,cs.h);
        c.restore();
    }

    function drawBezierPath(c, anchors, fill, stroke) {
        if (!anchors || anchors.length < 2) return;
        c.save(); c.beginPath();
        c.moveTo(anchors[0].x, anchors[0].y);
        for (let i=0;i<anchors.length;i++){
            const a0=anchors[i],a1=anchors[(i+1)%anchors.length];
            c.bezierCurveTo(a0.x+a0.hox,a0.y+a0.hoy, a1.x+a1.hix,a1.y+a1.hiy, a1.x,a1.y);
        }
        c.closePath();
        if (fill) { c.fillStyle=state.fillColor; c.fill('evenodd'); }
        if (stroke) { c.strokeStyle=state.fillColor; c.lineWidth=2; c.globalAlpha=0.8; c.stroke(); }
        c.restore();
    }

    function drawHandles(c, anchors) {
        if (!anchors) return;
        c.save();
        for (const p of anchors) {
            const hix=p.x+p.hix,hiy=p.y+p.hiy,hox=p.x+p.hox,hoy=p.y+p.hoy;
            c.strokeStyle='rgba(108,138,255,0.7)';c.lineWidth=1.5;c.setLineDash([]);
            c.beginPath();c.moveTo(hix,hiy);c.lineTo(p.x,p.y);c.lineTo(hox,hoy);c.stroke();
            c.fillStyle='#6c8aff';
            [{x:hix,y:hiy},{x:hox,y:hoy}].forEach(h=>{c.beginPath();c.arc(h.x,h.y,5,0,Math.PI*2);c.fill();});
            c.fillStyle='#fff';c.strokeStyle='#6c8aff';c.lineWidth=2;
            c.fillRect(p.x-6,p.y-6,12,12);c.strokeRect(p.x-6,p.y-6,12,12);
        }
        c.restore();
    }

    // ══════════════════════
    // EXPORT
    // ══════════════════════
    function exportSVG() {
        const svgP = state.paths.map(path=>{
            const a=path.anchors; if(!a||a.length<2) return '';
            const r=n=>Math.round(n*100)/100;
            let d=`M ${r(a[0].x)} ${r(a[0].y)}`;
            for(let i=0;i<a.length;i++){const a0=a[i],a1=a[(i+1)%a.length];
                d+=` C ${r(a0.x+a0.hox)} ${r(a0.y+a0.hoy)}, ${r(a1.x+a1.hix)} ${r(a1.y+a1.hiy)}, ${r(a1.x)} ${r(a1.y)}`;}
            return `  <path d="${d} Z" fill="${state.fillColor}" fill-rule="evenodd"/>`;
        }).filter(Boolean);
        const svg=[`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${state.canvasW} ${state.canvasH}" width="${state.canvasW}" height="${state.canvasH}">`,
            `  <rect width="100%" height="100%" fill="${state.bgColor}"/>`,...svgP,`</svg>`].join('\n');
        const blob=new Blob([svg],{type:'image/svg+xml'});
        const a=document.createElement('a');a.download=`lettering_${Date.now()}.svg`;
        a.href=URL.createObjectURL(blob);a.click();URL.revokeObjectURL(a.href);
    }

    function exportPNG() {
        const ec=document.createElement('canvas');ec.width=state.canvasW;ec.height=state.canvasH;
        const ex=ec.getContext('2d');ex.fillStyle=state.bgColor;ex.fillRect(0,0,state.canvasW,state.canvasH);
        for(const p of state.paths) drawBezierPath(ex,p.anchors,true,false);
        const a=document.createElement('a');a.download=`lettering_${Date.now()}.png`;a.href=ec.toDataURL('image/png');a.click();
    }

    function showFullscreen() {
        const v=document.getElementById('fullscreen-view'),fc=document.getElementById('fullscreenCanvas');
        v.classList.remove('hidden');fc.width=state.canvasW;fc.height=state.canvasH;
        const f=fc.getContext('2d');f.fillStyle=state.bgColor;f.fillRect(0,0,state.canvasW,state.canvasH);
        for(const p of state.paths) drawBezierPath(f,p.anchors,true,false);
    }

    function isColorDark(hex){const c=hex.replace('#','');return(parseInt(c.substr(0,2),16)*0.299+parseInt(c.substr(2,2),16)*0.587+parseInt(c.substr(4,2),16)*0.114)<128;}
    function updateInfo(){
        document.getElementById('canvasInfoText').textContent=`${state.canvasW} \u00d7 ${state.canvasH}`;
        document.getElementById('zoomLevel').textContent=`${Math.round(state.zoom*100)}%`;
        document.getElementById('pathCount').textContent=`paths: ${state.paths.length}`;
    }

    // ══════════════════════
    // THEME
    // ══════════════════════
    window._letteringToggleTheme = function(){
        const dk=isColorDark(state.bgColor);const r=document.documentElement;
        if(dk){r.style.setProperty('--bg-0','#f0f0f2');r.style.setProperty('--bg-1','#e8e8ec');r.style.setProperty('--bg-2','#dddde2');r.style.setProperty('--bg-3','#d0d0d6');r.style.setProperty('--border','#c0c0c8');r.style.setProperty('--border-hover','#a0a0a8');r.style.setProperty('--text-1','#111113');r.style.setProperty('--text-2','#444450');r.style.setProperty('--text-3','#777780');r.style.setProperty('--accent-dim','#dde4ff');state.bgColor='#ffffff';state.fillColor='#111113';}
        else{r.style.setProperty('--bg-0','#0c0c0e');r.style.setProperty('--bg-1','#111113');r.style.setProperty('--bg-2','#19191d');r.style.setProperty('--bg-3','#242429');r.style.setProperty('--border','#2a2a30');r.style.setProperty('--border-hover','#3a3a42');r.style.setProperty('--text-1','#e8e8ec');r.style.setProperty('--text-2','#a0a0a8');r.style.setProperty('--text-3','#686870');r.style.setProperty('--accent-dim','#1e2233');state.bgColor='#0c0c0e';state.fillColor='#e8e8ec';}
        document.getElementById('bgColor').value=state.bgColor;
        document.getElementById('fillColor').value=state.fillColor;render();
    };


    // ══════════════════════
    // UI BINDING
    // ══════════════════════
    function bindUI() {
        const $=id=>document.getElementById(id);
        // Tools
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b=>{
            b.addEventListener('click',()=>{
                state.tool=b.dataset.tool;
                document.querySelectorAll('.tool-btn[data-tool]').forEach(x=>x.classList.remove('active'));
                b.classList.add('active');
                canvasArea.classList.toggle('select-mode',state.tool==='select');
                state.lineStart=null; render();
            });
        });
        // Mirror
        $('mirrorBtn').addEventListener('click',()=>{
            state.mirror=!state.mirror;
            $('mirrorBtn').classList.toggle('active',state.mirror);
            render();
        });
        // Grid res
        $('gridRes').addEventListener('input',e=>{
            const v=+e.target.value; $('gridResVal').textContent=v;
            state.gridCols=v;state.gridRows=v;
            state.pixels=new Uint8Array(v*v);state.paths=[];render();
        });
        // Smoothing
        $('smoothAmount').addEventListener('input',e=>{
            state.smoothAmount=+e.target.value/100;
            $('smoothAmountVal').textContent=state.smoothAmount.toFixed(2);
            if(state.paths.length) { vectorize(); render(); }
        });
        // Corner threshold
        $('cornerThreshold').addEventListener('input',e=>{
            state.cornerThreshold=+e.target.value/100;
            $('cornerThresholdVal').textContent=state.cornerThreshold.toFixed(2);
            if(state.paths.length) { vectorize(); render(); }
        });
        // View
        $('showGrid').addEventListener('change',e=>{state.showGrid=e.target.checked;render();});
        $('showPixels').addEventListener('change',e=>{state.showPixels=e.target.checked;render();});
        $('showOutline').addEventListener('change',e=>{state.showOutline=e.target.checked;render();});
        $('showFill').addEventListener('change',e=>{state.showFill=e.target.checked;render();});
        // Colors
        $('fillColor').addEventListener('input',e=>{state.fillColor=e.target.value;render();});
        $('bgColor').addEventListener('input',e=>{state.bgColor=e.target.value;render();});
        // Buttons
        $('vectorizeBtn').addEventListener('click',()=>{vectorize();render();});
        $('exportSvgBtn').addEventListener('click',exportSVG);
        $('exportPngBtn').addEventListener('click',exportPNG);
        $('fullscreenBtn').addEventListener('click',showFullscreen);
        $('closeFullscreen').addEventListener('click',()=>$('fullscreen-view').classList.add('hidden'));
        $('fitBtn').addEventListener('click',fitView);
        $('undoBtn').addEventListener('click',undo);
        $('redoBtn').addEventListener('click',redo);
        $('clearBtn').addEventListener('click',()=>{
            saveUndo();state.pixels.fill(0);state.paths=[];render();updateInfo();
        });
        // Canvas size
        $('resizeBtn').addEventListener('click',()=>{
            state.canvasW=Math.max(100,Math.min(4096,+$('canvasW').value));
            state.canvasH=Math.max(100,Math.min(4096,+$('canvasH').value));
            fitView();render();
        });
        document.querySelectorAll('.size-preset-btn').forEach(b=>{
            b.addEventListener('click',()=>{
                $('canvasW').value=b.dataset.w;$('canvasH').value=b.dataset.h;
                state.canvasW=+b.dataset.w;state.canvasH=+b.dataset.h;fitView();render();
            });
        });
        // Ref image
        $('refImageInput').addEventListener('change',e=>{
            const f=e.target.files[0];if(!f) return;
            const img=new Image();img.onload=()=>{state.refImage=img;render();};
            img.src=URL.createObjectURL(f);
        });
        $('refOpacity').addEventListener('input',e=>{state.refOpacity=+e.target.value/100;$('refOpacityVal').textContent=state.refOpacity.toFixed(2);render();});
        $('removeRefBtn').addEventListener('click',()=>{state.refImage=null;render();});
        window.addEventListener('resize',()=>fitView());
    }

    // ══════════════════════
    // KEYBOARD
    // ══════════════════════
    function bindKeyboard() {
        document.addEventListener('keydown',e=>{
            if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
            if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z'){e.preventDefault();undo();}
            if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='z'){e.preventDefault();redo();}
            if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();exportSVG();}
            if(e.key==='d'||e.key==='D') document.querySelector('.tool-btn[data-tool="draw"]').click();
            if(e.key==='e'||e.key==='E') document.querySelector('.tool-btn[data-tool="erase"]').click();
            if(e.key==='v'||e.key==='V') document.querySelector('.tool-btn[data-tool="select"]').click();
            if(e.key==='g'||e.key==='G') document.querySelector('.tool-btn[data-tool="fill"]').click();
            if(e.key==='l'||e.key==='L') document.querySelector('.tool-btn[data-tool="line"]').click();
            if(e.key==='m'||e.key==='M') $('mirrorBtn').click();
            if(e.key===' '){e.preventDefault();vectorize();render();}
            if(e.key==='0'&&(e.ctrlKey||e.metaKey)){e.preventDefault();fitView();}
            if(e.key==='Escape'){document.getElementById('fullscreen-view').classList.add('hidden');state.lineStart=null;render();}
        });
        function $(id){return document.getElementById(id);}
    }

    init();
})();

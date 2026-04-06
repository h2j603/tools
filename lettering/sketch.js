/* ═══════════════════════════════════════════
   Lettering Tool — Catmull-Rom Spline Drawing
   Mobile-friendly calligraphy/lettering canvas
   v2: zoom/pan, eraser, mirror, ref image, palette
   ═══════════════════════════════════════════ */

(() => {
    // ─── State ───
    const state = {
        canvasW: 1080,
        canvasH: 1080,
        bgColor: '#0c0c0e',
        brushSize: 8,
        minWidthRatio: 0.15,
        smoothing: 0.5,
        taperStart: 0.1,
        taperEnd: 0.3,
        brushColor: '#e8e8ec',
        brushOpacity: 1.0,
        tool: 'brush', // 'brush' | 'eraser'
        mirror: false,
        showGuides: false,
        showGrid: false,
        guideRows: 4,
        guidePadding: 5,
        gridSize: 50,
        strokes: [],
        redoStack: [],
        currentPoints: [],
        isDrawing: false,
        recentColors: ['#e8e8ec', '#ff4455', '#44cc88', '#6c8aff', '#ffaa33', '#cc44ff', '#ffffff', '#000000'],
        // Zoom & Pan
        zoom: 1,
        panX: 0,
        panY: 0,
        // Reference image
        refImage: null,
        refOpacity: 0.3,
    };

    // ─── DOM ───
    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas.getContext('2d');
    const canvasArea = document.getElementById('canvas-area');
    const brushCursor = document.getElementById('brushCursor');

    let offCanvas, offCtx;

    // Pinch state
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let activePointers = new Map();

    // ─── Init ───
    function init() {
        setupOffscreen();
        fitView();
        bindUI();
        bindPointerEvents();
        bindKeyboard();
        renderRecentColors();
        render();
    }

    function setupOffscreen() {
        offCanvas = document.createElement('canvas');
        offCanvas.width = state.canvasW;
        offCanvas.height = state.canvasH;
        offCtx = offCanvas.getContext('2d');
        offCtx.lineCap = 'round';
        offCtx.lineJoin = 'round';
        clearOffscreen();
        for (const stroke of state.strokes) {
            drawStrokeToCtx(offCtx, stroke);
        }
    }

    function fitView() {
        const areaW = canvasArea.clientWidth - 20;
        const areaH = canvasArea.clientHeight - 20;
        state.zoom = Math.min(areaW / state.canvasW, areaH / state.canvasH, 1);
        state.panX = (canvasArea.clientWidth - state.canvasW * state.zoom) / 2;
        state.panY = (canvasArea.clientHeight - state.canvasH * state.zoom) / 2;
        applyTransform();
        updateInfo();
    }

    function applyTransform() {
        canvas.width = state.canvasW;
        canvas.height = state.canvasH;
        canvas.style.width = (state.canvasW * state.zoom) + 'px';
        canvas.style.height = (state.canvasH * state.zoom) + 'px';
        canvas.style.left = state.panX + 'px';
        canvas.style.top = state.panY + 'px';
    }

    function clearOffscreen() {
        offCtx.fillStyle = state.bgColor;
        offCtx.fillRect(0, 0, state.canvasW, state.canvasH);
    }

    // ─── Coordinate mapping ───
    function canvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left) / state.zoom;
        const y = (e.clientY - rect.top) / state.zoom;
        const pressure = e.pressure > 0 ? e.pressure : 0.5;
        return { x, y, pressure, time: performance.now() };
    }

    // ─── Pointer Events ───
    function bindPointerEvents() {
        canvasArea.addEventListener('pointerdown', onPointerDown, { passive: false });
        canvasArea.addEventListener('pointermove', onPointerMove, { passive: false });
        canvasArea.addEventListener('pointerup', onPointerUp);
        canvasArea.addEventListener('pointercancel', onPointerUp);
        canvasArea.addEventListener('wheel', onWheel, { passive: false });
        canvasArea.addEventListener('touchstart', e => { if (e.touches.length <= 1) e.preventDefault(); }, { passive: false });
        canvasArea.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    }

    function onPointerDown(e) {
        e.preventDefault();
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.size === 2) {
            // Start pinch
            state.isDrawing = false;
            state.currentPoints = [];
            const pts = [...activePointers.values()];
            pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            pinchStartZoom = state.zoom;
            canvasArea.classList.add('panning');
            return;
        }

        if (activePointers.size > 2) return;

        canvasArea.setPointerCapture(e.pointerId);
        state.isDrawing = true;
        state.currentPoints = [canvasCoords(e)];
        state.redoStack = [];
        canvasArea.classList.add('drawing');
    }

    function onPointerMove(e) {
        e.preventDefault();

        // Update brush cursor
        updateBrushCursor(e);

        const prev = activePointers.get(e.pointerId);
        if (!prev) return;

        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Pinch zoom + pan
        if (activePointers.size === 2) {
            const pts = [...activePointers.values()];
            const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            const newZoom = Math.max(0.1, Math.min(10, pinchStartZoom * (dist / pinchStartDist)));
            const midX = (pts[0].x + pts[1].x) / 2;
            const midY = (pts[0].y + pts[1].y) / 2;

            // Pan
            const dx = e.clientX - prev.x;
            const dy = e.clientY - prev.y;
            state.panX += dx / 2;
            state.panY += dy / 2;

            // Zoom toward midpoint
            const areaRect = canvasArea.getBoundingClientRect();
            const mx = midX - areaRect.left;
            const my = midY - areaRect.top;
            const canvasXBefore = (mx - state.panX) / state.zoom;
            const canvasYBefore = (my - state.panY) / state.zoom;
            state.zoom = newZoom;
            state.panX = mx - canvasXBefore * state.zoom;
            state.panY = my - canvasYBefore * state.zoom;

            applyTransform();
            render();
            updateInfo();
            return;
        }

        if (!state.isDrawing) return;

        const pt = canvasCoords(e);
        const lastPt = state.currentPoints[state.currentPoints.length - 1];
        const dist = Math.hypot(pt.x - lastPt.x, pt.y - lastPt.y);
        if (dist < 1.5) return;

        state.currentPoints.push(pt);
        render();
    }

    function onPointerUp(e) {
        activePointers.delete(e.pointerId);
        canvasArea.classList.remove('panning');

        if (!state.isDrawing) return;
        if (activePointers.size > 0) return;

        state.isDrawing = false;
        canvasArea.classList.remove('drawing');

        if (state.currentPoints.length >= 2) {
            const stroke = buildStroke(state.currentPoints);
            state.strokes.push(stroke);
            drawStrokeToCtx(offCtx, stroke);

            // Mirror
            if (state.mirror) {
                const mirrored = buildMirroredStroke(state.currentPoints);
                state.strokes.push(mirrored);
                drawStrokeToCtx(offCtx, mirrored);
            }

            addRecentColor(state.brushColor);
        }
        state.currentPoints = [];
        render();
        updateInfo();
    }

    function onWheel(e) {
        e.preventDefault();
        const areaRect = canvasArea.getBoundingClientRect();
        const mx = e.clientX - areaRect.left;
        const my = e.clientY - areaRect.top;
        const canvasXBefore = (mx - state.panX) / state.zoom;
        const canvasYBefore = (my - state.panY) / state.zoom;

        const delta = e.deltaY > 0 ? 0.9 : 1.1;
        state.zoom = Math.max(0.1, Math.min(10, state.zoom * delta));

        state.panX = mx - canvasXBefore * state.zoom;
        state.panY = my - canvasYBefore * state.zoom;

        applyTransform();
        render();
        updateInfo();
    }

    function updateBrushCursor(e) {
        const areaRect = canvasArea.getBoundingClientRect();
        const x = e.clientX - areaRect.left;
        const y = e.clientY - areaRect.top;
        const size = state.brushSize * state.zoom;

        brushCursor.style.left = x + 'px';
        brushCursor.style.top = y + 'px';
        brushCursor.style.width = size + 'px';
        brushCursor.style.height = size + 'px';

        if (state.tool === 'eraser') {
            brushCursor.style.borderColor = 'rgba(255,68,85,0.6)';
        } else {
            brushCursor.style.borderColor = 'rgba(108,138,255,0.6)';
        }
    }

    // ─── Catmull-Rom Spline ───
    function catmullRomSegment(p0, p1, p2, p3, numPoints, alpha = 0.5) {
        const points = [];
        function tj(ti, pi, pj) {
            const dx = pj.x - pi.x;
            const dy = pj.y - pi.y;
            return ti + Math.pow(dx * dx + dy * dy, alpha / 2);
        }
        const t0 = 0;
        const t1 = tj(t0, p0, p1);
        const t2 = tj(t1, p1, p2);
        const t3 = tj(t2, p2, p3);
        if (t1 === t0 || t2 === t1 || t3 === t2) return [p1];

        for (let i = 0; i < numPoints; i++) {
            const t = t1 + (i / numPoints) * (t2 - t1);
            const a1x = ((t1 - t) / (t1 - t0)) * p0.x + ((t - t0) / (t1 - t0)) * p1.x;
            const a1y = ((t1 - t) / (t1 - t0)) * p0.y + ((t - t0) / (t1 - t0)) * p1.y;
            const a1p = ((t1 - t) / (t1 - t0)) * p0.pressure + ((t - t0) / (t1 - t0)) * p1.pressure;
            const a2x = ((t2 - t) / (t2 - t1)) * p1.x + ((t - t1) / (t2 - t1)) * p2.x;
            const a2y = ((t2 - t) / (t2 - t1)) * p1.y + ((t - t1) / (t2 - t1)) * p2.y;
            const a2p = ((t2 - t) / (t2 - t1)) * p1.pressure + ((t - t1) / (t2 - t1)) * p2.pressure;
            const a3x = ((t3 - t) / (t3 - t2)) * p2.x + ((t - t2) / (t3 - t2)) * p3.x;
            const a3y = ((t3 - t) / (t3 - t2)) * p2.y + ((t - t2) / (t3 - t2)) * p3.y;
            const a3p = ((t3 - t) / (t3 - t2)) * p2.pressure + ((t - t2) / (t3 - t2)) * p3.pressure;
            const b1x = ((t2 - t) / (t2 - t0)) * a1x + ((t - t0) / (t2 - t0)) * a2x;
            const b1y = ((t2 - t) / (t2 - t0)) * a1y + ((t - t0) / (t2 - t0)) * a2y;
            const b1p = ((t2 - t) / (t2 - t0)) * a1p + ((t - t0) / (t2 - t0)) * a2p;
            const b2x = ((t3 - t) / (t3 - t1)) * a2x + ((t - t1) / (t3 - t1)) * a3x;
            const b2y = ((t3 - t) / (t3 - t1)) * a2y + ((t - t1) / (t3 - t1)) * a3y;
            const b2p = ((t3 - t) / (t3 - t1)) * a2p + ((t - t1) / (t3 - t1)) * a3p;
            const cx = ((t2 - t) / (t2 - t1)) * b1x + ((t - t1) / (t2 - t1)) * b2x;
            const cy = ((t2 - t) / (t2 - t1)) * b1y + ((t - t1) / (t2 - t1)) * b2y;
            const cp = ((t2 - t) / (t2 - t1)) * b1p + ((t - t1) / (t2 - t1)) * b2p;
            points.push({ x: cx, y: cy, pressure: cp });
        }
        return points;
    }

    // ─── Build Stroke ───
    function buildStroke(rawPoints) {
        const isEraser = state.tool === 'eraser';
        if (rawPoints.length < 2) {
            return { points: rawPoints, color: state.brushColor, opacity: state.brushOpacity, size: state.brushSize, minWidthRatio: state.minWidthRatio, taperStart: state.taperStart, taperEnd: state.taperEnd, eraser: isEraser };
        }
        const smoothed = smoothPoints(rawPoints, state.smoothing);
        const interpolated = interpolateSpline(smoothed);
        const withWidths = calculateWidths(interpolated);

        return {
            points: withWidths,
            color: isEraser ? state.bgColor : state.brushColor,
            opacity: isEraser ? 1.0 : state.brushOpacity,
            size: state.brushSize,
            minWidthRatio: state.minWidthRatio,
            taperStart: isEraser ? 0 : state.taperStart,
            taperEnd: isEraser ? 0 : state.taperEnd,
            eraser: isEraser,
        };
    }

    function buildMirroredStroke(rawPoints) {
        const midX = state.canvasW / 2;
        const mirrored = rawPoints.map(p => ({ ...p, x: midX + (midX - p.x) }));
        // Temporarily set tool to brush for mirrored stroke
        const savedTool = state.tool;
        if (state.tool === 'eraser') state.tool = 'eraser';
        const stroke = buildStroke(mirrored);
        state.tool = savedTool;
        return stroke;
    }

    function smoothPoints(pts, amount) {
        if (amount <= 0 || pts.length < 3) return pts.slice();
        const win = Math.max(2, Math.round(amount * 6));
        const result = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
            let sx = 0, sy = 0, sp = 0, count = 0;
            for (let j = Math.max(0, i - win); j <= Math.min(pts.length - 1, i + win); j++) {
                sx += pts[j].x; sy += pts[j].y; sp += pts[j].pressure; count++;
            }
            result.push({ x: sx / count, y: sy / count, pressure: sp / count, time: pts[i].time });
        }
        result.push(pts[pts.length - 1]);
        return result;
    }

    function interpolateSpline(pts) {
        if (pts.length < 3) return pts.slice();
        const result = [];
        const padded = [pts[0], ...pts, pts[pts.length - 1]];
        for (let i = 0; i < padded.length - 3; i++) {
            const segLen = Math.hypot(padded[i + 2].x - padded[i + 1].x, padded[i + 2].y - padded[i + 1].y);
            const numPts = Math.max(2, Math.round(segLen / 2));
            result.push(...catmullRomSegment(padded[i], padded[i + 1], padded[i + 2], padded[i + 3], numPts));
        }
        result.push(pts[pts.length - 1]);
        return result;
    }

    function calculateWidths(pts) {
        if (pts.length < 2) return pts.map(p => ({ ...p, width: state.brushSize }));
        const totalLen = getTotalLength(pts);
        let runLen = 0;

        return pts.map((pt, i) => {
            if (i > 0) runLen += Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y);
            const t = totalLen > 0 ? runLen / totalLen : 0;
            const pressureFactor = pt.pressure || 0.5;
            const minW = state.brushSize * state.minWidthRatio;
            let w = minW + (state.brushSize - minW) * pressureFactor;

            // Speed-based thinning
            if (i > 0 && i < pts.length - 1) {
                const dt = (pts[i].time || 1) - (pts[i - 1].time || 0);
                if (dt > 0) {
                    const speed = Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y) / dt;
                    w *= Math.max(0.3, 1 - speed * 0.15);
                }
            }

            // Taper
            if (state.taperStart > 0 && t < state.taperStart) w *= t / state.taperStart;
            if (state.taperEnd > 0 && t > (1 - state.taperEnd)) w *= (1 - t) / state.taperEnd;

            return { ...pt, width: Math.max(0.5, w) };
        });
    }

    function getTotalLength(pts) {
        let len = 0;
        for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        return len;
    }

    // ─── Draw Stroke ───
    function drawStrokeToCtx(targetCtx, stroke) {
        const { points, color, opacity, size, eraser } = stroke;
        if (points.length < 2) return;

        targetCtx.save();
        if (eraser) {
            targetCtx.globalCompositeOperation = 'destination-out';
            targetCtx.globalAlpha = 1;
        } else {
            targetCtx.globalCompositeOperation = 'source-over';
            targetCtx.globalAlpha = opacity;
        }

        targetCtx.fillStyle = eraser ? '#000' : color;

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const w0 = p0.width || size;
            const w1 = p1.width || size;
            const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x) + Math.PI / 2;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);

            targetCtx.beginPath();
            targetCtx.moveTo(p0.x + cos * w0 / 2, p0.y + sin * w0 / 2);
            targetCtx.lineTo(p1.x + cos * w1 / 2, p1.y + sin * w1 / 2);
            targetCtx.lineTo(p1.x - cos * w1 / 2, p1.y - sin * w1 / 2);
            targetCtx.lineTo(p0.x - cos * w0 / 2, p0.y - sin * w0 / 2);
            targetCtx.closePath();
            targetCtx.fill();

            targetCtx.beginPath();
            targetCtx.arc(p0.x, p0.y, w0 / 2, 0, Math.PI * 2);
            targetCtx.fill();
        }

        const last = points[points.length - 1];
        targetCtx.beginPath();
        targetCtx.arc(last.x, last.y, (last.width || size) / 2, 0, Math.PI * 2);
        targetCtx.fill();

        targetCtx.restore();
    }

    // ─── Render ───
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // BG
        ctx.fillStyle = state.bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Reference image
        if (state.refImage) {
            ctx.save();
            ctx.globalAlpha = state.refOpacity;
            ctx.drawImage(state.refImage, 0, 0, canvas.width, canvas.height);
            ctx.restore();
        }

        // Completed strokes from offscreen
        ctx.drawImage(offCanvas, 0, 0);

        // Grid
        if (state.showGrid) drawGrid(ctx);

        // Guide lines
        if (state.showGuides) drawGuides(ctx);

        // Mirror line
        if (state.mirror) {
            ctx.save();
            ctx.strokeStyle = 'rgba(108,138,255,0.3)';
            ctx.lineWidth = 1;
            ctx.setLineDash([6, 6]);
            ctx.beginPath();
            ctx.moveTo(state.canvasW / 2, 0);
            ctx.lineTo(state.canvasW / 2, state.canvasH);
            ctx.stroke();
            ctx.restore();
        }

        // Current stroke in progress
        if (state.currentPoints.length >= 2) {
            const tempStroke = buildStroke(state.currentPoints);
            drawStrokeToCtx(ctx, tempStroke);

            if (state.mirror) {
                const mirroredStroke = buildMirroredStroke(state.currentPoints);
                drawStrokeToCtx(ctx, mirroredStroke);
            }
        }
    }

    function drawGuides(c) {
        const pad = state.guidePadding / 100;
        const rows = state.guideRows;
        const padPx = state.canvasH * pad;
        const usableH = state.canvasH - padPx * 2;
        const rowH = usableH / rows;
        c.save();
        c.strokeStyle = 'rgba(108,138,255,0.15)';
        c.lineWidth = 1;
        c.setLineDash([4, 4]);
        for (let i = 0; i <= rows; i++) {
            const y = padPx + i * rowH;
            c.beginPath();
            c.moveTo(state.canvasW * pad, y);
            c.lineTo(state.canvasW * (1 - pad), y);
            c.stroke();
            if (i < rows) {
                c.strokeStyle = 'rgba(108,138,255,0.08)';
                c.beginPath();
                c.moveTo(state.canvasW * pad, y + rowH * 0.6);
                c.lineTo(state.canvasW * (1 - pad), y + rowH * 0.6);
                c.stroke();
                c.strokeStyle = 'rgba(108,138,255,0.15)';
            }
        }
        c.restore();
    }

    function drawGrid(c) {
        const gs = state.gridSize;
        c.save();
        c.strokeStyle = 'rgba(108,138,255,0.06)';
        c.lineWidth = 1;
        for (let x = gs; x < state.canvasW; x += gs) {
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, state.canvasH); c.stroke();
        }
        for (let y = gs; y < state.canvasH; y += gs) {
            c.beginPath(); c.moveTo(0, y); c.lineTo(state.canvasW, y); c.stroke();
        }
        c.restore();
    }

    // ─── Undo / Redo / Clear ───
    function undo() {
        if (state.strokes.length === 0) return;
        state.redoStack.push(state.strokes.pop());
        rebuildOffscreen();
        render();
        updateInfo();
    }

    function redo() {
        if (state.redoStack.length === 0) return;
        const stroke = state.redoStack.pop();
        state.strokes.push(stroke);
        drawStrokeToCtx(offCtx, stroke);
        render();
        updateInfo();
    }

    function clearAll() {
        if (state.strokes.length === 0) return;
        state.redoStack = [];
        state.strokes = [];
        rebuildOffscreen();
        render();
        updateInfo();
    }

    function rebuildOffscreen() {
        // For eraser to work with transparent BG, we need a proper background
        offCtx.globalCompositeOperation = 'source-over';
        offCtx.fillStyle = state.bgColor;
        offCtx.fillRect(0, 0, state.canvasW, state.canvasH);
        for (const stroke of state.strokes) {
            drawStrokeToCtx(offCtx, stroke);
        }
    }

    // ─── Export ───
    function exportPNG(transparent) {
        const expCanvas = document.createElement('canvas');
        expCanvas.width = state.canvasW;
        expCanvas.height = state.canvasH;
        const expCtx = expCanvas.getContext('2d');

        if (!transparent) {
            expCtx.fillStyle = state.bgColor;
            expCtx.fillRect(0, 0, state.canvasW, state.canvasH);
        }

        // Redraw strokes (not from offscreen, to support transparent bg)
        for (const stroke of state.strokes) {
            drawStrokeToCtx(expCtx, stroke);
        }

        const link = document.createElement('a');
        link.download = `lettering_${Date.now()}.png`;
        link.href = expCanvas.toDataURL('image/png');
        link.click();
    }

    // ─── Fullscreen ───
    function showFullscreen() {
        const view = document.getElementById('fullscreen-view');
        const fc = document.getElementById('fullscreenCanvas');
        view.classList.remove('hidden');

        fc.width = state.canvasW;
        fc.height = state.canvasH;
        const fctx = fc.getContext('2d');
        fctx.fillStyle = state.bgColor;
        fctx.fillRect(0, 0, state.canvasW, state.canvasH);
        for (const stroke of state.strokes) {
            drawStrokeToCtx(fctx, stroke);
        }
    }

    // ─── Recent Colors ───
    function addRecentColor(color) {
        const idx = state.recentColors.indexOf(color);
        if (idx > -1) state.recentColors.splice(idx, 1);
        state.recentColors.unshift(color);
        if (state.recentColors.length > 16) state.recentColors.pop();
        renderRecentColors();
    }

    function renderRecentColors() {
        const container = document.getElementById('recentColors');
        container.innerHTML = '';
        state.recentColors.forEach(color => {
            const swatch = document.createElement('button');
            swatch.className = 'color-swatch';
            if (color === state.brushColor) swatch.classList.add('active');
            swatch.style.background = color;
            swatch.addEventListener('click', () => {
                state.brushColor = color;
                document.getElementById('brushColor').value = color;
                renderRecentColors();
            });
            container.appendChild(swatch);
        });
    }

    // ─── UI Binding ───
    function bindUI() {
        const $ = id => document.getElementById(id);

        $('brushSize').addEventListener('input', e => { state.brushSize = +e.target.value; $('sizeVal').textContent = state.brushSize; });
        $('minWidthRatio').addEventListener('input', e => { state.minWidthRatio = +e.target.value / 100; $('minWidthVal').textContent = state.minWidthRatio.toFixed(2); });
        $('smoothing').addEventListener('input', e => { state.smoothing = +e.target.value / 100; $('smoothVal').textContent = state.smoothing.toFixed(2); });
        $('taperStart').addEventListener('input', e => { state.taperStart = +e.target.value / 100; $('taperStartVal').textContent = state.taperStart.toFixed(2); });
        $('taperEnd').addEventListener('input', e => { state.taperEnd = +e.target.value / 100; $('taperEndVal').textContent = state.taperEnd.toFixed(2); });
        $('brushColor').addEventListener('input', e => { state.brushColor = e.target.value; renderRecentColors(); });
        $('brushOpacity').addEventListener('input', e => { state.brushOpacity = +e.target.value / 100; $('opacityVal').textContent = state.brushOpacity.toFixed(1); });

        $('bgColor').addEventListener('input', e => { state.bgColor = e.target.value; rebuildOffscreen(); render(); });

        $('resizeBtn').addEventListener('click', () => {
            state.canvasW = Math.max(100, Math.min(4096, +$('canvasW').value));
            state.canvasH = Math.max(100, Math.min(4096, +$('canvasH').value));
            setupOffscreen();
            fitView();
            render();
        });

        // Size presets
        document.querySelectorAll('.size-preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                $('canvasW').value = btn.dataset.w;
                $('canvasH').value = btn.dataset.h;
                state.canvasW = +btn.dataset.w;
                state.canvasH = +btn.dataset.h;
                setupOffscreen();
                fitView();
                render();
            });
        });

        // Guides
        $('showGuides').addEventListener('change', e => { state.showGuides = e.target.checked; render(); });
        $('showGrid').addEventListener('change', e => { state.showGrid = e.target.checked; render(); });
        $('guideRows').addEventListener('input', e => { state.guideRows = +e.target.value; $('guideRowsVal').textContent = state.guideRows; render(); });
        $('guidePadding').addEventListener('input', e => { state.guidePadding = +e.target.value; $('guidePadVal').textContent = state.guidePadding + '%'; render(); });
        $('gridSize').addEventListener('input', e => { state.gridSize = +e.target.value; $('gridSizeVal').textContent = state.gridSize; render(); });

        // Buttons
        $('undoBtn').addEventListener('click', undo);
        $('redoBtn').addEventListener('click', redo);
        $('clearBtn').addEventListener('click', clearAll);
        $('exportBtn').addEventListener('click', () => exportPNG(false));
        $('exportTransBtn').addEventListener('click', () => exportPNG(true));
        $('fullscreenBtn').addEventListener('click', showFullscreen);
        $('closeFullscreen').addEventListener('click', () => $('fullscreen-view').classList.add('hidden'));
        $('fitBtn').addEventListener('click', fitView);

        // Tool selection
        document.querySelectorAll('.tool-btn[data-tool="brush"], .tool-btn[data-tool="eraser"]').forEach(btn => {
            btn.addEventListener('click', () => {
                if (btn.dataset.tool === 'mirror') return;
                state.tool = btn.dataset.tool;
                document.querySelectorAll('.tool-btn[data-tool="brush"], .tool-btn[data-tool="eraser"]').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                canvasArea.classList.toggle('eraser-mode', state.tool === 'eraser');
            });
        });

        // Mirror toggle
        $('mirrorBtn').addEventListener('click', () => {
            state.mirror = !state.mirror;
            $('mirrorBtn').classList.toggle('active', state.mirror);
            render();
        });

        // Reference image
        $('refImageInput').addEventListener('change', e => {
            const file = e.target.files[0];
            if (!file) return;
            const img = new Image();
            img.onload = () => { state.refImage = img; render(); };
            img.src = URL.createObjectURL(file);
        });

        $('refOpacity').addEventListener('input', e => {
            state.refOpacity = +e.target.value / 100;
            $('refOpacityVal').textContent = state.refOpacity.toFixed(2);
            render();
        });

        $('removeRefBtn').addEventListener('click', () => { state.refImage = null; render(); });

        // Brush presets
        const presets = {
            pen:         { brushSize: 4,  minWidthRatio: 0.3,  smoothing: 0.3,  taperStart: 0.05, taperEnd: 0.15 },
            brush:       { brushSize: 16, minWidthRatio: 0.1,  smoothing: 0.5,  taperStart: 0.1,  taperEnd: 0.3  },
            marker:      { brushSize: 12, minWidthRatio: 0.85, smoothing: 0.2,  taperStart: 0,    taperEnd: 0    },
            calligraphy: { brushSize: 20, minWidthRatio: 0.05, smoothing: 0.6,  taperStart: 0.15, taperEnd: 0.4  },
            ink:         { brushSize: 6,  minWidthRatio: 0.08, smoothing: 0.45, taperStart: 0.12, taperEnd: 0.35 },
            pencil:      { brushSize: 3,  minWidthRatio: 0.6,  smoothing: 0.15, taperStart: 0.02, taperEnd: 0.05 },
        };

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = presets[btn.dataset.preset];
                if (!p) return;
                Object.assign(state, p);
                $('brushSize').value = p.brushSize; $('sizeVal').textContent = p.brushSize;
                $('minWidthRatio').value = Math.round(p.minWidthRatio * 100); $('minWidthVal').textContent = p.minWidthRatio.toFixed(2);
                $('smoothing').value = Math.round(p.smoothing * 100); $('smoothVal').textContent = p.smoothing.toFixed(2);
                $('taperStart').value = Math.round(p.taperStart * 100); $('taperStartVal').textContent = p.taperStart.toFixed(2);
                $('taperEnd').value = Math.round(p.taperEnd * 100); $('taperEndVal').textContent = p.taperEnd.toFixed(2);
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        window.addEventListener('resize', () => fitView());
    }

    function updateInfo() {
        document.getElementById('canvasInfoText').textContent = `${state.canvasW} \u00d7 ${state.canvasH}`;
        document.getElementById('zoomLevel').textContent = `${Math.round(state.zoom * 100)}%`;
        document.getElementById('strokeCount').textContent = `strokes: ${state.strokes.length}`;
    }

    // ─── Keyboard shortcuts ───
    function bindKeyboard() {
        document.addEventListener('keydown', e => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') { e.preventDefault(); undo(); }
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); redo(); }
            if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); exportPNG(false); }

            // Tool shortcuts
            if (e.key === 'b' || e.key === 'B') {
                state.tool = 'brush';
                document.querySelectorAll('.tool-btn[data-tool="brush"], .tool-btn[data-tool="eraser"]').forEach(b => b.classList.remove('active'));
                document.querySelector('.tool-btn[data-tool="brush"]').classList.add('active');
                canvasArea.classList.remove('eraser-mode');
            }
            if (e.key === 'e' || e.key === 'E') {
                state.tool = 'eraser';
                document.querySelectorAll('.tool-btn[data-tool="brush"], .tool-btn[data-tool="eraser"]').forEach(b => b.classList.remove('active'));
                document.querySelector('.tool-btn[data-tool="eraser"]').classList.add('active');
                canvasArea.classList.add('eraser-mode');
            }
            if (e.key === 'm' || e.key === 'M') {
                state.mirror = !state.mirror;
                document.getElementById('mirrorBtn').classList.toggle('active', state.mirror);
                render();
            }

            // Brush size with [ ]
            if (e.key === '[') { state.brushSize = Math.max(1, state.brushSize - 2); document.getElementById('brushSize').value = state.brushSize; document.getElementById('sizeVal').textContent = state.brushSize; }
            if (e.key === ']') { state.brushSize = Math.min(80, state.brushSize + 2); document.getElementById('brushSize').value = state.brushSize; document.getElementById('sizeVal').textContent = state.brushSize; }

            // Fit view
            if (e.key === '0' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); fitView(); }

            // Escape fullscreen
            if (e.key === 'Escape') document.getElementById('fullscreen-view').classList.add('hidden');
        });
    }

    // ─── Start ───
    init();
})();

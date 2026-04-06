/* ═══════════════════════════════════════════
   Lettering Tool — Catmull-Rom Spline Drawing
   Mobile-friendly calligraphy/lettering canvas
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
        showGuides: false,
        guideRows: 4,
        guidePadding: 5,
        strokes: [],       // completed strokes
        redoStack: [],
        currentPoints: [],  // points being drawn { x, y, pressure, time }
        isDrawing: false,
    };

    // ─── DOM ───
    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas.getContext('2d');
    const canvasArea = document.getElementById('canvas-area');

    // Off-screen canvas for accumulated strokes
    let offCanvas, offCtx;
    let displayScale = 1;

    // ─── Init ───
    function init() {
        resizeCanvas(state.canvasW, state.canvasH);
        bindUI();
        bindPointerEvents();
        bindKeyboard();
        render();
    }

    function resizeCanvas(w, h) {
        state.canvasW = w;
        state.canvasH = h;

        // Off-screen at full resolution
        offCanvas = document.createElement('canvas');
        offCanvas.width = w;
        offCanvas.height = h;
        offCtx = offCanvas.getContext('2d');
        offCtx.lineCap = 'round';
        offCtx.lineJoin = 'round';

        // Redraw all strokes to offscreen
        clearOffscreen();
        for (const stroke of state.strokes) {
            drawStrokeToCtx(offCtx, stroke);
        }

        fitCanvasToArea();
        updateInfo();
    }

    function fitCanvasToArea() {
        const areaW = canvasArea.clientWidth - 20;
        const areaH = canvasArea.clientHeight - 20;
        const scaleX = areaW / state.canvasW;
        const scaleY = areaH / state.canvasH;
        displayScale = Math.min(scaleX, scaleY, 1);

        canvas.width = Math.round(state.canvasW * displayScale);
        canvas.height = Math.round(state.canvasH * displayScale);
        canvas.style.width = canvas.width + 'px';
        canvas.style.height = canvas.height + 'px';

        render();
    }

    function clearOffscreen() {
        offCtx.fillStyle = state.bgColor;
        offCtx.fillRect(0, 0, state.canvasW, state.canvasH);
    }

    // ─── Coordinate mapping ───
    function canvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / displayScale);
        const y = ((e.clientY - rect.top) / displayScale);
        const pressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;
        return { x, y, pressure, time: performance.now() };
    }

    // ─── Pointer Events ───
    function bindPointerEvents() {
        canvas.addEventListener('pointerdown', onPointerDown, { passive: false });
        canvas.addEventListener('pointermove', onPointerMove, { passive: false });
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('pointerleave', onPointerUp);

        // Prevent touch scrolling on canvas
        canvas.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        canvas.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    }

    function onPointerDown(e) {
        e.preventDefault();
        canvas.setPointerCapture(e.pointerId);
        state.isDrawing = true;
        state.currentPoints = [canvasCoords(e)];
        state.redoStack = [];
    }

    function onPointerMove(e) {
        if (!state.isDrawing) return;
        e.preventDefault();

        const pt = canvasCoords(e);
        const prev = state.currentPoints[state.currentPoints.length - 1];

        // Minimum distance filter (reduces noise from shaky touch)
        const dist = Math.hypot(pt.x - prev.x, pt.y - prev.y);
        if (dist < 1.5) return;

        state.currentPoints.push(pt);
        render();
    }

    function onPointerUp(e) {
        if (!state.isDrawing) return;
        state.isDrawing = false;

        if (state.currentPoints.length >= 2) {
            const stroke = buildStroke(state.currentPoints);
            state.strokes.push(stroke);
            drawStrokeToCtx(offCtx, stroke);
        }
        state.currentPoints = [];
        render();
        updateInfo();
    }

    // ─── Catmull-Rom Spline ───
    // Returns interpolated points between p1 and p2 using p0, p3 as control
    function catmullRomSegment(p0, p1, p2, p3, numPoints, alpha = 0.5) {
        const points = [];

        function tj(ti, pi, pj) {
            const dx = pj.x - pi.x;
            const dy = pj.y - pi.y;
            const d = Math.pow(dx * dx + dy * dy, alpha / 2);
            return ti + d;
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
    // Takes raw points, returns smoothed + width-calculated stroke data
    function buildStroke(rawPoints) {
        if (rawPoints.length < 2) return { points: rawPoints, color: state.brushColor, opacity: state.brushOpacity, size: state.brushSize, minWidthRatio: state.minWidthRatio, taperStart: state.taperStart, taperEnd: state.taperEnd };

        // Apply moving-average smoothing on raw points
        const smoothed = smoothPoints(rawPoints, state.smoothing);

        // Interpolate with Catmull-Rom
        const interpolated = interpolateSpline(smoothed);

        // Calculate speed-based widths
        const withWidths = calculateWidths(interpolated);

        return {
            points: withWidths,
            color: state.brushColor,
            opacity: state.brushOpacity,
            size: state.brushSize,
            minWidthRatio: state.minWidthRatio,
            taperStart: state.taperStart,
            taperEnd: state.taperEnd,
        };
    }

    function smoothPoints(pts, amount) {
        if (amount <= 0 || pts.length < 3) return pts.slice();
        const window = Math.max(2, Math.round(amount * 6));
        const result = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
            let sx = 0, sy = 0, sp = 0, count = 0;
            for (let j = Math.max(0, i - window); j <= Math.min(pts.length - 1, i + window); j++) {
                sx += pts[j].x;
                sy += pts[j].y;
                sp += pts[j].pressure;
                count++;
            }
            result.push({ x: sx / count, y: sy / count, pressure: sp / count, time: pts[i].time });
        }
        result.push(pts[pts.length - 1]);
        return result;
    }

    function interpolateSpline(pts) {
        if (pts.length < 3) return pts.slice();

        const result = [];
        // Pad start/end for Catmull-Rom
        const padded = [pts[0], ...pts, pts[pts.length - 1]];

        for (let i = 0; i < padded.length - 3; i++) {
            const segLen = Math.hypot(padded[i + 2].x - padded[i + 1].x, padded[i + 2].y - padded[i + 1].y);
            const numPts = Math.max(2, Math.round(segLen / 2));
            const segment = catmullRomSegment(padded[i], padded[i + 1], padded[i + 2], padded[i + 3], numPts);
            result.push(...segment);
        }

        // Add final point
        result.push(pts[pts.length - 1]);
        return result;
    }

    function calculateWidths(pts) {
        if (pts.length < 2) return pts.map(p => ({ ...p, width: state.brushSize }));

        const totalLen = getTotalLength(pts);
        let runLen = 0;

        return pts.map((pt, i) => {
            if (i > 0) {
                runLen += Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y);
            }

            const t = totalLen > 0 ? runLen / totalLen : 0;
            const pressureFactor = pt.pressure || 0.5;

            // Base width from pressure
            const minW = state.brushSize * state.minWidthRatio;
            let w = minW + (state.brushSize - minW) * pressureFactor;

            // Speed-based thinning
            if (i > 0 && i < pts.length - 1) {
                const dt = (pts[i].time || 1) - (pts[i - 1].time || 0);
                if (dt > 0) {
                    const dist = Math.hypot(pt.x - pts[i - 1].x, pt.y - pts[i - 1].y);
                    const speed = dist / dt;
                    const speedFactor = Math.max(0.3, 1 - speed * 0.15);
                    w *= speedFactor;
                }
            }

            // Taper at start
            if (state.taperStart > 0 && t < state.taperStart) {
                w *= t / state.taperStart;
            }

            // Taper at end
            if (state.taperEnd > 0 && t > (1 - state.taperEnd)) {
                w *= (1 - t) / state.taperEnd;
            }

            w = Math.max(0.5, w);

            return { ...pt, width: w };
        });
    }

    function getTotalLength(pts) {
        let len = 0;
        for (let i = 1; i < pts.length; i++) {
            len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
        }
        return len;
    }

    // ─── Draw Stroke ───
    function drawStrokeToCtx(targetCtx, stroke) {
        const { points, color, opacity, size } = stroke;
        if (points.length < 2) return;

        targetCtx.save();
        targetCtx.globalAlpha = opacity;
        targetCtx.lineCap = 'round';
        targetCtx.lineJoin = 'round';

        // Draw as connected variable-width segments using filled shapes
        const hex = color;
        targetCtx.fillStyle = hex;
        targetCtx.strokeStyle = hex;

        for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const w0 = p0.width || size;
            const w1 = p1.width || size;

            // Draw as a trapezoid between two circles
            const angle = Math.atan2(p1.y - p0.y, p1.x - p0.x);
            const perpAngle = angle + Math.PI / 2;

            const cos = Math.cos(perpAngle);
            const sin = Math.sin(perpAngle);

            targetCtx.beginPath();
            targetCtx.moveTo(p0.x + cos * w0 / 2, p0.y + sin * w0 / 2);
            targetCtx.lineTo(p1.x + cos * w1 / 2, p1.y + sin * w1 / 2);
            targetCtx.lineTo(p1.x - cos * w1 / 2, p1.y - sin * w1 / 2);
            targetCtx.lineTo(p0.x - cos * w0 / 2, p0.y - sin * w0 / 2);
            targetCtx.closePath();
            targetCtx.fill();

            // Fill circles at joints for smooth connection
            targetCtx.beginPath();
            targetCtx.arc(p0.x, p0.y, w0 / 2, 0, Math.PI * 2);
            targetCtx.fill();
        }

        // Final dot
        const last = points[points.length - 1];
        targetCtx.beginPath();
        targetCtx.arc(last.x, last.y, (last.width || size) / 2, 0, Math.PI * 2);
        targetCtx.fill();

        targetCtx.restore();
    }

    // ─── Render (display canvas) ───
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // Draw offscreen (completed strokes) scaled down
        ctx.drawImage(offCanvas, 0, 0, canvas.width, canvas.height);

        // Draw guide lines
        if (state.showGuides) {
            drawGuides(ctx, canvas.width, canvas.height);
        }

        // Draw current stroke in progress
        if (state.currentPoints.length >= 2) {
            const tempStroke = buildStroke(state.currentPoints);
            ctx.save();
            ctx.scale(displayScale, displayScale);
            drawStrokeToCtx(ctx, tempStroke);
            ctx.restore();
        }
    }

    function drawGuides(targetCtx, w, h) {
        const pad = state.guidePadding / 100;
        const rows = state.guideRows;
        const padPx = h * pad;
        const usableH = h - padPx * 2;
        const rowH = usableH / rows;

        targetCtx.save();
        targetCtx.strokeStyle = 'rgba(108,138,255,0.15)';
        targetCtx.lineWidth = 1;
        targetCtx.setLineDash([4, 4]);

        // Horizontal lines
        for (let i = 0; i <= rows; i++) {
            const y = padPx + i * rowH;
            targetCtx.beginPath();
            targetCtx.moveTo(w * pad, y);
            targetCtx.lineTo(w * (1 - pad), y);
            targetCtx.stroke();

            // Midline (x-height guide)
            if (i < rows) {
                targetCtx.strokeStyle = 'rgba(108,138,255,0.08)';
                targetCtx.beginPath();
                targetCtx.moveTo(w * pad, y + rowH * 0.6);
                targetCtx.lineTo(w * (1 - pad), y + rowH * 0.6);
                targetCtx.stroke();
                targetCtx.strokeStyle = 'rgba(108,138,255,0.15)';
            }
        }

        targetCtx.restore();
    }

    // ─── Undo / Redo ───
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
        clearOffscreen();
        render();
        updateInfo();
    }

    function rebuildOffscreen() {
        clearOffscreen();
        for (const stroke of state.strokes) {
            drawStrokeToCtx(offCtx, stroke);
        }
    }

    // ─── Export ───
    function exportPNG() {
        const link = document.createElement('a');
        link.download = `lettering_${Date.now()}.png`;
        link.href = offCanvas.toDataURL('image/png');
        link.click();
    }

    // ─── UI Binding ───
    function bindUI() {
        const $ = id => document.getElementById(id);

        // Brush size
        $('brushSize').addEventListener('input', e => {
            state.brushSize = +e.target.value;
            $('sizeVal').textContent = state.brushSize;
        });

        // Min width ratio
        $('minWidthRatio').addEventListener('input', e => {
            state.minWidthRatio = +e.target.value / 100;
            $('minWidthVal').textContent = state.minWidthRatio.toFixed(2);
        });

        // Smoothing
        $('smoothing').addEventListener('input', e => {
            state.smoothing = +e.target.value / 100;
            $('smoothVal').textContent = state.smoothing.toFixed(2);
        });

        // Taper start
        $('taperStart').addEventListener('input', e => {
            state.taperStart = +e.target.value / 100;
            $('taperStartVal').textContent = state.taperStart.toFixed(2);
        });

        // Taper end
        $('taperEnd').addEventListener('input', e => {
            state.taperEnd = +e.target.value / 100;
            $('taperEndVal').textContent = state.taperEnd.toFixed(2);
        });

        // Color
        $('brushColor').addEventListener('input', e => {
            state.brushColor = e.target.value;
        });

        // Opacity
        $('brushOpacity').addEventListener('input', e => {
            state.brushOpacity = +e.target.value / 100;
            $('opacityVal').textContent = state.brushOpacity.toFixed(1);
        });

        // BG color
        $('bgColor').addEventListener('input', e => {
            state.bgColor = e.target.value;
            rebuildOffscreen();
            render();
        });

        // Canvas resize
        $('resizeBtn').addEventListener('click', () => {
            const w = Math.max(100, Math.min(4096, +$('canvasW').value));
            const h = Math.max(100, Math.min(4096, +$('canvasH').value));
            // Save existing strokes, resize, redraw
            resizeCanvas(w, h);
        });

        // Guides
        $('showGuides').addEventListener('change', e => {
            state.showGuides = e.target.checked;
            render();
        });

        $('guideRows').addEventListener('input', e => {
            state.guideRows = +e.target.value;
            $('guideRowsVal').textContent = state.guideRows;
            render();
        });

        $('guidePadding').addEventListener('input', e => {
            state.guidePadding = +e.target.value;
            $('guidePadVal').textContent = state.guidePadding + '%';
            render();
        });

        // Buttons
        $('undoBtn').addEventListener('click', undo);
        $('redoBtn').addEventListener('click', redo);
        $('clearBtn').addEventListener('click', clearAll);
        $('exportBtn').addEventListener('click', exportPNG);

        // Presets
        const presets = {
            pen:         { brushSize: 4,  minWidthRatio: 0.3,  smoothing: 0.3,  taperStart: 0.05, taperEnd: 0.15 },
            brush:       { brushSize: 16, minWidthRatio: 0.1,  smoothing: 0.5,  taperStart: 0.1,  taperEnd: 0.3  },
            marker:      { brushSize: 12, minWidthRatio: 0.85, smoothing: 0.2,  taperStart: 0,    taperEnd: 0    },
            calligraphy: { brushSize: 20, minWidthRatio: 0.05, smoothing: 0.6,  taperStart: 0.15, taperEnd: 0.4  },
        };

        document.querySelectorAll('.preset-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const p = presets[btn.dataset.preset];
                if (!p) return;

                // Apply preset values
                Object.assign(state, p);

                // Update UI controls
                $('brushSize').value = p.brushSize;
                $('sizeVal').textContent = p.brushSize;
                $('minWidthRatio').value = Math.round(p.minWidthRatio * 100);
                $('minWidthVal').textContent = p.minWidthRatio.toFixed(2);
                $('smoothing').value = Math.round(p.smoothing * 100);
                $('smoothVal').textContent = p.smoothing.toFixed(2);
                $('taperStart').value = Math.round(p.taperStart * 100);
                $('taperStartVal').textContent = p.taperStart.toFixed(2);
                $('taperEnd').value = Math.round(p.taperEnd * 100);
                $('taperEndVal').textContent = p.taperEnd.toFixed(2);

                // Active state
                document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        // Window resize
        window.addEventListener('resize', () => fitCanvasToArea());
    }

    function updateInfo() {
        document.getElementById('canvasInfoText').textContent = `${state.canvasW} \u00d7 ${state.canvasH}`;
        document.getElementById('strokeCount').textContent = `strokes: ${state.strokes.length}`;
    }

    // ─── Keyboard shortcuts ───
    function bindKeyboard() {
        document.addEventListener('keydown', e => {
            // Ctrl+Z / Cmd+Z
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key === 'z') {
                e.preventDefault();
                undo();
            }
            // Ctrl+Shift+Z / Cmd+Shift+Z
            if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === 'z') {
                e.preventDefault();
                redo();
            }
            // Ctrl+S / Cmd+S — export
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                exportPNG();
            }
        });
    }

    // ─── Start ───
    init();
})();

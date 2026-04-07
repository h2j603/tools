/* ═══════════════════════════════════════════
   Lettering Tool v3
   Catmull-Rom drawing + Bezier handle editing + SVG export
   Mobile-optimized with proper touch-action separation
   ═══════════════════════════════════════════ */

(() => {
    // ─── State ───
    const state = {
        canvasW: 1080, canvasH: 1080,
        bgColor: '#0c0c0e',
        brushSize: 8, minWidthRatio: 0.15,
        smoothing: 0.5, taperStart: 0.1, taperEnd: 0.3,
        brushColor: '#e8e8ec', brushOpacity: 1.0,
        tool: 'brush', // 'brush' | 'eraser' | 'select'
        mirror: false,
        showGuides: false, showGrid: false,
        guideRows: 4, guidePadding: 5, gridSize: 50,
        strokes: [],    // { anchors, color, opacity, size, minWidthRatio, taperStart, taperEnd, eraser }
        redoStack: [],
        currentPoints: [],
        isDrawing: false,
        recentColors: ['#e8e8ec','#ff4455','#44cc88','#6c8aff','#ffaa33','#cc44ff','#ffffff','#000000'],
        zoom: 1, panX: 0, panY: 0,
        refImage: null, refOpacity: 0.3,
        // Select state
        selectedStroke: -1,
        dragTarget: null, // { strokeIdx, type:'anchor'|'handleIn'|'handleOut', idx }
    };

    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas.getContext('2d');
    const canvasArea = document.getElementById('canvas-area');
    const brushCursor = document.getElementById('brushCursor');
    let offCanvas, offCtx;
    let activePointers = new Map();
    let pinchStartDist = 0, pinchStartZoom = 1;

    // ══════════════════════════════════
    // INIT
    // ══════════════════════════════════
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
        rebuildOffscreen();
    }

    function rebuildOffscreen() {
        offCtx.globalCompositeOperation = 'source-over';
        offCtx.fillStyle = state.bgColor;
        offCtx.fillRect(0, 0, state.canvasW, state.canvasH);
        for (const s of state.strokes) drawStrokeToCtx(offCtx, s);
    }

    function fitView() {
        const aw = canvasArea.clientWidth - 20, ah = canvasArea.clientHeight - 20;
        state.zoom = Math.min(aw / state.canvasW, ah / state.canvasH, 1);
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

    // ══════════════════════════════════
    // COORDINATE MAPPING
    // ══════════════════════════════════
    function canvasCoords(e) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) / state.zoom,
            y: (e.clientY - rect.top) / state.zoom,
            pressure: e.pressure > 0 ? e.pressure : 0.5,
            time: performance.now()
        };
    }

    // ══════════════════════════════════
    // POINTER EVENTS
    // Only canvas-area gets touch-action:none.
    // Controls panel has touch-action:auto (CSS) so scrolling works.
    // ══════════════════════════════════
    function bindPointerEvents() {
        canvasArea.addEventListener('pointerdown', onPointerDown, { passive: false });
        canvasArea.addEventListener('pointermove', onPointerMove, { passive: false });
        canvasArea.addEventListener('pointerup', onPointerUp);
        canvasArea.addEventListener('pointercancel', onPointerUp);
        canvasArea.addEventListener('wheel', onWheel, { passive: false });
    }

    function onPointerDown(e) {
        e.preventDefault();
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Two-finger pinch
        if (activePointers.size === 2) {
            state.isDrawing = false;
            state.currentPoints = [];
            const pts = [...activePointers.values()];
            pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            pinchStartZoom = state.zoom;
            canvasArea.classList.add('panning');
            return;
        }
        if (activePointers.size > 2) return;

        const pt = canvasCoords(e);

        if (state.tool === 'select') {
            handleSelectDown(pt, e);
            return;
        }

        canvasArea.setPointerCapture(e.pointerId);
        state.isDrawing = true;
        state.currentPoints = [pt];
        state.redoStack = [];
    }

    function onPointerMove(e) {
        e.preventDefault();
        updateBrushCursor(e);

        const prev = activePointers.get(e.pointerId);
        if (!prev) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        // Pinch zoom+pan
        if (activePointers.size === 2) {
            const pts = [...activePointers.values()];
            const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            const newZoom = Math.max(0.1, Math.min(10, pinchStartZoom * (dist / pinchStartDist)));
            const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
            state.panX += dx / 2;
            state.panY += dy / 2;
            const areaRect = canvasArea.getBoundingClientRect();
            const midX = (pts[0].x + pts[1].x) / 2 - areaRect.left;
            const midY = (pts[0].y + pts[1].y) / 2 - areaRect.top;
            const cxB = (midX - state.panX) / state.zoom;
            const cyB = (midY - state.panY) / state.zoom;
            state.zoom = newZoom;
            state.panX = midX - cxB * state.zoom;
            state.panY = midY - cyB * state.zoom;
            applyTransform(); render(); updateInfo();
            return;
        }

        if (state.tool === 'select') {
            handleSelectMove(canvasCoords(e));
            return;
        }

        if (!state.isDrawing) return;
        const pt = canvasCoords(e);
        const last = state.currentPoints[state.currentPoints.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1.5) return;
        state.currentPoints.push(pt);
        render();
    }

    function onPointerUp(e) {
        activePointers.delete(e.pointerId);
        canvasArea.classList.remove('panning');

        if (state.tool === 'select') {
            handleSelectUp();
            return;
        }

        if (!state.isDrawing || activePointers.size > 0) return;
        state.isDrawing = false;

        if (state.currentPoints.length >= 2) {
            const stroke = buildStroke(state.currentPoints);
            state.strokes.push(stroke);
            drawStrokeToCtx(offCtx, stroke);
            if (state.mirror) {
                const m = buildMirroredStroke(state.currentPoints);
                state.strokes.push(m);
                drawStrokeToCtx(offCtx, m);
            }
            addRecentColor(state.brushColor);
        }
        state.currentPoints = [];
        render(); updateInfo();
    }

    function onWheel(e) {
        e.preventDefault();
        const ar = canvasArea.getBoundingClientRect();
        const mx = e.clientX - ar.left, my = e.clientY - ar.top;
        const cxB = (mx - state.panX) / state.zoom;
        const cyB = (my - state.panY) / state.zoom;
        state.zoom = Math.max(0.1, Math.min(10, state.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
        state.panX = mx - cxB * state.zoom;
        state.panY = my - cyB * state.zoom;
        applyTransform(); render(); updateInfo();
    }

    function updateBrushCursor(e) {
        if (state.tool === 'select') return;
        const ar = canvasArea.getBoundingClientRect();
        const sz = state.brushSize * state.zoom;
        brushCursor.style.left = (e.clientX - ar.left) + 'px';
        brushCursor.style.top = (e.clientY - ar.top) + 'px';
        brushCursor.style.width = sz + 'px';
        brushCursor.style.height = sz + 'px';
        brushCursor.style.borderColor = state.tool === 'eraser' ? 'rgba(255,68,85,0.6)' : 'rgba(108,138,255,0.6)';
    }


    // ══════════════════════════════════
    // CATMULL-ROM SPLINE
    // ══════════════════════════════════
    function catmullRom(p0, p1, p2, p3, n, alpha) {
        alpha = alpha || 0.5;
        const pts = [];
        function tj(ti, a, b) { return ti + Math.pow((b.x-a.x)**2 + (b.y-a.y)**2, alpha/2); }
        const t0=0, t1=tj(t0,p0,p1), t2=tj(t1,p1,p2), t3=tj(t2,p2,p3);
        if (t1===t0||t2===t1||t3===t2) return [p1];
        for (let i=0; i<n; i++) {
            const t = t1 + (i/n)*(t2-t1);
            const a1x=((t1-t)/(t1-t0))*p0.x+((t-t0)/(t1-t0))*p1.x;
            const a1y=((t1-t)/(t1-t0))*p0.y+((t-t0)/(t1-t0))*p1.y;
            const a1p=((t1-t)/(t1-t0))*p0.pressure+((t-t0)/(t1-t0))*p1.pressure;
            const a2x=((t2-t)/(t2-t1))*p1.x+((t-t1)/(t2-t1))*p2.x;
            const a2y=((t2-t)/(t2-t1))*p1.y+((t-t1)/(t2-t1))*p2.y;
            const a2p=((t2-t)/(t2-t1))*p1.pressure+((t-t1)/(t2-t1))*p2.pressure;
            const a3x=((t3-t)/(t3-t2))*p2.x+((t-t2)/(t3-t2))*p3.x;
            const a3y=((t3-t)/(t3-t2))*p2.y+((t-t2)/(t3-t2))*p3.y;
            const a3p=((t3-t)/(t3-t2))*p2.pressure+((t-t2)/(t3-t2))*p3.pressure;
            const b1x=((t2-t)/(t2-t0))*a1x+((t-t0)/(t2-t0))*a2x;
            const b1y=((t2-t)/(t2-t0))*a1y+((t-t0)/(t2-t0))*a2y;
            const b1p=((t2-t)/(t2-t0))*a1p+((t-t0)/(t2-t0))*a2p;
            const b2x=((t3-t)/(t3-t1))*a2x+((t-t1)/(t3-t1))*a3x;
            const b2y=((t3-t)/(t3-t1))*a2y+((t-t1)/(t3-t1))*a3y;
            const b2p=((t3-t)/(t3-t1))*a2p+((t-t1)/(t3-t1))*a3p;
            pts.push({
                x: ((t2-t)/(t2-t1))*b1x+((t-t1)/(t2-t1))*b2x,
                y: ((t2-t)/(t2-t1))*b1y+((t-t1)/(t2-t1))*b2y,
                pressure: ((t2-t)/(t2-t1))*b1p+((t-t1)/(t2-t1))*b2p
            });
        }
        return pts;
    }

    // ══════════════════════════════════
    // BUILD STROKE
    // Raw points → smoothed → spline → variable width → anchors for editing
    // ══════════════════════════════════
    function buildStroke(rawPts) {
        const isEraser = state.tool === 'eraser';
        const smoothed = smoothPoints(rawPts, state.smoothing);
        const interp = interpolateSpline(smoothed);
        const withW = calculateWidths(interp);
        const anchors = pointsToAnchors(withW);
        return {
            anchors,
            renderPoints: withW,
            color: isEraser ? state.bgColor : state.brushColor,
            opacity: isEraser ? 1.0 : state.brushOpacity,
            size: state.brushSize,
            minWidthRatio: state.minWidthRatio,
            taperStart: isEraser ? 0 : state.taperStart,
            taperEnd: isEraser ? 0 : state.taperEnd,
            eraser: isEraser,
        };
    }

    function buildMirroredStroke(rawPts) {
        const mid = state.canvasW / 2;
        const mirrored = rawPts.map(p => ({ ...p, x: mid + (mid - p.x) }));
        return buildStroke(mirrored);
    }

    function smoothPoints(pts, amt) {
        if (amt <= 0 || pts.length < 3) return pts.slice();
        const w = Math.max(2, Math.round(amt * 6));
        const res = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
            let sx=0,sy=0,sp=0,c=0;
            for (let j = Math.max(0,i-w); j <= Math.min(pts.length-1,i+w); j++) {
                sx+=pts[j].x; sy+=pts[j].y; sp+=pts[j].pressure; c++;
            }
            res.push({ x:sx/c, y:sy/c, pressure:sp/c, time:pts[i].time });
        }
        res.push(pts[pts.length-1]);
        return res;
    }

    function interpolateSpline(pts) {
        if (pts.length < 3) return pts.slice();
        const res = [];
        const p = [pts[0], ...pts, pts[pts.length-1]];
        for (let i = 0; i < p.length-3; i++) {
            const d = Math.hypot(p[i+2].x-p[i+1].x, p[i+2].y-p[i+1].y);
            res.push(...catmullRom(p[i],p[i+1],p[i+2],p[i+3], Math.max(2,Math.round(d/2))));
        }
        res.push(pts[pts.length-1]);
        return res;
    }

    function calculateWidths(pts) {
        if (pts.length < 2) return pts.map(p => ({ ...p, width: state.brushSize }));
        const totalLen = getTotalLen(pts);
        let run = 0;
        return pts.map((pt, i) => {
            if (i > 0) run += Math.hypot(pt.x-pts[i-1].x, pt.y-pts[i-1].y);
            const t = totalLen > 0 ? run / totalLen : 0;
            const pf = pt.pressure || 0.5;
            const minW = state.brushSize * state.minWidthRatio;
            let w = minW + (state.brushSize - minW) * pf;
            if (i > 0 && i < pts.length-1) {
                const dt = (pt.time||1) - (pts[i-1].time||0);
                if (dt > 0) w *= Math.max(0.3, 1 - Math.hypot(pt.x-pts[i-1].x, pt.y-pts[i-1].y)/dt * 0.15);
            }
            if (state.taperStart > 0 && t < state.taperStart) w *= t / state.taperStart;
            if (state.taperEnd > 0 && t > (1-state.taperEnd)) w *= (1-t) / state.taperEnd;
            return { ...pt, width: Math.max(0.5, w) };
        });
    }

    function getTotalLen(pts) {
        let l=0; for(let i=1;i<pts.length;i++) l+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y); return l;
    }

    // ══════════════════════════════════
    // ANCHOR SYSTEM (for handle editing)
    // Simplify dense render points down to editable anchors with bezier handles.
    // Uses Ramer-Douglas-Peucker to reduce, then compute smooth handles.
    // ══════════════════════════════════
    function pointsToAnchors(pts) {
        if (pts.length < 2) return pts.map(p => ({ x:p.x, y:p.y, w:p.width||state.brushSize, hix:0,hiy:0, hox:0,hoy:0 }));
        // RDP simplification
        const simplified = rdpSimplify(pts, 3);
        return simplified.map((p, i, arr) => {
            // Compute smooth handles from neighbors
            const prev = arr[i-1] || p;
            const next = arr[i+1] || p;
            const dx = next.x - prev.x, dy = next.y - prev.y;
            const len = Math.hypot(dx, dy) || 1;
            const handleLen = len * 0.25;
            const ux = dx/len, uy = dy/len;
            return {
                x: p.x, y: p.y, w: p.width || state.brushSize,
                // handleIn (relative to anchor)
                hix: -ux * handleLen, hiy: -uy * handleLen,
                // handleOut (relative to anchor)
                hox: ux * handleLen, hoy: uy * handleLen,
            };
        });
    }

    function rdpSimplify(pts, epsilon) {
        if (pts.length <= 2) return pts.slice();
        let maxDist = 0, maxIdx = 0;
        const first = pts[0], last = pts[pts.length-1];
        for (let i = 1; i < pts.length-1; i++) {
            const d = pointLineDistance(pts[i], first, last);
            if (d > maxDist) { maxDist = d; maxIdx = i; }
        }
        if (maxDist > epsilon) {
            const left = rdpSimplify(pts.slice(0, maxIdx+1), epsilon);
            const right = rdpSimplify(pts.slice(maxIdx), epsilon);
            return left.slice(0, -1).concat(right);
        }
        return [first, last];
    }

    function pointLineDistance(p, a, b) {
        const dx = b.x-a.x, dy = b.y-a.y;
        const lenSq = dx*dx+dy*dy;
        if (lenSq === 0) return Math.hypot(p.x-a.x, p.y-a.y);
        const t = Math.max(0, Math.min(1, ((p.x-a.x)*dx+(p.y-a.y)*dy)/lenSq));
        return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
    }

    // Regenerate render points from anchors (after handle editing)
    function anchorsToRenderPoints(stroke) {
        const anchors = stroke.anchors;
        if (anchors.length < 2) return anchors.map(a => ({ x:a.x, y:a.y, width:a.w }));
        const pts = [];
        for (let i = 0; i < anchors.length-1; i++) {
            const a = anchors[i], b = anchors[i+1];
            const cp1x = a.x + a.hox, cp1y = a.y + a.hoy;
            const cp2x = b.x + b.hix, cp2y = b.y + b.hiy;
            const segLen = Math.hypot(b.x-a.x, b.y-a.y);
            const steps = Math.max(8, Math.round(segLen / 3));
            for (let s = 0; s <= steps; s++) {
                const t = s / steps;
                const it = 1-t;
                const x = it*it*it*a.x + 3*it*it*t*cp1x + 3*it*t*t*cp2x + t*t*t*b.x;
                const y = it*it*it*a.y + 3*it*it*t*cp1y + 3*it*t*t*cp2y + t*t*t*b.y;
                const w = a.w + (b.w - a.w) * t;
                pts.push({ x, y, width: w });
            }
        }
        return pts;
    }


    // ══════════════════════════════════
    // SELECT / HANDLE EDITING
    // ══════════════════════════════════
    const HANDLE_RADIUS = 14; // px in screen space — big for mobile touch

    function handleSelectDown(pt, e) {
        // First check if clicking on a handle of selected stroke
        if (state.selectedStroke >= 0) {
            const s = state.strokes[state.selectedStroke];
            if (s) {
                const hit = hitTestHandles(s, pt);
                if (hit) {
                    state.dragTarget = { strokeIdx: state.selectedStroke, ...hit };
                    return;
                }
            }
        }
        // Then check if clicking on any stroke
        const idx = hitTestStroke(pt);
        state.selectedStroke = idx;
        state.dragTarget = null;
        updateSelectUI();
        render();
    }

    function handleSelectMove(pt) {
        if (!state.dragTarget) return;
        const s = state.strokes[state.dragTarget.strokeIdx];
        if (!s) return;
        const a = s.anchors[state.dragTarget.idx];
        if (!a) return;

        if (state.dragTarget.type === 'anchor') {
            const dx = pt.x - a.x, dy = pt.y - a.y;
            a.x = pt.x; a.y = pt.y;
        } else if (state.dragTarget.type === 'handleOut') {
            a.hox = pt.x - a.x;
            a.hoy = pt.y - a.y;
        } else if (state.dragTarget.type === 'handleIn') {
            a.hix = pt.x - a.x;
            a.hiy = pt.y - a.y;
        }

        // Rebuild render points from modified anchors
        s.renderPoints = anchorsToRenderPoints(s);
        rebuildOffscreen();
        render();
    }

    function handleSelectUp() {
        state.dragTarget = null;
    }

    function hitTestHandles(stroke, pt) {
        const r = HANDLE_RADIUS / state.zoom;
        for (let i = 0; i < stroke.anchors.length; i++) {
            const a = stroke.anchors[i];
            // Handle In
            if (Math.hypot(pt.x - (a.x+a.hix), pt.y - (a.y+a.hiy)) < r)
                return { type: 'handleIn', idx: i };
            // Handle Out
            if (Math.hypot(pt.x - (a.x+a.hox), pt.y - (a.y+a.hoy)) < r)
                return { type: 'handleOut', idx: i };
            // Anchor
            if (Math.hypot(pt.x - a.x, pt.y - a.y) < r)
                return { type: 'anchor', idx: i };
        }
        return null;
    }

    function hitTestStroke(pt) {
        // Test from top (last drawn) to bottom
        for (let i = state.strokes.length - 1; i >= 0; i--) {
            const rp = state.strokes[i].renderPoints;
            if (!rp) continue;
            for (const p of rp) {
                const w = (p.width || state.strokes[i].size || 8) / 2 + 8;
                if (Math.hypot(pt.x - p.x, pt.y - p.y) < w) return i;
            }
        }
        return -1;
    }

    function updateSelectUI() {
        const infoEl = document.getElementById('selectInfo');
        const hintEl = document.getElementById('selectHintText');
        if (state.tool !== 'select') { infoEl.style.display = 'none'; return; }
        infoEl.style.display = '';
        if (state.selectedStroke >= 0 && state.strokes[state.selectedStroke]) {
            const s = state.strokes[state.selectedStroke];
            hintEl.textContent = `앵커 ${s.anchors.length}개 — 드래그하여 곡선을 편집하세요.`;
            document.getElementById('selectedStrokeColor').value = s.color;
            document.getElementById('selectedStrokeSize').value = s.size;
            document.getElementById('selectedSizeVal').textContent = s.size;
        } else {
            hintEl.textContent = '스트로크를 탭하여 선택하세요. 앵커 포인트와 핸들을 드래그하여 곡선을 편집합니다.';
        }
    }

    // ══════════════════════════════════
    // DRAW STROKE TO CANVAS
    // ══════════════════════════════════
    function drawStrokeToCtx(tc, stroke) {
        const pts = stroke.renderPoints;
        if (!pts || pts.length < 2) return;
        tc.save();
        if (stroke.eraser) {
            tc.globalCompositeOperation = 'destination-out';
            tc.globalAlpha = 1;
            tc.fillStyle = '#000';
        } else {
            tc.globalCompositeOperation = 'source-over';
            tc.globalAlpha = stroke.opacity;
            tc.fillStyle = stroke.color;
        }
        for (let i = 0; i < pts.length - 1; i++) {
            const p0 = pts[i], p1 = pts[i+1];
            const w0 = p0.width || stroke.size, w1 = p1.width || stroke.size;
            const ang = Math.atan2(p1.y-p0.y, p1.x-p0.x) + Math.PI/2;
            const c = Math.cos(ang), s = Math.sin(ang);
            tc.beginPath();
            tc.moveTo(p0.x+c*w0/2, p0.y+s*w0/2);
            tc.lineTo(p1.x+c*w1/2, p1.y+s*w1/2);
            tc.lineTo(p1.x-c*w1/2, p1.y-s*w1/2);
            tc.lineTo(p0.x-c*w0/2, p0.y-s*w0/2);
            tc.closePath(); tc.fill();
            tc.beginPath(); tc.arc(p0.x,p0.y,w0/2,0,Math.PI*2); tc.fill();
        }
        const last = pts[pts.length-1];
        tc.beginPath(); tc.arc(last.x,last.y,(last.width||stroke.size)/2,0,Math.PI*2); tc.fill();
        tc.restore();
    }

    // ══════════════════════════════════
    // RENDER
    // ══════════════════════════════════
    function render() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = state.bgColor;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Reference image
        if (state.refImage) {
            ctx.save(); ctx.globalAlpha = state.refOpacity;
            ctx.drawImage(state.refImage, 0, 0, canvas.width, canvas.height);
            ctx.restore();
        }

        // Completed strokes
        ctx.drawImage(offCanvas, 0, 0);

        // Grid & Guides
        if (state.showGrid) drawGrid(ctx);
        if (state.showGuides) drawGuides(ctx);

        // Mirror line
        if (state.mirror) {
            ctx.save(); ctx.strokeStyle='rgba(108,138,255,0.3)'; ctx.lineWidth=1;
            ctx.setLineDash([6,6]); ctx.beginPath();
            ctx.moveTo(state.canvasW/2,0); ctx.lineTo(state.canvasW/2,state.canvasH);
            ctx.stroke(); ctx.restore();
        }

        // Current drawing stroke
        if (state.currentPoints.length >= 2) {
            const tmp = buildStroke(state.currentPoints);
            drawStrokeToCtx(ctx, tmp);
            if (state.mirror) drawStrokeToCtx(ctx, buildMirroredStroke(state.currentPoints));
        }

        // Selected stroke handles
        if (state.tool === 'select' && state.selectedStroke >= 0) {
            const s = state.strokes[state.selectedStroke];
            if (s) drawHandles(ctx, s);
        }
    }

    function drawHandles(c, stroke) {
        const anchors = stroke.anchors;
        c.save();
        for (let i = 0; i < anchors.length; i++) {
            const a = anchors[i];
            const hix = a.x+a.hix, hiy = a.y+a.hiy;
            const hox = a.x+a.hox, hoy = a.y+a.hoy;

            // Handle lines
            c.strokeStyle = 'rgba(108,138,255,0.5)';
            c.lineWidth = 1.5;
            c.setLineDash([]);
            c.beginPath(); c.moveTo(hix,hiy); c.lineTo(a.x,a.y); c.lineTo(hox,hoy); c.stroke();

            // Handle dots (diamonds)
            const hs = 5;
            c.fillStyle = '#6c8aff';
            [{ x:hix, y:hiy }, { x:hox, y:hoy }].forEach(h => {
                c.save(); c.translate(h.x, h.y); c.rotate(Math.PI/4);
                c.fillRect(-hs, -hs, hs*2, hs*2);
                c.restore();
            });

            // Anchor point (square)
            const as = 6;
            c.fillStyle = state.selectedStroke >= 0 ? '#fff' : '#6c8aff';
            c.strokeStyle = '#6c8aff';
            c.lineWidth = 2;
            c.fillRect(a.x-as, a.y-as, as*2, as*2);
            c.strokeRect(a.x-as, a.y-as, as*2, as*2);
        }
        c.restore();
    }

    function drawGuides(c) {
        const pad = state.guidePadding/100, rows = state.guideRows;
        const pPx = state.canvasH*pad, uH = state.canvasH-pPx*2, rH = uH/rows;
        c.save(); c.strokeStyle='rgba(108,138,255,0.15)'; c.lineWidth=1; c.setLineDash([4,4]);
        for (let i=0;i<=rows;i++) {
            const y=pPx+i*rH;
            c.beginPath(); c.moveTo(state.canvasW*pad,y); c.lineTo(state.canvasW*(1-pad),y); c.stroke();
            if (i<rows) {
                c.strokeStyle='rgba(108,138,255,0.08)';
                c.beginPath(); c.moveTo(state.canvasW*pad,y+rH*0.6); c.lineTo(state.canvasW*(1-pad),y+rH*0.6); c.stroke();
                c.strokeStyle='rgba(108,138,255,0.15)';
            }
        }
        c.restore();
    }

    function drawGrid(c) {
        const g=state.gridSize; c.save(); c.strokeStyle='rgba(108,138,255,0.06)'; c.lineWidth=1;
        for(let x=g;x<state.canvasW;x+=g){c.beginPath();c.moveTo(x,0);c.lineTo(x,state.canvasH);c.stroke();}
        for(let y=g;y<state.canvasH;y+=g){c.beginPath();c.moveTo(0,y);c.lineTo(state.canvasW,y);c.stroke();}
        c.restore();
    }


    // ══════════════════════════════════
    // UNDO / REDO / CLEAR
    // ══════════════════════════════════
    function undo() {
        if (!state.strokes.length) return;
        state.redoStack.push(state.strokes.pop());
        state.selectedStroke = -1;
        rebuildOffscreen(); render(); updateInfo(); updateSelectUI();
    }
    function redo() {
        if (!state.redoStack.length) return;
        state.strokes.push(state.redoStack.pop());
        rebuildOffscreen(); render(); updateInfo();
    }
    function clearAll() {
        if (!state.strokes.length) return;
        state.redoStack = []; state.strokes = [];
        state.selectedStroke = -1;
        rebuildOffscreen(); render(); updateInfo(); updateSelectUI();
    }

    // ══════════════════════════════════
    // EXPORT — PNG
    // ══════════════════════════════════
    function exportPNG(transparent) {
        const ec = document.createElement('canvas');
        ec.width = state.canvasW; ec.height = state.canvasH;
        const ex = ec.getContext('2d');
        if (!transparent) { ex.fillStyle = state.bgColor; ex.fillRect(0,0,state.canvasW,state.canvasH); }
        for (const s of state.strokes) drawStrokeToCtx(ex, s);
        const a = document.createElement('a');
        a.download = `lettering_${Date.now()}.png`;
        a.href = ec.toDataURL('image/png'); a.click();
    }

    // ══════════════════════════════════
    // EXPORT — SVG
    // Converts variable-width strokes to filled SVG <path> outlines.
    // Each stroke becomes a closed path (left edge → right edge reversed).
    // ══════════════════════════════════
    function exportSVG() {
        const paths = [];
        for (const stroke of state.strokes) {
            if (stroke.eraser) continue;
            const pts = stroke.renderPoints;
            if (!pts || pts.length < 2) continue;

            // Build left and right edge points
            const left = [], right = [];
            for (let i = 0; i < pts.length; i++) {
                const p = pts[i];
                const w = (p.width || stroke.size) / 2;
                let nx, ny;
                if (i < pts.length - 1) {
                    const dx = pts[i+1].x - p.x, dy = pts[i+1].y - p.y;
                    const len = Math.hypot(dx, dy) || 1;
                    nx = -dy/len; ny = dx/len;
                } else if (i > 0) {
                    const dx = p.x - pts[i-1].x, dy = p.y - pts[i-1].y;
                    const len = Math.hypot(dx, dy) || 1;
                    nx = -dy/len; ny = dx/len;
                } else { nx = 0; ny = -1; }
                left.push({ x: p.x + nx*w, y: p.y + ny*w });
                right.push({ x: p.x - nx*w, y: p.y - ny*w });
            }

            // Build SVG path: left edge forward, right edge backward, close
            let d = `M ${r(left[0].x)} ${r(left[0].y)}`;
            // Fit cubic beziers through left edge
            d += fitSvgCurve(left);
            // Line to last right point
            const lastR = right[right.length-1];
            d += ` L ${r(lastR.x)} ${r(lastR.y)}`;
            // Right edge backward
            const rightRev = right.slice().reverse();
            d += fitSvgCurve(rightRev);
            d += ' Z';

            const opacity = stroke.opacity < 1 ? ` opacity="${stroke.opacity}"` : '';
            paths.push(`  <path d="${d}" fill="${stroke.color}"${opacity}/>`);
        }

        const svg = [
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${state.canvasW} ${state.canvasH}" width="${state.canvasW}" height="${state.canvasH}">`,
            `  <rect width="100%" height="100%" fill="${state.bgColor}"/>`,
            ...paths,
            `</svg>`
        ].join('\n');

        const blob = new Blob([svg], { type: 'image/svg+xml' });
        const a = document.createElement('a');
        a.download = `lettering_${Date.now()}.svg`;
        a.href = URL.createObjectURL(blob);
        a.click();
        URL.revokeObjectURL(a.href);
    }

    function r(n) { return Math.round(n * 100) / 100; }

    // Fit smooth cubic bezier curves through a series of points for SVG path
    function fitSvgCurve(pts) {
        if (pts.length < 2) return '';
        if (pts.length === 2) return ` L ${r(pts[1].x)} ${r(pts[1].y)}`;

        let d = '';
        for (let i = 1; i < pts.length; i++) {
            const p0 = pts[i-1], p1 = pts[i];
            const prev = pts[i-2] || p0;
            const next = pts[i+1] || p1;

            // Compute control points using Catmull-Rom to Bezier conversion
            const cp1x = p0.x + (p1.x - prev.x) / 6;
            const cp1y = p0.y + (p1.y - prev.y) / 6;
            const cp2x = p1.x - (next.x - p0.x) / 6;
            const cp2y = p1.y - (next.y - p0.y) / 6;

            d += ` C ${r(cp1x)} ${r(cp1y)}, ${r(cp2x)} ${r(cp2y)}, ${r(p1.x)} ${r(p1.y)}`;
        }
        return d;
    }

    // ══════════════════════════════════
    // FULLSCREEN
    // ══════════════════════════════════
    function showFullscreen() {
        const v = document.getElementById('fullscreen-view');
        const fc = document.getElementById('fullscreenCanvas');
        v.classList.remove('hidden');
        fc.width = state.canvasW; fc.height = state.canvasH;
        const fctx = fc.getContext('2d');
        fctx.fillStyle = state.bgColor;
        fctx.fillRect(0,0,state.canvasW,state.canvasH);
        for (const s of state.strokes) drawStrokeToCtx(fctx, s);
    }

    // ══════════════════════════════════
    // RECENT COLORS
    // ══════════════════════════════════
    function addRecentColor(c) {
        const i = state.recentColors.indexOf(c);
        if (i > -1) state.recentColors.splice(i, 1);
        state.recentColors.unshift(c);
        if (state.recentColors.length > 16) state.recentColors.pop();
        renderRecentColors();
    }
    function renderRecentColors() {
        const el = document.getElementById('recentColors');
        el.innerHTML = '';
        state.recentColors.forEach(c => {
            const s = document.createElement('button');
            s.className = 'color-swatch' + (c === state.brushColor ? ' active' : '');
            s.style.background = c;
            s.addEventListener('click', () => {
                state.brushColor = c;
                document.getElementById('brushColor').value = c;
                renderRecentColors();
            });
            el.appendChild(s);
        });
    }

    // ══════════════════════════════════
    // UI BINDING
    // ══════════════════════════════════
    function bindUI() {
        const $ = id => document.getElementById(id);

        $('brushSize').addEventListener('input', e => { state.brushSize=+e.target.value; $('sizeVal').textContent=state.brushSize; });
        $('minWidthRatio').addEventListener('input', e => { state.minWidthRatio=+e.target.value/100; $('minWidthVal').textContent=state.minWidthRatio.toFixed(2); });
        $('smoothing').addEventListener('input', e => { state.smoothing=+e.target.value/100; $('smoothVal').textContent=state.smoothing.toFixed(2); });
        $('taperStart').addEventListener('input', e => { state.taperStart=+e.target.value/100; $('taperStartVal').textContent=state.taperStart.toFixed(2); });
        $('taperEnd').addEventListener('input', e => { state.taperEnd=+e.target.value/100; $('taperEndVal').textContent=state.taperEnd.toFixed(2); });
        $('brushColor').addEventListener('input', e => { state.brushColor=e.target.value; renderRecentColors(); });
        $('brushOpacity').addEventListener('input', e => { state.brushOpacity=+e.target.value/100; $('opacityVal').textContent=state.brushOpacity.toFixed(1); });
        $('bgColor').addEventListener('input', e => { state.bgColor=e.target.value; rebuildOffscreen(); render(); });

        $('resizeBtn').addEventListener('click', () => {
            state.canvasW=Math.max(100,Math.min(4096,+$('canvasW').value));
            state.canvasH=Math.max(100,Math.min(4096,+$('canvasH').value));
            setupOffscreen(); fitView(); render();
        });

        document.querySelectorAll('.size-preset-btn').forEach(b => {
            b.addEventListener('click', () => {
                $('canvasW').value=b.dataset.w; $('canvasH').value=b.dataset.h;
                state.canvasW=+b.dataset.w; state.canvasH=+b.dataset.h;
                setupOffscreen(); fitView(); render();
            });
        });

        $('showGuides').addEventListener('change', e => { state.showGuides=e.target.checked; render(); });
        $('showGrid').addEventListener('change', e => { state.showGrid=e.target.checked; render(); });
        $('guideRows').addEventListener('input', e => { state.guideRows=+e.target.value; $('guideRowsVal').textContent=state.guideRows; render(); });
        $('guidePadding').addEventListener('input', e => { state.guidePadding=+e.target.value; $('guidePadVal').textContent=state.guidePadding+'%'; render(); });
        $('gridSize').addEventListener('input', e => { state.gridSize=+e.target.value; $('gridSizeVal').textContent=state.gridSize; render(); });

        $('undoBtn').addEventListener('click', undo);
        $('redoBtn').addEventListener('click', redo);
        $('clearBtn').addEventListener('click', clearAll);
        $('exportBtn').addEventListener('click', () => exportPNG(false));
        $('exportTransBtn').addEventListener('click', () => exportPNG(true));
        $('exportSvgBtn').addEventListener('click', exportSVG);
        $('fullscreenBtn').addEventListener('click', showFullscreen);
        $('closeFullscreen').addEventListener('click', () => $('fullscreen-view').classList.add('hidden'));
        $('fitBtn').addEventListener('click', fitView);

        // Tool selection (brush / eraser / select)
        function setTool(tool) {
            state.tool = tool;
            state.selectedStroke = -1;
            document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
                b.classList.toggle('active', b.dataset.tool === tool);
            });
            canvasArea.classList.toggle('eraser-mode', tool === 'eraser');
            canvasArea.classList.toggle('select-mode', tool === 'select');
            updateSelectUI();
            render();
        }

        document.querySelectorAll('.tool-btn[data-tool="brush"], .tool-btn[data-tool="eraser"], .tool-btn[data-tool="select"]').forEach(b => {
            b.addEventListener('click', () => setTool(b.dataset.tool));
        });

        $('mirrorBtn').addEventListener('click', () => {
            state.mirror = !state.mirror;
            $('mirrorBtn').classList.toggle('active', state.mirror);
            render();
        });

        // Selected stroke editing
        $('selectedStrokeColor').addEventListener('input', e => {
            if (state.selectedStroke < 0) return;
            state.strokes[state.selectedStroke].color = e.target.value;
            rebuildOffscreen(); render();
        });
        $('selectedStrokeSize').addEventListener('input', e => {
            if (state.selectedStroke < 0) return;
            const s = state.strokes[state.selectedStroke];
            const newSize = +e.target.value;
            const ratio = newSize / s.size;
            s.size = newSize;
            $('selectedSizeVal').textContent = newSize;
            // Scale all anchor widths
            for (const a of s.anchors) a.w *= ratio;
            s.renderPoints = anchorsToRenderPoints(s);
            rebuildOffscreen(); render();
        });
        $('deleteStrokeBtn').addEventListener('click', () => {
            if (state.selectedStroke < 0) return;
            state.strokes.splice(state.selectedStroke, 1);
            state.selectedStroke = -1;
            rebuildOffscreen(); render(); updateInfo(); updateSelectUI();
        });

        // Reference image
        $('refImageInput').addEventListener('change', e => {
            const f = e.target.files[0]; if (!f) return;
            const img = new Image();
            img.onload = () => { state.refImage = img; render(); };
            img.src = URL.createObjectURL(f);
        });
        $('refOpacity').addEventListener('input', e => {
            state.refOpacity=+e.target.value/100; $('refOpacityVal').textContent=state.refOpacity.toFixed(2); render();
        });
        $('removeRefBtn').addEventListener('click', () => { state.refImage=null; render(); });

        // Brush presets
        const presets = {
            pen:         { brushSize:4,  minWidthRatio:0.3,  smoothing:0.3,  taperStart:0.05, taperEnd:0.15 },
            brush:       { brushSize:16, minWidthRatio:0.1,  smoothing:0.5,  taperStart:0.1,  taperEnd:0.3  },
            marker:      { brushSize:12, minWidthRatio:0.85, smoothing:0.2,  taperStart:0,    taperEnd:0    },
            calligraphy: { brushSize:20, minWidthRatio:0.05, smoothing:0.6,  taperStart:0.15, taperEnd:0.4  },
            ink:         { brushSize:6,  minWidthRatio:0.08, smoothing:0.45, taperStart:0.12, taperEnd:0.35 },
            pencil:      { brushSize:3,  minWidthRatio:0.6,  smoothing:0.15, taperStart:0.02, taperEnd:0.05 },
        };
        document.querySelectorAll('.preset-btn').forEach(b => {
            b.addEventListener('click', () => {
                const p = presets[b.dataset.preset]; if (!p) return;
                Object.assign(state, p);
                $('brushSize').value=p.brushSize; $('sizeVal').textContent=p.brushSize;
                $('minWidthRatio').value=Math.round(p.minWidthRatio*100); $('minWidthVal').textContent=p.minWidthRatio.toFixed(2);
                $('smoothing').value=Math.round(p.smoothing*100); $('smoothVal').textContent=p.smoothing.toFixed(2);
                $('taperStart').value=Math.round(p.taperStart*100); $('taperStartVal').textContent=p.taperStart.toFixed(2);
                $('taperEnd').value=Math.round(p.taperEnd*100); $('taperEndVal').textContent=p.taperEnd.toFixed(2);
                document.querySelectorAll('.preset-btn').forEach(x => x.classList.remove('active'));
                b.classList.add('active');
            });
        });

        window.addEventListener('resize', () => fitView());
    }

    function updateInfo() {
        document.getElementById('canvasInfoText').textContent = `${state.canvasW} \u00d7 ${state.canvasH}`;
        document.getElementById('zoomLevel').textContent = `${Math.round(state.zoom*100)}%`;
        document.getElementById('strokeCount').textContent = `strokes: ${state.strokes.length}`;
    }

    // ══════════════════════════════════
    // KEYBOARD SHORTCUTS
    // ══════════════════════════════════
    function bindKeyboard() {
        document.addEventListener('keydown', e => {
            if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
            if ((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z') { e.preventDefault(); undo(); }
            if ((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='z') { e.preventDefault(); redo(); }
            if ((e.ctrlKey||e.metaKey)&&e.key==='s') { e.preventDefault(); exportPNG(false); }
            if (e.key==='b'||e.key==='B') { document.querySelector('.tool-btn[data-tool="brush"]').click(); }
            if (e.key==='e'||e.key==='E') { document.querySelector('.tool-btn[data-tool="eraser"]').click(); }
            if (e.key==='v'||e.key==='V') { document.querySelector('.tool-btn[data-tool="select"]').click(); }
            if (e.key==='m'||e.key==='M') { document.getElementById('mirrorBtn').click(); }
            if (e.key==='[') { state.brushSize=Math.max(1,state.brushSize-2); document.getElementById('brushSize').value=state.brushSize; document.getElementById('sizeVal').textContent=state.brushSize; }
            if (e.key===']') { state.brushSize=Math.min(80,state.brushSize+2); document.getElementById('brushSize').value=state.brushSize; document.getElementById('sizeVal').textContent=state.brushSize; }
            if (e.key==='0'&&(e.ctrlKey||e.metaKey)) { e.preventDefault(); fitView(); }
            if (e.key==='Escape') { document.getElementById('fullscreen-view').classList.add('hidden'); state.selectedStroke=-1; updateSelectUI(); render(); }
            if (e.key==='Delete'||e.key==='Backspace') {
                if (state.tool==='select'&&state.selectedStroke>=0) {
                    state.strokes.splice(state.selectedStroke,1);
                    state.selectedStroke=-1;
                    rebuildOffscreen(); render(); updateInfo(); updateSelectUI();
                }
            }
        });
    }

    init();
})();

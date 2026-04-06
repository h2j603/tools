/* ═══════════════════════════════════════════
   Lettering Tool v3 — Vector Editing + SVG
   Catmull-Rom spline, bezier handles, mobile-first
   ═══════════════════════════════════════════ */

(() => {
    const HANDLE_RADIUS = 20;

    const state = {
        canvasW: 1080, canvasH: 1080, bgColor: '#0c0c0e',
        brushSize: 8, minWidthRatio: 0.15, smoothing: 0.5,
        taperStart: 0.1, taperEnd: 0.3,
        brushColor: '#e8e8ec', brushOpacity: 1.0,
        tool: 'brush', mirror: false,
        showGuides: false, showGrid: false,
        guideRows: 4, guidePadding: 5, gridSize: 50,
        strokes: [], redoStack: [], currentPoints: [], isDrawing: false,
        recentColors: ['#e8e8ec','#ff4455','#44cc88','#6c8aff','#ffaa33','#cc44ff','#ffffff','#000000'],
        zoom: 1, panX: 0, panY: 0,
        refImage: null, refOpacity: 0.3,
        selectedStrokeIndex: -1, draggingHandle: null,
    };

    const canvas = document.getElementById('drawCanvas');
    const ctx = canvas.getContext('2d');
    const canvasArea = document.getElementById('canvas-area');
    const brushCursor = document.getElementById('brushCursor');
    let offCanvas, offCtx;
    let pinchStartDist = 0, pinchStartZoom = 1;
    const activePointers = new Map();

    // ─── Init ───
    function init() {
        setupOffscreen(); fitView();
        bindUI(); bindPointerEvents(); bindKeyboard();
        renderRecentColors(); render();
    }

    function setupOffscreen() {
        offCanvas = document.createElement('canvas');
        offCanvas.width = state.canvasW; offCanvas.height = state.canvasH;
        offCtx = offCanvas.getContext('2d');
        offCtx.lineCap = 'round'; offCtx.lineJoin = 'round';
        rebuildOffscreen();
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

    function rebuildOffscreen() {
        offCtx.globalCompositeOperation = 'source-over';
        offCtx.fillStyle = state.bgColor;
        offCtx.fillRect(0, 0, state.canvasW, state.canvasH);
        for (const s of state.strokes) drawStrokeToCtx(offCtx, s);
    }

    function canvasCoords(e) {
        const r = canvas.getBoundingClientRect();
        return { x: (e.clientX - r.left) / state.zoom, y: (e.clientY - r.top) / state.zoom,
            pressure: e.pressure > 0 ? e.pressure : 0.5, time: performance.now() };
    }

    // ─── Pointer Events ───
    function bindPointerEvents() {
        canvasArea.addEventListener('pointerdown', onDown, { passive: false });
        canvasArea.addEventListener('pointermove', onMove, { passive: false });
        canvasArea.addEventListener('pointerup', onUp);
        canvasArea.addEventListener('pointercancel', onUp);
        canvasArea.addEventListener('wheel', onWheel, { passive: false });
        // Only prevent default touch on canvas area
        canvasArea.addEventListener('touchstart', e => e.preventDefault(), { passive: false });
        canvasArea.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
    }

    function onDown(e) {
        e.preventDefault();
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (activePointers.size === 2) {
            state.isDrawing = false; state.currentPoints = [];
            const pts = [...activePointers.values()];
            pinchStartDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            pinchStartZoom = state.zoom;
            canvasArea.classList.add('panning'); return;
        }
        if (activePointers.size > 2) return;
        canvasArea.setPointerCapture(e.pointerId);

        if (state.tool === 'select') { handleSelectDown(e); return; }

        state.isDrawing = true;
        state.currentPoints = [canvasCoords(e)];
        state.redoStack = [];
        canvasArea.classList.add('drawing');
    }

    function onMove(e) {
        e.preventDefault(); updateBrushCursor(e);
        const prev = activePointers.get(e.pointerId);
        if (!prev) return;
        activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

        if (activePointers.size === 2) {
            const pts = [...activePointers.values()];
            const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
            const dx = e.clientX - prev.x, dy = e.clientY - prev.y;
            state.panX += dx / 2; state.panY += dy / 2;
            const ar = canvasArea.getBoundingClientRect();
            const mx = (pts[0].x + pts[1].x) / 2 - ar.left;
            const my = (pts[0].y + pts[1].y) / 2 - ar.top;
            const bx = (mx - state.panX) / state.zoom, by = (my - state.panY) / state.zoom;
            state.zoom = Math.max(0.1, Math.min(10, pinchStartZoom * (dist / pinchStartDist)));
            state.panX = mx - bx * state.zoom; state.panY = my - by * state.zoom;
            applyTransform(); render(); updateInfo(); return;
        }

        if (state.tool === 'select') { handleSelectDrag(e); return; }
        if (!state.isDrawing) return;
        const pt = canvasCoords(e);
        const last = state.currentPoints[state.currentPoints.length - 1];
        if (Math.hypot(pt.x - last.x, pt.y - last.y) < 1.5) return;
        state.currentPoints.push(pt); render();
    }

    function onUp(e) {
        activePointers.delete(e.pointerId);
        canvasArea.classList.remove('panning');
        if (state.tool === 'select') { handleSelectUp(); return; }
        if (!state.isDrawing) return;
        if (activePointers.size > 0) return;
        state.isDrawing = false; canvasArea.classList.remove('drawing');

        if (state.currentPoints.length >= 2) {
            const stroke = buildStroke(state.currentPoints);
            state.strokes.push(stroke); drawStrokeToCtx(offCtx, stroke);
            if (state.mirror) {
                const m = buildMirroredStroke(state.currentPoints);
                state.strokes.push(m); drawStrokeToCtx(offCtx, m);
            }
            addRecentColor(state.brushColor);
        }
        state.currentPoints = []; render(); updateInfo();
    }

    function onWheel(e) {
        e.preventDefault();
        const ar = canvasArea.getBoundingClientRect();
        const mx = e.clientX - ar.left, my = e.clientY - ar.top;
        const bx = (mx - state.panX) / state.zoom, by = (my - state.panY) / state.zoom;
        state.zoom = Math.max(0.1, Math.min(10, state.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
        state.panX = mx - bx * state.zoom; state.panY = my - by * state.zoom;
        applyTransform(); render(); updateInfo();
    }

    function updateBrushCursor(e) {
        const ar = canvasArea.getBoundingClientRect();
        const sz = state.brushSize * state.zoom;
        brushCursor.style.left = (e.clientX - ar.left) + 'px';
        brushCursor.style.top = (e.clientY - ar.top) + 'px';
        brushCursor.style.width = sz + 'px'; brushCursor.style.height = sz + 'px';
        brushCursor.style.borderColor = state.tool === 'eraser' ? 'rgba(255,68,85,0.6)' : 'rgba(108,138,255,0.6)';
    }

    // ─── Select Tool ───
    function handleSelectDown(e) {
        const pt = canvasCoords(e);
        const hitR = HANDLE_RADIUS / state.zoom;

        // Check handles of selected stroke first
        if (state.selectedStrokeIndex >= 0) {
            const stroke = state.strokes[state.selectedStrokeIndex];
            for (let i = 0; i < stroke.anchors.length; i++) {
                const a = stroke.anchors[i];
                if (Math.hypot(pt.x - a.x, pt.y - a.y) < hitR) {
                    state.draggingHandle = { type: 'anchor', idx: i, startX: a.x, startY: a.y }; return;
                }
                if (Math.hypot(pt.x - a.handleIn.x, pt.y - a.handleIn.y) < hitR) {
                    state.draggingHandle = { type: 'handleIn', idx: i }; return;
                }
                if (Math.hypot(pt.x - a.handleOut.x, pt.y - a.handleOut.y) < hitR) {
                    state.draggingHandle = { type: 'handleOut', idx: i }; return;
                }
            }
        }

        // Hit test strokes (reverse order = top first)
        for (let si = state.strokes.length - 1; si >= 0; si--) {
            const rp = state.strokes[si].renderPoints || [];
            for (let i = 0; i < rp.length; i++) {
                const d = Math.hypot(pt.x - rp[i].x, pt.y - rp[i].y);
                const w = (rp[i].width || state.strokes[si].size) / 2 + hitR;
                if (d < w) { selectStroke(si); render(); return; }
            }
        }
        deselectStroke(); render();
    }

    function handleSelectDrag(e) {
        if (!state.draggingHandle) return;
        const pt = canvasCoords(e);
        const stroke = state.strokes[state.selectedStrokeIndex];
        const a = stroke.anchors[state.draggingHandle.idx];

        if (state.draggingHandle.type === 'anchor') {
            const dx = pt.x - a.x, dy = pt.y - a.y;
            a.x = pt.x; a.y = pt.y;
            a.handleIn.x += dx; a.handleIn.y += dy;
            a.handleOut.x += dx; a.handleOut.y += dy;
        } else if (state.draggingHandle.type === 'handleIn') {
            a.handleIn.x = pt.x; a.handleIn.y = pt.y;
        } else if (state.draggingHandle.type === 'handleOut') {
            a.handleOut.x = pt.x; a.handleOut.y = pt.y;
        }

        stroke.renderPoints = anchorsToRenderPoints(stroke.anchors, stroke.size, stroke.minWidthRatio, stroke.taperStart, stroke.taperEnd);
        rebuildOffscreen(); render();
    }

    function handleSelectUp() { state.draggingHandle = null; }

    function selectStroke(idx) {
        state.selectedStrokeIndex = idx;
        const s = state.strokes[idx];
        const $ = document.getElementById.bind(document);
        $('selectInfo').style.display = '';
        $('selectedStrokeColor').value = s.color;
        $('selectedStrokeSize').value = s.size;
        $('selectedSizeVal').textContent = s.size;
        $('selectHintText').textContent = `Stroke #${idx + 1} 선택됨 — 앵커/핸들을 드래그하세요`;
    }

    function deselectStroke() {
        state.selectedStrokeIndex = -1; state.draggingHandle = null;
        document.getElementById('selectInfo').style.display = 'none';
    }

    // ─── Catmull-Rom Spline ───
    function catmullRomSegment(p0, p1, p2, p3, n, alpha) {
        alpha = alpha || 0.5;
        const pts = [];
        function tj(ti, a, b) { return ti + Math.pow((b.x-a.x)**2 + (b.y-a.y)**2, alpha/2); }
        const t0=0, t1=tj(t0,p0,p1), t2=tj(t1,p1,p2), t3=tj(t2,p2,p3);
        if (t1===t0||t2===t1||t3===t2) return [p1];
        for (let i=0;i<n;i++) {
            const t=t1+(i/n)*(t2-t1);
            const a1x=((t1-t)/(t1-t0))*p0.x+((t-t0)/(t1-t0))*p1.x;
            const a1y=((t1-t)/(t1-t0))*p0.y+((t-t0)/(t1-t0))*p1.y;
            const a1p=((t1-t)/(t1-t0))*(p0.pressure||.5)+((t-t0)/(t1-t0))*(p1.pressure||.5);
            const a2x=((t2-t)/(t2-t1))*p1.x+((t-t1)/(t2-t1))*p2.x;
            const a2y=((t2-t)/(t2-t1))*p1.y+((t-t1)/(t2-t1))*p2.y;
            const a2p=((t2-t)/(t2-t1))*(p1.pressure||.5)+((t-t1)/(t2-t1))*(p2.pressure||.5);
            const a3x=((t3-t)/(t3-t2))*p2.x+((t-t2)/(t3-t2))*p3.x;
            const a3y=((t3-t)/(t3-t2))*p2.y+((t-t2)/(t3-t2))*p3.y;
            const a3p=((t3-t)/(t3-t2))*(p2.pressure||.5)+((t-t2)/(t3-t2))*(p3.pressure||.5);
            const b1x=((t2-t)/(t2-t0))*a1x+((t-t0)/(t2-t0))*a2x;
            const b1y=((t2-t)/(t2-t0))*a1y+((t-t0)/(t2-t0))*a2y;
            const b1p=((t2-t)/(t2-t0))*a1p+((t-t0)/(t2-t0))*a2p;
            const b2x=((t3-t)/(t3-t1))*a2x+((t-t1)/(t3-t1))*a3x;
            const b2y=((t3-t)/(t3-t1))*a2y+((t-t1)/(t3-t1))*a3y;
            const b2p=((t3-t)/(t3-t1))*a2p+((t-t1)/(t3-t1))*a3p;
            pts.push({
                x:((t2-t)/(t2-t1))*b1x+((t-t1)/(t2-t1))*b2x,
                y:((t2-t)/(t2-t1))*b1y+((t-t1)/(t2-t1))*b2y,
                pressure:((t2-t)/(t2-t1))*b1p+((t-t1)/(t2-t1))*b2p
            });
        }
        return pts;
    }

    // ─── Stroke Building ───
    function buildStroke(rawPoints) {
        const isEraser = state.tool === 'eraser';
        if (rawPoints.length < 2) {
            const a = [{ x:rawPoints[0].x, y:rawPoints[0].y, pressure:rawPoints[0].pressure||.5,
                handleIn:{x:rawPoints[0].x,y:rawPoints[0].y}, handleOut:{x:rawPoints[0].x,y:rawPoints[0].y} }];
            return { rawPoints:rawPoints.slice(), anchors:a, renderPoints:rawPoints,
                color:isEraser?state.bgColor:state.brushColor, opacity:isEraser?1:state.brushOpacity,
                size:state.brushSize, minWidthRatio:state.minWidthRatio,
                taperStart:isEraser?0:state.taperStart, taperEnd:isEraser?0:state.taperEnd, eraser:isEraser };
        }
        const smoothed = smoothPoints(rawPoints, state.smoothing);
        const interp = interpolateSpline(smoothed);
        const widths = calculateWidths(interp);
        const eps = Math.max(2, state.brushSize * 0.3);
        const simplified = rdpSimplify(widths, eps);
        const anchors = pointsToAnchors(simplified);
        const ts = isEraser ? 0 : state.taperStart, te = isEraser ? 0 : state.taperEnd;
        const renderPoints = anchorsToRenderPoints(anchors, state.brushSize, state.minWidthRatio, ts, te);
        return { rawPoints:rawPoints.slice(), anchors, renderPoints,
            color:isEraser?state.bgColor:state.brushColor, opacity:isEraser?1:state.brushOpacity,
            size:state.brushSize, minWidthRatio:state.minWidthRatio, taperStart:ts, taperEnd:te, eraser:isEraser };
    }

    function buildMirroredStroke(raw) {
        const mid = state.canvasW / 2;
        const mirrored = raw.map(p => ({ ...p, x: mid + (mid - p.x) }));
        return buildStroke(mirrored);
    }

    function smoothPoints(pts, amt) {
        if (amt <= 0 || pts.length < 3) return pts.slice();
        const w = Math.max(2, Math.round(amt * 6)), res = [pts[0]];
        for (let i = 1; i < pts.length - 1; i++) {
            let sx=0,sy=0,sp=0,c=0;
            for (let j=Math.max(0,i-w);j<=Math.min(pts.length-1,i+w);j++) { sx+=pts[j].x;sy+=pts[j].y;sp+=pts[j].pressure;c++; }
            res.push({ x:sx/c, y:sy/c, pressure:sp/c, time:pts[i].time });
        }
        res.push(pts[pts.length-1]); return res;
    }

    function interpolateSpline(pts) {
        if (pts.length < 3) return pts.slice();
        const res = [], pad = [pts[0], ...pts, pts[pts.length-1]];
        for (let i=0;i<pad.length-3;i++) {
            const sl = Math.hypot(pad[i+2].x-pad[i+1].x, pad[i+2].y-pad[i+1].y);
            res.push(...catmullRomSegment(pad[i],pad[i+1],pad[i+2],pad[i+3], Math.max(2,Math.round(sl/2))));
        }
        res.push(pts[pts.length-1]); return res;
    }

    function calculateWidths(pts) {
        if (pts.length<2) return pts.map(p=>({...p, width:state.brushSize}));
        const total = getTotalLength(pts); let run = 0;
        return pts.map((pt,i)=> {
            if(i>0) run += Math.hypot(pt.x-pts[i-1].x, pt.y-pts[i-1].y);
            const t = total>0 ? run/total : 0;
            const minW = state.brushSize * state.minWidthRatio;
            let w = minW + (state.brushSize - minW) * (pt.pressure||.5);
            if(i>0 && i<pts.length-1) {
                const dt = (pt.time||1)-(pts[i-1].time||0);
                if(dt>0) w *= Math.max(0.3, 1 - Math.hypot(pt.x-pts[i-1].x,pt.y-pts[i-1].y)/dt*0.15);
            }
            if(state.taperStart>0 && t<state.taperStart) w *= t/state.taperStart;
            if(state.taperEnd>0 && t>(1-state.taperEnd)) w *= (1-t)/state.taperEnd;
            return {...pt, width:Math.max(0.5,w)};
        });
    }

    function getTotalLength(pts) {
        let l=0; for(let i=1;i<pts.length;i++) l+=Math.hypot(pts[i].x-pts[i-1].x,pts[i].y-pts[i-1].y); return l;
    }

    // ─── RDP Simplification ───
    function rdpSimplify(pts, eps) {
        if (pts.length <= 2) return pts.slice();
        let mx = 0, mi = 0;
        const s = pts[0], e = pts[pts.length-1];
        for (let i=1;i<pts.length-1;i++) { const d=ptLineDist(pts[i],s,e); if(d>mx){mx=d;mi=i;} }
        if (mx > eps) {
            const l = rdpSimplify(pts.slice(0,mi+1),eps);
            const r = rdpSimplify(pts.slice(mi),eps);
            return l.slice(0,-1).concat(r);
        }
        return [s, e];
    }
    function ptLineDist(p,a,b) {
        const dx=b.x-a.x, dy=b.y-a.y, l2=dx*dx+dy*dy;
        if(l2===0) return Math.hypot(p.x-a.x,p.y-a.y);
        let t=((p.x-a.x)*dx+(p.y-a.y)*dy)/l2;
        t=Math.max(0,Math.min(1,t));
        return Math.hypot(p.x-(a.x+t*dx), p.y-(a.y+t*dy));
    }

    function pointsToAnchors(simplified) {
        return simplified.map((pt,i,arr)=>{
            const prev=arr[i-1]||pt, next=arr[i+1]||pt;
            const dx=next.x-prev.x, dy=next.y-prev.y;
            const scale=Math.hypot(dx,dy)/6, angle=Math.atan2(dy,dx);
            return { x:pt.x, y:pt.y, pressure:pt.pressure||.5,
                handleIn: {x:pt.x-Math.cos(angle)*scale, y:pt.y-Math.sin(angle)*scale},
                handleOut:{x:pt.x+Math.cos(angle)*scale, y:pt.y+Math.sin(angle)*scale} };
        });
    }

    function anchorsToRenderPoints(anchors, size, minWR, tS, tE) {
        if (anchors.length < 2) return [];
        const pts = [];
        for (let i=0;i<anchors.length-1;i++) {
            const a0=anchors[i], a1=anchors[i+1];
            const steps = Math.max(8, Math.round(Math.hypot(a1.x-a0.x, a1.y-a0.y)/3));
            for (let t=0;t<=steps;t++) {
                const s=t/steps;
                pts.push({ x:cBez(a0.x,a0.handleOut.x,a1.handleIn.x,a1.x,s),
                    y:cBez(a0.y,a0.handleOut.y,a1.handleIn.y,a1.y,s),
                    pressure:a0.pressure+(a1.pressure-a0.pressure)*s });
            }
        }
        const total=getTotalLength(pts); let run=0;
        return pts.map((pt,i,arr)=>{
            if(i>0) run+=Math.hypot(pt.x-arr[i-1].x,pt.y-arr[i-1].y);
            const t=total>0?run/total:0;
            const minW=size*minWR; let w=minW+(size-minW)*(pt.pressure||.5);
            if(tS>0&&t<tS) w*=t/tS; if(tE>0&&t>(1-tE)) w*=(1-t)/tE;
            return {...pt, width:Math.max(0.5,w)};
        });
    }

    function cBez(p0,p1,p2,p3,t) { const m=1-t; return m*m*m*p0+3*m*m*t*p1+3*m*t*t*p2+t*t*t*p3; }

    // ─── Draw Stroke ───
    function drawStrokeToCtx(tc, stroke) {
        const pts = stroke.renderPoints||[];
        if (pts.length < 2) return;
        tc.save();
        if (stroke.eraser) { tc.globalCompositeOperation='destination-out'; tc.globalAlpha=1; tc.fillStyle='#000'; }
        else { tc.globalCompositeOperation='source-over'; tc.globalAlpha=stroke.opacity; tc.fillStyle=stroke.color; }
        for (let i=0;i<pts.length-1;i++) {
            const p0=pts[i],p1=pts[i+1];
            const w0=p0.width||stroke.size, w1=p1.width||stroke.size;
            const ang=Math.atan2(p1.y-p0.y,p1.x-p0.x)+Math.PI/2;
            const c=Math.cos(ang),s=Math.sin(ang);
            tc.beginPath();
            tc.moveTo(p0.x+c*w0/2,p0.y+s*w0/2); tc.lineTo(p1.x+c*w1/2,p1.y+s*w1/2);
            tc.lineTo(p1.x-c*w1/2,p1.y-s*w1/2); tc.lineTo(p0.x-c*w0/2,p0.y-s*w0/2);
            tc.closePath(); tc.fill();
            tc.beginPath(); tc.arc(p0.x,p0.y,w0/2,0,Math.PI*2); tc.fill();
        }
        const last=pts[pts.length-1];
        tc.beginPath(); tc.arc(last.x,last.y,(last.width||stroke.size)/2,0,Math.PI*2); tc.fill();
        tc.restore();
    }

    // ─── Render ───
    function render() {
        ctx.clearRect(0,0,canvas.width,canvas.height);
        ctx.fillStyle=state.bgColor; ctx.fillRect(0,0,canvas.width,canvas.height);
        if (state.refImage) { ctx.save(); ctx.globalAlpha=state.refOpacity; ctx.drawImage(state.refImage,0,0,canvas.width,canvas.height); ctx.restore(); }
        ctx.drawImage(offCanvas,0,0);
        if (state.showGrid) drawGrid(ctx);
        if (state.showGuides) drawGuides(ctx);
        if (state.mirror) { ctx.save(); ctx.strokeStyle='rgba(108,138,255,0.3)'; ctx.lineWidth=1; ctx.setLineDash([6,6]); ctx.beginPath(); ctx.moveTo(state.canvasW/2,0); ctx.lineTo(state.canvasW/2,state.canvasH); ctx.stroke(); ctx.restore(); }
        if (state.currentPoints.length>=2) {
            const ts=buildStroke(state.currentPoints); drawStrokeToCtx(ctx,ts);
            if(state.mirror) { const ms=buildMirroredStroke(state.currentPoints); drawStrokeToCtx(ctx,ms); }
        }
        // Draw handles overlay
        if (state.tool==='select' && state.selectedStrokeIndex>=0) {
            const stroke=state.strokes[state.selectedStrokeIndex];
            if(stroke) drawHandlesOverlay(ctx,stroke);
        }
    }

    function drawHandlesOverlay(c, stroke) {
        const anchors = stroke.anchors;
        c.save();
        for (const a of anchors) {
            // Handle lines
            c.strokeStyle='rgba(108,138,255,0.5)'; c.lineWidth=1.5; c.setLineDash([]);
            c.beginPath(); c.moveTo(a.handleIn.x,a.handleIn.y); c.lineTo(a.x,a.y); c.lineTo(a.handleOut.x,a.handleOut.y); c.stroke();
            // Handle circles
            c.fillStyle='rgba(108,138,255,0.3)'; c.strokeStyle='rgba(108,138,255,0.8)'; c.lineWidth=1.5;
            [a.handleIn, a.handleOut].forEach(h => { c.beginPath(); c.arc(h.x,h.y,5,0,Math.PI*2); c.fill(); c.stroke(); });
            // Anchor square
            c.fillStyle='rgba(108,138,255,0.9)';
            c.fillRect(a.x-5, a.y-5, 10, 10);
            c.strokeStyle='#fff'; c.lineWidth=1; c.strokeRect(a.x-5, a.y-5, 10, 10);
        }
        c.restore();
    }

    function drawGuides(c) {
        const pad=state.guidePadding/100, rows=state.guideRows;
        const pp=state.canvasH*pad, uh=state.canvasH-pp*2, rh=uh/rows;
        c.save(); c.strokeStyle='rgba(108,138,255,0.15)'; c.lineWidth=1; c.setLineDash([4,4]);
        for(let i=0;i<=rows;i++){
            const y=pp+i*rh; c.beginPath(); c.moveTo(state.canvasW*pad,y); c.lineTo(state.canvasW*(1-pad),y); c.stroke();
            if(i<rows){ c.strokeStyle='rgba(108,138,255,0.08)'; c.beginPath(); c.moveTo(state.canvasW*pad,y+rh*.6); c.lineTo(state.canvasW*(1-pad),y+rh*.6); c.stroke(); c.strokeStyle='rgba(108,138,255,0.15)'; }
        }
        c.restore();
    }

    function drawGrid(c) {
        const gs=state.gridSize; c.save(); c.strokeStyle='rgba(108,138,255,0.06)'; c.lineWidth=1;
        for(let x=gs;x<state.canvasW;x+=gs){c.beginPath();c.moveTo(x,0);c.lineTo(x,state.canvasH);c.stroke();}
        for(let y=gs;y<state.canvasH;y+=gs){c.beginPath();c.moveTo(0,y);c.lineTo(state.canvasW,y);c.stroke();}
        c.restore();
    }

    // ─── Undo/Redo/Clear ───
    function undo() { if(!state.strokes.length) return; state.redoStack.push(state.strokes.pop()); if(state.selectedStrokeIndex>=state.strokes.length) deselectStroke(); rebuildOffscreen(); render(); updateInfo(); }
    function redo() { if(!state.redoStack.length) return; state.strokes.push(state.redoStack.pop()); rebuildOffscreen(); render(); updateInfo(); }
    function clearAll() { if(!state.strokes.length) return; state.redoStack=[]; state.strokes=[]; deselectStroke(); rebuildOffscreen(); render(); updateInfo(); }

    // ─── Export PNG ───
    function exportPNG(transparent) {
        const ec=document.createElement('canvas'); ec.width=state.canvasW; ec.height=state.canvasH;
        const ex=ec.getContext('2d');
        if(!transparent){ex.fillStyle=state.bgColor;ex.fillRect(0,0,state.canvasW,state.canvasH);}
        for(const s of state.strokes) drawStrokeToCtx(ex,s);
        const a=document.createElement('a'); a.download=`lettering_${Date.now()}.png`; a.href=ec.toDataURL('image/png'); a.click();
    }

    // ─── Export SVG ───
    function exportSVG() {
        let paths='';
        for(const stroke of state.strokes) {
            if(stroke.eraser) continue;
            const pts=stroke.renderPoints||[]; if(pts.length<2) continue;
            const left=[],right=[];
            for(let i=0;i<pts.length;i++){
                const p=pts[i], w=(p.width||stroke.size)/2;
                let ang;
                if(i===0) ang=Math.atan2(pts[1].y-p.y,pts[1].x-p.x);
                else if(i===pts.length-1) ang=Math.atan2(p.y-pts[i-1].y,p.x-pts[i-1].x);
                else ang=Math.atan2(pts[i+1].y-pts[i-1].y,pts[i+1].x-pts[i-1].x);
                const pa=ang+Math.PI/2, c=Math.cos(pa), s=Math.sin(pa);
                left.push({x:p.x+c*w,y:p.y+s*w}); right.push({x:p.x-c*w,y:p.y-s*w});
            }
            let d=`M ${left[0].x.toFixed(1)} ${left[0].y.toFixed(1)}`;
            for(let i=1;i<left.length;i++) d+=` L ${left[i].x.toFixed(1)} ${left[i].y.toFixed(1)}`;
            const ew=(pts[pts.length-1].width||stroke.size)/2;
            d+=` A ${ew.toFixed(1)} ${ew.toFixed(1)} 0 0 1 ${right[right.length-1].x.toFixed(1)} ${right[right.length-1].y.toFixed(1)}`;
            for(let i=right.length-2;i>=0;i--) d+=` L ${right[i].x.toFixed(1)} ${right[i].y.toFixed(1)}`;
            const sw=(pts[0].width||stroke.size)/2;
            d+=` A ${sw.toFixed(1)} ${sw.toFixed(1)} 0 0 1 ${left[0].x.toFixed(1)} ${left[0].y.toFixed(1)} Z`;
            paths+=`  <path d="${d}" fill="${stroke.color}" fill-opacity="${stroke.opacity}" />\n`;
        }
        const svg=`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${state.canvasW} ${state.canvasH}" width="${state.canvasW}" height="${state.canvasH}">\n  <rect width="${state.canvasW}" height="${state.canvasH}" fill="${state.bgColor}" />\n${paths}</svg>`;
        const blob=new Blob([svg],{type:'image/svg+xml'});
        const a=document.createElement('a'); a.download=`lettering_${Date.now()}.svg`; a.href=URL.createObjectURL(blob); a.click(); URL.revokeObjectURL(a.href);
    }

    // ─── Fullscreen ───
    function showFullscreen() {
        const v=document.getElementById('fullscreen-view'), fc=document.getElementById('fullscreenCanvas');
        v.classList.remove('hidden'); fc.width=state.canvasW; fc.height=state.canvasH;
        const fx=fc.getContext('2d'); fx.fillStyle=state.bgColor; fx.fillRect(0,0,state.canvasW,state.canvasH);
        for(const s of state.strokes) drawStrokeToCtx(fx,s);
    }

    // ─── Recent Colors ───
    function addRecentColor(c) {
        const i=state.recentColors.indexOf(c); if(i>-1) state.recentColors.splice(i,1);
        state.recentColors.unshift(c); if(state.recentColors.length>16) state.recentColors.pop();
        renderRecentColors();
    }
    function renderRecentColors() {
        const el=document.getElementById('recentColors'); el.innerHTML='';
        state.recentColors.forEach(c=>{
            const s=document.createElement('button'); s.className='color-swatch';
            if(c===state.brushColor) s.classList.add('active');
            s.style.background=c;
            s.addEventListener('click',()=>{ state.brushColor=c; document.getElementById('brushColor').value=c; renderRecentColors(); });
            el.appendChild(s);
        });
    }

    function updateInfo() {
        document.getElementById('canvasInfoText').textContent=`${state.canvasW} \u00d7 ${state.canvasH}`;
        document.getElementById('zoomLevel').textContent=`${Math.round(state.zoom*100)}%`;
        document.getElementById('strokeCount').textContent=`strokes: ${state.strokes.length}`;
    }

    function setTool(t) {
        state.tool = t;
        document.querySelectorAll('.tool-btn[data-tool]').forEach(b => {
            if(b.dataset.tool==='brush'||b.dataset.tool==='eraser'||b.dataset.tool==='select')
                b.classList.toggle('active', b.dataset.tool===t);
        });
        canvasArea.classList.toggle('eraser-mode', t==='eraser');
        canvasArea.classList.toggle('select-mode', t==='select');
        if(t!=='select') deselectStroke();
    }

    // ─── UI Binding ───
    function bindUI() {
        const $=id=>document.getElementById(id);
        $('brushSize').addEventListener('input',e=>{state.brushSize=+e.target.value;$('sizeVal').textContent=state.brushSize;});
        $('minWidthRatio').addEventListener('input',e=>{state.minWidthRatio=+e.target.value/100;$('minWidthVal').textContent=state.minWidthRatio.toFixed(2);});
        $('smoothing').addEventListener('input',e=>{state.smoothing=+e.target.value/100;$('smoothVal').textContent=state.smoothing.toFixed(2);});
        $('taperStart').addEventListener('input',e=>{state.taperStart=+e.target.value/100;$('taperStartVal').textContent=state.taperStart.toFixed(2);});
        $('taperEnd').addEventListener('input',e=>{state.taperEnd=+e.target.value/100;$('taperEndVal').textContent=state.taperEnd.toFixed(2);});
        $('brushColor').addEventListener('input',e=>{state.brushColor=e.target.value;renderRecentColors();});
        $('brushOpacity').addEventListener('input',e=>{state.brushOpacity=+e.target.value/100;$('opacityVal').textContent=state.brushOpacity.toFixed(1);});
        $('bgColor').addEventListener('input',e=>{state.bgColor=e.target.value;rebuildOffscreen();render();});

        $('resizeBtn').addEventListener('click',()=>{
            state.canvasW=Math.max(100,Math.min(4096,+$('canvasW').value));
            state.canvasH=Math.max(100,Math.min(4096,+$('canvasH').value));
            setupOffscreen();fitView();render();
        });

        document.querySelectorAll('.size-preset-btn').forEach(b=>b.addEventListener('click',()=>{
            $('canvasW').value=b.dataset.w;$('canvasH').value=b.dataset.h;
            state.canvasW=+b.dataset.w;state.canvasH=+b.dataset.h;
            setupOffscreen();fitView();render();
        }));

        $('showGuides').addEventListener('change',e=>{state.showGuides=e.target.checked;render();});
        $('showGrid').addEventListener('change',e=>{state.showGrid=e.target.checked;render();});
        $('guideRows').addEventListener('input',e=>{state.guideRows=+e.target.value;$('guideRowsVal').textContent=state.guideRows;render();});
        $('guidePadding').addEventListener('input',e=>{state.guidePadding=+e.target.value;$('guidePadVal').textContent=state.guidePadding+'%';render();});
        $('gridSize').addEventListener('input',e=>{state.gridSize=+e.target.value;$('gridSizeVal').textContent=state.gridSize;render();});

        $('undoBtn').addEventListener('click',undo);
        $('redoBtn').addEventListener('click',redo);
        $('clearBtn').addEventListener('click',clearAll);
        $('exportBtn').addEventListener('click',()=>exportPNG(false));
        $('exportTransBtn').addEventListener('click',()=>exportPNG(true));
        $('exportSvgBtn').addEventListener('click',exportSVG);
        $('fullscreenBtn').addEventListener('click',showFullscreen);
        $('closeFullscreen').addEventListener('click',()=>$('fullscreen-view').classList.add('hidden'));
        $('fitBtn').addEventListener('click',fitView);

        // Tool buttons
        document.querySelectorAll('.tool-btn[data-tool="brush"],.tool-btn[data-tool="eraser"],.tool-btn[data-tool="select"]').forEach(b=>{
            b.addEventListener('click',()=>setTool(b.dataset.tool));
        });

        $('mirrorBtn').addEventListener('click',()=>{ state.mirror=!state.mirror; $('mirrorBtn').classList.toggle('active',state.mirror); render(); });

        // Reference image
        $('refImageInput').addEventListener('change',e=>{ const f=e.target.files[0]; if(!f) return; const img=new Image(); img.onload=()=>{state.refImage=img;render();}; img.src=URL.createObjectURL(f); });
        $('refOpacity').addEventListener('input',e=>{state.refOpacity=+e.target.value/100;$('refOpacityVal').textContent=state.refOpacity.toFixed(2);render();});
        $('removeRefBtn').addEventListener('click',()=>{state.refImage=null;render();});

        // Selected stroke controls
        $('selectedStrokeColor').addEventListener('input',e=>{
            if(state.selectedStrokeIndex<0) return;
            state.strokes[state.selectedStrokeIndex].color=e.target.value;
            rebuildOffscreen(); render();
        });
        $('selectedStrokeSize').addEventListener('input',e=>{
            if(state.selectedStrokeIndex<0) return;
            const s=state.strokes[state.selectedStrokeIndex];
            s.size=+e.target.value; $('selectedSizeVal').textContent=s.size;
            s.renderPoints=anchorsToRenderPoints(s.anchors,s.size,s.minWidthRatio,s.taperStart,s.taperEnd);
            rebuildOffscreen(); render();
        });
        $('deleteStrokeBtn').addEventListener('click',()=>{
            if(state.selectedStrokeIndex<0) return;
            state.strokes.splice(state.selectedStrokeIndex,1);
            deselectStroke(); rebuildOffscreen(); render(); updateInfo();
        });

        // Brush presets
        const presets={
            pen:{brushSize:4,minWidthRatio:.3,smoothing:.3,taperStart:.05,taperEnd:.15},
            brush:{brushSize:16,minWidthRatio:.1,smoothing:.5,taperStart:.1,taperEnd:.3},
            marker:{brushSize:12,minWidthRatio:.85,smoothing:.2,taperStart:0,taperEnd:0},
            calligraphy:{brushSize:20,minWidthRatio:.05,smoothing:.6,taperStart:.15,taperEnd:.4},
            ink:{brushSize:6,minWidthRatio:.08,smoothing:.45,taperStart:.12,taperEnd:.35},
            pencil:{brushSize:3,minWidthRatio:.6,smoothing:.15,taperStart:.02,taperEnd:.05},
        };
        document.querySelectorAll('.preset-btn').forEach(b=>b.addEventListener('click',()=>{
            const p=presets[b.dataset.preset]; if(!p) return;
            Object.assign(state,p);
            $('brushSize').value=p.brushSize;$('sizeVal').textContent=p.brushSize;
            $('minWidthRatio').value=Math.round(p.minWidthRatio*100);$('minWidthVal').textContent=p.minWidthRatio.toFixed(2);
            $('smoothing').value=Math.round(p.smoothing*100);$('smoothVal').textContent=p.smoothing.toFixed(2);
            $('taperStart').value=Math.round(p.taperStart*100);$('taperStartVal').textContent=p.taperStart.toFixed(2);
            $('taperEnd').value=Math.round(p.taperEnd*100);$('taperEndVal').textContent=p.taperEnd.toFixed(2);
            document.querySelectorAll('.preset-btn').forEach(x=>x.classList.remove('active'));
            b.classList.add('active');
        }));

        window.addEventListener('resize',()=>fitView());
    }

    // ─── Keyboard Shortcuts ───
    function bindKeyboard() {
        document.addEventListener('keydown',e=>{
            if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
            if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key==='z'){e.preventDefault();undo();}
            if((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='z'){e.preventDefault();redo();}
            if((e.ctrlKey||e.metaKey)&&e.key==='s'){e.preventDefault();exportPNG(false);}
            if(e.key==='b'||e.key==='B') setTool('brush');
            if(e.key==='e'||e.key==='E') setTool('eraser');
            if(e.key==='v'||e.key==='V') setTool('select');
            if(e.key==='m'||e.key==='M'){state.mirror=!state.mirror;document.getElementById('mirrorBtn').classList.toggle('active',state.mirror);render();}
            if(e.key==='['){state.brushSize=Math.max(1,state.brushSize-2);document.getElementById('brushSize').value=state.brushSize;document.getElementById('sizeVal').textContent=state.brushSize;}
            if(e.key===']'){state.brushSize=Math.min(80,state.brushSize+2);document.getElementById('brushSize').value=state.brushSize;document.getElementById('sizeVal').textContent=state.brushSize;}
            if(e.key==='0'&&(e.ctrlKey||e.metaKey)){e.preventDefault();fitView();}
            if(e.key==='Escape'){document.getElementById('fullscreen-view').classList.add('hidden');if(state.tool==='select')deselectStroke();render();}
            if((e.key==='Delete'||e.key==='Backspace')&&state.tool==='select'&&state.selectedStrokeIndex>=0){
                state.strokes.splice(state.selectedStrokeIndex,1);deselectStroke();rebuildOffscreen();render();updateInfo();
            }
        });
    }

    init();
})();

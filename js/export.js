/* ═══════════════════════════════════
   Export v4 — Real-time Recording
   No frame-by-frame capture.
   Let draw() run normally, record the stream.
   ═══════════════════════════════════ */

let isExporting = false;
let exportTimer = null;

function getExportScale() {
    let active = document.querySelector('.export-scale-btn.active');
    return active ? parseInt(active.dataset.scale) || 1 : 1;
}

function saveImage() {
    let so = offset.copy(), sz = zoom;
    offset = createVector(0, 0);
    zoom = 1.0;

    let expScale = getExportScale();
    pixelDensity(expScale);
    resizeCanvas(width, height);
    drawFrame(frameCount);
    saveCanvas('TEXT_MOSAIC_' + width * expScale + 'x' + height * expScale, 'png');
    pixelDensity(1);
    resizeCanvas(width, height);

    offset = so; zoom = sz;
    fitCanvasToPreview();
    updateStatus('이미지 저장됨!', 'success');
}

function saveTransparentImage() {
    let so = offset.copy(), sz = zoom;
    offset = createVector(0, 0);
    zoom = 1.0;

    let expScale = getExportScale();
    pixelDensity(expScale);
    resizeCanvas(width, height);
    clear();

    if (fontReady) {
        push();
        translate(width / 2, height / 2);
        scale(zoom);
        translate(-width / 2 + offset.x, -height / 2 + offset.y);
        drawLayers(frameCount);
        pop();
    }

    saveCanvas('TEXT_MOSAIC_TRANSPARENT', 'png');
    pixelDensity(1);
    resizeCanvas(width, height);
    offset = so; zoom = sz;
    fitCanvasToPreview();
    updateStatus('투명 배경 PNG 저장됨!', 'success');
}

// ═══════════════════════════════════
// Real-Time Video Recording
//
// Instead of frame-by-frame capture (which causes timing issues),
// we let p5's draw() loop run at its natural speed and record
// the canvas stream in real-time. This guarantees smooth playback
// because MediaRecorder captures at consistent intervals.
//
// For hi-res: temporarily increase pixelDensity before recording.
// Trade-off: export takes as long as the video duration (real-time).
// ═══════════════════════════════════

async function exportVideo() {
    if (isExporting) return;

    let hasAnim = layers.some(L =>
        L.effects.pulse || L.effects.morph || L.effects.wave ||
        L.effects.vortex || L.effects.rotate3d || L.effects.scatter ||
        L.effects.sequencer || L.effects.spring);
    if (!hasAnim) { updateStatus('애니메이션 이펙트를 켜세요', 'error'); return; }

    let dur = constrain(parseInt(document.getElementById('videoDuration').value) || 3, 1, 30);
    let loops = constrain(parseInt(document.getElementById('videoLoops').value) || 1, 1, 20);
    let totalDur = dur * loops;

    isExporting = true;
    let btn = document.getElementById('exportVideoBtn');
    btn.classList.add('exporting');

    let progBar = document.getElementById('exportProgress');
    let progFill = document.getElementById('exportProgressFill');
    progBar.classList.remove('hidden');

    let expScale = getExportScale();
    let origW = width;
    let origH = height;

    // Save state & reset
    let savedOffset = offset.copy();
    let savedZoom = zoom;
    offset = createVector(0, 0);
    zoom = 1.0;

    // Reset all animations
    for (let L of layers) {
        L.morphProgress = 0;
        L.morphDirection = 1;
        L.morphHolding = false;
        L.morphHoldTimer = 0;
        L.morphStepIdx = 0;
        L._morphPairs = null;
        if (L.effects.scatter) { L.scatterProgress = 1; L.scatterDirection = -1; }
        if (L.effects.sequencer) { L.sequencerProgress = 0; }
        if (L.effects.spring) { L._springState = null; }
    }

    // Limit frame rate during recording to reduce GPU load
    frameRate(30);

    // Upscale for hi-res
    if (expScale > 1) {
        pixelDensity(expScale);
        resizeCanvas(origW, origH);
        generateNoiseBuffer();
        markGradientDirty();
        _imgPixelsLoaded = false;
    }

    let cnv = document.querySelector('#canvas-wrap canvas') ||
              document.querySelector('#fullscreen-canvas-holder canvas');
    if (!cnv) { finishExport(savedOffset, savedZoom, btn, progBar, expScale); return; }

    // Check captureStream support (iOS Safari may not support it)
    if (!cnv.captureStream) {
        finishExport(savedOffset, savedZoom, btn, progBar, expScale);
        updateStatus('이 브라우저에서 영상 녹화를 지원하지 않습니다. PNG 저장을 이용하세요.', 'error');
        return;
    }

    // Use captureStream with auto fps (browser handles timing)
    let stream, recorder;
    try {
        stream = cnv.captureStream(30);
    } catch (e) {
        finishExport(savedOffset, savedZoom, btn, progBar, expScale);
        updateStatus('캡처 스트림 생성 실패', 'error');
        return;
    }

    let chunks = [];
    // VP8 first on mobile (VP9 encoding is too heavy for mobile GPUs)
    // VP9 first on desktop (better quality per bit)
    let isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    let codecOrder = isMobile
        ? ['video/webm;codecs=vp8', 'video/webm;codecs=vp9', 'video/webm']
        : ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

    let bitrate = isMobile ? 20000000 * expScale : 40000000 * expScale;
    let opts = { videoBitsPerSecond: bitrate };
    for (let mime of codecOrder) {
        if (MediaRecorder.isTypeSupported(mime)) { opts.mimeType = mime; break; }
    }

    try {
        recorder = new MediaRecorder(stream, opts);
    } catch (e) {
        finishExport(savedOffset, savedZoom, btn, progBar, expScale);
        updateStatus('MediaRecorder 생성 실패', 'error');
        return;
    }

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onerror = () => {
        finishExport(savedOffset, savedZoom, btn, progBar, expScale);
        updateStatus('녹화 중 오류 발생', 'error');
    };

    recorder.onstop = () => {
        let blob = new Blob(chunks, { type: opts.mimeType || 'video/webm' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        let resLabel = origW * expScale + 'x' + origH * expScale;
        a.download = 'TEXT_MOSAIC_' + resLabel + '.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        finishExport(savedOffset, savedZoom, btn, progBar, expScale);
        let loopMsg = loops > 1 ? ' (' + loops + '회 루프)' : '';
        updateStatus(totalDur + '초' + loopMsg + ' 영상 내보내기 완료!', 'success');
    };

    // Let draw() run — it's NOT blocked by isExporting anymore during recording
    isExporting = 'recording'; // special state: draw() runs but user can't trigger another export

    recorder.start(1000); // 1s timeslice — flush data regularly, reduce memory pressure
    updateStatus('실시간 녹화 중... ' + totalDur + '초');

    // Progress timer
    let startTime = Date.now();
    let progressInterval = setInterval(() => {
        let elapsed = (Date.now() - startTime) / 1000;
        let pct = Math.min(100, Math.round((elapsed / totalDur) * 100));
        progFill.style.width = pct + '%';
        btn.textContent = Math.ceil(totalDur - elapsed) + '초 남음';
    }, 200);

    // Handle loop resets during recording
    let loopInterval = null;
    if (loops > 1) {
        let loopCount = 0;
        loopInterval = setInterval(() => {
            loopCount++;
            if (loopCount >= loops) { clearInterval(loopInterval); return; }
            // Reset animations for next loop
            for (let L of layers) {
                L.morphProgress = 0;
                L.morphDirection = 1;
                L.morphHolding = false;
                L.morphHoldTimer = 0;
                L.morphStepIdx = 0;
                L._morphPairs = null;
                if (L.effects.scatter) { L.scatterProgress = 1; L.scatterDirection = -1; }
                if (L.effects.sequencer) { L.sequencerProgress = 0; }
                if (L.effects.spring) { L._springState = null; }
            }
        }, dur * 1000);
    }

    // Stop after total duration
    exportTimer = setTimeout(() => {
        clearInterval(progressInterval);
        if (loopInterval) clearInterval(loopInterval);
        if (recorder.state === 'recording') recorder.stop();
    }, totalDur * 1000);
}

function finishExport(savedOffset, savedZoom, btn, progBar, restoreScale) {
    isExporting = false;
    frameRate(60); // restore normal frame rate
    if (exportTimer) { clearTimeout(exportTimer); exportTimer = null; }
    offset = savedOffset;
    zoom = savedZoom;
    if (restoreScale && restoreScale > 1) {
        pixelDensity(1);
        resizeCanvas(width, height);
        generateNoiseBuffer();
        markGradientDirty();
        _imgPixelsLoaded = false;
        fitCanvasToPreview();
    }
    btn.classList.remove('exporting');
    btn.textContent = 'VIDEO';
    progBar.classList.add('hidden');
}

// ── Draw a single frame (used by live draw loop) ──
function drawFrame(frameNum) {
    drawBackground();
    if (!fontReady) return;

    push();
    translate(width / 2, height / 2);
    scale(zoom);
    translate(-width / 2 + offset.x, -height / 2 + offset.y);
    drawLayers(frameNum);
    pop();
}

function generateDemoImage() {
    img = createGraphics(width, height);
    img.background(30);
    img.noStroke();
    for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
            let r = map(x, 0, width, 60, 220);
            let g = map(y, 0, height, 80, 200);
            let b = map(x + y, 0, width + height, 120, 255);
            img.fill(r, g, b);
            img.rect(x, y, 4, 4);
        }
    }
    for (let i = 0; i < 30; i++) {
        img.fill(random(150, 255), random(100, 255), random(180, 255), 120);
        img.ellipse(random(width), random(height), random(30, 100));
    }
}

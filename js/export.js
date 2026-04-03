/* ═══════════════════════════════════
   Export v3.2
   Image save & frame-perfect video
   ═══════════════════════════════════ */

let isExporting = false;

function saveImage() {
    let so = offset.copy(), sz = zoom;
    offset = createVector(0, 0);
    zoom = 1.0;

    let oldPD = pixelDensity();
    pixelDensity(window.devicePixelRatio || 1);
    resizeCanvas(width, height);
    drawFrame(frameCount);
    saveCanvas('TEXT_MOSAIC', 'png');
    pixelDensity(1);
    resizeCanvas(width, height);

    offset = so; zoom = sz;
    updateStatus('이미지 저장됨!', 'success');
}

// ── Transparent Background PNG ──
function saveTransparentImage() {
    let so = offset.copy(), sz = zoom;
    offset = createVector(0, 0);
    zoom = 1.0;

    let oldPD = pixelDensity();
    pixelDensity(window.devicePixelRatio || 1);
    resizeCanvas(width, height);

    // Clear to transparent (not background color)
    clear();

    // Draw only tiles, no background
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
    updateStatus('투명 배경 PNG 저장됨!', 'success');
}

// ═══════════════════════════════════
// Frame-Perfect Video Export
//
// Key: We render frames at our own pace using a simple counter,
// NOT tied to requestAnimationFrame timing. Each frame is drawn,
// then explicitly signaled to the recorder via requestFrame().
// This guarantees every frame is captured at exact intervals.
// ═══════════════════════════════════

async function exportVideo() {
    if (isExporting) return;

    let hasAnim = layers.some(L => L.effects.pulse || L.effects.morph || L.effects.wave || L.effects.vortex || L.effects.rotate3d);
    if (!hasAnim) { updateStatus('애니메이션 이펙트를 켜세요', 'error'); return; }

    let dur = constrain(parseInt(document.getElementById('videoDuration').value) || 3, 1, 30);
    let fps = 60;
    let totalFrames = fps * dur;

    isExporting = true;
    let btn = document.getElementById('exportVideoBtn');
    btn.classList.add('exporting');
    btn.textContent = 'EXPORTING...';

    let progBar = document.getElementById('exportProgress');
    let progFill = document.getElementById('exportProgressFill');
    progBar.classList.remove('hidden');

    // Save state
    let savedOffset = offset.copy();
    let savedZoom = zoom;
    offset = createVector(0, 0);
    zoom = 1.0;

    // Reset all animations to start
    for (let L of layers) {
        L.morphProgress = 0;
        L.morphDirection = 1;
    }

    let cnv = document.querySelector('#canvas-wrap canvas');
    if (!cnv) {
        cnv = document.querySelector('#fullscreen-canvas-holder canvas');
    }
    if (!cnv) { finishExport(savedOffset, savedZoom, btn, progBar); return; }

    // Setup high-quality recording
    let stream = cnv.captureStream(0); // 0 = manual frame control
    let track = stream.getVideoTracks()[0];
    let chunks = [];

    let opts = { videoBitsPerSecond: 40000000 };
    for (let mime of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
        if (MediaRecorder.isTypeSupported(mime)) { opts.mimeType = mime; break; }
    }

    let recorder = new MediaRecorder(stream, opts);
    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

    recorder.onstop = () => {
        let blob = new Blob(chunks, { type: opts.mimeType || 'video/webm' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'TEXT_MOSAIC_HQ.webm';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        finishExport(savedOffset, savedZoom, btn, progBar);
        updateStatus(dur + '초 영상 내보내기 완료!', 'success');
    };

    // Wait a tick for recorder to be ready
    await new Promise(r => setTimeout(r, 50));
    recorder.start();

    // Render each frame on our own schedule
    let frame = 0;

    function renderNext() {
        if (frame >= totalFrames) {
            recorder.stop();
            return;
        }

        // Advance morph/animation state deterministically
        // Each frame = exactly 1/fps of a second, regardless of wall-clock time
        for (let L of layers) {
            if (L.effects.morph && L.tiles1.length > 0 && L.tiles2.length > 0) {
                let ppf = 1 / (L.morphDuration * fps);
                L.morphProgress += L.morphDirection * ppf;
                if (L.morphProgress >= 1) { L.morphProgress = 1; L.morphDirection = -1; }
                else if (L.morphProgress <= 0) { L.morphProgress = 0; L.morphDirection = 1; }
                updateMorphedTiles(L);
            }
        }

        // Draw this frame (use our own frame counter, not p5's frameCount)
        drawBackground();
        if (fontReady) {
            push();
            translate(width / 2, height / 2);
            scale(zoom);
            translate(-width / 2 + offset.x, -height / 2 + offset.y);
            drawLayers(frame);
            pop();
        }

        // Signal frame to recorder
        if (track.requestFrame) {
            track.requestFrame();
        }

        frame++;
        let pct = Math.round((frame / totalFrames) * 100);
        progFill.style.width = pct + '%';

        // Update UI ~10x per second (not every frame)
        if (frame % 6 === 0) {
            updateStatus('내보내기 ' + pct + '%...');
        }

        // Use rAF to yield to browser for UI updates, but WE control frame counting
        requestAnimationFrame(renderNext);
    }

    requestAnimationFrame(renderNext);
}

function finishExport(savedOffset, savedZoom, btn, progBar) {
    isExporting = false;
    offset = savedOffset;
    zoom = savedZoom;
    btn.classList.remove('exporting');
    btn.textContent = 'EXPORT VIDEO';
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

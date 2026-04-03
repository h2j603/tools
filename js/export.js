/* ═══════════════════════════════════
   Export v3.2
   Image save & frame-perfect video
   ═══════════════════════════════════ */

let isExporting = false;

function getExportScale() {
    let active = document.querySelector('.export-scale-btn.active');
    return active ? parseInt(active.dataset.scale) || 1 : 1;
}

function saveImage() {
    let so = offset.copy(), sz = zoom;
    offset = createVector(0, 0);
    zoom = 1.0;

    let expScale = getExportScale();
    let oldPD = pixelDensity();
    pixelDensity(expScale);
    resizeCanvas(width, height);
    drawFrame(frameCount);
    saveCanvas('TEXT_MOSAIC_' + width*expScale + 'x' + height*expScale, 'png');
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

    let expScale = getExportScale();
    let oldPD = pixelDensity();
    pixelDensity(expScale);
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

    let hasAnim = layers.some(L => L.effects.pulse || L.effects.morph || L.effects.wave || L.effects.vortex || L.effects.rotate3d || L.effects.scatter || L.effects.sequencer || L.effects.spring);
    if (!hasAnim) { updateStatus('애니메이션 이펙트를 켜세요', 'error'); return; }

    let dur = constrain(parseInt(document.getElementById('videoDuration').value) || 3, 1, 30);
    let loops = constrain(parseInt(document.getElementById('videoLoops').value) || 1, 1, 20);
    // Use 30fps for export — half the frames, double the animation step per frame
    // This gives encoder 2x more time per frame and produces smoother playback
    let fps = 30;
    let animStepsPerFrame = 2; // advance animation by 2 ticks per rendered frame (equivalent to 60fps motion)
    let framesPerLoop = fps * dur;
    let totalFrames = framesPerLoop * loops;

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

    // Setup high-quality recording (wrapped in try-catch to prevent stuck state)
    let stream, track, recorder;
    try {
        stream = cnv.captureStream(0);
        track = stream.getVideoTracks()[0];
    } catch (e) {
        finishExport(savedOffset, savedZoom, btn, progBar);
        updateStatus('캡처 스트림 생성 실패', 'error');
        return;
    }

    let chunks = [];
    let opts = { videoBitsPerSecond: 40000000 };
    for (let mime of ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']) {
        if (MediaRecorder.isTypeSupported(mime)) { opts.mimeType = mime; break; }
    }

    try {
        recorder = new MediaRecorder(stream, opts);
    } catch (e) {
        finishExport(savedOffset, savedZoom, btn, progBar);
        updateStatus('MediaRecorder 생성 실패', 'error');
        return;
    }

    recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onerror = () => {
        finishExport(savedOffset, savedZoom, btn, progBar);
        updateStatus('녹화 중 오류 발생', 'error');
    };

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
        let loopMsg = loops > 1 ? ' (' + loops + '회 루프)' : '';
        updateStatus(dur + '초' + loopMsg + ' 영상 내보내기 완료!', 'success');
    };

    await new Promise(r => setTimeout(r, 50));
    try {
        recorder.start();
    } catch (e) {
        finishExport(savedOffset, savedZoom, btn, progBar);
        updateStatus('녹화 시작 실패', 'error');
        return;
    }

    // Render each frame with guaranteed encode time
    // Key: use setTimeout between frames to let encoder process each frame
    // This prevents frame drops from encoder backpressure
    let frame = 0;
    let encodeDelay = 1000 / fps; // ~16ms per frame at 60fps

    function renderNext() {
        if (frame >= totalFrames) {
            recorder.stop();
            return;
        }

        // Reset animations at the start of each loop
        if (loops > 1 && frame > 0 && (frame % framesPerLoop) === 0) {
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
        }

        // Advance animation by multiple ticks per frame (30fps render, 60fps motion)
        // Advance animation N ticks (30fps render with 60fps-equivalent motion)
        let motionFps = 60; // always 60 for consistent motion speed
        for (let step = 0; step < animStepsPerFrame; step++) {
            for (let L of layers) {
                if (L.effects.morph && L.morphSteps && L.morphSteps.length > 1) {
                    if (L.morphHolding) {
                        L.morphHoldTimer -= 1/motionFps;
                        if (L.morphHoldTimer <= 0) {
                            L.morphHolding = false;
                            L.morphProgress = 0;
                            L.morphStepIdx++;
                            if (L.morphStepIdx >= L.morphSteps.length) L.morphStepIdx = 0;
                            L._morphPairs = null;
                        }
                    } else {
                        let ppf = 1 / (L.morphDuration * motionFps);
                        L.morphProgress += ppf;
                        if (L.morphProgress >= 1) {
                            L.morphProgress = 1;
                            if (L.morphHold > 0) {
                                L.morphHolding = true;
                                L.morphHoldTimer = L.morphHold;
                            } else {
                                L.morphProgress = 0;
                                L.morphStepIdx++;
                                if (L.morphStepIdx >= L.morphSteps.length) L.morphStepIdx = 0;
                                L._morphPairs = null;
                            }
                        }
                    }
                    let fromIdx = L.morphStepIdx;
                    let toIdx = (L.morphStepIdx + 1) % L.morphSteps.length;
                    L.tiles1 = L.morphSteps[fromIdx];
                    L.tiles2 = L.morphSteps[toIdx];
                    if (!L._morphPairs) L._morphPairs = buildSpatialMorphMap(L.tiles1, L.tiles2);
                    updateMorphedTiles(L);
                }
                if (L.effects.scatter) {
                    let spd = 1 / (L.morphDuration * motionFps);
                    L.scatterProgress += L.scatterDirection * spd;
                    if (L.scatterProgress >= 1) { L.scatterProgress = 1; L.scatterDirection = -1; }
                    else if (L.scatterProgress <= 0) { L.scatterProgress = 0; L.scatterDirection = 1; }
                }
                if (L.effects.sequencer) {
                    L.sequencerProgress += 1 / (L.morphDuration * motionFps * 2);
                    if (L.sequencerProgress > 1.5) L.sequencerProgress = 0;
                }
            }
        }

        // Draw this frame and measure render time
        let renderStart = performance.now();
        drawBackground();
        if (fontReady) {
            push();
            translate(width / 2, height / 2);
            scale(zoom);
            translate(-width / 2 + offset.x, -height / 2 + offset.y);
            drawLayers(frame);
            pop();
        }
        let renderTime = performance.now() - renderStart;

        // Wait for paint to flush to canvas, THEN signal frame to recorder
        // rAF guarantees the canvas buffer is ready for capture
        requestAnimationFrame(() => {
            if (track && track.requestFrame) {
                track.requestFrame();
            }

            frame++;
            let pct = Math.round((frame / totalFrames) * 100);
            progFill.style.width = pct + '%';
            if (frame % 6 === 0) updateStatus('내보내기 ' + pct + '%...');

            // Dynamic delay: at least 20ms, or 2x render time (whichever is larger)
            // This ensures encoder has enough time even with heavy frames
            let delay = Math.max(20, renderTime * 2);
            setTimeout(renderNext, delay);
        });
    }

    setTimeout(renderNext, 100);
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

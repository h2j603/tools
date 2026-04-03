/* ═══════════════════════════════════
   TEXT MOSAIC v3.2 — Main Entry
   p5.js setup() / draw() + globals
   ═══════════════════════════════════ */

// ── Global State ──
let img;
let fontReady = false;
let layers = [];
let activeLayerIdx = 0;
let gradientType = 'none';
let gradAngle = 0;
let noiseAmount = 0;
let noiseBuffer;
let zoom = 1.0;
let offset;

// ── p5.js Setup ──
function setup() {
    const w = parseInt(document.getElementById('canvasW').value) || 360;
    const h = parseInt(document.getElementById('canvasH').value) || 400;
    let canvas = createCanvas(w, h);
    canvas.parent('canvas-wrap');
    offset = createVector(0, 0);

    pixelDensity(1);

    initTheme();
    checkFontAndInit();
    bindGlobalEvents();
    bindLayerSettingsEvents();
    generateNoiseBuffer();
    initTouchHandlers();
    initKeyboardShortcuts();
    updateCanvasInfoUI();
    fitCanvasToPreview();
}

function checkFontAndInit() {
    let checkCount = 0;
    let checker = setInterval(() => {
        checkCount++;
        let tc = document.createElement('canvas');
        let ctx = tc.getContext('2d');
        ctx.font = '40px "kozuka-mincho-pr6n", serif';
        let w1 = ctx.measureText('\u3042').width;
        ctx.font = '40px serif';
        let w2 = ctx.measureText('\u3042').width;

        if (w1 !== w2 || checkCount > 50) {
            clearInterval(checker);
            fontReady = true;
            updateStatus('준비 완료');
            addLayer();
            generateDemoImage();
            generateLayerTiles(layers[0]);
            updateTileCountUI();
        }
    }, 100);
}

// ── Fit canvas CSS size to preview area (aspect-ratio preserving) ──
function fitCanvasToPreview() {
    let cnv = document.querySelector('#canvas-wrap canvas');
    if (!cnv) return;
    let area = document.getElementById('canvas-area');
    if (!area) return;

    let areaW = area.clientWidth;
    let areaH = area.clientHeight;
    let canvasW = width;
    let canvasH = height;

    if (areaW <= 0 || areaH <= 0 || canvasW <= 0 || canvasH <= 0) return;

    let scaleX = areaW / canvasW;
    let scaleY = areaH / canvasH;
    let s = Math.min(scaleX, scaleY) * 0.95; // 5% padding

    cnv.style.width = Math.floor(canvasW * s) + 'px';
    cnv.style.height = Math.floor(canvasH * s) + 'px';
}

// ── p5.js Draw Loop ──
let _keepLoopUntil = 0; // timestamp — keep loop running until this time

function draw() {
    if (isExporting === true) return;
    drawFrame(frameCount);

    // Auto noLoop when no animations are active AND no recent user interaction
    let anyAnim = layers.some(L => L.visible && (
        L.effects.morph || L.effects.pulse || L.effects.wave ||
        L.effects.vortex || L.effects.rotate3d || L.effects.scatter ||
        L.effects.sequencer || L.effects.spring));
    let now = millis();
    if (!anyAnim && isExporting !== 'recording' && now > _keepLoopUntil) {
        noLoop();
    }
}

// Call this when any setting changes — keeps loop alive for 500ms
function requestRedraw() {
    _keepLoopUntil = millis() + 500;
    loop();
}

// Refit on window resize
function windowResized() {
    fitCanvasToPreview();
}

// ── Mouse Interaction (Desktop) ──
function mouseWheel(event) {
    let fsView = document.getElementById('fullscreen-view');
    let canvasArea = document.getElementById('canvas-area');
    let target = event.target;

    let inCanvas = canvasArea.contains(target) || !fsView.classList.contains('hidden');
    if (inCanvas) {
        zoom -= event.delta * 0.001;
        zoom = constrain(zoom, 0.1, 5);
        return false;
    }
}

function mouseDragged() {
    let fsView = document.getElementById('fullscreen-view');
    let canvasArea = document.getElementById('canvas-area');

    let inFS = !fsView.classList.contains('hidden');
    let inCanvas = canvasArea && canvasArea.matches(':hover');

    if (inFS || inCanvas) {
        let cnv = document.querySelector('#canvas-wrap canvas') ||
                  document.querySelector('#fullscreen-canvas-holder canvas');
        if (cnv) {
            let scaleX = width / cnv.clientWidth;
            let scaleY = height / cnv.clientHeight;
            offset.x += ((mouseX - pmouseX) * scaleX) / zoom;
            offset.y += ((mouseY - pmouseY) * scaleY) / zoom;
        } else {
            offset.x += (mouseX - pmouseX) / zoom;
            offset.y += (mouseY - pmouseY) / zoom;
        }
    }
}

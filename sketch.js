/* ═══════════════════════════════════════
   TEXT MOSAIC v2.0 — Layer-based System
   ═══════════════════════════════════════ */

let myFont;
let img;
let isFontLoaded = false;

// ── Layer System ──
let layers = [];
let activeLayerIdx = 0;
const LAYER_COLORS = ['#4488ff', '#ff4488', '#44cc88', '#ffaa44', '#aa44ff', '#44dddd', '#ff6644', '#88cc44'];

// ── Background ──
let gradientType = 'none';
let gradAngle = 0;
let noiseAmount = 0;
let noiseBuffer;

// ── View ──
let zoom = 1.0;
let offset;

// ── Recording ──
let isRecording = false;
let mediaRecorder = null;
let recordedChunks = [];

// ═══════════════════════════════════
// Layer Class
// ═══════════════════════════════════
class Layer {
    constructor(id, name) {
        this.id = id;
        this.name = name;
        this.visible = true;
        this.text = 'A';
        this.morphText = 'B';
        this.fontSize = 50;
        this.tileSize = 5;
        this.scaleX = 100;
        this.letterSpace = 0;
        this.lineHeight = 120;
        this.offsetX = 0;
        this.offsetY = 0;
        this.opacity = 100;
        this.blendMode = 'source-over';
        this.morphDuration = 2;
        this.effects = { web: false, rotate: false, pulse: false, morph: false };

        this.tiles1 = [];
        this.tiles2 = [];
        this.currentTiles = [];
        this.morphProgress = 0;
        this.morphDirection = 1;
        this.color = LAYER_COLORS[id % LAYER_COLORS.length];
    }
}

// ═══════════════════════════════════
// Setup
// ═══════════════════════════════════
function setup() {
    const w = parseInt(select('#canvasW').value());
    const h = parseInt(select('#canvasH').value());
    let canvas = createCanvas(w, h);
    canvas.parent('canvas-holder');
    offset = createVector(0, 0);

    const fontURL = 'https://fonts.gstatic.com/s/roboto/v30/KFOmCnqEu92Fr1Mu4mxP.ttf';
    myFont = loadFont(fontURL,
        () => {
            isFontLoaded = true;
            updateStatus('폰트 로드 완료');
            // Create default layer and generate demo
            addLayer();
            generateDemoImage();
            generateLayerTiles(layers[0]);
        },
        () => updateStatus('폰트 로드 실패')
    );

    bindGlobalEvents();
    bindLayerSettingsEvents();
    generateNoiseBuffer();
}

// ═══════════════════════════════════
// Event Bindings
// ═══════════════════════════════════
function bindGlobalEvents() {
    // Canvas / export
    select('#convertBtn').mousePressed(convertAll);
    select('#resizeBtn').mousePressed(updateCanvas);
    select('#saveBtn').mousePressed(saveImage);
    select('#saveVideoBtn').mousePressed(startRecording);
    select('#previewBtn').mousePressed(() => select('#fullscreen-view').removeClass('hidden'));
    select('#closeFullscreen').mousePressed(() => select('#fullscreen-view').addClass('hidden'));
    select('#imageInput').changed(handleImage);
    select('#addLayerBtn').mousePressed(() => { addLayer(); });

    // Background controls
    select('#bgColor').input(redraw);
    select('#bgColor2').input(redraw);
    select('#gradAngle').input(() => {
        gradAngle = parseInt(select('#gradAngle').value());
        select('#gradAngleVal').html(gradAngle);
    });
    select('#noiseAmount').input(() => {
        noiseAmount = parseInt(select('#noiseAmount').value());
        select('#noiseAmountVal').html(noiseAmount);
        generateNoiseBuffer();
    });
    select('#gradNone').mousePressed(() => { gradientType = 'none'; updateGradBtns(); });
    select('#gradLinear').mousePressed(() => { gradientType = 'linear'; updateGradBtns(); });
    select('#gradRadial').mousePressed(() => { gradientType = 'radial'; updateGradBtns(); });
}

function bindLayerSettingsEvents() {
    // Text inputs — live update
    select('#layerText').input(() => {
        let L = activeLayer();
        if (!L) return;
        L.text = document.getElementById('layerText').value || 'A';
        generateLayerTiles(L);
        updateLayerListUI();
    });
    select('#layerMorphText').input(() => {
        let L = activeLayer();
        if (!L) return;
        L.morphText = document.getElementById('layerMorphText').value || 'B';
        generateLayerTiles(L);
    });

    // Sliders
    const sliderBindings = [
        ['layerFontSize', 'layerFontSizeVal', 'fontSize', true],
        ['layerTileSize', 'layerTileSizeVal', 'tileSize', true],
        ['layerScaleX', 'layerScaleXVal', 'scaleX', true],
        ['layerLetterSpace', 'layerLetterSpaceVal', 'letterSpace', true],
        ['layerLineHeight', 'layerLineHeightVal', 'lineHeight', true],
        ['layerOffsetX', 'layerOffsetXVal', 'offsetX', false],
        ['layerOffsetY', 'layerOffsetYVal', 'offsetY', false],
        ['layerOpacity', 'layerOpacityVal', 'opacity', false],
        ['layerMorphDuration', 'layerMorphDurVal', 'morphDuration', false],
    ];

    for (let [sliderId, valId, prop, regen] of sliderBindings) {
        select('#' + sliderId).input(() => {
            let L = activeLayer();
            if (!L) return;
            let v = parseFloat(select('#' + sliderId).value());
            L[prop] = v;
            select('#' + valId).html(v);
            if (regen) generateLayerTiles(L);
        });
    }

    // Blend mode
    document.getElementById('layerBlendMode').addEventListener('change', (e) => {
        let L = activeLayer();
        if (L) L.blendMode = e.target.value;
    });

    // Effect toggles
    document.querySelectorAll('.effect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let L = activeLayer();
            if (!L) return;
            let fx = btn.dataset.effect;
            L.effects[fx] = !L.effects[fx];
            btn.classList.toggle('active', L.effects[fx]);
            if (fx === 'morph' && L.effects.morph) {
                L.morphProgress = 0;
                L.morphDirection = 1;
            }
        });
    });
}

// ═══════════════════════════════════
// Layer Management
// ═══════════════════════════════════
function activeLayer() {
    return layers[activeLayerIdx] || null;
}

function addLayer() {
    let id = layers.length;
    let L = new Layer(id, 'Layer ' + (id + 1));
    if (id > 0) {
        L.text = 'B';
        L.morphText = 'A';
    }
    layers.push(L);
    activeLayerIdx = layers.length - 1;
    updateLayerListUI();
    loadLayerToUI(L);
    if (isFontLoaded) generateLayerTiles(L);
    updateStatus('레이어 ' + (id + 1) + ' 추가됨');
}

function removeLayer(idx) {
    if (layers.length <= 1) {
        updateStatus('최소 1개 레이어 필요');
        return;
    }
    layers.splice(idx, 1);
    // Re-index
    for (let i = 0; i < layers.length; i++) {
        layers[i].id = i;
        layers[i].name = 'Layer ' + (i + 1);
        layers[i].color = LAYER_COLORS[i % LAYER_COLORS.length];
    }
    if (activeLayerIdx >= layers.length) activeLayerIdx = layers.length - 1;
    updateLayerListUI();
    loadLayerToUI(layers[activeLayerIdx]);
}

function moveLayer(idx, dir) {
    let newIdx = idx + dir;
    if (newIdx < 0 || newIdx >= layers.length) return;
    [layers[idx], layers[newIdx]] = [layers[newIdx], layers[idx]];
    // Re-index
    for (let i = 0; i < layers.length; i++) {
        layers[i].id = i;
        layers[i].name = 'Layer ' + (i + 1);
        layers[i].color = LAYER_COLORS[i % LAYER_COLORS.length];
    }
    if (activeLayerIdx === idx) activeLayerIdx = newIdx;
    else if (activeLayerIdx === newIdx) activeLayerIdx = idx;
    updateLayerListUI();
}

function selectLayer(idx) {
    activeLayerIdx = idx;
    updateLayerListUI();
    loadLayerToUI(layers[idx]);
}

function toggleLayerVisibility(idx) {
    layers[idx].visible = !layers[idx].visible;
    updateLayerListUI();
}

// ═══════════════════════════════════
// Layer UI
// ═══════════════════════════════════
function updateLayerListUI() {
    let container = document.getElementById('layerList');
    container.innerHTML = '';

    for (let i = 0; i < layers.length; i++) {
        let L = layers[i];
        let el = document.createElement('div');
        el.className = 'layer-item' + (i === activeLayerIdx ? ' active' : '');

        el.innerHTML = `
            <button class="layer-vis-btn ${L.visible ? '' : 'hidden-layer'}" data-idx="${i}" title="표시/숨김">
                ${L.visible ? '◉' : '○'}
            </button>
            <span class="layer-color" style="background:${L.color}"></span>
            <span class="layer-name">${L.name}</span>
            <span class="layer-text-preview">${L.text.substring(0, 10)}</span>
            <div class="layer-actions">
                <button class="layer-btn" data-move="${i}" data-dir="-1" title="위로">↑</button>
                <button class="layer-btn" data-move="${i}" data-dir="1" title="아래로">↓</button>
                <button class="layer-btn danger" data-del="${i}" title="삭제">✕</button>
            </div>
        `;

        // Select on click (but not on buttons)
        el.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            selectLayer(i);
        });

        container.appendChild(el);
    }

    // Bind layer action buttons
    container.querySelectorAll('.layer-vis-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleLayerVisibility(parseInt(btn.dataset.idx));
        });
    });

    container.querySelectorAll('[data-move]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            moveLayer(parseInt(btn.dataset.move), parseInt(btn.dataset.dir));
        });
    });

    container.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            removeLayer(parseInt(btn.dataset.del));
        });
    });
}

function loadLayerToUI(L) {
    if (!L) return;
    select('#activeLayerTitle').html(L.name.toUpperCase());
    document.getElementById('layerText').value = L.text;
    document.getElementById('layerMorphText').value = L.morphText;
    select('#layerFontSize').value(L.fontSize); select('#layerFontSizeVal').html(L.fontSize);
    select('#layerTileSize').value(L.tileSize); select('#layerTileSizeVal').html(L.tileSize);
    select('#layerScaleX').value(L.scaleX); select('#layerScaleXVal').html(L.scaleX);
    select('#layerLetterSpace').value(L.letterSpace); select('#layerLetterSpaceVal').html(L.letterSpace);
    select('#layerLineHeight').value(L.lineHeight); select('#layerLineHeightVal').html(L.lineHeight);
    select('#layerOffsetX').value(L.offsetX); select('#layerOffsetXVal').html(L.offsetX);
    select('#layerOffsetY').value(L.offsetY); select('#layerOffsetYVal').html(L.offsetY);
    select('#layerOpacity').value(L.opacity); select('#layerOpacityVal').html(L.opacity);
    select('#layerMorphDuration').value(L.morphDuration); select('#layerMorphDurVal').html(L.morphDuration);
    document.getElementById('layerBlendMode').value = L.blendMode;

    // Effect buttons
    document.querySelectorAll('.effect-btn').forEach(btn => {
        let fx = btn.dataset.effect;
        btn.classList.toggle('active', L.effects[fx]);
    });
}

// ═══════════════════════════════════
// Tile Generation
// ═══════════════════════════════════
function generateTextPoints(txt, targetArray, layerSettings) {
    let lines = txt.split('\n');
    let fontSize = min(width, height) * (layerSettings.fontSize / 100);
    let density = map(layerSettings.tileSize, 1, 20, 0.5, 0.03);

    targetArray.length = 0;

    let lineHeightPx = fontSize * (layerSettings.lineHeight / 100);
    let totalHeight = lines.length * lineHeightPx;
    let startY = (height - totalHeight) / 2 + fontSize * 0.8;

    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        let lineTxt = lines[lineIdx];
        if (lineTxt.trim() === '') continue;

        let chars = lineTxt.split('');
        let totalWidth = 0;

        for (let c = 0; c < chars.length; c++) {
            if (chars[c] === ' ') {
                totalWidth += fontSize * 0.3 * (layerSettings.scaleX / 100);
            } else {
                let cb = myFont.textBounds(chars[c], 0, 0, fontSize);
                totalWidth += cb.w * (layerSettings.scaleX / 100);
            }
            if (c < chars.length - 1) totalWidth += layerSettings.letterSpace;
        }

        let startX = (width - totalWidth) / 2;
        let y = startY + lineIdx * lineHeightPx;
        let currentX = startX;

        for (let c = 0; c < chars.length; c++) {
            let ch = chars[c];
            if (ch === ' ') {
                currentX += fontSize * 0.3 * (layerSettings.scaleX / 100) + layerSettings.letterSpace;
                continue;
            }

            let cb = myFont.textBounds(ch, 0, 0, fontSize);
            let pts = myFont.textToPoints(ch, 0, 0, fontSize, {
                sampleFactor: density,
                simplifyThreshold: 0
            });

            for (let p of pts) {
                let sx = p.x * (layerSettings.scaleX / 100);
                targetArray.push({
                    x: currentX + sx,
                    y: y + p.y,
                    index: targetArray.length
                });
            }

            currentX += cb.w * (layerSettings.scaleX / 100) + layerSettings.letterSpace;
        }
    }
}

function normalizeToCenter(arr) {
    if (arr.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let t of arr) {
        minX = min(minX, t.x); maxX = max(maxX, t.x);
        minY = min(minY, t.y); maxY = max(maxY, t.y);
    }
    let ox = width / 2 - (minX + maxX) / 2;
    let oy = height / 2 - (minY + maxY) / 2;
    for (let t of arr) { t.x += ox; t.y += oy; }
}

function generateLayerTiles(L) {
    if (!isFontLoaded || !myFont) return;
    generateTextPoints(L.text, L.tiles1, L);
    generateTextPoints(L.morphText, L.tiles2, L);
    normalizeToCenter(L.tiles1);
    normalizeToCenter(L.tiles2);
    L.currentTiles = L.tiles1.map(t => ({ ...t }));
    L.morphProgress = 0;
    L.morphDirection = 1;
}

// ═══════════════════════════════════
// Drawing
// ═══════════════════════════════════
function draw() {
    drawBackground();

    if (!isFontLoaded) {
        fill(255);
        textAlign(CENTER, CENTER);
        textFont('sans-serif');
        textSize(14);
        text('LOADING FONT...', width / 2, height / 2);
        return;
    }

    push();
    translate(width / 2, height / 2);
    scale(zoom);
    translate(-width / 2 + offset.x, -height / 2 + offset.y);

    // Draw each layer (bottom to top)
    for (let i = 0; i < layers.length; i++) {
        let L = layers[i];
        if (!L.visible || L.currentTiles.length === 0) continue;

        // Update morph
        if (L.effects.morph && L.tiles1.length > 0 && L.tiles2.length > 0) {
            let ppf = 1 / (L.morphDuration * 60);
            L.morphProgress += L.morphDirection * ppf;
            if (L.morphProgress >= 1) { L.morphProgress = 1; L.morphDirection = -1; }
            else if (L.morphProgress <= 0) { L.morphProgress = 0; L.morphDirection = 1; }
            updateMorphedTiles(L);
        } else if (!L.effects.morph && L.tiles1.length > 0) {
            L.currentTiles = L.tiles1;
        }

        // Apply blend mode via drawingContext
        push();
        drawingContext.globalAlpha = L.opacity / 100;
        drawingContext.globalCompositeOperation = L.blendMode;
        translate(L.offsetX, L.offsetY);

        if (L.effects.web) drawWebLines(L);
        drawTiles(L);
        pop();
    }

    pop();

    // No-image hint
    if (!img && layers.some(l => l.currentTiles.length > 0)) {
        // Tiles show demo image anyway
    } else if (!img && layers.every(l => l.currentTiles.length === 0)) {
        push();
        fill(100);
        textAlign(CENTER, CENTER);
        textFont('sans-serif');
        textSize(13);
        text('PHOTO → CONVERT', width / 2, height / 2);
        pop();
    }
}

function updateMorphedTiles(L) {
    let count = min(L.tiles1.length, L.tiles2.length);
    L.currentTiles = [];
    let t = L.morphProgress;
    let eased = t * t * (3 - 2 * t);

    for (let i = 0; i < count; i++) {
        let idx1 = floor(map(i, 0, count, 0, L.tiles1.length));
        let idx2 = floor(map(i, 0, count, 0, L.tiles2.length));
        let t1 = L.tiles1[idx1];
        let t2 = L.tiles2[idx2];

        let mx = lerp(t1.x, t2.x, eased);
        let my = lerp(t1.y, t2.y, eased);

        let curve = sin(eased * PI) * 15;
        let angle = atan2(t2.y - t1.y, t2.x - t1.x) + HALF_PI;
        mx += cos(angle) * curve * sin(i * 0.1);
        my += sin(angle) * curve * sin(i * 0.1);

        L.currentTiles.push({ x: mx, y: my, index: i });
    }
}

function drawWebLines(L) {
    strokeWeight(0.8);
    let maxDist = min(width, height) * 0.1;
    let tiles = L.currentTiles;

    for (let i = 0; i < tiles.length; i++) {
        let t1 = tiles[i];
        let conn = 0;
        for (let j = i + 1; j < tiles.length && conn < 4; j++) {
            let t2 = tiles[j];
            let d = dist(t1.x, t1.y, t2.x, t2.y);
            if (d < maxDist) {
                let midX = (t1.x + t2.x) / 2;
                let midY = (t1.y + t2.y) / 2;
                let c = getImageColor(midX, midY);
                let a = map(d, 0, maxDist, 200, 30);
                stroke(red(c), green(c), blue(c), a);
                line(t1.x, t1.y, t2.x, t2.y);
                conn++;
            }
        }
    }
}

function drawTiles(L) {
    let baseTileSize = min(width, height) * (L.tileSize / 100);
    let tiles = L.currentTiles;

    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        let sz = baseTileSize;

        if (L.effects.pulse) {
            let pulse = sin(frameCount * 0.05 + i * 0.3) * 0.3 + 1;
            sz *= pulse;
        }

        push();
        translate(t.x, t.y);
        if (L.effects.rotate) {
            randomSeed(i);
            rotate(random(-0.4, 0.4));
        }
        if (img) {
            image(img, -sz / 2, -sz / 2, sz, sz);
        }
        pop();
    }
}

function getImageColor(x, y) {
    if (!img) return color(255);
    let ix = constrain(floor(map(x, 0, width, 0, img.width)), 0, img.width - 1);
    let iy = constrain(floor(map(y, 0, height, 0, img.height)), 0, img.height - 1);
    return img.get(ix, iy);
}

// ═══════════════════════════════════
// Background
// ═══════════════════════════════════
function drawBackground() {
    let c1 = color(select('#bgColor').value());
    let c2 = color(select('#bgColor2').value());

    if (gradientType === 'none') {
        background(c1);
    } else if (gradientType === 'linear') {
        drawLinearGradient(c1, c2);
    } else if (gradientType === 'radial') {
        drawRadialGradient(c1, c2);
    }

    if (noiseAmount > 0 && noiseBuffer) {
        push();
        blendMode(ADD);
        tint(255, noiseAmount * 2.55);
        image(noiseBuffer, 0, 0);
        pop();
    }
}

function drawLinearGradient(c1, c2) {
    push();
    noFill();
    let ar = radians(gradAngle);
    let cx = width / 2, cy = height / 2;
    let diag = sqrt(width * width + height * height);
    for (let i = 0; i <= diag; i++) {
        let t = i / diag;
        stroke(lerpColor(c1, c2, t));
        let x1 = cx + cos(ar + HALF_PI) * diag;
        let y1 = cy + sin(ar + HALF_PI) * diag;
        let x2 = cx - cos(ar + HALF_PI) * diag;
        let y2 = cy - sin(ar + HALF_PI) * diag;
        let ox = cos(ar) * (i - diag / 2);
        let oy = sin(ar) * (i - diag / 2);
        line(x1 + ox, y1 + oy, x2 + ox, y2 + oy);
    }
    pop();
}

function drawRadialGradient(c1, c2) {
    push();
    noStroke();
    let maxR = sqrt(width * width + height * height) / 2;
    for (let r = maxR; r > 0; r -= 2) {
        fill(lerpColor(c1, c2, 1 - r / maxR));
        ellipse(width / 2, height / 2, r * 2, r * 2);
    }
    pop();
}

function generateNoiseBuffer() {
    noiseBuffer = createGraphics(width, height);
    noiseBuffer.loadPixels();
    for (let i = 0; i < noiseBuffer.pixels.length; i += 4) {
        let v = random(255);
        noiseBuffer.pixels[i] = v;
        noiseBuffer.pixels[i + 1] = v;
        noiseBuffer.pixels[i + 2] = v;
        noiseBuffer.pixels[i + 3] = 255;
    }
    noiseBuffer.updatePixels();
}

function updateGradBtns() {
    select('#gradNone').removeClass('active');
    select('#gradLinear').removeClass('active');
    select('#gradRadial').removeClass('active');
    if (gradientType === 'none') select('#gradNone').addClass('active');
    else if (gradientType === 'linear') select('#gradLinear').addClass('active');
    else if (gradientType === 'radial') select('#gradRadial').addClass('active');
}

// ═══════════════════════════════════
// Actions
// ═══════════════════════════════════
function generateDemoImage() {
    img = createGraphics(width, height);
    img.background(50);
    img.noStroke();
    for (let i = 0; i < 200; i++) {
        img.fill(random(100, 255), random(100, 255), random(200, 255));
        img.ellipse(random(width), random(height), random(20, 80));
    }
}

function convertAll() {
    if (!isFontLoaded || !myFont) { updateStatus('폰트 로딩 중...'); return; }
    if (!img) { updateStatus('이미지를 먼저 선택하세요'); return; }

    let totalTiles = 0;
    for (let L of layers) {
        generateLayerTiles(L);
        totalTiles += L.tiles1.length;
    }

    offset = createVector(0, 0);
    zoom = 1.0;
    updateStatus('총 ' + totalTiles + '개 타일 (' + layers.length + '개 레이어)');
}

function handleImage(e) {
    if (e.target.files.length > 0) {
        let url = URL.createObjectURL(e.target.files[0]);
        updateStatus('이미지 로딩...');
        img = loadImage(url, () => updateStatus('이미지 준비 완료 → CONVERT'),
            () => updateStatus('이미지 로드 실패'));
    }
}

function updateCanvas() {
    let w = parseInt(select('#canvasW').value());
    let h = parseInt(select('#canvasH').value());
    resizeCanvas(w, h);
    for (let L of layers) {
        L.tiles1 = []; L.tiles2 = []; L.currentTiles = [];
    }
    offset = createVector(0, 0);
    zoom = 1.0;
    generateNoiseBuffer();
    updateStatus('캔버스: ' + w + 'x' + h);
}

function saveImage() {
    let so = offset.copy(), sz = zoom;
    offset = createVector(0, 0);
    zoom = 1.0;
    draw();
    saveCanvas('TEXT_MOSAIC', 'png');
    offset = so;
    zoom = sz;
    updateStatus('이미지 저장됨!');
}

function startRecording() {
    if (isRecording) { updateStatus('이미 녹화 중'); return; }

    let hasAnim = layers.some(L => L.effects.pulse || L.effects.morph);
    if (!hasAnim) { updateStatus('PULSE 또는 MORPH를 켜세요'); return; }

    let dur = constrain(parseInt(document.getElementById('videoDuration').value) || 3, 1, 30);
    let canvas = document.querySelector('#canvas-holder canvas');
    let stream = canvas.captureStream(60);
    recordedChunks = [];

    let opts = { mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 20000000 };
    if (!MediaRecorder.isTypeSupported(opts.mimeType)) opts.mimeType = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(opts.mimeType)) opts.mimeType = 'video/webm';

    mediaRecorder = new MediaRecorder(stream, opts);
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordedChunks.push(e.data); };
    mediaRecorder.onstop = () => {
        let blob = new Blob(recordedChunks, { type: 'video/webm' });
        let a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'TEXT_MOSAIC.webm';
        a.click();
        isRecording = false;
        select('#saveVideoBtn').html('● REC');
        select('#saveVideoBtn').removeClass('recording');
        updateStatus('비디오 저장됨!');
    };

    // Reset morph for all layers
    for (let L of layers) { L.morphProgress = 0; L.morphDirection = 1; }
    offset = createVector(0, 0);
    zoom = 1.0;

    mediaRecorder.start();
    isRecording = true;
    select('#saveVideoBtn').html('● REC...');
    select('#saveVideoBtn').addClass('recording');
    updateStatus(dur + '초 녹화 중...');

    setTimeout(() => {
        if (mediaRecorder && mediaRecorder.state === 'recording') mediaRecorder.stop();
    }, dur * 1000);
}

function updateStatus(msg) {
    select('#info-text').html(msg);
}

// ═══════════════════════════════════
// Interaction (preview pan/zoom)
// ═══════════════════════════════════
function mouseWheel(event) {
    if (!select('#fullscreen-view').hasClass('hidden')) {
        zoom -= event.delta * 0.001;
        zoom = constrain(zoom, 0.1, 5);
        return false;
    }
}

function mouseDragged() {
    if (!select('#fullscreen-view').hasClass('hidden')) {
        offset.x += (mouseX - pmouseX) / zoom;
        offset.y += (mouseY - pmouseY) / zoom;
    }
}

/* ═══════════════════════════════════
   UI: Event Bindings & Layer Management
   ═══════════════════════════════════ */

// ── Debounce utility ──
function debounce(fn, ms) {
    let timer;
    return function (...args) { clearTimeout(timer); timer = setTimeout(() => fn.apply(this, args), ms); };
}

const debouncedGenerate = debounce(function (L) { generateLayerTiles(L); }, 150);

// ── Layer Management ──

function activeLayer() {
    return layers[activeLayerIdx] || null;
}

function addLayer() {
    let id = layers.length;
    let L = new Layer(id);
    if (id > 0) { L.text = 'B'; L.morphText = 'A'; }
    layers.push(L);
    activeLayerIdx = layers.length - 1;
    updateLayerListUI();
    loadLayerToUI(L);
    if (fontReady) generateLayerTiles(L);
    updateStatus('레이어 ' + (id + 1) + ' 추가됨');
    updateTileCountUI();
}

function removeLayer(idx) {
    if (layers.length <= 1) { updateStatus('최소 1개 레이어 필요', 'error'); return; }
    layers.splice(idx, 1);
    reindexLayers();
    if (activeLayerIdx >= layers.length) activeLayerIdx = layers.length - 1;
    updateLayerListUI();
    loadLayerToUI(layers[activeLayerIdx]);
    updateTileCountUI();
}

function moveLayer(idx, dir) {
    let ni = idx + dir;
    if (ni < 0 || ni >= layers.length) return;
    [layers[idx], layers[ni]] = [layers[ni], layers[idx]];
    reindexLayers();
    if (activeLayerIdx === idx) activeLayerIdx = ni;
    else if (activeLayerIdx === ni) activeLayerIdx = idx;
    updateLayerListUI();
}

function reindexLayers() {
    for (let i = 0; i < layers.length; i++) {
        layers[i].id = i;
        layers[i].name = 'Layer ' + (i + 1);
        layers[i].color = LAYER_COLORS[i % LAYER_COLORS.length];
    }
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

// ── Layer List UI ──

function updateLayerListUI() {
    let container = document.getElementById('layerList');
    container.innerHTML = '';

    for (let i = 0; i < layers.length; i++) {
        let L = layers[i];
        let el = document.createElement('div');
        el.className = 'layer-item' + (i === activeLayerIdx ? ' active' : '');
        el.innerHTML =
            '<button class="layer-vis-btn ' + (L.visible ? '' : 'hidden-layer') + '" data-idx="' + i + '">' +
            (L.visible ? '\u25C9' : '\u25CB') + '</button>' +
            '<span class="layer-color" style="background:' + L.color + '"></span>' +
            '<span class="layer-name">' + L.name + '</span>' +
            '<span class="layer-text-preview">' + L.text.substring(0, 8) + '</span>' +
            '<div class="layer-actions">' +
            '<button class="layer-btn" data-move="' + i + '" data-dir="-1">\u2191</button>' +
            '<button class="layer-btn" data-move="' + i + '" data-dir="1">\u2193</button>' +
            '<button class="layer-btn danger" data-del="' + i + '">\u2715</button>' +
            '</div>';

        el.addEventListener('click', (e) => {
            if (e.target.closest('button')) return;
            selectLayer(i);
        });
        container.appendChild(el);
    }

    container.querySelectorAll('.layer-vis-btn').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); toggleLayerVisibility(parseInt(btn.dataset.idx)); });
    });
    container.querySelectorAll('[data-move]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); moveLayer(parseInt(btn.dataset.move), parseInt(btn.dataset.dir)); });
    });
    container.querySelectorAll('[data-del]').forEach(btn => {
        btn.addEventListener('click', e => { e.stopPropagation(); removeLayer(parseInt(btn.dataset.del)); });
    });
}

function loadLayerToUI(L) {
    if (!L) return;
    document.getElementById('activeLayerTitle').textContent = L.name.toUpperCase();
    document.getElementById('layerText').value = L.text;
    document.getElementById('layerFont').value = L.fontFamily;
    document.getElementById('layerBlendMode').value = L.blendMode;
    renderMorphStepCards(L);

    let sliders = {
        layerFontSize: ['layerFontSizeVal', L.fontSize],
        layerTileSize: ['layerTileSizeVal', L.tileSize],
        layerScaleX: ['layerScaleXVal', L.scaleX],
        layerLetterSpace: ['layerLetterSpaceVal', L.letterSpace],
        layerLineHeight: ['layerLineHeightVal', L.lineHeight],
        layerOffsetX: ['layerOffsetXVal', L.offsetX],
        layerOffsetY: ['layerOffsetYVal', L.offsetY],
        layerOpacity: ['layerOpacityVal', L.opacity],
        layerMorphDuration: ['layerMorphDurVal', L.morphDuration],
        layerMorphHold: ['layerMorphHoldVal', L.morphHold]
    };

    for (let [sid, [vid, val]] of Object.entries(sliders)) {
        let el = document.getElementById(sid);
        if (el) { el.value = val; }
        let vel = document.getElementById(vid);
        if (vel) { vel.textContent = val; }
    }

    document.querySelectorAll('.weight-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.weight === L.fontWeight);
    });
    document.querySelectorAll('.effect-btn').forEach(btn => {
        btn.classList.toggle('active', L.effects[btn.dataset.effect]);
    });
    document.querySelectorAll('.tilemode-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === L.tileMode);
    });
    document.querySelectorAll('.tileshape-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.shape === L.tileShape);
    });
}

// ── Event Bindings ──

// ═══════════════════════════════════
// Morph Step Cards (dynamic UI)
// ═══════════════════════════════════

function renderMorphStepCards(L) {
    let container = document.getElementById('morphStepList');
    container.innerHTML = '';
    let defs = L.morphStepDefs || [];

    for (let si = 0; si < defs.length; si++) {
        let def = defs[si];
        let card = document.createElement('div');
        card.className = 'morph-step-card';

        // Font options HTML
        let fontOpts = FONT_OPTIONS.map(f =>
            '<option value="' + f.value + '"' + (f.value === def.fontFamily ? ' selected' : '') + '>' + f.label + '</option>'
        ).join('');

        card.innerHTML =
            '<div class="step-header">' +
            '<span class="step-label">STEP ' + (si + 1) + '</span>' +
            '<button class="step-del-btn" data-si="' + si + '">\u2715</button>' +
            '</div>' +
            '<textarea rows="1" class="step-text" data-si="' + si + '" spellcheck="false">' + (def.text || '') + '</textarea>' +
            '<div class="step-row">' +
            '<div class="field"><select class="step-font" data-si="' + si + '">' + fontOpts + '</select></div>' +
            '<div class="field"><div class="toggle-group">' +
            '<button class="toggle-btn step-weight-btn' + (def.fontWeight === '400' ? ' active' : '') + '" data-si="' + si + '" data-w="400">Rg</button>' +
            '<button class="toggle-btn step-weight-btn' + (def.fontWeight === '700' ? ' active' : '') + '" data-si="' + si + '" data-w="700">Bd</button>' +
            '<button class="toggle-btn step-weight-btn' + (def.fontWeight === '900' ? ' active' : '') + '" data-si="' + si + '" data-w="900">Bk</button>' +
            '</div></div>' +
            '</div>';

        container.appendChild(card);
    }

    // Bind events on newly created elements
    container.querySelectorAll('.step-text').forEach(el => {
        el.addEventListener('input', () => {
            let L = activeLayer(); if (!L) return;
            L.morphStepDefs[parseInt(el.dataset.si)].text = el.value;
            debouncedGenerate(L);
        });
    });
    container.querySelectorAll('.step-font').forEach(el => {
        el.addEventListener('change', () => {
            let L = activeLayer(); if (!L) return;
            L.morphStepDefs[parseInt(el.dataset.si)].fontFamily = el.value;
            generateLayerTiles(L);
        });
    });
    container.querySelectorAll('.step-weight-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let L = activeLayer(); if (!L) return;
            let si = parseInt(btn.dataset.si);
            L.morphStepDefs[si].fontWeight = btn.dataset.w;
            // Update toggle UI within this step only
            btn.parentElement.querySelectorAll('.step-weight-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            generateLayerTiles(L);
        });
    });
    container.querySelectorAll('.step-del-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let L = activeLayer(); if (!L) return;
            let si = parseInt(btn.dataset.si);
            L.morphStepDefs.splice(si, 1);
            renderMorphStepCards(L);
            generateLayerTiles(L);
        });
    });
}

function addMorphStep() {
    let L = activeLayer(); if (!L) return;
    L.morphStepDefs.push({
        text: '',
        fontFamily: L.fontFamily,
        fontWeight: L.fontWeight
    });
    renderMorphStepCards(L);
}

function bindGlobalEvents() {
    document.getElementById('convertBtn').addEventListener('click', convertAll);
    document.getElementById('resizeBtn').addEventListener('click', updateCanvas);
    document.getElementById('saveBtn').addEventListener('click', saveImage);
    document.getElementById('saveTransBtn').addEventListener('click', saveTransparentImage);
    document.getElementById('exportVideoBtn').addEventListener('click', exportVideo);
    document.getElementById('previewBtn').addEventListener('click', enterFullscreen);
    document.getElementById('closeFullscreen').addEventListener('click', exitFullscreen);
    document.getElementById('imageInput').addEventListener('change', handleImage);
    document.getElementById('addLayerBtn').addEventListener('click', () => addLayer());
    document.getElementById('addMorphStepBtn').addEventListener('click', addMorphStep);

    document.getElementById('bgColor').addEventListener('input', markGradientDirty);
    document.getElementById('bgColor2').addEventListener('input', markGradientDirty);
    document.getElementById('gradAngle').addEventListener('input', () => {
        gradAngle = parseInt(document.getElementById('gradAngle').value);
        document.getElementById('gradAngleVal').textContent = gradAngle;
        markGradientDirty();
    });
    document.getElementById('noiseAmount').addEventListener('input', () => {
        noiseAmount = parseInt(document.getElementById('noiseAmount').value);
        document.getElementById('noiseAmountVal').textContent = noiseAmount;
        generateNoiseBuffer();
    });

    document.getElementById('gradNone').addEventListener('click', () => { gradientType = 'none'; updateGradBtns(); markGradientDirty(); });
    document.getElementById('gradLinear').addEventListener('click', () => { gradientType = 'linear'; updateGradBtns(); markGradientDirty(); });
    document.getElementById('gradRadial').addEventListener('click', () => { gradientType = 'radial'; updateGradBtns(); markGradientDirty(); });

    // Canvas presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('canvasW').value = btn.dataset.w;
            document.getElementById('canvasH').value = btn.dataset.h;
            updateCanvas();
        });
    });

    // Image filter sliders
    ['imgBrightness', 'imgBrightnessVal', 'imgContrast', 'imgContrastVal', 'imgSaturate', 'imgSaturateVal'].forEach((id, i) => {
        if (i % 2 === 1) return; // skip val ids
        let valId = ['imgBrightness', 'imgBrightnessVal', 'imgContrast', 'imgContrastVal', 'imgSaturate', 'imgSaturateVal'][i + 1];
        let el = document.getElementById(id);
        if (el) el.addEventListener('input', () => {
            let vel = document.getElementById(valId);
            if (vel) vel.textContent = el.value;
        });
    });

    document.querySelectorAll('.imgfilter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.imgfilter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    // Shortcut modal
    document.getElementById('shortcutHelpBtn').addEventListener('click', () => {
        document.getElementById('shortcutModal').classList.remove('hidden');
    });
    document.getElementById('closeShortcutModal').addEventListener('click', () => {
        document.getElementById('shortcutModal').classList.add('hidden');
    });
    document.getElementById('shortcutModal').addEventListener('click', (e) => {
        if (e.target.id === 'shortcutModal') document.getElementById('shortcutModal').classList.add('hidden');
    });
}

function bindLayerSettingsEvents() {
    document.getElementById('layerText').addEventListener('input', () => {
        let L = activeLayer(); if (!L) return;
        L.text = document.getElementById('layerText').value || 'A';
        debouncedGenerate(L);
        updateLayerListUI();
    });
    document.getElementById('layerFont').addEventListener('change', e => {
        let L = activeLayer(); if (!L) return;
        L.fontFamily = e.target.value;
        generateLayerTiles(L);
    });

    document.querySelectorAll('.weight-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let L = activeLayer(); if (!L) return;
            L.fontWeight = btn.dataset.weight;
            document.querySelectorAll('.weight-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            generateLayerTiles(L);
        });
    });

    // Export scale buttons
    document.querySelectorAll('.export-scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.export-scale-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    document.querySelectorAll('.tilemode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let L = activeLayer(); if (!L) return;
            L.tileMode = btn.dataset.mode;
            document.querySelectorAll('.tilemode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            generateLayerTiles(L);
            updateTileCountUI();
        });
    });

    document.querySelectorAll('.tileshape-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let L = activeLayer(); if (!L) return;
            L.tileShape = btn.dataset.shape;
            document.querySelectorAll('.tileshape-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

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
        ['layerMorphHold', 'layerMorphHoldVal', 'morphHold', false],
    ];

    for (let [sliderId, valId, prop, regen] of sliderBindings) {
        document.getElementById(sliderId).addEventListener('input', () => {
            let L = activeLayer(); if (!L) return;
            let v = parseFloat(document.getElementById(sliderId).value);
            L[prop] = v;
            document.getElementById(valId).textContent = v;
            if (regen) debouncedGenerate(L);
        });
    }

    document.getElementById('layerBlendMode').addEventListener('change', e => {
        let L = activeLayer(); if (L) L.blendMode = e.target.value;
    });

    document.querySelectorAll('.effect-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            let L = activeLayer(); if (!L) return;
            let fx = btn.dataset.effect;
            L.effects[fx] = !L.effects[fx];
            btn.classList.toggle('active', L.effects[fx]);
            if (fx === 'morph' && L.effects.morph) {
                L.morphProgress = 0;
                L.morphDirection = 1;
            }
            if (fx === 'scatter' && L.effects.scatter) {
                L.scatterProgress = 1;
                L.scatterDirection = -1;
                L._scatterOrigins = null;
            }
            if (fx === 'sequencer' && L.effects.sequencer) {
                L.sequencerProgress = 0;
            }
            if (fx === 'spring' && L.effects.spring) {
                // Initialize spring state for each tile
                L._springState = null;
            }
        });
    });
}

function updateGradBtns() {
    ['gradNone', 'gradLinear', 'gradRadial'].forEach(id => {
        document.getElementById(id).classList.remove('active');
    });
    if (gradientType === 'none') document.getElementById('gradNone').classList.add('active');
    else if (gradientType === 'linear') document.getElementById('gradLinear').classList.add('active');
    else if (gradientType === 'radial') document.getElementById('gradRadial').classList.add('active');
}

// ── Actions ──

function convertAll() {
    if (!fontReady) { updateStatus('폰트 로딩 중...', 'error'); return; }
    if (!img) { updateStatus('이미지를 먼저 선택하세요', 'error'); return; }
    let total = 0;
    for (let L of layers) {
        generateLayerTiles(L);
        total += L.tiles1.length;
    }
    offset = createVector(0, 0);
    zoom = 1.0;
    updateStatus('총 ' + total + '개 타일 (' + layers.length + '개 레이어)', 'success');
    updateTileCountUI();
}

function handleImage(e) {
    if (e.target.files.length === 0) return;
    let file = e.target.files[0];
    // Validate
    if (file.size > 50 * 1024 * 1024) { updateStatus('50MB 이하 이미지만 지원', 'error'); return; }
    let url = URL.createObjectURL(file);
    updateStatus('이미지 로딩...');
    img = loadImage(url,
        () => {
            _imgPixelsLoaded = false; // invalidate pixel cache for new image
            updateStatus('이미지 준비 완료 → CONVERT', 'success');
            URL.revokeObjectURL(url);
        },
        () => updateStatus('이미지 로드 실패', 'error'));
}

function updateCanvas() {
    let w = constrain(parseInt(document.getElementById('canvasW').value) || 360, 100, 3840);
    let h = constrain(parseInt(document.getElementById('canvasH').value) || 400, 100, 2160);
    document.getElementById('canvasW').value = w;
    document.getElementById('canvasH').value = h;
    resizeCanvas(w, h);
    for (let L of layers) { L.tiles1 = []; L.tiles2 = []; L.currentTiles = []; }
    offset = createVector(0, 0);
    zoom = 1.0;
    generateNoiseBuffer();
    markGradientDirty();
    updateCanvasInfoUI();
    updateStatus('캔버스: ' + w + ' × ' + h);
}

function updateCanvasInfoUI() {
    let el = document.getElementById('canvasInfoText');
    if (el) el.textContent = width + ' × ' + height;
}

function updateTileCountUI() {
    let el = document.getElementById('tileCount');
    if (!el) return;
    let total = 0;
    for (let L of layers) total += L.currentTiles.length;
    el.textContent = total > 0 ? total + ' tiles' : '';
}

function updateStatus(msg, type) {
    let el = document.getElementById('info-text');
    el.textContent = msg;
    el.className = 'status-msg' + (type ? ' ' + type : '');
}

// ── Fullscreen ──

function enterFullscreen() {
    let fsView = document.getElementById('fullscreen-view');
    let fsHolder = document.getElementById('fullscreen-canvas-holder');
    let cnv = document.querySelector('#canvas-wrap canvas');
    if (cnv) fsHolder.appendChild(cnv);
    fsView.classList.remove('hidden');
}

function exitFullscreen() {
    let fsView = document.getElementById('fullscreen-view');
    let wrap = document.getElementById('canvas-wrap');
    let cnv = document.querySelector('#fullscreen-canvas-holder canvas');
    if (cnv) wrap.appendChild(cnv);
    fsView.classList.add('hidden');
    offset = createVector(0, 0);
    zoom = 1.0;
}

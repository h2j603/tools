/* ═══════════════════════════════════
   Text Point Extraction Engine v3.1
   Precision-focused with 3 modes
   ═══════════════════════════════════ */

function extractTextPoints(txt, L) {
    let lines = txt.split('\n').filter(l => l.trim() !== '');
    if (lines.length === 0) return [];

    let fontSize = min(width, height) * (L.fontSize / 100);
    let tilePx = max(2, min(width, height) * (L.tileSize / 100) * 0.55);

    // Offscreen canvas for text rendering
    let offCanvas = document.createElement('canvas');
    offCanvas.width = width;
    offCanvas.height = height;
    let ctx = offCanvas.getContext('2d', { willReadFrequently: true });
    ctx.clearRect(0, 0, width, height);

    let fontStr = L.fontWeight + ' ' + fontSize + 'px ' + L.fontFamily;
    ctx.font = fontStr;
    ctx.fillStyle = '#ffffff';
    ctx.textBaseline = 'alphabetic';

    let lineHeightPx = fontSize * (L.lineHeight / 100);
    let totalH = lines.length * lineHeightPx;
    let startY = (height - totalH) / 2 + fontSize * 0.8;
    let scaleXR = L.scaleX / 100;

    // Draw each line character by character
    for (let li = 0; li < lines.length; li++) {
        let lineTxt = lines[li];
        let y = startY + li * lineHeightPx;

        let totalW = 0;
        for (let c = 0; c < lineTxt.length; c++) {
            totalW += ctx.measureText(lineTxt[c]).width * scaleXR;
            if (c < lineTxt.length - 1) totalW += L.letterSpace;
        }

        let cx = (width - totalW) / 2;
        for (let c = 0; c < lineTxt.length; c++) {
            let ch = lineTxt[c];
            let charW = ctx.measureText(ch).width;
            ctx.save();
            ctx.translate(cx, y);
            ctx.scale(scaleXR, 1);
            ctx.fillText(ch, 0, 0);
            ctx.restore();
            cx += charW * scaleXR + L.letterSpace;
        }
    }

    // Read pixel data
    let imageData = ctx.getImageData(0, 0, width, height);
    let px = imageData.data;

    if (L.tileMode === 'outline') return extractOutlinePoints(px, width, height, tilePx);
    if (L.tileMode === 'density') return extractDensityPoints(px, width, height, tilePx);
    return extractFillPoints(px, width, height, tilePx);
}

// ── FILL mode: organic staggered layout with size variation ──
// Hex-offset rows + jitter + per-tile random size for natural mosaic feel
function extractFillPoints(px, w, h, tilePx) {
    let points = [];
    let step = tilePx;
    let halfStep = step * 0.5;
    let rowIdx = 0;

    for (let y = 0; y < h; y += step * 0.85) { // tighter vertical packing
        // Hex offset: odd rows shift right by half step
        let rowOffset = (rowIdx % 2) * halfStep * 0.6;
        rowIdx++;

        for (let x = 0; x < w; x += step) {
            let sx = floor(x + halfStep + rowOffset);
            let sy = floor(y + halfStep);
            if (sx >= w || sy >= h || sx < 0) continue;

            let idx = (sy * w + sx) * 4;
            if (px[idx + 3] > 100) {
                // Moderate jitter (25-30%) for organic feel while keeping text readable
                let jitter = step * 0.28;
                // Per-tile size variation (0.6x ~ 1.4x)
                let sizeVar = 0.7 + random(0.6);
                points.push({
                    x: x + halfStep + rowOffset + random(-jitter, jitter),
                    y: y + halfStep + random(-jitter, jitter),
                    index: points.length,
                    size: sizeVar
                });
            }
        }
    }
    return points;
}

// ── OUTLINE mode: Sobel-like edge detection ──
function extractOutlinePoints(px, w, h, tilePx) {
    let points = [];
    let step = max(3, floor(tilePx * 0.7));
    // Sobel sample offset: at least 1px, scales with step for large tiles
    let sOff = max(1, floor(step * 0.4));

    for (let y = sOff; y < h - sOff; y += step) {
        for (let x = sOff; x < w - sOff; x += step) {
            // Sobel gradient using scaled offset for consistent detection
            let aL  = px[(y * w + (x - sOff)) * 4 + 3] || 0;
            let aR  = px[(y * w + (x + sOff)) * 4 + 3] || 0;
            let aU  = px[((y - sOff) * w + x) * 4 + 3] || 0;
            let aD  = px[((y + sOff) * w + x) * 4 + 3] || 0;
            let aUL = px[((y - sOff) * w + (x - sOff)) * 4 + 3] || 0;
            let aUR = px[((y - sOff) * w + (x + sOff)) * 4 + 3] || 0;
            let aDL = px[((y + sOff) * w + (x - sOff)) * 4 + 3] || 0;
            let aDR = px[((y + sOff) * w + (x + sOff)) * 4 + 3] || 0;

            let gx = (-aUL + aUR - 2 * aL + 2 * aR - aDL + aDR);
            let gy = (-aUL - 2 * aU - aUR + aDL + 2 * aD + aDR);
            let mag = sqrt(gx * gx + gy * gy);

            if (mag > 150) {
                let jitter = step * 0.25;
                points.push({
                    x: x + random(-jitter, jitter),
                    y: y + random(-jitter, jitter),
                    index: points.length,
                    size: 0.6 + random(0.8)
                });
            }
        }
    }
    return points;
}

// ── DENSITY mode: image brightness modulates tile density ──
function extractDensityPoints(px, w, h, tilePx) {
    // Ensure image pixels are loaded for brightness sampling
    if (img && (!img.pixels || img.pixels.length === 0)) {
        img.loadPixels();
    }
    let points = [];
    let baseStep = tilePx;

    // Two-pass: first regular grid, then subdivide bright areas
    for (let y = 0; y < h; y += baseStep) {
        for (let x = 0; x < w; x += baseStep) {
            let sx = floor(min(x + baseStep * 0.5, w - 1));
            let sy = floor(min(y + baseStep * 0.5, h - 1));
            let idx = (sy * w + sx) * 4;

            if (px[idx + 3] > 100) {
                // Get image brightness at this position
                let brightness = 0.5;
                if (img && img.pixels && img.pixels.length > 0) {
                    let ix = constrain(floor(sx / w * img.width), 0, img.width - 1);
                    let iy = constrain(floor(sy / h * img.height), 0, img.height - 1);
                    let pidx = (iy * img.width + ix) * 4;
                    brightness = (img.pixels[pidx] + img.pixels[pidx+1] + img.pixels[pidx+2]) / (3 * 255);
                }

                // Subdivide: brighter areas get 2x2 sub-tiles
                if (brightness > 0.6) {
                    let subStep = baseStep * 0.5;
                    for (let sy2 = 0; sy2 < 2; sy2++) {
                        for (let sx2 = 0; sx2 < 2; sx2++) {
                            let px2 = x + sx2 * subStep + subStep * 0.5;
                            let py2 = y + sy2 * subStep + subStep * 0.5;
                            let jitter = subStep * 0.1;
                            points.push({
                                x: px2 + random(-jitter, jitter),
                                y: py2 + random(-jitter, jitter),
                                index: points.length,
                                size: lerp(0.4, 0.7, brightness)
                            });
                        }
                    }
                } else {
                    let jitter = baseStep * 0.1;
                    points.push({
                        x: x + baseStep * 0.5 + random(-jitter, jitter),
                        y: y + baseStep * 0.5 + random(-jitter, jitter),
                        index: points.length,
                        size: lerp(0.8, 1.4, 1 - brightness)
                    });
                }
            }
        }
    }
    return points;
}

function normalizeToCenter(arr) {
    if (arr.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (let t of arr) {
        if (t.x < minX) minX = t.x;
        if (t.x > maxX) maxX = t.x;
        if (t.y < minY) minY = t.y;
        if (t.y > maxY) maxY = t.y;
    }
    let ox = width / 2 - (minX + maxX) / 2;
    let oy = height / 2 - (minY + maxY) / 2;
    for (let t of arr) { t.x += ox; t.y += oy; }
}

function generateLayerTiles(L) {
    if (!fontReady) return;

    // Step 0: main text with layer font
    randomSeed(L.id * 1000 + 42);
    L.tiles1 = extractTextPoints(L.text, L);
    normalizeToCenter(L.tiles1);

    // Steps 1..N: each morphStepDef has its own text/font/weight
    L.morphSteps = [L.tiles1];
    let defs = L.morphStepDefs || [];
    for (let si = 0; si < defs.length; si++) {
        let def = defs[si];
        let stepSettings = Object.create(L);
        stepSettings.fontFamily = def.fontFamily || L.fontFamily;
        stepSettings.fontWeight = def.fontWeight || L.fontWeight;
        randomSeed(L.id * 1000 + 99 + si * 50);
        let stepTiles = extractTextPoints(def.text || 'B', stepSettings);
        normalizeToCenter(stepTiles);
        L.morphSteps.push(stepTiles);
    }

    L.tiles2 = L.morphSteps.length > 1 ? L.morphSteps[1] : L.tiles1;

    L.currentTiles = L.tiles1.map(t => ({ ...t }));
    L.morphProgress = 0;
    L.morphDirection = 1;
    L.morphStepIdx = 0;
    L.morphHolding = false;
    L.morphHoldTimer = 0;
    L._nearestMap = null;
    L._morphPairs = null;
    L._voronoiCells = null;
    L._scatterOrigins = null;
    L._seqRank = null;
    L._springState = null;
    randomSeed(millis());
}

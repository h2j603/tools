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

// ── FILL mode: precise grid-aligned sampling ──
// Key improvement: minimal jitter to preserve text shape
function extractFillPoints(px, w, h, tilePx) {
    let points = [];
    let step = tilePx;
    let halfStep = step * 0.5;

    for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
            // Sample center of each tile cell
            let sx = floor(x + halfStep);
            let sy = floor(y + halfStep);
            if (sx >= w || sy >= h) continue;

            let idx = (sy * w + sx) * 4;
            if (px[idx + 3] > 100) {
                // Tiny jitter (10-15% of step) to avoid mechanical grid look
                // but preserve text shape accuracy
                let jitter = step * 0.12;
                points.push({
                    x: x + halfStep + random(-jitter, jitter),
                    y: y + halfStep + random(-jitter, jitter),
                    index: points.length
                });
            }
        }
    }
    return points;
}

// ── OUTLINE mode: Sobel-like edge detection ──
function extractOutlinePoints(px, w, h, tilePx) {
    let points = [];
    let step = max(2, floor(tilePx * 0.6));

    for (let y = 1; y < h - 1; y += step) {
        for (let x = 1; x < w - 1; x += step) {
            // Sobel gradient approximation
            let aL  = px[(y * w + (x - 1)) * 4 + 3];
            let aR  = px[(y * w + (x + 1)) * 4 + 3];
            let aU  = px[((y - 1) * w + x) * 4 + 3];
            let aD  = px[((y + 1) * w + x) * 4 + 3];
            let aUL = px[((y - 1) * w + (x - 1)) * 4 + 3];
            let aUR = px[((y - 1) * w + (x + 1)) * 4 + 3];
            let aDL = px[((y + 1) * w + (x - 1)) * 4 + 3];
            let aDR = px[((y + 1) * w + (x + 1)) * 4 + 3];

            let gx = (-aUL + aUR - 2 * aL + 2 * aR - aDL + aDR);
            let gy = (-aUL - 2 * aU - aUR + aDL + 2 * aD + aDR);
            let mag = sqrt(gx * gx + gy * gy);

            if (mag > 200) {
                let jitter = step * 0.08;
                points.push({
                    x: x + random(-jitter, jitter),
                    y: y + random(-jitter, jitter),
                    index: points.length
                });
            }
        }
    }
    return points;
}

// ── DENSITY mode: image brightness modulates tile density ──
function extractDensityPoints(px, w, h, tilePx) {
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
                if (img) {
                    let ix = constrain(floor(map(sx, 0, w, 0, img.width)), 0, img.width - 1);
                    let iy = constrain(floor(map(sy, 0, h, 0, img.height)), 0, img.height - 1);
                    let c = img.get(ix, iy);
                    brightness = (red(c) + green(c) + blue(c)) / (3 * 255);
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
    randomSeed(L.id * 1000 + 42);
    L.tiles1 = extractTextPoints(L.text, L);
    randomSeed(L.id * 1000 + 99);
    L.tiles2 = extractTextPoints(L.morphText, L);
    normalizeToCenter(L.tiles1);
    normalizeToCenter(L.tiles2);
    L.currentTiles = L.tiles1.map(t => ({ ...t }));
    L.morphProgress = 0;
    L.morphDirection = 1;
    L._nearestMap = null; // invalidate morph cache
    randomSeed(millis());
}

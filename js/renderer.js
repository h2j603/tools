/* ═══════════════════════════════════
   Renderer v3.2
   Background, Tiles, Effects, 3D
   ═══════════════════════════════════ */

let gradientBuffer = null;
let gradientDirty = true;

// ── Background ──

// Cache DOM elements (queried once, not every frame)
let _bgColorEl, _bgColor2El;
function getBgColorEls() {
    if (!_bgColorEl) _bgColorEl = document.getElementById('bgColor');
    if (!_bgColor2El) _bgColor2El = document.getElementById('bgColor2');
}

function drawBackground() {
    getBgColorEls();
    let c1 = color(_bgColorEl.value);
    let c2 = color(_bgColor2El.value);

    if (gradientType === 'none') {
        background(c1);
    } else {
        if (gradientDirty || !gradientBuffer || gradientBuffer.width !== width) {
            // Clean up old buffer to prevent memory leak
            if (gradientBuffer) gradientBuffer.remove();
            gradientBuffer = createGraphics(width, height);
            if (gradientType === 'linear') renderLinearGradient(gradientBuffer, c1, c2);
            else renderRadialGradient(gradientBuffer, c1, c2);
            gradientDirty = false;
        }
        image(gradientBuffer, 0, 0);
    }

    if (noiseAmount > 0 && noiseBuffer) {
        push();
        blendMode(ADD);
        tint(255, noiseAmount * 2.55);
        image(noiseBuffer, 0, 0);
        pop();
    }
}

function renderLinearGradient(g, c1, c2) {
    g.push(); g.noFill();
    let ar = radians(gradAngle);
    let cx = g.width / 2, cy = g.height / 2;
    let diag = sqrt(g.width * g.width + g.height * g.height);
    for (let i = 0; i <= diag; i++) {
        g.stroke(lerpColor(c1, c2, i / diag));
        let px = cos(ar + HALF_PI) * diag;
        let py = sin(ar + HALF_PI) * diag;
        let ox = cos(ar) * (i - diag / 2);
        let oy = sin(ar) * (i - diag / 2);
        g.line(cx + px + ox, cy + py + oy, cx - px + ox, cy - py + oy);
    }
    g.pop();
}

function renderRadialGradient(g, c1, c2) {
    g.push(); g.noStroke();
    let maxR = sqrt(g.width * g.width + g.height * g.height) / 2;
    for (let r = maxR; r > 0; r -= 2) {
        g.fill(lerpColor(c1, c2, 1 - r / maxR));
        g.ellipse(g.width / 2, g.height / 2, r * 2, r * 2);
    }
    g.pop();
}

function generateNoiseBuffer() {
    if (noiseBuffer) noiseBuffer.remove();
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

function markGradientDirty() { gradientDirty = true; }

// ═══════════════════════════════════
// Draw Layers
// ═══════════════════════════════════

function drawLayers(frameNum) {
    ensureImagePixels();
    for (let i = 0; i < layers.length; i++) {
        let L = layers[i];
        if (!L.visible || L.currentTiles.length === 0) continue;

        // Morph update
        if (L.effects.morph && L.tiles1.length > 0 && L.tiles2.length > 0) {
            let ppf = 1 / (L.morphDuration * 60);
            L.morphProgress += L.morphDirection * ppf;
            if (L.morphProgress >= 1) { L.morphProgress = 1; L.morphDirection = -1; }
            else if (L.morphProgress <= 0) { L.morphProgress = 0; L.morphDirection = 1; }
            updateMorphedTiles(L);
        } else if (!L.effects.morph && L.tiles1.length > 0) {
            L.currentTiles = L.tiles1;
        }

        // Scatter (photo particle rebuild) update
        if (L.effects.scatter) {
            let spd = 1 / (L.morphDuration * 60);
            L.scatterProgress += L.scatterDirection * spd;
            if (L.scatterProgress >= 1) { L.scatterProgress = 1; L.scatterDirection = -1; }
            else if (L.scatterProgress <= 0) { L.scatterProgress = 0; L.scatterDirection = 1; }
        }

        push();
        drawingContext.globalAlpha = L.opacity / 100;
        drawingContext.globalCompositeOperation = L.blendMode;
        translate(L.offsetX, L.offsetY);

        // Store current layer offset for color sampling
        _currentLayerOffsetX = L.offsetX;
        _currentLayerOffsetY = L.offsetY;

        if (L.effects.web) drawWebLines(L);

        if (L.effects.rotate3d) {
            draw3DRotatedTiles(L, frameNum);
        } else {
            drawTiles(L, frameNum);
        }

        pop();
    }
}

// Current layer offset (for correct color sampling)
let _currentLayerOffsetX = 0;
let _currentLayerOffsetY = 0;

// ═══════════════════════════════════
// Morph — Spatial-sorted matching
// ═══════════════════════════════════

// Build spatial match: sort both sets by position, then 1:1 pair
// This ensures nearby tiles morph to nearby tiles (no criss-crossing)
function buildSpatialMorphMap(tiles1, tiles2) {
    let len1 = tiles1.length;
    let len2 = tiles2.length;
    let maxLen = max(len1, len2);

    // Create index arrays sorted by spatial position (Hilbert-like: y-band then x)
    let bandH = height / max(1, ceil(sqrt(maxLen)));

    let sorted1 = tiles1.map((t, i) => i);
    sorted1.sort((a, b) => {
        let bandA = floor(tiles1[a].y / bandH);
        let bandB = floor(tiles1[b].y / bandH);
        if (bandA !== bandB) return bandA - bandB;
        return (bandA % 2 === 0)
            ? tiles1[a].x - tiles1[b].x   // left-to-right
            : tiles1[b].x - tiles1[a].x;  // right-to-left (snake)
    });

    let sorted2 = tiles2.map((t, i) => i);
    sorted2.sort((a, b) => {
        let bandA = floor(tiles2[a].y / bandH);
        let bandB = floor(tiles2[b].y / bandH);
        if (bandA !== bandB) return bandA - bandB;
        return (bandA % 2 === 0)
            ? tiles2[a].x - tiles2[b].x
            : tiles2[b].x - tiles2[a].x;
    });

    // Build pair mapping: matchFrom[i] = index in tiles2 that sorted1[i] pairs with
    // For overlapping count: direct 1:1 by sorted position
    // For extras: find nearest in the other set
    let pairs = []; // { idx1, idx2 } — idx1 into tiles1, idx2 into tiles2

    let minLen = min(len1, len2);
    for (let i = 0; i < minLen; i++) {
        pairs.push({ idx1: sorted1[i], idx2: sorted2[i] });
    }

    // Extra tiles: pair with nearest from the other set
    if (len1 > len2) {
        for (let i = minLen; i < len1; i++) {
            let src = tiles1[sorted1[i]];
            let nearest = findNearestIdx(src, tiles2);
            pairs.push({ idx1: sorted1[i], idx2: nearest, extra: 'from1' });
        }
    } else if (len2 > len1) {
        for (let i = minLen; i < len2; i++) {
            let src = tiles2[sorted2[i]];
            let nearest = findNearestIdx(src, tiles1);
            pairs.push({ idx1: nearest, idx2: sorted2[i], extra: 'from2' });
        }
    }

    return pairs;
}

function findNearestIdx(tile, targets) {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < targets.length; i++) {
        let dx = targets[i].x - tile.x;
        let dy = targets[i].y - tile.y;
        let d = dx * dx + dy * dy;
        if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
}

function updateMorphedTiles(L) {
    let len1 = L.tiles1.length;
    let len2 = L.tiles2.length;
    if (len1 === 0 && len2 === 0) return;

    // Build spatial morph map once (cached until tiles regenerated)
    if (!L._morphPairs) {
        L._morphPairs = buildSpatialMorphMap(L.tiles1, L.tiles2);
    }

    L.currentTiles = [];
    let t = L.morphProgress;
    let eased = t * t * (3 - 2 * t);

    for (let pi = 0; pi < L._morphPairs.length; pi++) {
        let pair = L._morphPairs[pi];
        let t1 = L.tiles1[pair.idx1];
        let t2 = L.tiles2[pair.idx2];
        if (!t1 || !t2) continue;

        let mx = lerp(t1.x, t2.x, eased);
        let my = lerp(t1.y, t2.y, eased);

        // Smooth arc
        let curve = sin(eased * PI) * 12;
        let angle = atan2(t2.y - t1.y, t2.x - t1.x) + HALF_PI;
        mx += cos(angle) * curve * sin(PI * 0.1);
        my += sin(angle) * curve * sin(PI * 0.1);

        // Extra tiles scale smoothly
        let sizeScale = 1;
        if (pair.extra === 'from2') sizeScale = eased;
        else if (pair.extra === 'from1') sizeScale = 1 - eased;

        L.currentTiles.push({
            x: mx, y: my, index: pi,
            size: (lerp(t1.size || 1, t2.size || 1, eased)) * sizeScale,
            alpha: max(0.05, sizeScale)
        });
    }
}

// ═══════════════════════════════════
// Web Lines
// ═══════════════════════════════════

function drawWebLines(L) {
    strokeWeight(0.6);
    let maxDist = min(width, height) * 0.08;
    let tiles = L.currentTiles;

    for (let i = 0; i < tiles.length; i++) {
        let t1 = tiles[i];
        let conn = 0;
        for (let j = i + 1; j < tiles.length && conn < 3; j++) {
            let t2 = tiles[j];
            let dx = t1.x - t2.x, dy = t1.y - t2.y;
            let d = sqrt(dx * dx + dy * dy);
            if (d < maxDist) {
                let c = getImageColor((t1.x + t2.x) / 2, (t1.y + t2.y) / 2);
                let a = map(d, 0, maxDist, 180, 20);
                stroke(red(c), green(c), blue(c), a);
                line(t1.x, t1.y, t2.x, t2.y);
                conn++;
            }
        }
    }
}

// ═══════════════════════════════════
// Standard Tile Drawing
// ═══════════════════════════════════

function drawTiles(L, frameNum) {
    let baseSz = min(width, height) * (L.tileSize / 100);
    let tiles = L.currentTiles;
    let fn = frameNum || frameCount;
    let shape = L.tileShape || 'rect';

    // Pre-extract char array for 'char' shape
    let charSource = (L.text || 'A').replace(/\s/g, '');
    if (charSource.length === 0) charSource = 'A';

    // Scatter: compute scatter origins (regenerate if tile count changed)
    let scatterActive = L.effects.scatter && L.scatterProgress > 0.001;
    if (scatterActive && (!L._scatterOrigins || L._scatterOrigins.length !== tiles.length)) {
        L._scatterOrigins = [];
        for (let i = 0; i < tiles.length; i++) {
            let angle = ((i * 137.508) % 360) * (PI / 180);
            let dist = min(width, height) * (0.8 + ((i * 73) % 100) / 100 * 0.7);
            L._scatterOrigins.push({
                x: width / 2 + cos(angle) * dist,
                y: height / 2 + sin(angle) * dist
            });
        }
    }

    noStroke();
    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        let sz = baseSz * (t.size || 1);

        if (L.effects.pulse) {
            sz *= sin(fn * 0.05 + i * 0.3) * 0.3 + 1;
        }

        let tileAlpha = t.alpha !== undefined ? t.alpha : 1;

        push();

        // Scatter: interpolate between scatter origin and home position
        if (scatterActive && L._scatterOrigins && i < L._scatterOrigins.length) {
            let sp = L.scatterProgress;
            let eased = sp * sp * (3 - 2 * sp);
            let orig = L._scatterOrigins[i];
            let stagger = (i / tiles.length) * 0.4;
            let localT = constrain((eased - stagger) / (1 - stagger), 0, 1);
            let lx = lerp(t.x, orig.x, localT);
            let ly = lerp(t.y, orig.y, localT);
            translate(lx, ly);
            let scaleF = lerp(1, 0.3, localT);
            scale(scaleF); // scale BEFORE rotate
            rotate(localT * (((i % 2) * 2) - 1) * PI * 1.5);
        } else {
            translate(t.x, t.y);
        }

        if (L.effects.wave) {
            translate(sin(fn * 0.03 + t.x * 0.008) * 8, cos(fn * 0.025 + t.y * 0.008) * 6);
        }

        if (L.effects.vortex) {
            let dx = t.x - width / 2;
            let dy = t.y - height / 2;
            let dist = sqrt(dx * dx + dy * dy);
            let ang = fn * 0.01 + dist * 0.005;
            let r = sin(fn * 0.02) * min(dist * 0.08, 20);
            translate(cos(ang) * r, sin(ang) * r);
        }

        if (L.effects.rotate) {
            randomSeed(i);
            rotate(random(-0.4, 0.4));
        }

        if (tileAlpha < 1) drawingContext.globalAlpha *= tileAlpha;

        let c = getImageColor(t.x, t.y);

        // Voronoi is drawn as a batch after the loop, skip individual tiles here
        if (shape === 'voronoi') {
            pop();
            continue;
        }

        switch (shape) {
            case 'circle': drawTileCircle(sz, c); break;
            case 'char': drawTileChar(sz, c, charSource, i, L); break;
            case 'adaptive': drawTileAdaptive(sz, c, t); break;
            case 'cross': drawTileCross(sz, c); break;
            default: drawTileRect(sz, c); break;
        }

        pop();
    }

    // Voronoi: draw all cells as a batch
    if (shape === 'voronoi' && tiles.length > 0) {
        drawVoronoiTiles(L, tiles, baseSz, fn);
    }
}

// ── Tile Shape: Rect (default) ──
function drawTileRect(sz, c) {
    if (img) {
        image(img, -sz / 2, -sz / 2, sz, sz);
    } else {
        fill(c);
        rect(-sz / 2, -sz / 2, sz, sz);
    }
}

// ── Tile Shape: Circle (halftone) ──
function drawTileCircle(sz, c) {
    if (img) {
        // Clip image to circle using drawingContext
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.arc(0, 0, sz / 2, 0, TWO_PI);
        drawingContext.clip();
        image(img, -sz / 2, -sz / 2, sz, sz);
        drawingContext.restore();
    } else {
        fill(c);
        ellipse(0, 0, sz, sz);
    }
}

// ── Tile Shape: Character ──
// Each tile draws one character from the source text, colored by image
function drawTileChar(sz, c, charSource, idx, L) {
    let ch = charSource[idx % charSource.length];
    let fontSize = sz * 1.1;

    drawingContext.fillStyle = 'rgb(' + red(c) + ',' + green(c) + ',' + blue(c) + ')';
    drawingContext.font = L.fontWeight + ' ' + fontSize + 'px ' + L.fontFamily;
    drawingContext.textAlign = 'center';
    drawingContext.textBaseline = 'middle';
    drawingContext.fillText(ch, 0, 0);
}

// ── Tile Shape: Adaptive ──
// Bright areas → circle, dark areas → rect, mid → rounded rect
// Size also varies with brightness
function drawTileAdaptive(sz, c, t) {
    let brightness = (red(c) + green(c) + blue(c)) / (3 * 255);

    // Size varies: brighter = smaller (like halftone inversion)
    let adaptSz = sz * lerp(1.3, 0.6, brightness);

    if (img) {
        if (brightness > 0.65) {
            // Bright: circle
            drawingContext.save();
            drawingContext.beginPath();
            drawingContext.arc(0, 0, adaptSz / 2, 0, TWO_PI);
            drawingContext.clip();
            image(img, -adaptSz / 2, -adaptSz / 2, adaptSz, adaptSz);
            drawingContext.restore();
        } else if (brightness > 0.35) {
            // Mid: rounded rect
            drawingContext.save();
            let r = adaptSz * 0.3;
            drawingContext.beginPath();
            drawingContext.roundRect(-adaptSz / 2, -adaptSz / 2, adaptSz, adaptSz, r);
            drawingContext.clip();
            image(img, -adaptSz / 2, -adaptSz / 2, adaptSz, adaptSz);
            drawingContext.restore();
        } else {
            // Dark: full rect, larger
            image(img, -adaptSz / 2, -adaptSz / 2, adaptSz, adaptSz);
        }
    } else {
        fill(c);
        if (brightness > 0.65) ellipse(0, 0, adaptSz, adaptSz);
        else if (brightness > 0.35) rect(-adaptSz / 2, -adaptSz / 2, adaptSz, adaptSz, adaptSz * 0.3);
        else rect(-adaptSz / 2, -adaptSz / 2, adaptSz, adaptSz);
    }
}

// ── Tile Shape: Cross (+) ──
function drawTileCross(sz, c) {
    let arm = sz * 0.3;  // arm thickness
    let half = sz / 2;

    if (img) {
        // Clip image to cross shape
        drawingContext.save();
        drawingContext.beginPath();
        // Vertical arm
        drawingContext.rect(-arm / 2, -half, arm, sz);
        // Horizontal arm
        drawingContext.rect(-half, -arm / 2, sz, arm);
        drawingContext.clip();
        image(img, -half, -half, sz, sz);
        drawingContext.restore();
    } else {
        fill(c);
        rect(-arm / 2, -half, arm, sz);
        rect(-half, -arm / 2, sz, arm);
    }
}

// ═══════════════════════════════════
// Voronoi Tile Shape
// Each tile becomes an irregular polygon cell
// Computed via nearest-neighbor Voronoi from tile positions
// ═══════════════════════════════════

function drawVoronoiTiles(L, tiles, baseSz, frameNum) {
    // Build Voronoi cell polygons (cached)
    if (!L._voronoiCells || L._voronoiCells.length !== tiles.length) {
        L._voronoiCells = computeVoronoiCells(tiles, width, height);
    }

    let fn = frameNum || frameCount;

    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        let cell = L._voronoiCells[i];
        if (!cell || cell.length < 3) continue;

        let tileAlpha = t.alpha !== undefined ? t.alpha : 1;
        let c = getImageColor(t.x, t.y);

        push();

        // Apply effects to cell center
        let ox = 0, oy = 0;
        if (L.effects.wave) {
            ox = sin(fn * 0.03 + t.x * 0.008) * 8;
            oy = cos(fn * 0.025 + t.y * 0.008) * 6;
        }
        if (L.effects.vortex) {
            let dx = t.x - width / 2;
            let dy = t.y - height / 2;
            let dist = sqrt(dx * dx + dy * dy);
            let ang = fn * 0.01 + dist * 0.005;
            let r = sin(fn * 0.02) * min(dist * 0.08, 20);
            ox += cos(ang) * r;
            oy += sin(ang) * r;
        }

        if (tileAlpha < 1) drawingContext.globalAlpha = (L.opacity / 100) * tileAlpha;

        // Draw the Voronoi cell as a clipped polygon
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.moveTo(cell[0].x + ox, cell[0].y + oy);
        for (let j = 1; j < cell.length; j++) {
            drawingContext.lineTo(cell[j].x + ox, cell[j].y + oy);
        }
        drawingContext.closePath();

        if (img) {
            drawingContext.clip();
            // Draw image for the cell bounding area
            let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
            for (let p of cell) {
                if (p.x < minX) minX = p.x;
                if (p.x > maxX) maxX = p.x;
                if (p.y < minY) minY = p.y;
                if (p.y > maxY) maxY = p.y;
            }
            minX += ox; maxX += ox; minY += oy; maxY += oy;
            // Map cell bounds to image
            let iw = img.width, ih = img.height;
            let sx = (minX / width) * iw;
            let sy = (minY / height) * ih;
            let sw = ((maxX - minX) / width) * iw;
            let sh = ((maxY - minY) / height) * ih;
            drawingContext.drawImage(img.canvas || img.elt, sx, sy, sw, sh, minX, minY, maxX - minX, maxY - minY);
        } else {
            drawingContext.fillStyle = 'rgb(' + red(c) + ',' + green(c) + ',' + blue(c) + ')';
            drawingContext.fill();
        }

        // Optional: draw cell border
        drawingContext.strokeStyle = 'rgba(255,255,255,0.06)';
        drawingContext.lineWidth = 0.5;
        drawingContext.stroke();

        drawingContext.restore();
        pop();
    }
}

// Compute approximate Voronoi cells using nearest-neighbor scan
// For each tile point, find the polygon formed by midpoints to neighbors
function computeVoronoiCells(tiles, w, h) {
    let cells = [];
    let n = tiles.length;

    // For performance: use a simpler approach
    // Sample boundary points and assign to nearest tile
    // Then compute convex hull of assigned points per tile

    // Faster approach: for each tile, find nearby tiles and compute
    // perpendicular bisector intersections to form the cell polygon
    for (let i = 0; i < n; i++) {
        let t = tiles[i];

        // Find nearest neighbors (limit to closest ~8 for performance)
        let neighbors = [];
        for (let j = 0; j < n; j++) {
            if (i === j) continue;
            let dx = tiles[j].x - t.x;
            let dy = tiles[j].y - t.y;
            neighbors.push({ idx: j, dist: dx * dx + dy * dy, dx: dx, dy: dy });
        }
        neighbors.sort((a, b) => a.dist - b.dist);
        neighbors = neighbors.slice(0, min(12, neighbors.length));

        // Create cell polygon by intersecting half-planes
        // Start with a large bounding rect, clip by each bisector
        let poly = [
            { x: max(0, t.x - w * 0.5), y: max(0, t.y - h * 0.5) },
            { x: min(w, t.x + w * 0.5), y: max(0, t.y - h * 0.5) },
            { x: min(w, t.x + w * 0.5), y: min(h, t.y + h * 0.5) },
            { x: max(0, t.x - w * 0.5), y: min(h, t.y + h * 0.5) }
        ];

        for (let nb of neighbors) {
            let other = tiles[nb.idx];
            // Bisector: midpoint and perpendicular direction
            let mx = (t.x + other.x) / 2;
            let my = (t.y + other.y) / 2;
            // Normal pointing away from neighbor (toward t)
            let nx = t.x - other.x;
            let ny = t.y - other.y;
            // Clip polygon by half-plane: keep points where dot(p-mid, normal) >= 0
            poly = clipPolygon(poly, mx, my, nx, ny);
            if (poly.length < 3) break;
        }

        cells.push(poly);
    }

    return cells;
}

// Sutherland-Hodgman polygon clipping by a half-plane
function clipPolygon(poly, mx, my, nx, ny) {
    if (poly.length === 0) return poly;
    let out = [];
    let len = poly.length;

    for (let i = 0; i < len; i++) {
        let curr = poly[i];
        let next = poly[(i + 1) % len];

        let dc = (curr.x - mx) * nx + (curr.y - my) * ny;
        let dn = (next.x - mx) * nx + (next.y - my) * ny;

        if (dc >= 0) out.push(curr);

        if ((dc >= 0 && dn < 0) || (dc < 0 && dn >= 0)) {
            // Edge crosses the boundary — find intersection
            let t = dc / (dc - dn);
            out.push({
                x: curr.x + t * (next.x - curr.x),
                y: curr.y + t * (next.y - curr.y)
            });
        }
    }

    return out;
}

// ═══════════════════════════════════
// 3D Rotation Effect
// ═══════════════════════════════════

function draw3DRotatedTiles(L, frameNum) {
    let baseSz = min(width, height) * (L.tileSize / 100);
    let tiles = L.currentTiles;
    let fn = frameNum || frameCount;
    let shape = L.tileShape || 'rect';
    let charSource = (L.text || 'A').replace(/\s/g, '') || 'A';

    let cx = width / 2, cy = height / 2;
    let focalLen = width * 1.2;
    let maxDim = min(width, height);

    // Scatter support in 3D (regenerate if tile count changed)
    let scatterActive3D = L.effects.scatter && L.scatterProgress > 0.001;
    if (scatterActive3D && (!L._scatterOrigins || L._scatterOrigins.length !== tiles.length)) {
        L._scatterOrigins = [];
        for (let i = 0; i < tiles.length; i++) {
            let angle = ((i * 137.508) % 360) * (PI / 180);
            let dist = maxDim * (0.8 + ((i * 73) % 100) / 100 * 0.7);
            L._scatterOrigins.push({
                x: width / 2 + cos(angle) * dist,
                y: height / 2 + sin(angle) * dist
            });
        }
    }

    // Global rotation (gentle base)
    let baseRotY = sin(fn * 0.012) * 0.4;
    let baseRotX = sin(fn * 0.008 + 1) * 0.15;

    noStroke();

    let projected = [];
    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        let x = t.x - cx;
        let y = t.y - cy;

        // ── Per-tile individual Z depth ──
        // Each tile gets its own z based on:
        // 1) Distance from center (further = more depth variation)
        // 2) A ripple wave that propagates outward over time
        // 3) Image brightness (brighter tiles float forward)
        let distFromCenter = sqrt(x * x + y * y);
        let normalizedDist = distFromCenter / (maxDim * 0.5);

        // Ripple: concentric wave emanating from center
        let ripplePhase = distFromCenter * 0.015 - fn * 0.04;
        let rippleZ = sin(ripplePhase) * maxDim * 0.08;

        // Per-tile wobble (each tile has its own rhythm)
        let tilePhase = i * 0.7 + fn * 0.025;
        let wobbleZ = sin(tilePhase) * maxDim * 0.03;

        // Brightness-based depth push
        let brightnessZ = 0;
        if (img) {
            let c = getImageColor(t.x, t.y);
            let bri = (red(c) + green(c) + blue(c)) / (3 * 255);
            brightnessZ = (bri - 0.5) * maxDim * 0.06;
        }

        let z = rippleZ + wobbleZ + brightnessZ;

        // ── Per-tile rotation offset ──
        // Tiles further from center rotate more (parallax)
        let tileRotY = baseRotY + sin(fn * 0.02 + i * 0.3) * 0.12 * normalizedDist;
        let tileRotX = baseRotX + cos(fn * 0.015 + i * 0.5) * 0.08 * normalizedDist;

        let cosY = cos(tileRotY), sinY = sin(tileRotY);
        let cosX = cos(tileRotX), sinX = sin(tileRotX);

        // Rotate around Y axis
        let x2 = x * cosY - z * sinY;
        let z2 = x * sinY + z * cosY;

        // Rotate around X axis
        let y2 = y * cosX - z2 * sinX;
        let z3 = y * sinX + z2 * cosX;

        // Perspective projection
        let scale = focalLen / (focalLen + z3);
        if (scale < 0.05 || scale > 4) continue;

        projected.push({
            sx: cx + x2 * scale,
            sy: cy + y2 * scale,
            z: z3,
            scale: scale,
            origIdx: i,
            origTile: t,
            // Per-tile 2D rotation for "card flip" feel
            tileRot: sin(fn * 0.02 + i * 0.4) * 0.15
        });
    }

    // Sort back-to-front for correct overlap
    projected.sort((a, b) => b.z - a.z);

    for (let p of projected) {
        let t = p.origTile;
        let sz = baseSz * (t.size || 1) * p.scale;

        if (L.effects.pulse) sz *= sin(fn * 0.05 + p.origIdx * 0.3) * 0.2 + 1;

        // Depth alpha: further tiles dimmer, closer tiles brighter
        let depthAlpha = constrain(map(p.scale, 0.4, 1.4, 0.2, 1), 0.08, 1);
        let tileAlpha = (t.alpha !== undefined ? t.alpha : 1) * depthAlpha;

        push();

        // Scatter in 3D mode
        if (scatterActive3D && L._scatterOrigins && p.origIdx < L._scatterOrigins.length) {
            let sp = L.scatterProgress;
            let eased = sp * sp * (3 - 2 * sp);
            let stagger = (p.origIdx / tiles.length) * 0.4;
            let localT = constrain((eased - stagger) / (1 - stagger), 0, 1);
            let orig = L._scatterOrigins[p.origIdx];
            let lx = lerp(p.sx, orig.x, localT);
            let ly = lerp(p.sy, orig.y, localT);
            translate(lx, ly);
            let sf = lerp(1, 0.3, localT);
            scale(sf); // scale BEFORE rotate
            rotate(localT * (((p.origIdx % 2) * 2) - 1) * PI * 1.5);
        } else {
            translate(p.sx, p.sy);
        }

        rotate(p.tileRot);

        if (L.effects.wave) translate(sin(fn * 0.03 + t.x * 0.008) * 5, 0);
        drawingContext.globalAlpha *= tileAlpha;

        let c = getImageColor(t.x, t.y);

        switch (shape) {
            case 'circle': drawTileCircle(sz, c); break;
            case 'char': drawTileChar(sz, c, charSource, p.origIdx, L); break;
            case 'adaptive': drawTileAdaptive(sz, c, t); break;
            case 'cross': drawTileCross(sz, c); break;
            default: drawTileRect(sz, c); break;
        }

        pop();
    }
}

// ═══════════════════════════════════
// Image Color Sampling — offset-aware, pixel-array optimized
// img.get(x,y) creates a new array per call — very slow.
// Instead, read pixels once and index directly.
// ═══════════════════════════════════

let _imgPixelsLoaded = false;
let _imgPixelsId = null; // track which image's pixels are loaded

function ensureImagePixels() {
    if (!img) return;
    // Only loadPixels once per image (check by dimensions as ID proxy)
    let id = img.width + 'x' + img.height;
    if (_imgPixelsLoaded && _imgPixelsId === id) return;
    img.loadPixels();
    _imgPixelsLoaded = true;
    _imgPixelsId = id;
}

function getImageColor(x, y) {
    if (!img || !img.pixels || img.pixels.length === 0) return color(200);
    let ax = x - _currentLayerOffsetX;
    let ay = y - _currentLayerOffsetY;
    let ix = constrain(floor(ax / width * img.width), 0, img.width - 1);
    let iy = constrain(floor(ay / height * img.height), 0, img.height - 1);
    let idx = (iy * img.width + ix) * 4;
    return color(img.pixels[idx], img.pixels[idx + 1], img.pixels[idx + 2]);
}

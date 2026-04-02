/* ═══════════════════════════════════
   Renderer v3.1
   Background, Tiles, Effects (incl. 3D)
   ═══════════════════════════════════ */

let gradientBuffer = null;
let gradientDirty = true;

// ── Background ──

function drawBackground() {
    let c1 = color(document.getElementById('bgColor').value);
    let c2 = color(document.getElementById('bgColor2').value);

    if (gradientType === 'none') {
        background(c1);
    } else {
        if (gradientDirty || !gradientBuffer || gradientBuffer.width !== width) {
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

        push();
        drawingContext.globalAlpha = L.opacity / 100;
        drawingContext.globalCompositeOperation = L.blendMode;
        translate(L.offsetX, L.offsetY);

        if (L.effects.web) drawWebLines(L);

        // 3D rotation wraps the tile drawing
        if (L.effects.rotate3d) {
            draw3DRotatedTiles(L, frameNum);
        } else {
            drawTiles(L, frameNum);
        }

        pop();
    }
}

// ═══════════════════════════════════
// Morph
// ═══════════════════════════════════

function updateMorphedTiles(L) {
    let len1 = L.tiles1.length;
    let len2 = L.tiles2.length;
    let maxLen = max(len1, len2);
    if (maxLen === 0) return;

    L.currentTiles = [];
    let t = L.morphProgress;
    let eased = t * t * (3 - 2 * t);

    // Build nearest-neighbor map for extra tiles (computed once per morph start)
    if (!L._nearestMap || L._nearestMapDir !== L.morphDirection) {
        L._nearestMap = buildNearestMap(L.tiles1, L.tiles2);
        L._nearestMapDir = L.morphDirection;
    }

    for (let i = 0; i < maxLen; i++) {
        // Map index into both arrays — wrap/clamp for the smaller one
        let hasT1 = i < len1;
        let hasT2 = i < len2;

        let t1, t2;

        if (hasT1 && hasT2) {
            // Both exist: direct interpolation
            t1 = L.tiles1[i];
            t2 = L.tiles2[i];
        } else if (hasT1 && !hasT2) {
            // Extra tile in tiles1: morph toward nearest tile in tiles2
            t1 = L.tiles1[i];
            t2 = L._nearestMap.from1to2[i] || t1;
        } else {
            // Extra tile in tiles2: morph from nearest tile in tiles1
            t2 = L.tiles2[i];
            t1 = L._nearestMap.from2to1[i] || t2;
        }

        let mx = lerp(t1.x, t2.x, eased);
        let my = lerp(t1.y, t2.y, eased);

        // Smooth arc during transition
        let curve = sin(eased * PI) * 12;
        let angle = atan2(t2.y - t1.y, t2.x - t1.x) + HALF_PI;
        mx += cos(angle) * curve * sin(i * 0.1);
        my += sin(angle) * curve * sin(i * 0.1);

        // Extra tiles scale up/down smoothly instead of popping
        let sizeScale = 1;
        if (!hasT1) sizeScale = eased;        // grows in as we morph toward tiles2
        else if (!hasT2) sizeScale = 1 - eased; // shrinks as we leave tiles1

        L.currentTiles.push({
            x: mx, y: my, index: i,
            size: (t1.size ? lerp(t1.size, t2.size || 1, eased) : 1) * sizeScale,
            alpha: max(0.05, sizeScale) // never fully invisible for smooth feel
        });
    }
}

// Find nearest neighbor in the other tile set for each extra tile
function buildNearestMap(tiles1, tiles2) {
    let from1to2 = {};
    let from2to1 = {};

    let minLen = min(tiles1.length, tiles2.length);

    // For extra tiles in tiles1 (i >= tiles2.length), find nearest in tiles2
    for (let i = tiles2.length; i < tiles1.length; i++) {
        from1to2[i] = findNearest(tiles1[i], tiles2);
    }

    // For extra tiles in tiles2 (i >= tiles1.length), find nearest in tiles1
    for (let i = tiles1.length; i < tiles2.length; i++) {
        from2to1[i] = findNearest(tiles2[i], tiles1);
    }

    return { from1to2, from2to1 };
}

function findNearest(tile, targets) {
    let best = null;
    let bestDist = Infinity;
    for (let t of targets) {
        let dx = t.x - tile.x;
        let dy = t.y - tile.y;
        let d = dx * dx + dy * dy;
        if (d < bestDist) {
            bestDist = d;
            best = t;
        }
    }
    return best;
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

    noStroke();
    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        let sz = baseSz * (t.size || 1);

        if (L.effects.pulse) {
            sz *= sin(fn * 0.05 + i * 0.3) * 0.3 + 1;
        }

        let tileAlpha = t.alpha !== undefined ? t.alpha : 1;

        push();
        translate(t.x, t.y);

        // WAVE effect
        if (L.effects.wave) {
            let wx = sin(fn * 0.03 + t.x * 0.008) * 8;
            let wy = cos(fn * 0.025 + t.y * 0.008) * 6;
            translate(wx, wy);
        }

        // VORTEX effect — spiral motion around center
        if (L.effects.vortex) {
            let dx = t.x - width / 2;
            let dy = t.y - height / 2;
            let dist = sqrt(dx * dx + dy * dy);
            let ang = fn * 0.01 + dist * 0.005;
            let r = sin(fn * 0.02) * min(dist * 0.08, 20);
            translate(cos(ang) * r, sin(ang) * r);
        }

        // ROTATE effect (per-tile random rotation)
        if (L.effects.rotate) {
            randomSeed(i);
            rotate(random(-0.4, 0.4));
        }

        if (tileAlpha < 1) drawingContext.globalAlpha *= tileAlpha;

        if (img) {
            image(img, -sz / 2, -sz / 2, sz, sz);
        } else {
            let c = getImageColor(t.x, t.y);
            fill(c);
            rect(-sz / 2, -sz / 2, sz, sz);
        }
        pop();
    }
}

// ═══════════════════════════════════
// 3D Rotation Effect
// Pseudo-3D: project tiles through perspective
// rotates entire text around Y-axis (or X-axis)
// ═══════════════════════════════════

function draw3DRotatedTiles(L, frameNum) {
    let baseSz = min(width, height) * (L.tileSize / 100);
    let tiles = L.currentTiles;
    let fn = frameNum || frameCount;

    let cx = width / 2;
    let cy = height / 2;
    let focalLen = width * 1.2; // perspective focal length

    // Rotation angle oscillates
    let rotY = sin(fn * 0.015) * 0.8; // -0.8 to 0.8 radians (~46 degrees)
    let rotX = sin(fn * 0.01 + 1) * 0.3;

    let cosY = cos(rotY), sinY = sin(rotY);
    let cosX = cos(rotX), sinX = sin(rotX);

    noStroke();

    // Sort tiles by projected Z for correct depth ordering
    let projected = [];
    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        // Translate to center
        let x = t.x - cx;
        let y = t.y - cy;
        let z = 0;

        // Rotate around Y axis
        let x2 = x * cosY - z * sinY;
        let z2 = x * sinY + z * cosY;

        // Rotate around X axis
        let y2 = y * cosX - z2 * sinX;
        let z3 = y * sinX + z2 * cosX;

        // Perspective projection
        let scale = focalLen / (focalLen + z3);
        if (scale < 0.05) continue; // Behind camera

        projected.push({
            sx: cx + x2 * scale,
            sy: cy + y2 * scale,
            z: z3,
            scale: scale,
            origIdx: i,
            origTile: t
        });
    }

    // Sort back-to-front
    projected.sort((a, b) => b.z - a.z);

    for (let p of projected) {
        let t = p.origTile;
        let sz = baseSz * (t.size || 1) * p.scale;

        if (L.effects.pulse) {
            sz *= sin(fn * 0.05 + p.origIdx * 0.3) * 0.2 + 1;
        }

        // Depth-based alpha (further = dimmer)
        let depthAlpha = map(p.scale, 0.3, 1.5, 0.3, 1);
        depthAlpha = constrain(depthAlpha, 0.1, 1);

        let tileAlpha = (t.alpha !== undefined ? t.alpha : 1) * depthAlpha;

        push();
        translate(p.sx, p.sy);

        if (L.effects.wave) {
            translate(sin(fn * 0.03 + t.x * 0.008) * 5, 0);
        }

        drawingContext.globalAlpha *= tileAlpha;

        if (img) {
            image(img, -sz / 2, -sz / 2, sz, sz);
        } else {
            let c = getImageColor(t.x, t.y);
            fill(c);
            rect(-sz / 2, -sz / 2, sz, sz);
        }
        pop();
    }
}

// ═══════════════════════════════════
// Explode/Gather Effect
// Tiles fly out from center then reassemble
// ═══════════════════════════════════

function applyExplodeEffect(L, frameNum) {
    let fn = frameNum || frameCount;
    let cycle = (fn * 0.008) % (TWO_PI); // full cycle
    let t = (sin(cycle) + 1) / 2; // 0→1→0 oscillation
    let force = t * min(width, height) * 0.4;

    let cx = width / 2;
    let cy = height / 2;

    for (let tile of L.currentTiles) {
        let dx = tile.x - cx;
        let dy = tile.y - cy;
        let dist = sqrt(dx * dx + dy * dy) || 1;
        tile._renderX = tile.x + (dx / dist) * force * (1 + sin(tile.index * 0.5) * 0.3);
        tile._renderY = tile.y + (dy / dist) * force * (1 + cos(tile.index * 0.7) * 0.3);
    }
}

// ═══════════════════════════════════
// Utility
// ═══════════════════════════════════

function getImageColor(x, y) {
    if (!img) return color(200);
    let ix = constrain(floor(map(x, 0, width, 0, img.width)), 0, img.width - 1);
    let iy = constrain(floor(map(y, 0, height, 0, img.height)), 0, img.height - 1);
    return img.get(ix, iy);
}

/* ═══════════════════════════════════
   Renderer v3.2
   Background, Tiles, Effects, 3D
   ═══════════════════════════════════ */

let gradientBuffer = null;
let gradientDirty = true;
let bgImage = null; // background image

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

    if (gradientType === 'image' && bgImage) {
        // Background image — stretch to fill canvas
        image(bgImage, 0, 0, width, height);
    } else if (gradientType === 'none') {
        background(c1);
    } else if (gradientType === 'linear' || gradientType === 'radial') {
        if (gradientDirty || !gradientBuffer || gradientBuffer.width !== width) {
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
    updateImageFilterCache();
    for (let i = 0; i < layers.length; i++) {
        let L = layers[i];
        if (!L.visible || L.currentTiles.length === 0) continue;

        // Morph update (multi-step with per-step hold)
        if (L.effects.morph && L.morphSteps && L.morphSteps.length > 1) {
            if (L.morphHolding) {
                // Holding at destination — keep progress at 1.0 (stay at target)
                L.morphHoldTimer -= 1/60;
                if (L.morphHoldTimer <= 0) {
                    L.morphHolding = false;
                    // NOW advance to next step
                    L.morphProgress = 0;
                    L.morphStepIdx++;
                    if (L.morphStepIdx >= L.morphSteps.length) L.morphStepIdx = 0;
                    L._morphPairs = null;
                }
            } else {
                let ppf = 1 / (L.morphDuration * 60);
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
            // Set tiles1/tiles2 for current step
            let fromIdx = L.morphStepIdx;
            let toIdx = (L.morphStepIdx + 1) % L.morphSteps.length;
            L.tiles1 = L.morphSteps[fromIdx];
            L.tiles2 = L.morphSteps[toIdx];
            if (!L._morphPairs) {
                L._morphPairs = buildSpatialMorphMap(L.tiles1, L.tiles2);
            }
            updateMorphedTiles(L);
        } else if (!L.effects.morph && L.morphSteps && L.morphSteps.length > 0) {
            L.currentTiles = L.morphSteps[0];
        }

        // Scatter (photo particle rebuild) update
        if (L.effects.scatter) {
            let spd = 1 / (L.morphDuration * 60);
            L.scatterProgress += L.scatterDirection * spd;
            if (L.scatterProgress >= 1) { L.scatterProgress = 1; L.scatterDirection = -1; }
            else if (L.scatterProgress <= 0) { L.scatterProgress = 0; L.scatterDirection = 1; }
        }

        // Sequencer: progressive reveal 0→1→hold→0→hold
        if (L.effects.sequencer) {
            let spd = 1 / (L.morphDuration * 120);
            L.sequencerProgress += spd;
            if (L.sequencerProgress > 1.5) L.sequencerProgress = 0; // loop with pause
        }

        // Spring: initialize spring physics state (reinit if tile count changed)
        if (L.effects.spring && (!L._springState || L._springState.length !== L.currentTiles.length)) {
            L._springState = [];
            for (let j = 0; j < L.currentTiles.length; j++) {
                L._springState.push({
                    vy: 0, vx: 0,
                    dy: -(80 + random(60)), // start offset above
                    dx: random(-20, 20)
                });
            }
        }

        // Store layer offset BEFORE any rendering (used by getImageColor)
        _currentLayerOffsetX = L.offsetX;
        _currentLayerOffsetY = L.offsetY;

        push();
        drawingContext.globalAlpha = L.opacity / 100;
        drawingContext.globalCompositeOperation = L.blendMode;
        translate(L.offsetX, L.offsetY);

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
    let maxDist = min(width, height) * 0.1;
    let tiles = L.currentTiles;
    let fn = frameCount;
    let ctx = drawingContext;

    // Pass 1: Draw bezier connections (also track connected nodes for pass 2)
    let connectedNodes = new Set();
    noFill();
    for (let i = 0; i < tiles.length; i++) {
        let t1 = tiles[i];
        let conn = 0;
        for (let j = i + 1; j < tiles.length && conn < 4; j++) {
            let t2 = tiles[j];
            let dx = t1.x - t2.x, dy = t1.y - t2.y;
            let d = sqrt(dx * dx + dy * dy);
            if (d < maxDist) {
                let c = getImageColor((t1.x + t2.x) / 2, (t1.y + t2.y) / 2);
                let proximity = 1 - d / maxDist; // 0 at max, 1 at zero
                let a = proximity * 160 + 20;

                // Thickness varies with distance
                let sw = lerp(0.3, 1.8, proximity);
                strokeWeight(sw);

                // Color with pulsing alpha
                let pulseA = a * (0.7 + 0.3 * sin(fn * 0.04 + i * 0.5 + j * 0.3));
                stroke(red(c), green(c), blue(c), pulseA);

                // Bezier curve — control point offset perpendicular to line
                let mx = (t1.x + t2.x) / 2;
                let my = (t1.y + t2.y) / 2;
                let perpX = -(t2.y - t1.y) / d; // perpendicular unit vector
                let perpY = (t2.x - t1.x) / d;
                let curveAmt = sin(fn * 0.02 + (i + j) * 0.4) * d * 0.2;
                let cx1 = mx + perpX * curveAmt;
                let cy1 = my + perpY * curveAmt;

                ctx.beginPath();
                ctx.moveTo(t1.x, t1.y);
                ctx.quadraticCurveTo(cx1, cy1, t2.x, t2.y);
                ctx.stroke();

                // Traveling light dot along the curve
                let dotT = ((fn * 0.015 + i * 0.7) % 1);
                let dotX = (1-dotT)*(1-dotT)*t1.x + 2*(1-dotT)*dotT*cx1 + dotT*dotT*t2.x;
                let dotY = (1-dotT)*(1-dotT)*t1.y + 2*(1-dotT)*dotT*cy1 + dotT*dotT*t2.y;
                ctx.save();
                ctx.globalAlpha = proximity * 0.6;
                ctx.fillStyle = 'rgba(' + floor(red(c)) + ',' + floor(green(c)) + ',' + floor(blue(c)) + ',1)';
                ctx.beginPath();
                ctx.arc(dotX, dotY, sw + 1, 0, TWO_PI);
                ctx.fill();
                ctx.restore();

                connectedNodes.add(i);
                connectedNodes.add(j);
                conn++;
            }
        }
    }

    // Pass 2: Glow dots at connected nodes (using connectedSet from pass 1)
    ctx.save();
    for (let idx of connectedNodes) {
        let t = tiles[idx];
        getImageColorFast(t.x, t.y);
        let glowSize = 2 + Math.sin(fn * 0.05 + idx * 0.8);
        ctx.globalAlpha = 0.3 + 0.15 * Math.sin(fn * 0.06 + idx);
        ctx.fillStyle = 'rgb(' + (_fastColorR|0) + ',' + (_fastColorG|0) + ',' + (_fastColorB|0) + ')';
        ctx.beginPath();
        ctx.arc(t.x, t.y, glowSize, 0, 6.2832);
        ctx.fill();
    }
    ctx.restore();
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

    // Sequencer: precompute per-tile reveal timing (cached on tiles1)
    let seqActive = L.effects.sequencer && L.sequencerProgress < 1.0;
    let seqOrder = null;
    if (seqActive) {
        // Cache reveal order based on tiles1 (stable positions, not morphed)
        if (!L._seqRank || L._seqRank.length !== tiles.length) {
            let src = L.tiles1.length === tiles.length ? L.tiles1 : tiles;
            let sorted = src.map((t, i) => ({ i, sort: t.x * 0.7 + t.y * 0.3 }));
            sorted.sort((a, b) => a.sort - b.sort);
            L._seqRank = new Float32Array(tiles.length);
            for (let k = 0; k < sorted.length; k++) {
                L._seqRank[sorted[k].i] = k / max(1, sorted.length - 1);
            }
        }
        seqOrder = L._seqRank;
    }

    // Spring: update physics
    let springActive = L.effects.spring && L._springState;
    if (springActive) {
        let stiffness = 0.08;
        let damping = 0.82;
        for (let j = 0; j < min(L._springState.length, tiles.length); j++) {
            let s = L._springState[j];
            // Spring toward 0 (home position)
            s.vy += -s.dy * stiffness;
            s.vx += -s.dx * stiffness;
            s.vy *= damping;
            s.vx *= damping;
            s.dy += s.vy;
            s.dx += s.vx;
        }
    }

    let ctx = drawingContext;
    let baseAlpha = ctx.globalAlpha;
    let hasEffects = scatterActive || springActive || seqActive ||
                     L.effects.wave || L.effects.vortex || L.effects.rotate;
    let tilesLen = tiles.length;
    let invTilesLen = 1 / Math.max(1, tilesLen);

    noStroke();
    for (let i = 0; i < tilesLen; i++) {
        let t = tiles[i];
        let sz = baseSz * (t.size || 1);

        if (L.effects.pulse) {
            sz *= Math.sin(fn * 0.05 + i * 0.3) * 0.3 + 1;
        }

        let tileAlpha = t.alpha !== undefined ? t.alpha : 1;

        // Use ctx.save/restore directly (faster than p5's push/pop)
        ctx.save();

        // Scatter
        if (scatterActive && L._scatterOrigins && i < L._scatterOrigins.length) {
            let sp = L.scatterProgress;
            let eased = sp * sp * (3 - 2 * sp);
            let orig = L._scatterOrigins[i];
            let stagger = i * invTilesLen * 0.4;
            let localT = Math.max(0, Math.min(1, (eased - stagger) / (1 - stagger)));
            let lx = t.x + (orig.x - t.x) * localT;
            let ly = t.y + (orig.y - t.y) * localT;
            ctx.translate(lx, ly);
            let scaleF = 1 + (0.3 - 1) * localT;
            ctx.scale(scaleF, scaleF);
            ctx.rotate(localT * (((i & 1) * 2) - 1) * Math.PI * 1.5);
        } else {
            ctx.translate(t.x, t.y);
        }

        // Spring
        if (springActive && i < L._springState.length) {
            let s = L._springState[i];
            ctx.translate(s.dx, s.dy);
        }

        // Sequencer
        if (seqActive && seqOrder) {
            let tileReveal = Math.max(0, Math.min(1, (L.sequencerProgress - seqOrder[i] * 0.8) / 0.2));
            let s = tileReveal === 0 ? 0 : Math.pow(2, -10 * tileReveal) * Math.sin((tileReveal - 0.075) * 6.2832 / 0.3) + 1;
            ctx.scale(s, s);
            tileAlpha *= s;
            if (s < 0.01) { ctx.restore(); continue; }
        }

        if (L.effects.wave) {
            ctx.translate(Math.sin(fn * 0.03 + t.x * 0.008) * 8, Math.cos(fn * 0.025 + t.y * 0.008) * 6);
        }

        if (L.effects.vortex) {
            let dx = t.x - width * 0.5, dy = t.y - height * 0.5;
            let dist = Math.sqrt(dx * dx + dy * dy);
            let ang = fn * 0.01 + dist * 0.005;
            let r = Math.sin(fn * 0.02) * Math.min(dist * 0.08, 20);
            ctx.translate(Math.cos(ang) * r, Math.sin(ang) * r);
        }

        if (L.effects.rotate) {
            // Deterministic per-tile rotation without randomSeed (expensive)
            let rot = ((i * 73856093) & 0xFFFF) / 65535.0 * 0.8 - 0.4;
            ctx.rotate(rot);
        }

        if (tileAlpha < 1) ctx.globalAlpha = baseAlpha * tileAlpha;

        getImageColorFast(t.x, t.y);

        if (shape === 'voronoi') {
            ctx.restore();
            continue;
        }

        // Fast path: for simple rect shape, draw directly via ctx (skip p5 overhead)
        if (shape === 'rect') {
            if (img) {
                ctx.drawImage(img.canvas || img.elt, -sz * 0.5, -sz * 0.5, sz, sz);
            } else {
                ctx.fillStyle = 'rgb(' + (_fastColorR|0) + ',' + (_fastColorG|0) + ',' + (_fastColorB|0) + ')';
                ctx.fillRect(-sz * 0.5, -sz * 0.5, sz, sz);
            }
        } else {
            // Other shapes use p5 helpers (need color object)
            let c = color(_fastColorR, _fastColorG, _fastColorB);
            switch (shape) {
                case 'circle': drawTileCircle(sz, c); break;
                case 'char': drawTileChar(sz, c, charSource, i, L); break;
                case 'adaptive': drawTileAdaptive(sz, c, t); break;
                case 'cross': drawTileCross(sz, c); break;
            }
        }

        ctx.restore();
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
            let imgEl = (img.canvas ? img.canvas : (img.elt ? img.elt : null));
            if (imgEl) drawingContext.drawImage(imgEl, sx, sy, sw, sh, minX, minY, maxX - minX, maxY - minY);
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
    let focalLen = width * 1.5;
    let maxDim = min(width, height);

    // ── UNIFIED ROTATION (rigid body — the whole text rotates as one) ──
    let rotY = sin(fn * 0.01) * 0.7;   // Y-axis: slow side-to-side
    let rotX = sin(fn * 0.007 + 0.5) * 0.4; // X-axis: gentle tilt
    let cosRY = cos(rotY), sinRY = sin(rotY);
    let cosRX = cos(rotX), sinRX = sin(rotX);

    // ── LIGHT DIRECTION (moves with rotation to simulate fixed light) ──
    let lightDirX = 0.4;
    let lightDirY = -0.6;
    let lightDirZ = 0.7;
    // Normalize
    let lLen = sqrt(lightDirX*lightDirX + lightDirY*lightDirY + lightDirZ*lightDirZ);
    lightDirX /= lLen; lightDirY /= lLen; lightDirZ /= lLen;

    noStroke();

    let projected = [];
    for (let i = 0; i < tiles.length; i++) {
        let t = tiles[i];
        let x = t.x - cx;
        let y = t.y - cy;

        // ── Z HEIGHT from image brightness (relief/emboss effect) ──
        let z = 0;
        if (img) {
            let c = getImageColor(t.x, t.y);
            let bri = (red(c) + green(c) + blue(c)) / (3 * 255);
            z = (bri - 0.3) * maxDim * 0.15; // bright = forward, dark = back
        }

        // Apply unified rotation
        // Y-axis rotation
        let x1 = x * cosRY - z * sinRY;
        let z1 = x * sinRY + z * cosRY;
        // X-axis rotation
        let y1 = y * cosRX - z1 * sinRX;
        let z2 = y * sinRX + z1 * cosRX;

        // Perspective projection
        let pScale = focalLen / (focalLen + z2);
        if (pScale < 0.05 || pScale > 4) continue;

        // Lighting: compute how much this tile faces the light
        // Surface normal approximation: (0, 0, 1) rotated by same angles
        let nz = cosRY * cosRX; // simplified normal z after rotation
        let nx = -sinRY;
        let ny = -sinRX * cosRY;
        let lightDot = nx * lightDirX + ny * lightDirY + nz * lightDirZ;
        let lightAmount = constrain(lightDot * 0.5 + 0.5, 0.3, 1.0);

        // Shadow offset: tiles further from surface cast longer shadows
        let shadowOff = max(0, z * 0.05) * pScale;

        projected.push({
            sx: cx + x1 * pScale,
            sy: cy + y1 * pScale,
            z: z2,
            pScale: pScale,
            origIdx: i,
            origTile: t,
            lightAmount: lightAmount,
            shadowOff: shadowOff,
            origZ: z
        });
    }

    // Sort back-to-front
    projected.sort((a, b) => b.z - a.z);

    // ── SHADOW PASS ──
    for (let p of projected) {
        if (p.shadowOff < 0.5) continue;
        let sz = baseSz * (p.origTile.size || 1) * p.pScale;
        drawingContext.save();
        drawingContext.globalAlpha = 0.15;
        drawingContext.fillStyle = '#000';
        drawingContext.beginPath();
        drawingContext.arc(p.sx + p.shadowOff * 2, p.sy + p.shadowOff * 2, sz * 0.5, 0, TWO_PI);
        drawingContext.fill();
        drawingContext.restore();
    }

    // ── TILE PASS ──
    for (let p of projected) {
        let t = p.origTile;
        let sz = baseSz * (t.size || 1) * p.pScale;

        if (L.effects.pulse) sz *= sin(fn * 0.05 + p.origIdx * 0.3) * 0.2 + 1;

        // Depth + lighting alpha
        let depthAlpha = constrain(map(p.pScale, 0.5, 1.3, 0.4, 1), 0.15, 1);
        let tileAlpha = (t.alpha !== undefined ? t.alpha : 1) * depthAlpha;

        push();
        translate(p.sx, p.sy);

        if (L.effects.wave) translate(sin(fn * 0.03 + t.x * 0.008) * 5, 0);

        // Apply lighting: darken tiles facing away from light
        drawingContext.globalAlpha *= tileAlpha;

        let c = getImageColor(t.x, t.y);
        // Modulate color by light amount
        let lr = constrain(red(c) * p.lightAmount, 0, 255);
        let lg = constrain(green(c) * p.lightAmount, 0, 255);
        let lb = constrain(blue(c) * p.lightAmount, 0, 255);
        let litColor = color(lr, lg, lb);

        // Render tile with lit color
        switch (shape) {
            case 'circle': drawTileCircleLit(sz, litColor); break;
            case 'char': drawTileCharLit(sz, litColor, charSource, p.origIdx, L); break;
            case 'cross': drawTileCrossLit(sz, litColor); break;
            default: drawTileRectLit(sz, litColor); break;
        }

        // Highlight edge for tiles that protrude (bright relief)
        if (p.origZ > maxDim * 0.03) {
            drawingContext.save();
            drawingContext.globalAlpha = 0.08;
            drawingContext.strokeStyle = '#fff';
            drawingContext.lineWidth = 1;
            drawingContext.strokeRect(-sz/2, -sz/2, sz, sz);
            drawingContext.restore();
        }

        pop();
    }
}

// ── Lit tile renderers — render image texture + lighting tint overlay ──
function drawTileRectLit(sz, c) {
    if (img) {
        image(img, -sz/2, -sz/2, sz, sz);
        // Lighting tint overlay
        drawingContext.save();
        drawingContext.globalCompositeOperation = 'multiply';
        drawingContext.fillStyle = 'rgb(' + red(c) + ',' + green(c) + ',' + blue(c) + ')';
        drawingContext.fillRect(-sz/2, -sz/2, sz, sz);
        drawingContext.restore();
    } else {
        fill(c); rect(-sz/2, -sz/2, sz, sz);
    }
}

function drawTileCircleLit(sz, c) {
    if (img) {
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.arc(0, 0, sz/2, 0, TWO_PI);
        drawingContext.clip();
        image(img, -sz/2, -sz/2, sz, sz);
        drawingContext.globalCompositeOperation = 'multiply';
        drawingContext.fillStyle = 'rgb(' + red(c) + ',' + green(c) + ',' + blue(c) + ')';
        drawingContext.fill();
        drawingContext.restore();
    } else {
        fill(c); ellipse(0, 0, sz, sz);
    }
}

function drawTileCharLit(sz, c, charSource, idx, L) {
    let ch = charSource[idx % charSource.length];
    let fontSize = sz * 1.1;
    drawingContext.fillStyle = 'rgb(' + red(c) + ',' + green(c) + ',' + blue(c) + ')';
    drawingContext.font = L.fontWeight + ' ' + fontSize + 'px ' + L.fontFamily;
    drawingContext.textAlign = 'center';
    drawingContext.textBaseline = 'middle';
    drawingContext.fillText(ch, 0, 0);
}

function drawTileCrossLit(sz, c) {
    let arm = sz * 0.3, half = sz / 2;
    if (img) {
        drawingContext.save();
        drawingContext.beginPath();
        drawingContext.rect(-arm/2, -half, arm, sz);
        drawingContext.rect(-half, -arm/2, sz, arm);
        drawingContext.clip();
        image(img, -half, -half, sz, sz);
        drawingContext.globalCompositeOperation = 'multiply';
        drawingContext.fillStyle = 'rgb(' + red(c) + ',' + green(c) + ',' + blue(c) + ')';
        drawingContext.fill();
        drawingContext.restore();
    } else {
        fill(c); rect(-arm/2, -half, arm, sz); rect(-half, -arm/2, sz, arm);
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

// Image filter cache (read from DOM once per frame via drawLayers)
let _imgBrightness = 100, _imgContrast = 100, _imgSaturate = 100, _imgFilter = 'none';

function updateImageFilterCache() {
    let bEl = document.getElementById('imgBrightness');
    let cEl = document.getElementById('imgContrast');
    let sEl = document.getElementById('imgSaturate');
    if (bEl) _imgBrightness = parseFloat(bEl.value);
    if (cEl) _imgContrast = parseFloat(cEl.value);
    if (sEl) _imgSaturate = parseFloat(sEl.value);
    let activeFilter = document.querySelector('.imgfilter-btn.active');
    _imgFilter = activeFilter ? activeFilter.dataset.filter : 'none';
}

// Fast color return — reuse array instead of creating p5.Color objects
let _fastColorR = 200, _fastColorG = 200, _fastColorB = 200;

function getImageColorFast(x, y) {
    if (!img || !img.pixels || img.pixels.length === 0) {
        _fastColorR = _fastColorG = _fastColorB = 200;
        return;
    }
    let ax = x - _currentLayerOffsetX;
    let ay = y - _currentLayerOffsetY;
    let ix = Math.max(0, Math.min(Math.floor(ax / width * img.width), img.width - 1));
    let iy = Math.max(0, Math.min(Math.floor(ay / height * img.height), img.height - 1));
    let idx = (iy * img.width + ix) * 4;
    let r = img.pixels[idx], g = img.pixels[idx + 1], b = img.pixels[idx + 2];

    // Apply filters inline (avoid function call overhead)
    if (_imgBrightness !== 100) { let f = _imgBrightness / 100; r *= f; g *= f; b *= f; }
    if (_imgContrast !== 100) { let f = _imgContrast / 100; let ic = 128 * (1 - f); r = r * f + ic; g = g * f + ic; b = b * f + ic; }
    if (_imgSaturate !== 100) { let s = _imgSaturate / 100; let gray = 0.299 * r + 0.587 * g + 0.114 * b; r = gray + s * (r - gray); g = gray + s * (g - gray); b = gray + s * (b - gray); }
    if (_imgFilter === 'grayscale') { let gray = 0.299 * r + 0.587 * g + 0.114 * b; r = g = b = gray; }
    else if (_imgFilter === 'invert') { r = 255 - r; g = 255 - g; b = 255 - b; }

    _fastColorR = Math.max(0, Math.min(255, r));
    _fastColorG = Math.max(0, Math.min(255, g));
    _fastColorB = Math.max(0, Math.min(255, b));
}

// Legacy wrapper for code that still uses color() return
function getImageColor(x, y) {
    if (!img || !img.pixels || img.pixels.length === 0) return color(200);
    let ax = x - _currentLayerOffsetX;
    let ay = y - _currentLayerOffsetY;
    let ix = Math.max(0, Math.min(Math.floor(ax / width * img.width), img.width - 1));
    let iy = Math.max(0, Math.min(Math.floor(ay / height * img.height), img.height - 1));
    let idx = (iy * img.width + ix) * 4;
    let r = img.pixels[idx], g = img.pixels[idx + 1], b = img.pixels[idx + 2];

    // Apply brightness
    if (_imgBrightness !== 100) {
        let f = _imgBrightness / 100;
        r *= f; g *= f; b *= f;
    }

    // Apply contrast
    if (_imgContrast !== 100) {
        let f = (_imgContrast / 100);
        let intercept = 128 * (1 - f);
        r = r * f + intercept;
        g = g * f + intercept;
        b = b * f + intercept;
    }

    // Apply saturate
    if (_imgSaturate !== 100) {
        let s = _imgSaturate / 100;
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = gray + s * (r - gray);
        g = gray + s * (g - gray);
        b = gray + s * (b - gray);
    }

    // Apply filter
    if (_imgFilter === 'grayscale') {
        let gray = 0.299 * r + 0.587 * g + 0.114 * b;
        r = g = b = gray;
    } else if (_imgFilter === 'invert') {
        r = 255 - r; g = 255 - g; b = 255 - b;
    }

    return color(constrain(r, 0, 255), constrain(g, 0, 255), constrain(b, 0, 255));
}

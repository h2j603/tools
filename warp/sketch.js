/* ═══════════════════════════════════
   IMAGE TEXT WARP — Main Engine
   Vanilla Canvas (no p5.js dependency)
   ═══════════════════════════════════ */

// ── State ──
const S = {
    canvas: null, ctx: null,
    W: 1080, H: 1080,
    sourceImg: null,
    textMask: null,       // offscreen canvas for text
    distField: null,      // Float32Array distance field
    processed: null,      // offscreen canvas for result
    mode: 'displace',
    text: 'WARP',
    font: "'Black Han Sans', sans-serif",
    fontWeight: '700',
    textSize: 40,         // percent of canvas height
    textX: 50, textY: 50,
    letterSpace: 0,
    intensity: 50,
    edgeSoftness: 30,
    detail: 50,
    seed: 0,
    insideColor: 'original',
    outsideColor: 'original',
    bgColor: '#0a0a0c',
    bgOpacity: 0,
    anim: 'none',
    animSpeed: 1.0,
    exportScale: 1,
    animFrame: 0,
    isAnimating: false,
    needsRender: true,
    demoGenerated: false,
};

// ── Init ──
function init() {
    S.canvas = document.createElement('canvas');
    S.canvas.width = S.W;
    S.canvas.height = S.H;
    S.ctx = S.canvas.getContext('2d', { willReadFrequently: true });
    document.getElementById('canvas-container').appendChild(S.canvas);

    S.textMask = document.createElement('canvas');
    S.processed = document.createElement('canvas');

    generateDemoImage();
    bindUI();
    initTheme();
    fitCanvas();
    render();
    updateStatus('준비 완료');
}

// ── Demo gradient image ──
function generateDemoImage() {
    const c = document.createElement('canvas');
    c.width = S.W; c.height = S.H;
    const ctx = c.getContext('2d');

    // Colorful gradient
    const g1 = ctx.createLinearGradient(0, 0, S.W, S.H);
    g1.addColorStop(0, '#ff6b4a');
    g1.addColorStop(0.3, '#ff2d87');
    g1.addColorStop(0.6, '#6c4aff');
    g1.addColorStop(1, '#00c9ff');
    ctx.fillStyle = g1;
    ctx.fillRect(0, 0, S.W, S.H);

    // Add some shapes for visual interest
    const rng = mulberry32(42);
    for (let i = 0; i < 40; i++) {
        ctx.beginPath();
        const x = rng() * S.W;
        const y = rng() * S.H;
        const r = 20 + rng() * 120;
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${rng()*360|0}, 80%, 60%, ${0.1 + rng()*0.2})`;
        ctx.fill();
    }

    S.sourceImg = new Image();
    S.sourceImg.src = c.toDataURL();
    S.sourceImg.onload = () => { S.needsRender = true; S.demoGenerated = true; render(); };
}

// ── Seeded PRNG ──
function mulberry32(a) {
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ── Generate text mask & distance field ──
function generateTextMask(w, h) {
    S.textMask.width = w;
    S.textMask.height = h;
    const ctx = S.textMask.getContext('2d');
    ctx.clearRect(0, 0, w, h);

    const fontSize = (S.textSize / 100) * h;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${S.fontWeight} ${fontSize}px ${S.font}`;

    const cx = (S.textX / 100) * w;
    const cy = (S.textY / 100) * h;

    const lines = S.text.split('\n');
    const lineH = fontSize * 1.15;
    const totalH = lines.length * lineH;
    const startY = cy - totalH / 2 + lineH / 2;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (S.letterSpace !== 0 && line.length > 0) {
            // Manual letter spacing
            const chars = [...line];
            const spacing = S.letterSpace * (fontSize / 50);
            const totalW = chars.reduce((sum, ch) => sum + ctx.measureText(ch).width, 0) + spacing * (chars.length - 1);
            let x = cx - totalW / 2;
            for (const ch of chars) {
                const cw = ctx.measureText(ch).width;
                ctx.fillText(ch, x + cw / 2, startY + i * lineH);
                x += cw + spacing;
            }
        } else {
            ctx.fillText(line, cx, startY + i * lineH);
        }
    }

    // Build distance field from mask
    buildDistanceField(w, h);
}

function buildDistanceField(w, h) {
    const maskCtx = S.textMask.getContext('2d');
    const maskData = maskCtx.getImageData(0, 0, w, h).data;

    // Binary mask: 1 inside text, 0 outside
    const inside = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
        inside[i] = maskData[i * 4 + 3] > 128 ? 1 : 0;
    }

    // Approximate distance field using multi-pass blur approach
    // For performance, use a coarser grid then upscale
    const scale = 4;
    const sw = Math.ceil(w / scale);
    const sh = Math.ceil(h / scale);
    const smallInside = new Uint8Array(sw * sh);

    for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
            const ox = Math.min(x * scale, w - 1);
            const oy = Math.min(y * scale, h - 1);
            smallInside[y * sw + x] = inside[oy * w + ox];
        }
    }

    // Simple distance transform (chamfer 3-4)
    const dist = new Float32Array(sw * sh);
    const INF = 1e6;

    // Init
    for (let i = 0; i < sw * sh; i++) {
        dist[i] = smallInside[i] ? 0 : INF;
    }

    // Forward pass
    for (let y = 1; y < sh - 1; y++) {
        for (let x = 1; x < sw - 1; x++) {
            const i = y * sw + x;
            dist[i] = Math.min(dist[i],
                dist[(y-1)*sw + (x-1)] + 1.414,
                dist[(y-1)*sw + x] + 1,
                dist[(y-1)*sw + (x+1)] + 1.414,
                dist[y*sw + (x-1)] + 1
            );
        }
    }

    // Backward pass
    for (let y = sh - 2; y >= 1; y--) {
        for (let x = sw - 2; x >= 1; x--) {
            const i = y * sw + x;
            dist[i] = Math.min(dist[i],
                dist[(y+1)*sw + (x+1)] + 1.414,
                dist[(y+1)*sw + x] + 1,
                dist[(y+1)*sw + (x-1)] + 1.414,
                dist[y*sw + (x+1)] + 1
            );
        }
    }

    // Upscale back to full resolution
    S.distField = new Float32Array(w * h);
    S.insideMask = inside;

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const sx = Math.min(Math.floor(x / scale), sw - 1);
            const sy = Math.min(Math.floor(y / scale), sh - 1);
            S.distField[y * w + x] = dist[sy * sw + sx] * scale;
        }
    }
}

// ── Warp Effects ──

function applyDisplace(srcData, outData, w, h, time) {
    const strength = (S.intensity / 100) * 80;
    const softness = Math.max(1, (S.edgeSoftness / 100) * w * 0.15);
    const rng = mulberry32(S.seed);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const d = S.distField[idx];
            const isIn = S.insideMask[idx];

            // Displacement based on distance from text edge
            let dx = 0, dy = 0;
            if (!isIn && d < softness) {
                const factor = (1 - d / softness) * strength;
                // Direction: push away from text center
                const tcx = (S.textX / 100) * w;
                const tcy = (S.textY / 100) * h;
                const ax = x - tcx;
                const ay = y - tcy;
                const len = Math.sqrt(ax * ax + ay * ay) || 1;
                dx = (ax / len) * factor + Math.sin(y * 0.05 + time) * factor * 0.3;
                dy = (ay / len) * factor + Math.cos(x * 0.05 + time) * factor * 0.3;
            } else if (isIn) {
                // Subtle inward pull
                const factor = strength * 0.15;
                dx = Math.sin(x * 0.02 + y * 0.01 + time * 2) * factor;
                dy = Math.cos(y * 0.02 + x * 0.01 + time * 2) * factor;
            }

            const sx = Math.round(Math.max(0, Math.min(w - 1, x + dx)));
            const sy = Math.round(Math.max(0, Math.min(h - 1, y + dy)));
            const si = (sy * w + sx) * 4;
            const di = idx * 4;

            outData[di] = srcData[si];
            outData[di+1] = srcData[si+1];
            outData[di+2] = srcData[si+2];
            outData[di+3] = srcData[si+3];
        }
    }
}

function applyFocus(srcData, outData, w, h, time) {
    const blurRadius = Math.max(1, Math.round((S.intensity / 100) * 20));
    const softness = Math.max(1, (S.edgeSoftness / 100) * w * 0.1);

    // Pre-blur the entire image
    const blurred = boxBlur(srcData, w, h, blurRadius);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const d = S.distField[idx];
            const isIn = S.insideMask[idx];
            const di = idx * 4;

            let t = isIn ? 0 : Math.min(1, d / softness);
            t = t * t; // ease

            // Animate
            if (S.anim === 'breathe') {
                t *= 0.8 + 0.2 * Math.sin(time * 2);
            }

            outData[di]   = srcData[di]   * (1-t) + blurred[di]   * t;
            outData[di+1] = srcData[di+1] * (1-t) + blurred[di+1] * t;
            outData[di+2] = srcData[di+2] * (1-t) + blurred[di+2] * t;
            outData[di+3] = 255;
        }
    }
}

function applyScatter(srcData, outData, w, h, time) {
    const strength = (S.intensity / 100) * 60;
    const softness = Math.max(1, (S.edgeSoftness / 100) * w * 0.15);
    const rng = mulberry32(S.seed + Math.floor(time * 3));

    // Pre-generate random offsets
    const randX = new Float32Array(w * h);
    const randY = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        randX[i] = (rng() - 0.5) * 2;
        randY[i] = (rng() - 0.5) * 2;
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const d = S.distField[idx];
            const isIn = S.insideMask[idx];
            const di = idx * 4;

            let scatter = 0;
            if (!isIn) {
                scatter = Math.min(1, d / softness) * strength;
            }

            if (S.anim === 'glitch') {
                scatter *= 0.7 + 0.3 * Math.abs(Math.sin(time * 5 + y * 0.01));
            }

            const sx = Math.round(Math.max(0, Math.min(w-1, x + randX[idx] * scatter)));
            const sy = Math.round(Math.max(0, Math.min(h-1, y + randY[idx] * scatter)));
            const si = (sy * w + sx) * 4;

            outData[di]   = srcData[si];
            outData[di+1] = srcData[si+1];
            outData[di+2] = srcData[si+2];
            outData[di+3] = srcData[si+3];
        }
    }
}

function applyDensity(srcData, outData, w, h, time) {
    const gridBase = Math.max(2, Math.round(3 + (100 - S.detail) / 100 * 30));
    const softness = Math.max(1, (S.edgeSoftness / 100) * w * 0.15);
    const intensityF = S.intensity / 100;

    // Fill with bg first
    for (let i = 0; i < w * h * 4; i += 4) {
        outData[i] = outData[i+1] = outData[i+2] = 0;
        outData[i+3] = 255;
    }

    // Draw tiles of varying size based on text mask
    for (let gy = 0; gy < h; gy += gridBase) {
        for (let gx = 0; gx < w; gx += gridBase) {
            const idx = Math.min(gy, h-1) * w + Math.min(gx, w-1);
            const d = S.distField[idx];
            const isIn = S.insideMask[idx];

            let tileSize;
            if (isIn) {
                tileSize = gridBase;
            } else {
                const fade = Math.min(1, d / softness);
                tileSize = Math.max(1, Math.round(gridBase * (1 - fade * intensityF)));
            }

            // Sample color from center of tile
            const cx = Math.min(gx + Math.floor(gridBase/2), w-1);
            const cy = Math.min(gy + Math.floor(gridBase/2), h-1);
            const ci = (cy * w + cx) * 4;
            const r = srcData[ci], g = srcData[ci+1], b = srcData[ci+2];

            // Draw tile centered
            const offX = gx + Math.floor((gridBase - tileSize) / 2);
            const offY = gy + Math.floor((gridBase - tileSize) / 2);

            for (let ty = 0; ty < tileSize; ty++) {
                for (let tx = 0; tx < tileSize; tx++) {
                    const px = offX + tx;
                    const py = offY + ty;
                    if (px >= 0 && px < w && py >= 0 && py < h) {
                        const pi = (py * w + px) * 4;
                        outData[pi] = r;
                        outData[pi+1] = g;
                        outData[pi+2] = b;
                        outData[pi+3] = 255;
                    }
                }
            }
        }
    }
}

function applyWave(srcData, outData, w, h, time) {
    const strength = (S.intensity / 100) * 50;
    const freq = 0.01 + (S.detail / 100) * 0.08;
    const softness = Math.max(1, (S.edgeSoftness / 100) * w * 0.2);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const d = S.distField[idx];
            const isIn = S.insideMask[idx];
            const di = idx * 4;

            let waveAmt;
            if (isIn) {
                waveAmt = 0;
            } else {
                waveAmt = Math.min(1, d / softness);
            }

            const wave = waveAmt * strength;
            const dx = Math.sin(y * freq + d * 0.05 + time * 3) * wave;
            const dy = Math.cos(x * freq + d * 0.05 + time * 3) * wave;

            const sx = Math.round(Math.max(0, Math.min(w-1, x + dx)));
            const sy = Math.round(Math.max(0, Math.min(h-1, y + dy)));
            const si = (sy * w + sx) * 4;

            outData[di]   = srcData[si];
            outData[di+1] = srcData[si+1];
            outData[di+2] = srcData[si+2];
            outData[di+3] = srcData[si+3];
        }
    }
}

function applyShatter(srcData, outData, w, h, time) {
    const strength = (S.intensity / 100) * 40;
    const softness = Math.max(1, (S.edgeSoftness / 100) * w * 0.12);
    const rng = mulberry32(S.seed);

    // Create voronoi-like shatter cells
    const numCells = 30 + Math.round((S.detail / 100) * 150);
    const cellCenters = [];
    for (let i = 0; i < numCells; i++) {
        cellCenters.push({
            x: rng() * w,
            y: rng() * h,
            dx: (rng() - 0.5) * strength,
            dy: (rng() - 0.5) * strength,
        });
    }

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const d = S.distField[idx];
            const isIn = S.insideMask[idx];
            const di = idx * 4;

            // Find nearest cell
            let minDist = Infinity, nearest = 0;
            for (let c = 0; c < numCells; c++) {
                const cd = (x - cellCenters[c].x) ** 2 + (y - cellCenters[c].y) ** 2;
                if (cd < minDist) { minDist = cd; nearest = c; }
            }

            let shatterAmt = isIn ? 0 : Math.min(1, d / softness);

            if (S.anim === 'pulse-wave') {
                shatterAmt *= 0.5 + 0.5 * Math.sin(time * 2 + d * 0.02);
            }

            const cell = cellCenters[nearest];
            const dx = cell.dx * shatterAmt;
            const dy = cell.dy * shatterAmt;

            const sx = Math.round(Math.max(0, Math.min(w-1, x + dx)));
            const sy = Math.round(Math.max(0, Math.min(h-1, y + dy)));
            const si = (sy * w + sx) * 4;

            outData[di]   = srcData[si];
            outData[di+1] = srcData[si+1];
            outData[di+2] = srcData[si+2];
            outData[di+3] = srcData[si+3];
        }
    }
}

// ── Box blur helper ──
function boxBlur(data, w, h, radius) {
    const out = new Uint8ClampedArray(data.length);
    const tmp = new Uint8ClampedArray(data.length);

    // Horizontal pass
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0, count = 0;
            for (let kx = -radius; kx <= radius; kx++) {
                const sx = Math.max(0, Math.min(w-1, x + kx));
                const si = (y * w + sx) * 4;
                r += data[si]; g += data[si+1]; b += data[si+2];
                count++;
            }
            const di = (y * w + x) * 4;
            tmp[di] = r/count; tmp[di+1] = g/count; tmp[di+2] = b/count; tmp[di+3] = 255;
        }
    }

    // Vertical pass
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0, count = 0;
            for (let ky = -radius; ky <= radius; ky++) {
                const sy = Math.max(0, Math.min(h-1, y + ky));
                const si = (sy * w + x) * 4;
                r += tmp[si]; g += tmp[si+1]; b += tmp[si+2];
                count++;
            }
            const di = (y * w + x) * 4;
            out[di] = r/count; out[di+1] = g/count; out[di+2] = b/count; out[di+3] = 255;
        }
    }
    return out;
}

// ── Color processing ──
function applyColorEffects(outData, w, h) {
    const softness = Math.max(1, (S.edgeSoftness / 100) * w * 0.15);

    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const d = S.distField[idx];
            const isIn = S.insideMask[idx];
            const di = idx * 4;

            let r = outData[di], g = outData[di+1], b = outData[di+2];

            if (isIn) {
                // Inside text
                if (S.insideColor === 'bright') {
                    r = Math.min(255, r * 1.3);
                    g = Math.min(255, g * 1.3);
                    b = Math.min(255, b * 1.3);
                } else if (S.insideColor === 'saturate') {
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    const sat = 1.6;
                    r = Math.min(255, Math.max(0, gray + (r - gray) * sat));
                    g = Math.min(255, Math.max(0, gray + (g - gray) * sat));
                    b = Math.min(255, Math.max(0, gray + (b - gray) * sat));
                }
            } else {
                // Outside text
                if (S.outsideColor === 'grayscale') {
                    const t = Math.min(1, d / softness);
                    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
                    r = r * (1-t) + gray * t;
                    g = g * (1-t) + gray * t;
                    b = b * (1-t) + gray * t;
                } else if (S.outsideColor === 'dark') {
                    const t = Math.min(1, d / softness);
                    const darkF = 1 - t * 0.7;
                    r *= darkF; g *= darkF; b *= darkF;
                }
            }

            // BG overlay
            if (S.bgOpacity > 0 && !isIn) {
                const bgR = parseInt(S.bgColor.slice(1,3), 16);
                const bgG = parseInt(S.bgColor.slice(3,5), 16);
                const bgB = parseInt(S.bgColor.slice(5,7), 16);
                const t = Math.min(1, d / softness) * (S.bgOpacity / 100);
                r = r * (1-t) + bgR * t;
                g = g * (1-t) + bgG * t;
                b = b * (1-t) + bgB * t;
            }

            outData[di]   = Math.round(r);
            outData[di+1] = Math.round(g);
            outData[di+2] = Math.round(b);
        }
    }
}

// ── Main render ──
function render(time) {
    if (!S.sourceImg || !S.sourceImg.complete) return;

    const w = S.W, h = S.H;
    const ctx = S.ctx;

    // Draw source image to get pixel data
    S.processed.width = w;
    S.processed.height = h;
    const pCtx = S.processed.getContext('2d');
    pCtx.drawImage(S.sourceImg, 0, 0, w, h);
    const srcImageData = pCtx.getImageData(0, 0, w, h);
    const srcData = srcImageData.data;

    // Generate text mask
    generateTextMask(w, h);

    // Apply warp effect
    const outImageData = ctx.createImageData(w, h);
    const outData = outImageData.data;
    const t = (time || 0) * S.animSpeed;

    switch (S.mode) {
        case 'displace': applyDisplace(srcData, outData, w, h, t); break;
        case 'focus':    applyFocus(srcData, outData, w, h, t); break;
        case 'scatter':  applyScatter(srcData, outData, w, h, t); break;
        case 'density':  applyDensity(srcData, outData, w, h, t); break;
        case 'wave':     applyWave(srcData, outData, w, h, t); break;
        case 'shatter':  applyShatter(srcData, outData, w, h, t); break;
        default:         applyDisplace(srcData, outData, w, h, t);
    }

    // Apply color effects
    applyColorEffects(outData, w, h);

    ctx.putImageData(outImageData, 0, 0);
    S.needsRender = false;
}

// ── Animation loop ──
let animRAF = null;
function startAnim() {
    if (S.anim === 'none') { stopAnim(); return; }
    S.isAnimating = true;
    const startTime = performance.now();
    function tick() {
        const elapsed = (performance.now() - startTime) / 1000;
        render(elapsed);
        if (S.isAnimating) animRAF = requestAnimationFrame(tick);
    }
    animRAF = requestAnimationFrame(tick);
}

function stopAnim() {
    S.isAnimating = false;
    if (animRAF) { cancelAnimationFrame(animRAF); animRAF = null; }
}

// ── Fit canvas in preview ──
function fitCanvas() {
    if (!S.canvas) return;
    const area = document.getElementById('canvas-area');
    const aW = area.clientWidth, aH = area.clientHeight;
    if (aW <= 0 || aH <= 0) return;
    const s = Math.min(aW / S.W, aH / S.H) * 0.92;
    S.canvas.style.width = Math.floor(S.W * s) + 'px';
    S.canvas.style.height = Math.floor(S.H * s) + 'px';
}

// ── Status ──
function updateStatus(msg, type) {
    const el = document.getElementById('status');
    el.textContent = msg;
    el.className = 'status-msg' + (type ? ' ' + type : '');
}

// ── Theme ──
function initTheme() {
    const saved = localStorage.getItem('warp-theme');
    if (saved === 'light') document.documentElement.classList.add('light');
    updateThemeIcon();
}

function toggleTheme() {
    document.documentElement.classList.toggle('light');
    const isLight = document.documentElement.classList.contains('light');
    localStorage.setItem('warp-theme', isLight ? 'light' : 'dark');
    updateThemeIcon();
}

function updateThemeIcon() {
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = document.documentElement.classList.contains('light') ? '☽' : '☀';
}

// ── UI Binding ──
function bindUI() {
    // Image upload
    document.getElementById('imageInput').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                S.sourceImg = img;
                updateStatus('이미지 로드 완료', 'success');
                render();
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    // Apply button
    document.getElementById('applyBtn').addEventListener('click', () => {
        updateStatus('처리 중...');
        requestAnimationFrame(() => {
            render();
            if (S.anim !== 'none') startAnim();
            updateStatus('완료!', 'success');
        });
    });

    // Theme
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // Text input
    document.getElementById('warpText').addEventListener('input', (e) => {
        S.text = e.target.value || 'A';
        scheduleRender();
    });

    // Font select
    document.getElementById('fontSelect').addEventListener('change', (e) => {
        S.font = e.target.value;
        scheduleRender();
    });

    // Weight buttons
    document.querySelectorAll('.weight-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.weight-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.fontWeight = btn.dataset.weight;
            scheduleRender();
        });
    });

    // Range sliders
    const sliders = [
        { id: 'textSize', key: 'textSize', valId: 'textSizeVal' },
        { id: 'textLetterSpace', key: 'letterSpace', valId: 'textLetterSpaceVal' },
        { id: 'textX', key: 'textX', valId: 'textXVal' },
        { id: 'textY', key: 'textY', valId: 'textYVal' },
        { id: 'intensity', key: 'intensity', valId: 'intensityVal' },
        { id: 'edgeSoftness', key: 'edgeSoftness', valId: 'edgeSoftnessVal' },
        { id: 'detail', key: 'detail', valId: 'detailVal' },
        { id: 'seed', key: 'seed', valId: 'seedVal' },
        { id: 'bgOpacity', key: 'bgOpacity', valId: 'bgOpacityVal' },
        { id: 'animSpeed', key: 'animSpeed', valId: 'animSpeedVal' },
    ];

    sliders.forEach(({ id, key, valId }) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            S[key] = parseFloat(el.value);
            const valEl = document.getElementById(valId);
            if (valEl) valEl.textContent = el.value;
            scheduleRender();
        });
    });

    // Mode buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.mode = btn.dataset.mode;
            scheduleRender();
        });
    });

    // Inside/outside color
    document.querySelectorAll('.inside-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.inside-color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.insideColor = btn.dataset.color;
            scheduleRender();
        });
    });

    document.querySelectorAll('.outside-color-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.outside-color-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.outsideColor = btn.dataset.color;
            scheduleRender();
        });
    });

    // BG color
    document.getElementById('bgColor').addEventListener('input', (e) => {
        S.bgColor = e.target.value;
        scheduleRender();
    });

    // Animation buttons
    document.querySelectorAll('.anim-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.anim-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.anim = btn.dataset.anim;
            if (S.anim !== 'none') { startAnim(); } else { stopAnim(); render(); }
        });
    });

    // Canvas size
    document.getElementById('resizeBtn').addEventListener('click', () => {
        const w = parseInt(document.getElementById('canvasW').value) || 1080;
        const h = parseInt(document.getElementById('canvasH').value) || 1080;
        resizeCanvas(w, h);
    });

    // Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const w = parseInt(btn.dataset.w);
            const h = parseInt(btn.dataset.h);
            document.getElementById('canvasW').value = w;
            document.getElementById('canvasH').value = h;
            resizeCanvas(w, h);
        });
    });

    // Export scale
    document.querySelectorAll('.scale-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.scale-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            S.exportScale = parseInt(btn.dataset.scale);
        });
    });

    // Save PNG
    document.getElementById('savePngBtn').addEventListener('click', () => savePNG(false));
    document.getElementById('saveTransBtn').addEventListener('click', () => savePNG(true));

    // Window resize
    window.addEventListener('resize', fitCanvas);
}

let renderTimeout = null;
function scheduleRender() {
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => {
        render();
        if (S.anim !== 'none') startAnim();
    }, 50);
}

function resizeCanvas(w, h) {
    S.W = w; S.H = h;
    S.canvas.width = w;
    S.canvas.height = h;
    document.getElementById('canvasInfoText').textContent = w + ' x ' + h;
    fitCanvas();
    render();
}

function savePNG(transparent) {
    const scale = S.exportScale;
    const expW = S.W * scale;
    const expH = S.H * scale;

    const c = document.createElement('canvas');
    c.width = expW; c.height = expH;
    const ctx = c.getContext('2d');

    if (transparent) {
        // Render with alpha based on text mask
        const origW = S.W, origH = S.H;
        // Temporarily resize
        const tmpCanvas = document.createElement('canvas');
        tmpCanvas.width = expW; tmpCanvas.height = expH;
        const tmpCtx = tmpCanvas.getContext('2d');
        tmpCtx.drawImage(S.canvas, 0, 0, expW, expH);
        ctx.drawImage(tmpCanvas, 0, 0);
    } else {
        ctx.drawImage(S.canvas, 0, 0, expW, expH);
    }

    const link = document.createElement('a');
    link.download = 'warp-' + Date.now() + '.png';
    link.href = c.toDataURL('image/png');
    link.click();
    updateStatus('PNG 저장 완료!', 'success');
}

// ── Start ──
document.addEventListener('DOMContentLoaded', init);

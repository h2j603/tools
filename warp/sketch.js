/* ═══════════════════════════════════
   IMAGE DISTORT — Color Separation Engine
   Threshold · Color Map · Posterize · Grain
   ═══════════════════════════════════ */

const S = {
    canvas: null, ctx: null,
    W: 800, H: 600,
    sourceImg: null,
    srcImageData: null,
    // Threshold
    threshold: 50,
    channel: 'luma', // luma, r, g, b, saturation
    preBlur: 3,
    levels: 2,       // posterize levels (2=binary, 3-8=multi)
    // Color mapping
    colorLow: '#3030ff',
    colorMid: '#888888',
    colorHigh: '#d0d0d0',
    mixMode: 'flat',  // flat, tint, multiply
    // Post FX
    brightness: 0,
    contrast: 0,
    saturation: 30,
    grain: 5,
    edgeGlow: 15,
    edgeNoise: 20,  // edge pixel artifact intensity
    bloomRadius: 8, // glow spread distance
    edgeSmooth: 0,  // 0=sharp pixel edges, higher=rounder edges
    // Region
    invert: false,
    // View
    zoom: 1, panX: 0, panY: 0,
    isPanning: false, panStartX: 0, panStartY: 0,
    showOriginal: false,
    exportScale: 1,
    // Anim
    anim: 'none',
    animSpeed: 1.0,
    isAnimating: false,
    // Video
    videoEl: null,
    isVideo: false,
    isPlaying: false,
    videoDuration: 0,
    videoTime: 0,
};

const PRESETS = {
    'blueprint': { threshold:50, channel:'luma', preBlur:3, levels:2, colorLow:'#3030ff', colorHigh:'#d0d0d0', mixMode:'flat', saturation:30, grain:5, contrast:10, edgeGlow:15, edgeNoise:20, bloomRadius:8 },
    'noir': { threshold:50, channel:'luma', preBlur:2, levels:2, colorLow:'#000000', colorHigh:'#ffffff', mixMode:'flat', saturation:0, grain:15, contrast:20, edgeGlow:5, edgeNoise:15, bloomRadius:4 },
    'thermal': { threshold:40, channel:'luma', preBlur:4, levels:4, colorLow:'#1a0a3e', colorMid:'#ff4400', colorHigh:'#ffff00', mixMode:'flat', saturation:40, grain:3, contrast:0, edgeGlow:20, edgeNoise:10, bloomRadius:10 },
    'pop-art': { threshold:45, channel:'luma', preBlur:2, levels:3, colorLow:'#ff0066', colorMid:'#ffcc00', colorHigh:'#ffffff', mixMode:'flat', saturation:60, grain:0, contrast:30, edgeGlow:10, edgeNoise:25, bloomRadius:3 },
    'xray': { threshold:55, channel:'luma', preBlur:5, levels:2, colorLow:'#000020', colorHigh:'#88ccff', mixMode:'flat', saturation:10, grain:8, contrast:15, edgeGlow:25, edgeNoise:15, bloomRadius:12 },
    'solarize': { threshold:50, channel:'luma', preBlur:1, levels:6, colorLow:'#ff2200', colorMid:'#ffaa00', colorHigh:'#00ffaa', mixMode:'tint', saturation:50, grain:2, contrast:20, edgeGlow:8, edgeNoise:5, bloomRadius:5 },
    'duotone-warm': { threshold:50, channel:'luma', preBlur:3, levels:2, colorLow:'#cc3300', colorHigh:'#ffddaa', mixMode:'flat', saturation:20, grain:5, contrast:10, edgeGlow:12, edgeNoise:18, bloomRadius:6 },
    'retro-screen': { threshold:50, channel:'luma', preBlur:6, levels:3, colorLow:'#003322', colorMid:'#00aa66', colorHigh:'#88ffcc', mixMode:'flat', saturation:15, grain:20, contrast:5, edgeGlow:10, edgeNoise:20, bloomRadius:5 },
};

function init() {
    S.canvas = document.createElement('canvas');
    S.canvas.width = S.W;
    S.canvas.height = S.H;
    S.ctx = S.canvas.getContext('2d', { willReadFrequently: true });
    document.getElementById('canvas-container').appendChild(S.canvas);
    bindUI();
    initTheme();
    drawPlaceholder();
    fitCanvas(true);
}

function drawPlaceholder() {
    const ctx = S.ctx;
    ctx.fillStyle = '#18181e';
    ctx.fillRect(0, 0, S.W, S.H);
    ctx.fillStyle = '#404050';
    ctx.font = "700 18px 'JetBrains Mono', monospace";
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('DROP IMAGE OR CLICK PHOTO', S.W / 2, S.H / 2);
}

function mulberry32(a) {
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function loadFile(file) {
    if (file.type.startsWith('video/')) {
        loadVideo(file);
    } else {
        loadImage(file);
    }
}

function loadImage(file) {
    stopVideo();
    S.isVideo = false;
    const reader = new FileReader();
    reader.onload = (ev) => {
        const img = new Image();
        img.onload = () => {
            S.sourceImg = img;
            let w = img.naturalWidth, h = img.naturalHeight;
            const maxDim = 2400;
            if (w > maxDim || h > maxDim) {
                const r = Math.min(maxDim / w, maxDim / h);
                w = Math.round(w * r); h = Math.round(h * r);
            }
            S.W = w; S.H = h;
            S.canvas.width = w; S.canvas.height = h;
            const tc = document.createElement('canvas');
            tc.width = w; tc.height = h;
            tc.getContext('2d').drawImage(img, 0, 0, w, h);
            S.srcImageData = tc.getContext('2d').getImageData(0, 0, w, h);
            document.getElementById('canvasInfoText').textContent = w + ' \u00d7 ' + h;
            updateExportInfo();
            fitCanvas(true);
            render(0);
            showVideoControls(false);
            updateStatus(w + '\u00d7' + h + ' loaded', 'success');
        };
        img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
}

function loadVideo(file) {
    stopVideo();
    S.isVideo = true;
    S.isPlaying = false;
    if (S.videoEl) { S.videoEl.pause(); S.videoEl.src = ''; }
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    S.videoEl = video;

    const url = URL.createObjectURL(file);
    video.src = url;

    video.onloadedmetadata = () => {
        let w = video.videoWidth, h = video.videoHeight;
        const maxDim = 1200; // lower for video perf
        if (w > maxDim || h > maxDim) {
            const r = Math.min(maxDim / w, maxDim / h);
            w = Math.round(w * r); h = Math.round(h * r);
        }
        S.W = w; S.H = h;
        S.canvas.width = w; S.canvas.height = h;
        S.videoDuration = video.duration;
        S.videoTime = 0;
        S.sourceImg = video; // use video as source for Before/After

        document.getElementById('canvasInfoText').textContent = w + ' \u00d7 ' + h + ' | ' + Math.round(video.duration) + 's';
        updateExportInfo();
        fitCanvas(true);
        showVideoControls(true);

        // Capture first frame
        video.currentTime = 0;
    };

    video.onseeked = () => {
        captureVideoFrame();
    };

    video.onended = () => {
        S.isPlaying = false;
        updatePlayBtn();
    };
}

function captureVideoFrame() {
    if (!S.videoEl) return;
    const tc = document.createElement('canvas');
    tc.width = S.W; tc.height = S.H;
    tc.getContext('2d').drawImage(S.videoEl, 0, 0, S.W, S.H);
    S.srcImageData = tc.getContext('2d').getImageData(0, 0, S.W, S.H);
    render(0);
}

let videoRAF = null;
function videoPlayLoop() {
    if (!S.isPlaying || !S.videoEl) return;
    captureVideoFrame();
    // Update seek slider
    const seekEl = document.getElementById('videoSeek');
    if (seekEl) seekEl.value = (S.videoEl.currentTime / S.videoDuration * 100) || 0;
    const timeEl = document.getElementById('videoTimeVal');
    if (timeEl) timeEl.textContent = formatTime(S.videoEl.currentTime) + ' / ' + formatTime(S.videoDuration);
    videoRAF = requestAnimationFrame(videoPlayLoop);
}

function toggleVideoPlay() {
    if (!S.videoEl) return;
    if (S.isPlaying) {
        S.videoEl.pause();
        S.isPlaying = false;
        if (videoRAF) { cancelAnimationFrame(videoRAF); videoRAF = null; }
    } else {
        S.videoEl.play();
        S.isPlaying = true;
        videoPlayLoop();
    }
    updatePlayBtn();
}

function stopVideo() {
    if (S.videoEl) { S.videoEl.pause(); S.isPlaying = false; }
    if (videoRAF) { cancelAnimationFrame(videoRAF); videoRAF = null; }
}

function seekVideo(pct) {
    if (!S.videoEl) return;
    S.videoEl.currentTime = (pct / 100) * S.videoDuration;
}

function updatePlayBtn() {
    const btn = document.getElementById('videoPlayBtn');
    if (btn) btn.textContent = S.isPlaying ? '⏸' : '▶';
}

function showVideoControls(show) {
    const el = document.getElementById('videoControls');
    if (el) el.style.display = show ? '' : 'none';
}

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m + ':' + (sec < 10 ? '0' : '') + sec;
}

function exportProcessedVideo() {
    if (!S.videoEl) { updateStatus('비디오를 먼저 올려주세요', 'error'); return; }
    const fps = 30;
    const stream = S.canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9', videoBitsPerSecond: 8000000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const link = document.createElement('a');
        link.download = 'distort-video-' + Date.now() + '.webm';
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
        S.videoEl.pause();
        S.isPlaying = false;
        updatePlayBtn();
        updateStatus('video export done!', 'success');
    };

    // Play from start and record
    S.videoEl.currentTime = 0;
    S.videoEl.onseeked = () => {
        S.videoEl.onseeked = () => { captureVideoFrame(); }; // restore
        recorder.start();
        S.videoEl.play();
        S.isPlaying = true;
        updateStatus('exporting video...', '');

        function recordLoop() {
            if (S.videoEl.ended || S.videoEl.paused) {
                recorder.stop();
                S.isPlaying = false;
                if (videoRAF) cancelAnimationFrame(videoRAF);
                return;
            }
            captureVideoFrame();
            requestAnimationFrame(recordLoop);
        }
        recordLoop();
    };
}

function updateExportInfo() {
    const el = document.getElementById('exportInfo');
    if (el) el.textContent = (S.W * S.exportScale) + ' \u00d7 ' + (S.H * S.exportScale) + 'px';
}

// ── Box blur for pre-processing ──
function boxBlur(data, w, h, radius) {
    if (radius < 1) return new Uint8ClampedArray(data);
    const out = new Uint8ClampedArray(data.length);
    const tmp = new Uint8ClampedArray(data.length);
    // Horizontal
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0, c = 0;
            for (let kx = -radius; kx <= radius; kx++) {
                const si = (y * w + Math.max(0, Math.min(w - 1, x + kx))) * 4;
                r += data[si]; g += data[si + 1]; b += data[si + 2]; c++;
            }
            const di = (y * w + x) * 4;
            tmp[di] = r / c; tmp[di + 1] = g / c; tmp[di + 2] = b / c; tmp[di + 3] = 255;
        }
    }
    // Vertical
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let r = 0, g = 0, b = 0, c = 0;
            for (let ky = -radius; ky <= radius; ky++) {
                const si = (Math.max(0, Math.min(h - 1, y + ky)) * w + x) * 4;
                r += tmp[si]; g += tmp[si + 1]; b += tmp[si + 2]; c++;
            }
            const di = (y * w + x) * 4;
            out[di] = r / c; out[di + 1] = g / c; out[di + 2] = b / c; out[di + 3] = 255;
        }
    }
    return out;
}

// ── Channel extraction ──
function getChannelValue(r, g, b, channel) {
    switch (channel) {
        case 'r': return r;
        case 'g': return g;
        case 'b': return b;
        case 'saturation': {
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            return mx === 0 ? 0 : ((mx - mn) / mx) * 255;
        }
        default: return 0.299 * r + 0.587 * g + 0.114 * b; // luma
    }
}

// ── Parse hex color ──
function hexToRGB(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

// ── HSL utilities ──
function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h = 0, s = 0, l = (mx + mn) / 2;
    if (mx !== mn) {
        const d = mx - mn;
        s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
        if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
        else if (mx === g) h = ((b - r) / d + 2) / 6;
        else h = ((r - g) / d + 4) / 6;
    }
    return [h * 360, s * 100, l * 100];
}

function hsl2rgb(h, s, l) {
    h /= 360; s /= 100; l /= 100;
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const hue2rgb = (p, q, t) => {
        if (t < 0) t += 1; if (t > 1) t -= 1;
        if (t < 1 / 6) return p + (q - p) * 6 * t;
        if (t < 1 / 2) return q;
        if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
        return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [Math.round(hue2rgb(p, q, h + 1 / 3) * 255), Math.round(hue2rgb(p, q, h) * 255), Math.round(hue2rgb(p, q, h - 1 / 3) * 255)];
}

// ── Main render ──
function render(time) {
    if (!S.sourceImg || !S.srcImageData) return;
    const w = S.W, h = S.H;
    const src = S.srcImageData.data;

    // 1. Pre-blur
    const blurred = S.preBlur > 0 ? boxBlur(src, w, h, S.preBlur) : src;

    // 2. Extract channel values
    const vals = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) {
        const si = i * 4;
        vals[i] = getChannelValue(blurred[si], blurred[si + 1], blurred[si + 2], S.channel);
    }

    // 3. Threshold / Quantize
    const t = (time || 0) * S.animSpeed;
    const threshBase = (S.threshold / 100) * 255;
    let threshAnimOffset = 0;
    if (S.anim === 'breathe') threshAnimOffset = Math.sin(t * 2) * 20;
    else if (S.anim === 'evolve') threshAnimOffset = Math.sin(t * 0.8) * 40;
    else if (S.anim === 'glitch') threshAnimOffset = (Math.random() > 0.85 ? (Math.random() - 0.5) * 80 : 0);

    const levels = Math.max(2, Math.min(8, S.levels));
    const quantized = new Uint8Array(w * h); // 0..levels-1

    for (let i = 0; i < w * h; i++) {
        let v = vals[i] + threshAnimOffset;
        // Remap with threshold as midpoint
        const adjusted = ((v - threshBase) / 255) * levels * 2 + levels / 2;
        let q = Math.floor(Math.max(0, Math.min(levels - 1, adjusted)));
        if (S.invert) q = levels - 1 - q;
        quantized[i] = q;
    }

    // 3.5. Edge smooth: blur quantized map → re-quantize (rounds corners)
    if (S.edgeSmooth > 0) {
        const r = S.edgeSmooth;
        // Convert quantized to float
        const fmap = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) fmap[i] = quantized[i];
        // Horizontal blur
        const tmp = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let kx = -r; kx <= r; kx++) {
                    const nx = Math.max(0, Math.min(w - 1, x + kx));
                    sum += fmap[y * w + nx]; cnt++;
                }
                tmp[y * w + x] = sum / cnt;
            }
        }
        // Vertical blur
        const smoothed = new Float32Array(w * h);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let ky = -r; ky <= r; ky++) {
                    const ny = Math.max(0, Math.min(h - 1, y + ky));
                    sum += tmp[ny * w + x]; cnt++;
                }
                smoothed[y * w + x] = sum / cnt;
            }
        }
        // Re-quantize
        for (let i = 0; i < w * h; i++) {
            quantized[i] = Math.max(0, Math.min(levels - 1, Math.round(smoothed[i])));
        }
    }

    // 4. Color mapping
    const cLow = hexToRGB(S.colorLow);
    const cMid = hexToRGB(S.colorMid);
    const cHigh = hexToRGB(S.colorHigh);

    const outImageData = S.ctx.createImageData(w, h);
    const out = outImageData.data;
    const rng = mulberry32(S.seed + Math.floor(t * 3));

    for (let i = 0; i < w * h; i++) {
        const si = i * 4, q = quantized[i];
        const frac = q / (levels - 1); // 0..1

        let r, g, b;
        if (S.mixMode === 'flat') {
            // Interpolate between colors
            if (levels === 2) {
                r = cLow[0] + (cHigh[0] - cLow[0]) * frac;
                g = cLow[1] + (cHigh[1] - cLow[1]) * frac;
                b = cLow[2] + (cHigh[2] - cLow[2]) * frac;
            } else {
                if (frac <= 0.5) {
                    const t2 = frac * 2;
                    r = cLow[0] + (cMid[0] - cLow[0]) * t2;
                    g = cLow[1] + (cMid[1] - cLow[1]) * t2;
                    b = cLow[2] + (cMid[2] - cLow[2]) * t2;
                } else {
                    const t2 = (frac - 0.5) * 2;
                    r = cMid[0] + (cHigh[0] - cMid[0]) * t2;
                    g = cMid[1] + (cHigh[1] - cMid[1]) * t2;
                    b = cMid[2] + (cHigh[2] - cMid[2]) * t2;
                }
            }
        } else if (S.mixMode === 'tint') {
            // Original image tinted by mapped color
            const tintR = cLow[0] + (cHigh[0] - cLow[0]) * frac;
            const tintG = cLow[1] + (cHigh[1] - cLow[1]) * frac;
            const tintB = cLow[2] + (cHigh[2] - cLow[2]) * frac;
            r = (src[si] * 0.4 + tintR * 0.6);
            g = (src[si + 1] * 0.4 + tintG * 0.6);
            b = (src[si + 2] * 0.4 + tintB * 0.6);
        } else { // multiply
            const tintR = cLow[0] + (cHigh[0] - cLow[0]) * frac;
            const tintG = cLow[1] + (cHigh[1] - cLow[1]) * frac;
            const tintB = cLow[2] + (cHigh[2] - cLow[2]) * frac;
            r = (src[si] * tintR) / 255;
            g = (src[si + 1] * tintG) / 255;
            b = (src[si + 2] * tintB) / 255;
        }

        // 5. Edge pixel noise (dithering at boundaries)
        if (S.edgeNoise > 0) {
            const x = i % w, y = (i / w) | 0;
            let isNearEdge = false;
            // Check 2px neighborhood for level changes
            for (let dy = -2; dy <= 2 && !isNearEdge; dy++) {
                for (let dx = -2; dx <= 2 && !isNearEdge; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx, ny = y + dy;
                    if (nx >= 0 && nx < w && ny >= 0 && ny < h) {
                        if (quantized[ny * w + nx] !== q) isNearEdge = true;
                    }
                }
            }
            if (isNearEdge) {
                const nf = (S.edgeNoise / 100) * 80;
                const n = (rng() - 0.5) * nf;
                r += n; g += n; b += n;
                // Random pixel swap with neighbor (artifact effect)
                if (rng() < S.edgeNoise / 200) {
                    const ox = Math.max(0, Math.min(w - 1, x + Math.round((rng() - 0.5) * 4)));
                    const oy = Math.max(0, Math.min(h - 1, y + Math.round((rng() - 0.5) * 4)));
                    const ni = (oy * w + ox) * 4;
                    r = src[ni] * 0.5 + r * 0.5;
                    g = src[ni + 1] * 0.5 + g * 0.5;
                    b = src[ni + 2] * 0.5 + b * 0.5;
                }
            }
        }

        // 6. Post FX: brightness, contrast
        if (S.brightness !== 0) {
            const bf = S.brightness * 2.55;
            r += bf; g += bf; b += bf;
        }
        if (S.contrast !== 0) {
            const cf = (259 * (S.contrast * 2.55 + 255)) / (255 * (259 - S.contrast * 2.55));
            r = cf * (r - 128) + 128;
            g = cf * (g - 128) + 128;
            b = cf * (b - 128) + 128;
        }

        // 7. Saturation
        if (S.saturation !== 0) {
            const hsl = rgb2hsl(Math.max(0, Math.min(255, r)), Math.max(0, Math.min(255, g)), Math.max(0, Math.min(255, b)));
            hsl[1] = Math.max(0, Math.min(100, hsl[1] + S.saturation));
            const rgb = hsl2rgb(hsl[0], hsl[1], hsl[2]);
            r = rgb[0]; g = rgb[1]; b = rgb[2];
        }

        // 8. Grain
        if (S.grain > 0) {
            const noise = (rng() - 0.5) * S.grain * 5;
            r += noise; g += noise; b += noise;
        }

        out[si] = Math.max(0, Math.min(255, r));
        out[si + 1] = Math.max(0, Math.min(255, g));
        out[si + 2] = Math.max(0, Math.min(255, b));
        out[si + 3] = 255;
    }

    // 9. Bloom: spread glow from bright edges into dark regions
    if (S.edgeGlow > 0 && S.bloomRadius > 0) {
        // Build edge mask: pixels near level boundaries with high brightness
        const edgeMask = new Float32Array(w * h);
        for (let i = 0; i < w * h; i++) {
            const x = i % w, y = (i / w) | 0;
            const q = quantized[i];
            let isEdge = false;
            if (x > 0 && quantized[i - 1] !== q) isEdge = true;
            else if (x < w - 1 && quantized[i + 1] !== q) isEdge = true;
            else if (y > 0 && quantized[i - w] !== q) isEdge = true;
            else if (y < h - 1 && quantized[i + w] !== q) isEdge = true;
            if (isEdge) {
                // Glow intensity based on pixel brightness
                const si = i * 4;
                const lum = (out[si] * 0.299 + out[si + 1] * 0.587 + out[si + 2] * 0.114) / 255;
                edgeMask[i] = lum;
            }
        }

        // Spread the edge glow using a fast blur on the mask
        const bR = S.bloomRadius;
        const glowStr = S.edgeGlow / 100;
        const spread = new Float32Array(w * h);

        // Horizontal spread
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let kx = -bR; kx <= bR; kx++) {
                    const nx = Math.max(0, Math.min(w - 1, x + kx));
                    const v = edgeMask[y * w + nx];
                    if (v > 0) {
                        const weight = 1 - Math.abs(kx) / (bR + 1);
                        sum += v * weight;
                        cnt += weight;
                    }
                }
                spread[y * w + x] = cnt > 0 ? sum / cnt : 0;
            }
        }
        // Vertical spread + apply
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                let sum = 0, cnt = 0;
                for (let ky = -bR; ky <= bR; ky++) {
                    const ny = Math.max(0, Math.min(h - 1, y + ky));
                    const v = spread[ny * w + x];
                    if (v > 0) {
                        const weight = 1 - Math.abs(ky) / (bR + 1);
                        sum += v * weight;
                        cnt += weight;
                    }
                }
                const glow = (cnt > 0 ? sum / cnt : 0) * glowStr;
                if (glow > 0.01) {
                    const di = (y * w + x) * 4;
                    // Additive blend: push toward white
                    out[di]     = Math.min(255, out[di]     + glow * 255 * 0.7);
                    out[di + 1] = Math.min(255, out[di + 1] + glow * 255 * 0.7);
                    out[di + 2] = Math.min(255, out[di + 2] + glow * 255 * 0.7);
                }
            }
        }
    }

    S.ctx.putImageData(outImageData, 0, 0);
}

// ── Animation ──
let animRAF = null, animStartTime = 0;
function startAnim() {
    if (S.anim === 'none') { stopAnim(); return; }
    S.isAnimating = true;
    animStartTime = performance.now();
    function tick(now) {
        if (!S.isAnimating) return;
        render((now - animStartTime) / 1000);
        animRAF = requestAnimationFrame(tick);
    }
    animRAF = requestAnimationFrame(tick);
}
function stopAnim() {
    S.isAnimating = false;
    if (animRAF) { cancelAnimationFrame(animRAF); animRAF = null; }
}

// ── Canvas fit / zoom / pan ──
function fitCanvas(resetView) {
    if (!S.canvas) return;
    const area = document.getElementById('canvas-area');
    const aW = area.clientWidth, aH = area.clientHeight;
    if (aW <= 0 || aH <= 0) return;
    const baseScale = Math.min(aW / S.W, aH / S.H) * 0.92;
    if (resetView) { S.zoom = 1; S.panX = 0; S.panY = 0; }
    const s = baseScale * S.zoom;
    S.canvas.style.width = Math.floor(S.W * s) + 'px';
    S.canvas.style.height = Math.floor(S.H * s) + 'px';
    S.canvas.style.transform = 'translate(' + S.panX + 'px,' + S.panY + 'px)';
}

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
    localStorage.setItem('warp-theme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
    updateThemeIcon();
}
function updateThemeIcon() {
    const icon = document.getElementById('themeIcon');
    if (icon) icon.textContent = document.documentElement.classList.contains('light') ? '\u263d' : '\u2600';
}

function bindToggleGroup(selector, callback) {
    document.querySelectorAll(selector).forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll(selector).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            callback(btn);
        });
    });
}

let renderTimeout = null;
function scheduleRender() {
    if (!S.sourceImg) return;
    clearTimeout(renderTimeout);
    renderTimeout = setTimeout(() => { render(0); if (S.anim !== 'none') startAnim(); }, 30);
}

function syncUIFromState() {
    const map = {
        'threshold': 'threshold', 'preBlur': 'preBlur', 'levels': 'levels',
        'intensity': 'threshold', 'detail': 'levels', 'seed': 'seed',
        'brightness': 'brightness', 'contrast': 'contrast', 'saturation': 'saturation',
        'grain': 'grain', 'edgeSmooth': 'edgeSmooth',
        'edgeGlow': 'edgeGlow', 'edgeNoise': 'edgeNoise',
        'bloomRadius': 'bloomRadius', 'animSpeed': 'animSpeed',
    };
    const valMap = {
        'threshold': 'thresholdVal', 'preBlur': 'preBlurVal', 'levels': 'levelsVal',
        'brightness': 'brightnessVal', 'contrast': 'contrastVal', 'saturation': 'saturationVal',
        'grain': 'grainVal', 'edgeSmooth': 'edgeSmoothVal',
        'edgeGlow': 'edgeGlowVal', 'edgeNoise': 'edgeNoiseVal',
        'bloomRadius': 'bloomRadiusVal', 'animSpeed': 'animSpeedVal',
    };
    Object.keys(valMap).forEach(elId => {
        const el = document.getElementById(elId);
        if (el) el.value = S[elId];
        const valEl = document.getElementById(valMap[elId]);
        if (valEl) valEl.textContent = S[elId];
    });
    document.getElementById('colorLow').value = S.colorLow;
    document.getElementById('colorMid').value = S.colorMid;
    document.getElementById('colorHigh').value = S.colorHigh;
    document.querySelectorAll('.channel-btn').forEach(b => b.classList.toggle('active', b.dataset.channel === S.channel));
    document.querySelectorAll('.mix-btn').forEach(b => b.classList.toggle('active', b.dataset.mix === S.mixMode));
    document.querySelectorAll('.invert-btn').forEach(b => b.classList.toggle('active', (b.dataset.invert === 'true') === S.invert));
    document.querySelectorAll('.anim-btn').forEach(b => b.classList.toggle('active', b.dataset.anim === S.anim));
}

function randomizeParams() {
    const channels = ['luma', 'r', 'g', 'b', 'saturation'];
    S.channel = channels[Math.floor(Math.random() * channels.length)];
    S.threshold = 20 + Math.floor(Math.random() * 60);
    S.preBlur = Math.floor(Math.random() * 10);
    S.levels = 2 + Math.floor(Math.random() * 5);
    S.mixMode = ['flat', 'tint', 'multiply'][Math.floor(Math.random() * 3)];
    S.invert = Math.random() > 0.7;
    S.brightness = Math.floor((Math.random() - 0.5) * 40);
    S.contrast = Math.floor(Math.random() * 40);
    S.saturation = Math.floor(Math.random() * 80 - 20);
    S.grain = Math.floor(Math.random() * 25);
    S.edgeSmooth = Math.floor(Math.random() * 10);
    S.edgeGlow = 5 + Math.floor(Math.random() * 30);
    S.edgeNoise = 5 + Math.floor(Math.random() * 35);
    S.bloomRadius = 3 + Math.floor(Math.random() * 15);
    // Random colors
    const rc = () => '#' + Math.floor(Math.random() * 16777215).toString(16).padStart(6, '0');
    S.colorLow = rc(); S.colorMid = rc(); S.colorHigh = rc();
    syncUIFromState();
    scheduleRender();
    updateStatus('randomized!', 'success');
}

function applyPreset(p) {
    Object.keys(p).forEach(k => { S[k] = p[k]; });
    syncUIFromState();
    scheduleRender();
    updateStatus('preset applied!', 'success');
}

function bindUI() {
    // Image upload
    document.getElementById('imageInput').addEventListener('change', (e) => {
        if (e.target.files[0]) loadFile(e.target.files[0]);
    });
    const area = document.getElementById('canvas-area');
    area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('drag-over'); });
    area.addEventListener('dragleave', () => area.classList.remove('drag-over'));
    area.addEventListener('drop', (e) => {
        e.preventDefault(); area.classList.remove('drag-over');
        const file = e.dataTransfer.files[0];
        if (file && (file.type.startsWith('image/') || file.type.startsWith('video/'))) loadFile(file);
    });

    // Apply
    document.getElementById('applyBtn').addEventListener('click', () => {
        if (!S.sourceImg) { updateStatus('upload image first', 'error'); return; }
        updateStatus('processing...');
        setTimeout(() => { render(0); if (S.anim !== 'none') startAnim(); updateStatus('done!', 'success'); }, 16);
    });

    // View
    document.getElementById('resetViewBtn').addEventListener('click', () => { fitCanvas(true); if (S.sourceImg) render(0); });
    document.getElementById('themeToggle').addEventListener('click', toggleTheme);

    // Zoom / Pan
    area.addEventListener('wheel', (e) => {
        e.preventDefault();
        S.zoom = Math.max(0.1, Math.min(10, S.zoom * (e.deltaY > 0 ? 0.9 : 1.1)));
        fitCanvas();
    }, { passive: false });
    area.addEventListener('mousedown', (e) => {
        if (e.button === 1 || (e.button === 0 && e.altKey)) {
            e.preventDefault();
            S.isPanning = true; S.panStartX = e.clientX - S.panX; S.panStartY = e.clientY - S.panY;
            area.style.cursor = 'grabbing';
        }
    });
    window.addEventListener('mousemove', (e) => {
        if (!S.isPanning) return;
        S.panX = e.clientX - S.panStartX; S.panY = e.clientY - S.panStartY;
        fitCanvas();
    });
    window.addEventListener('mouseup', () => {
        if (S.isPanning) { S.isPanning = false; area.style.cursor = ''; }
    });

    // Before/After
    document.addEventListener('keydown', (e) => {
        if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'TEXTAREA' && document.activeElement.tagName !== 'INPUT') {
            e.preventDefault();
            S.showOriginal = true;
            if (S.sourceImg) {
                S.ctx.drawImage(S.sourceImg, 0, 0, S.W, S.H);
            }
        }
    });
    document.addEventListener('keyup', (e) => {
        if (e.code === 'Space') { S.showOriginal = false; if (S.sourceImg) render(0); }
    });

    // Randomize
    document.getElementById('randomizeBtn').addEventListener('click', randomizeParams);

    // Presets
    document.querySelectorAll('.preset-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const p = PRESETS[btn.dataset.preset];
            if (p) applyPreset(p);
        });
    });

    // Sliders
    const sliders = [
        ['threshold', 'threshold', 'thresholdVal'],
        ['preBlur', 'preBlur', 'preBlurVal'],
        ['levels', 'levels', 'levelsVal'],
        ['brightness', 'brightness', 'brightnessVal'],
        ['contrast', 'contrast', 'contrastVal'],
        ['saturation', 'saturation', 'saturationVal'],
        ['grain', 'grain', 'grainVal'],
        ['edgeSmooth', 'edgeSmooth', 'edgeSmoothVal'],
        ['edgeGlow', 'edgeGlow', 'edgeGlowVal'],
        ['edgeNoise', 'edgeNoise', 'edgeNoiseVal'],
        ['bloomRadius', 'bloomRadius', 'bloomRadiusVal'],
        ['animSpeed', 'animSpeed', 'animSpeedVal'],
    ];
    sliders.forEach(([id, key, valId]) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            S[key] = parseFloat(el.value);
            const valEl = document.getElementById(valId);
            if (valEl) valEl.textContent = el.value;
            scheduleRender();
        });
    });

    // Colors
    ['colorLow', 'colorMid', 'colorHigh'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', (e) => { S[id] = e.target.value; scheduleRender(); });
    });

    // Toggle groups
    bindToggleGroup('.channel-btn', (btn) => { S.channel = btn.dataset.channel; scheduleRender(); });
    bindToggleGroup('.mix-btn', (btn) => { S.mixMode = btn.dataset.mix; scheduleRender(); });
    bindToggleGroup('.invert-btn', (btn) => { S.invert = btn.dataset.invert === 'true'; scheduleRender(); });
    bindToggleGroup('.anim-btn', (btn) => {
        S.anim = btn.dataset.anim;
        if (S.anim !== 'none') startAnim(); else { stopAnim(); if (S.sourceImg) render(0); }
    });
    bindToggleGroup('.scale-btn', (btn) => { S.exportScale = parseInt(btn.dataset.scale); updateExportInfo(); });

    // Export
    document.getElementById('savePngBtn').addEventListener('click', () => savePNG(false));
    document.getElementById('saveTransBtn').addEventListener('click', () => savePNG(true));
    const clipBtn = document.getElementById('clipboardBtn');
    if (clipBtn) clipBtn.addEventListener('click', copyToClipboard);
    const webmBtn = document.getElementById('saveWebmBtn');
    if (webmBtn) webmBtn.addEventListener('click', () => {
        if (S.isVideo) exportProcessedVideo();
        else exportWebM();
    });

    // Video controls
    const playBtn = document.getElementById('videoPlayBtn');
    if (playBtn) playBtn.addEventListener('click', toggleVideoPlay);
    const seekEl = document.getElementById('videoSeek');
    if (seekEl) seekEl.addEventListener('input', (e) => seekVideo(parseFloat(e.target.value)));
    const exportVidBtn = document.getElementById('exportVideoBtn');
    if (exportVidBtn) exportVidBtn.addEventListener('click', exportProcessedVideo);

    window.addEventListener('resize', () => fitCanvas());
}

async function copyToClipboard() {
    if (!S.sourceImg) { updateStatus('upload image first', 'error'); return; }
    try {
        const blob = await new Promise(resolve => S.canvas.toBlob(resolve, 'image/png'));
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        updateStatus('copied!', 'success');
    } catch (e) { updateStatus('copy failed: ' + e.message, 'error'); }
}

function exportWebM() {
    if (!S.sourceImg) { updateStatus('upload image first', 'error'); return; }
    const duration = 4000, fps = 30;
    const stream = S.canvas.captureStream(fps);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9', videoBitsPerSecond: 5000000 });
    const chunks = [];
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const link = document.createElement('a');
        link.download = 'distort-' + Date.now() + '.webm';
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
        updateStatus('WebM saved!', 'success');
    };
    const prevAnim = S.anim;
    if (S.anim === 'none') S.anim = 'breathe';
    startAnim();
    recorder.start();
    updateStatus('recording ' + (duration / 1000) + 's...', '');
    setTimeout(() => {
        recorder.stop(); stopAnim();
        S.anim = prevAnim;
        if (prevAnim === 'none') render(0);
        syncUIFromState();
    }, duration);
}

function savePNG(transparent) {
    if (!S.sourceImg) { updateStatus('upload image first', 'error'); return; }
    const scale = S.exportScale;
    const expW = S.W * scale, expH = S.H * scale;
    const c = document.createElement('canvas');
    c.width = expW; c.height = expH;
    const ctx = c.getContext('2d');
    if (scale > 1) {
        const origW = S.W, origH = S.H;
        S.W = expW; S.H = expH;
        S.canvas.width = expW; S.canvas.height = expH;
        const tc = document.createElement('canvas');
        tc.width = expW; tc.height = expH;
        tc.getContext('2d').drawImage(S.sourceImg, 0, 0, expW, expH);
        S.srcImageData = tc.getContext('2d').getImageData(0, 0, expW, expH);
        render(0);
        ctx.drawImage(S.canvas, 0, 0);
        S.W = origW; S.H = origH;
        S.canvas.width = origW; S.canvas.height = origH;
        const tc2 = document.createElement('canvas');
        tc2.width = origW; tc2.height = origH;
        tc2.getContext('2d').drawImage(S.sourceImg, 0, 0, origW, origH);
        S.srcImageData = tc2.getContext('2d').getImageData(0, 0, origW, origH);
        render(0);
        fitCanvas();
    } else {
        ctx.drawImage(S.canvas, 0, 0);
    }
    const link = document.createElement('a');
    link.download = 'distort-' + Date.now() + '.png';
    link.href = c.toDataURL('image/png');
    link.click();
    updateStatus(expW + '\u00d7' + expH + ' PNG saved!', 'success');
}

document.addEventListener('DOMContentLoaded', init);

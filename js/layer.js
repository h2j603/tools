/* ═══════════════════════════════════
   Layer Class & Constants
   ═══════════════════════════════════ */

const LAYER_COLORS = ['#4488ff','#ff4488','#44cc88','#ffaa44','#aa44ff','#44dddd','#ff6644','#88cc44'];

const FONT_OPTIONS = [
    { value: 'kozuka-mincho-pr6n, serif', label: 'Kozuka Mincho' },
    { value: "'Noto Sans KR', sans-serif", label: 'Noto Sans KR' },
    { value: "'Noto Serif KR', serif", label: 'Noto Serif KR' },
    { value: "'Black Han Sans', sans-serif", label: '블랙한산스' },
    { value: "'SunBatang', serif", label: '순바탕' },
    { value: 'serif', label: 'Serif' },
    { value: 'sans-serif', label: 'Sans-serif' },
    { value: 'monospace', label: 'Monospace' },
    { value: 'Georgia, serif', label: 'Georgia' },
    { value: "'Courier New', monospace", label: 'Courier New' }
];

class Layer {
    constructor(id) {
        this.id = id;
        this.name = 'Layer ' + (id + 1);
        this.visible = true;
        this.text = 'A';
        this.fontFamily = 'kozuka-mincho-pr6n, serif';
        this.fontWeight = '400';
        // Morph steps: each step = { text, fontFamily, fontWeight }
        this.morphStepDefs = [
            { text: 'B', fontFamily: 'kozuka-mincho-pr6n, serif', fontWeight: '400' }
        ];
        this.fontSize = 50;
        this.tileSize = 5;
        this.tileMode = 'fill';
        this.tileShape = 'rect';
        this.scaleX = 100;
        this.letterSpace = 0;
        this.lineHeight = 120;
        this.offsetX = 0;
        this.offsetY = 0;
        this.opacity = 100;
        this.blendMode = 'source-over';
        this.morphDuration = 2;
        this.morphHold = 0.5;
        this.effects = { web: false, rotate: false, pulse: false, morph: false, wave: false, rotate3d: false, vortex: false, scatter: false, sequencer: false, spring: false };
        this.scatterProgress = 0;
        this.scatterDirection = 1;
        this.sequencerProgress = 0;
        this.tiles1 = [];
        this.tiles2 = [];
        this.morphSteps = []; // generated tile arrays
        this.morphStepIdx = 0;
        this.currentTiles = [];
        this.morphProgress = 0;
        this.morphDirection = 1;
        this.morphHolding = false;
        this.morphHoldTimer = 0;
        this.color = LAYER_COLORS[id % LAYER_COLORS.length];
    }
}

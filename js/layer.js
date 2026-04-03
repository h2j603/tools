/* ═══════════════════════════════════
   Layer Class & Constants
   ═══════════════════════════════════ */

const LAYER_COLORS = ['#4488ff','#ff4488','#44cc88','#ffaa44','#aa44ff','#44dddd','#ff6644','#88cc44'];

class Layer {
    constructor(id) {
        this.id = id;
        this.name = 'Layer ' + (id + 1);
        this.visible = true;
        this.text = 'A';
        this.morphText = 'B';
        this.fontFamily = 'kozuka-mincho-pr6n, serif';
        this.fontWeight = '400';
        this.morphFontFamily = 'kozuka-mincho-pr6n, serif';
        this.morphFontWeight = '400';
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
        this.morphSteps = [];  // array of tile arrays for multi-morph
        this.morphStepIdx = 0; // current step index
        this.currentTiles = [];
        this.morphProgress = 0;
        this.morphDirection = 1;
        this.morphHolding = false;
        this.morphHoldTimer = 0;
        this.color = LAYER_COLORS[id % LAYER_COLORS.length];
    }
}

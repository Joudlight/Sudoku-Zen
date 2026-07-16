/* ═══════════════════════════════════════════════════════
   SUDOKU ZEN — PHASE 1: WEB AUDIO ENGINE (upgrade)
   Replaces your existing `const Sound = {…}` object.

   What's new:
   • Wood-block synthesis (sharp transient + wooden body resonance)
   • Singing-bowl synthesis (slow-attack sine + 3 harmonics, long tail)
   • Combo-pitch scaling — each consecutive correct placement
     bends the placement pitch up by 1 semitone (capped at 1 octave)
   • Single master gain node (one volume knob, click-free shutdown)
   • unlock() method to satisfy mobile/Chrome autoplay policies

   Public API stays IDENTICAL (place / correct / error / erase / hint /
   complete / noteOn / undo / toggle), so the rest of your code does
   not need to change.
   ═══════════════════════════════════════════════════════ */
const Sound = {
  _ctxInstance: null,
  _master:      null,
  _enabled:     localStorage.getItem('sz-sound') !== 'off',

  // Combo-pitch settings. comboCount is read LIVE from your module scope.
  _comboStepSemitones: 1,    // pitch rises 1 semitone per combo step
  _comboMaxSteps:      12,   // cap at 1 octave
  _comboBaseNote:      60,   // MIDI 60 = C4 (261.63 Hz)

  // ── Audio context bootstrap ────────────────────────────────────────────
  _getCtx() {
    if (this._ctxInstance) return this._ctxInstance;
    try {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      this._ctxInstance = new Ctor();
      // Master gain — single point of volume control + click-free ramp-down
      this._master = this._ctxInstance.createGain();
      this._master.gain.value = 0.9;
      this._master.connect(this._ctxInstance.destination);
    } catch (e) { return null; }
    return this._ctxInstance;
  },

  /** Resume on first user gesture (mobile Safari / Chrome autoplay policy). */
  unlock() {
    const ctx = this._getCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  },

  /** MIDI note → frequency (Hz). */
  _mtof(note) { return 440 * Math.pow(2, (note - 69) / 12); },

  // ── Synthesis primitives ───────────────────────────────────────────────

  /**
   * Wood-block hit. Two layers:
   *   1. Sharp transient click (square @ 2.4× fundamental, ~30ms decay)
   *   2. Wooden body resonance (triangle through bandpass, ~140ms decay)
   */
  woodBlock(opts = {}) {
    if (!this._enabled) return;
    const ctx = this._getCtx(); if (!ctx) return;
    const t0   = ctx.currentTime + (opts.delay || 0);
    const freq = opts.freq || this._mtof(72);
    const vol  = opts.vol  ?? 0.18;

    // 1. Transient click
    const click = ctx.createOscillator();
    const clickGain = ctx.createGain();
    click.type = 'square';
    click.frequency.value = freq * 2.4;
    clickGain.gain.setValueAtTime(vol * 0.6, t0);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.03);
    click.connect(clickGain).connect(this._master);
    click.start(t0); click.stop(t0 + 0.04);
    click.onended = () => { click.disconnect(); clickGain.disconnect(); };

    // 2. Wooden body
    const body = ctx.createOscillator();
    const bodyGain = ctx.createGain();
    const bodyFilter = ctx.createBiquadFilter();
    body.type = 'triangle';
    body.frequency.value = freq;
    bodyFilter.type = 'bandpass';
    bodyFilter.frequency.value = freq * 1.5;
    bodyFilter.Q.value = 2.2;
    bodyGain.gain.setValueAtTime(vol, t0);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
    body.connect(bodyFilter).connect(bodyGain).connect(this._master);
    body.start(t0); body.stop(t0 + 0.16);
    body.onended = () => { body.disconnect(); bodyGain.disconnect(); bodyFilter.disconnect(); };
  },

  /**
   * Singing bowl. Long-decay harmonic stack with slow attack (no click).
   * Partials: 1×, 2×, 3×, 4.2× (the 4.2 gives a metallic shimmer).
   */
  singingBowl(opts = {}) {
    if (!this._enabled) return;
    const ctx = this._getCtx(); if (!ctx) return;
    const t0   = ctx.currentTime + (opts.delay || 0);
    const freq = opts.freq || this._mtof(72);
    const vol  = opts.vol  ?? 0.14;
    const dur  = opts.dur  ?? 2.4;

    const partials = [
      { mult: 1.0, gain: 1.00, type: 'sine'     },
      { mult: 2.0, gain: 0.45, type: 'sine'     },
      { mult: 3.0, gain: 0.25, type: 'sine'     },
      { mult: 4.2, gain: 0.12, type: 'triangle' }
    ];

    partials.forEach(p => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = p.type;
      o.frequency.value = freq * p.mult;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol * p.gain, t0 + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this._master);
      o.start(t0); o.stop(t0 + dur + 0.05);
      o.onended = () => { o.disconnect(); g.disconnect(); };
    });
  },

  /** Soft low thud for errors — sine sweep downward through a lowpass. */
  softThud(opts = {}) {
    if (!this._enabled) return;
    const ctx = this._getCtx(); if (!ctx) return;
    const t0   = ctx.currentTime + (opts.delay || 0);
    const freq = opts.freq || this._mtof(48);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    const f = ctx.createBiquadFilter();
    o.type = 'sine';
    o.frequency.setValueAtTime(freq, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.6, t0 + 0.18);
    f.type = 'lowpass'; f.frequency.value = 600;
    g.gain.setValueAtTime(0.16, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
    o.connect(f).connect(g).connect(this._master);
    o.start(t0); o.stop(t0 + 0.3);
    o.onended = () => { o.disconnect(); g.disconnect(); f.disconnect(); };
  },

  // ── Combo-aware pitch bend ─────────────────────────────────────────────
  _comboOffset() {
    // Read comboCount defensively (it lives in your module scope)
    const c = (typeof comboCount !== 'undefined') ? comboCount : 0;
    return Math.min(c, this._comboMaxSteps) * this._comboStepSemitones;
  },

  // ── Public API (drop-in replacement) ───────────────────────────────────

  /** Plain placement — combo-pitched wood block. */
  place() {
    const note = this._comboBaseNote + this._comboOffset();
    this.woodBlock({ freq: this._mtof(note), vol: 0.16 });
  },

  /** Correct placement — wood block + singing-bowl tail, pitch climbs with combo. */
  correct() {
    const note = this._comboBaseNote + 4 + this._comboOffset();
    this.woodBlock({ freq: this._mtof(note), vol: 0.18 });
    this.singingBowl({ freq: this._mtof(note + 7), vol: 0.10, dur: 1.2, delay: 0.02 });
  },

  /** Wrong placement — soft thud. */
  error() {
    this.softThud();
  },

  /** Erase — softer, lower wood block. */
  erase() {
    this.woodBlock({ freq: this._mtof(55), vol: 0.10 });
  },

  /** Hint — two-note singing bowl. */
  hint() {
    this.singingBowl({ freq: this._mtof(76), vol: 0.14, dur: 1.8 });
    this.singingBowl({ freq: this._mtof(83), vol: 0.10, dur: 1.8, delay: 0.08 });
  },

  /** Win — ascending singing-bowl arpeggio (C – E – G – C – E). */
  complete() {
    const base = 60;
    [0, 4, 7, 12, 16].forEach((interval, i) => {
      this.singingBowl({
        freq: this._mtof(base + interval),
        vol:  0.16,
        dur:  2.4,
        delay: i * 0.18
      });
    });
  },

  /** Pencil tick — very short, very soft wood block. */
  noteOn() {
    this.woodBlock({ freq: this._mtof(84), vol: 0.06 });
  },

  /** Undo — low wood block. */
  undo() {
    this.woodBlock({ freq: this._mtof(52), vol: 0.10 });
  },

  /** Toggle mute. Plays a confirmation bowl when re-enabling. */
  toggle() {
    this._enabled = !this._enabled;
    localStorage.setItem('sz-sound', this._enabled ? 'on' : 'off');
    if (typeof updateSoundBtn === 'function') updateSoundBtn();
    if (this._enabled) this.singingBowl({ freq: this._mtof(72), vol: 0.12, dur: 1.0 });
  }
};

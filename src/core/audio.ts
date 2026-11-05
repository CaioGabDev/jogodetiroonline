import type { WeaponSound } from '../game/weapons';
import { settings } from './settings';

export type HitKind = 'hit' | 'head' | 'kill';

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Procedural sound effects synthesized with the Web Audio API (no audio files). */
class AudioEngine {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private ui!: GainNode;
  private noise!: AudioBuffer;
  private lastFoot = 0;

  /** Must be called from a user gesture at least once (autoplay policy). */
  unlock(): void {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
      } catch {
        return;
      }
      this.master = this.ctx.createGain();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -12;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      this.sfx = this.ctx.createGain();
      this.ui = this.ctx.createGain();
      this.sfx.connect(this.master);
      this.ui.connect(this.master);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      settings.onChange(() => this.applyVolumes());
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const s = settings.get();
    this.master.gain.value = s.masterVolume;
    this.sfx.gain.value = s.sfxVolume;
    this.ui.gain.value = s.uiVolume;
  }

  setListener(pos: Vec3Like, fwd: Vec3Like): void {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(pos.x, t);
      l.positionY.setValueAtTime(pos.y, t);
      l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t);
      l.forwardY.setValueAtTime(fwd.y, t);
      l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  /** Output node: either the bus directly or a 3D panner placed at pos. */
  private out(bus: 'sfx' | 'ui', pos?: Vec3Like, refDist = 4): AudioNode | null {
    if (!this.ctx || this.ctx.state !== 'running') return null;
    const target = bus === 'sfx' ? this.sfx : this.ui;
    if (!pos) return target;
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = refDist;
    p.maxDistance = 200;
    p.rolloffFactor = 1.2;
    const t = this.ctx.currentTime;
    if (p.positionX) {
      p.positionX.setValueAtTime(pos.x, t);
      p.positionY.setValueAtTime(pos.y, t);
      p.positionZ.setValueAtTime(pos.z, t);
    } else {
      p.setPosition(pos.x, pos.y, pos.z);
    }
    p.connect(target);
    return p;
  }

  private noiseBurst(
    dest: AudioNode,
    opts: { type: BiquadFilterType; freq: number; q?: number; dur: number; gain: number; delay?: number; freqEnd?: number },
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) f.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.dur);
    f.Q.value = opts.q ?? 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5);
    src.stop(t + opts.dur + 0.05);
  }

  private tone(
    dest: AudioNode,
    opts: { type: OscillatorType; freq: number; freqEnd?: number; dur: number; gain: number; delay?: number; attack?: number },
  ): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + (opts.delay ?? 0);
    const o = ctx.createOscillator();
    o.type = opts.type;
    o.frequency.setValueAtTime(opts.freq, t);
    if (opts.freqEnd) o.frequency.exponentialRampToValueAtTime(opts.freqEnd, t + opts.dur);
    const g = ctx.createGain();
    const a = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(opts.gain, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + opts.dur + 0.05);
  }

  /** Attack sound of a weapon. Each one is synthesized, so tuning it here changes every gun that uses it. */
  shot(sound: WeaponSound, pos?: Vec3Like): void {
    const d = this.out('sfx', pos, sound === 'crossbow' ? 0.6 : 6);
    if (!d) return;
    const v = pos ? 1.4 : 1;
    switch (sound) {
      case 'rifle':
        this.noiseBurst(d, { type: 'bandpass', freq: 1800, freqEnd: 600, q: 0.7, dur: 0.14, gain: 0.55 * v });
        this.tone(d, { type: 'sine', freq: 140, freqEnd: 45, dur: 0.12, gain: 0.5 * v });
        break;
      case 'smg':
        this.noiseBurst(d, { type: 'bandpass', freq: 2600, freqEnd: 1000, q: 0.8, dur: 0.08, gain: 0.42 * v });
        this.tone(d, { type: 'triangle', freq: 190, freqEnd: 70, dur: 0.07, gain: 0.3 * v });
        break;
      case 'lmg':
        this.noiseBurst(d, { type: 'bandpass', freq: 1200, freqEnd: 350, q: 0.6, dur: 0.17, gain: 0.7 * v });
        this.tone(d, { type: 'sine', freq: 110, freqEnd: 38, dur: 0.16, gain: 0.7 * v });
        break;
      case 'dmr':
        this.noiseBurst(d, { type: 'bandpass', freq: 1500, freqEnd: 400, q: 0.6, dur: 0.22, gain: 0.65 * v });
        this.tone(d, { type: 'sine', freq: 120, freqEnd: 40, dur: 0.2, gain: 0.65 * v });
        break;
      case 'pistol':
        this.noiseBurst(d, { type: 'bandpass', freq: 2600, freqEnd: 900, q: 0.9, dur: 0.1, gain: 0.45 * v });
        this.tone(d, { type: 'triangle', freq: 220, freqEnd: 70, dur: 0.08, gain: 0.35 * v });
        break;
      case 'deagle':
        this.noiseBurst(d, { type: 'bandpass', freq: 1700, freqEnd: 300, q: 0.6, dur: 0.24, gain: 0.8 * v });
        this.tone(d, { type: 'sine', freq: 130, freqEnd: 40, dur: 0.2, gain: 0.8 * v });
        break;
      case 'revolver':
        this.noiseBurst(d, { type: 'bandpass', freq: 2000, freqEnd: 450, q: 0.7, dur: 0.2, gain: 0.7 * v });
        this.tone(d, { type: 'triangle', freq: 170, freqEnd: 55, dur: 0.16, gain: 0.6 * v });
        break;
      case 'shotgun':
        this.noiseBurst(d, { type: 'lowpass', freq: 1400, freqEnd: 200, q: 0.5, dur: 0.38, gain: 0.9 * v });
        this.tone(d, { type: 'sine', freq: 95, freqEnd: 35, dur: 0.25, gain: 0.8 * v });
        this.noiseBurst(d, { type: 'highpass', freq: 3000, dur: 0.06, gain: 0.25 * v });
        break;
      case 'knife':
        this.noiseBurst(d, { type: 'bandpass', freq: 700, freqEnd: 2600, q: 1.2, dur: 0.16, gain: 0.3 * v });
        break;
      case 'crossbow':
        this.noiseBurst(d, { type: 'bandpass', freq: 900, freqEnd: 300, q: 1.5, dur: 0.1, gain: 0.25 });
        this.tone(d, { type: 'triangle', freq: 300, freqEnd: 120, dur: 0.09, gain: 0.15 });
        break;
      case 'launcher':
        this.noiseBurst(d, { type: 'lowpass', freq: 700, freqEnd: 150, q: 0.6, dur: 0.22, gain: 0.8 * v });
        this.tone(d, { type: 'sine', freq: 170, freqEnd: 60, dur: 0.18, gain: 0.8 * v });
        break;
      default:
        this.noiseBurst(d, { type: 'highpass', freq: 2000, dur: 0.08, gain: 0.6 * v });
        this.noiseBurst(d, { type: 'lowpass', freq: 2200, freqEnd: 120, q: 0.4, dur: 0.75, gain: 0.8 * v });
        this.tone(d, { type: 'sine', freq: 80, freqEnd: 30, dur: 0.35, gain: 0.9 * v });
    }
  }

  explosion(pos: Vec3Like): void {
    const d = this.out('sfx', pos, 10);
    if (!d) return;
    this.noiseBurst(d, { type: 'lowpass', freq: 1100, freqEnd: 90, q: 0.5, dur: 0.8, gain: 1.2 });
    this.tone(d, { type: 'sine', freq: 70, freqEnd: 25, dur: 0.6, gain: 1 });
  }

  dryFire(): void {
    const d = this.out('sfx');
    if (!d) return;
    this.noiseBurst(d, { type: 'highpass', freq: 4000, dur: 0.03, gain: 0.25 });
  }

  /** Mechanical clicks spread across the reload duration. */
  reload(duration: number): void {
    const d = this.out('sfx');
    if (!d) return;
    this.noiseBurst(d, { type: 'highpass', freq: 3500, dur: 0.05, gain: 0.3, delay: 0.1 });
    this.noiseBurst(d, { type: 'bandpass', freq: 900, dur: 0.08, gain: 0.3, delay: duration * 0.45 });
    this.noiseBurst(d, { type: 'highpass', freq: 2500, dur: 0.05, gain: 0.35, delay: duration * 0.85 });
    this.tone(d, { type: 'square', freq: 1200, dur: 0.03, gain: 0.05, delay: duration * 0.86 });
  }

  switchWeapon(): void {
    const d = this.out('sfx');
    if (!d) return;
    this.noiseBurst(d, { type: 'bandpass', freq: 1500, dur: 0.06, gain: 0.2 });
  }

  footstep(pos?: Vec3Like, loud = 1): void {
    const d = this.out('sfx', pos, 2.5);
    if (!d) return;
    if (!pos) {
      const t = performance.now();
      if (t - this.lastFoot < 120) return;
      this.lastFoot = t;
    }
    const g = (pos ? 0.6 : 0.18) * loud;
    this.noiseBurst(d, { type: 'lowpass', freq: 350 + Math.random() * 150, dur: 0.09, gain: g });
    this.tone(d, { type: 'sine', freq: 70 + Math.random() * 20, freqEnd: 40, dur: 0.07, gain: g * 0.6 });
  }

  land(): void {
    const d = this.out('sfx');
    if (!d) return;
    this.noiseBurst(d, { type: 'lowpass', freq: 300, dur: 0.15, gain: 0.35 });
  }

  jump(): void {
    const d = this.out('sfx');
    if (!d) return;
    this.noiseBurst(d, { type: 'lowpass', freq: 600, dur: 0.06, gain: 0.12 });
  }

  hitmarker(kind: HitKind): void {
    const d = this.out('ui');
    if (!d) return;
    if (kind === 'hit') {
      this.tone(d, { type: 'square', freq: 1700, dur: 0.05, gain: 0.12 });
    } else if (kind === 'head') {
      this.tone(d, { type: 'triangle', freq: 2400, dur: 0.12, gain: 0.25 });
      this.tone(d, { type: 'sine', freq: 3600, dur: 0.18, gain: 0.15, delay: 0.03 });
    } else {
      this.tone(d, { type: 'triangle', freq: 880, dur: 0.16, gain: 0.3 });
      this.tone(d, { type: 'triangle', freq: 1320, dur: 0.18, gain: 0.25, delay: 0.07 });
      this.tone(d, { type: 'sine', freq: 1760, dur: 0.3, gain: 0.2, delay: 0.14 });
    }
  }

  hurt(): void {
    const d = this.out('sfx');
    if (!d) return;
    this.noiseBurst(d, { type: 'lowpass', freq: 500, dur: 0.18, gain: 0.5 });
    this.tone(d, { type: 'sawtooth', freq: 160, freqEnd: 90, dur: 0.15, gain: 0.12 });
  }

  death(): void {
    const d = this.out('sfx');
    if (!d) return;
    this.tone(d, { type: 'sawtooth', freq: 300, freqEnd: 60, dur: 0.8, gain: 0.2 });
    this.noiseBurst(d, { type: 'lowpass', freq: 400, dur: 0.5, gain: 0.4 });
  }

  pickup(kind: 'health' | 'ammo'): void {
    const d = this.out('ui');
    if (!d) return;
    const base = kind === 'health' ? 660 : 520;
    [0, 0.06, 0.12].forEach((delay, i) =>
      this.tone(d, { type: 'triangle', freq: base * (1 + i * 0.25), dur: 0.12, gain: 0.18, delay }),
    );
  }

  uiClick(): void {
    const d = this.out('ui');
    if (!d) return;
    this.tone(d, { type: 'sine', freq: 900, freqEnd: 600, dur: 0.06, gain: 0.12 });
  }

  chat(): void {
    const d = this.out('ui');
    if (!d) return;
    this.tone(d, { type: 'sine', freq: 1200, dur: 0.08, gain: 0.08 });
  }

  matchEnd(win: boolean): void {
    const d = this.out('ui');
    if (!d) return;
    const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone(d, { type: 'triangle', freq: f, dur: 0.35, gain: 0.2, delay: i * 0.15 }));
  }
}

export const audio = new AudioEngine();

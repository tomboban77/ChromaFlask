/**
 * Procedural audio. Every sound is synthesised at runtime from oscillators and
 * filtered noise, so the game ships with no audio assets: nothing to download,
 * nothing to decode, and the whole sound design is a few KB of code.
 *
 * All public methods are safe to call before the context exists or when audio
 * is unsupported - they simply no-op.
 */

export type SfxName =
  | 'select' | 'deselect' | 'swap' | 'pour' | 'land' | 'invalid'
  | 'tubeComplete' | 'star' | 'win' | 'coin' | 'button' | 'powerup'
  | 'stuck' | 'unlock' | 'cork';

interface ToneOptions {
  freq: number;
  dur: number;
  type?: OscillatorType;
  gain?: number;
  attack?: number;
  glideTo?: number;
  delay?: number;
  detune?: number;
}

interface NoiseOptions {
  dur: number;
  gain?: number;
  from?: number;
  to?: number;
  q?: number;
  delay?: number;
  kind?: 'bandpass' | 'highpass' | 'lowpass';
}

const MUSIC_GAIN = 0.2;

/**
 * Am - F - C - G as MIDI notes, all voiced around middle C. Inversions keep
 * every chord in the same warm register: nothing low enough to boom, nothing
 * high enough to pierce. Loops without fatigue.
 */
const PROGRESSION: readonly number[][] = [
  [57, 60, 64], // A3 C4 E4
  [60, 65, 69], // C4 F4 A4
  [60, 64, 67], // C4 E4 G4
  [59, 62, 67], // B3 D4 G4
];

function noteHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private sfxEnabled = true;
  private musicEnabled = true;
  private musicRunning = false;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;

  /**
   * Browsers refuse to start audio outside a user gesture, so the context is
   * created lazily on the first interaction rather than at boot.
   */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext ?? (window as unknown as {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;
      if (!Ctor) return;

      const ctx = new Ctor();
      this.ctx = ctx;

      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.sfxEnabled ? 1 : 0;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0;
      this.musicBus.connect(this.master);

      this.noiseBuffer = this.buildNoise(ctx);
      if (ctx.state === 'suspended') void ctx.resume();
      if (this.musicEnabled) this.startMusic();
    } catch (err) {
      console.warn('[audio] unavailable', err);
      this.ctx = null;
    }
  }

  private buildNoise(ctx: AudioContext): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  setSfxEnabled(on: boolean): void {
    this.sfxEnabled = on;
    if (this.sfxBus && this.ctx) {
      this.sfxBus.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.02);
    }
  }

  setMusicEnabled(on: boolean): void {
    this.musicEnabled = on;
    if (!this.ctx) return;
    if (on) this.startMusic();
    else this.stopMusic();
  }

  /** Duck music during celebrations so the win stinger cuts through. */
  duckMusic(seconds: number): void {
    if (!this.ctx || !this.musicBus || !this.musicRunning) return;
    const now = this.ctx.currentTime;
    const g = this.musicBus.gain;
    g.cancelScheduledValues(now);
    g.setTargetAtTime(0.02, now, 0.05);
    g.setTargetAtTime(MUSIC_GAIN, now + seconds, 0.4);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  // ------------------------------------------------------------ primitives
  private tone(o: ToneOptions): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus) return;

    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.glideTo !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.glideTo), t0 + o.dur);
    }
    if (o.detune) osc.detune.setValueAtTime(o.detune, t0);

    const peak = o.gain ?? 0.2;
    const attack = o.attack ?? 0.006;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

    osc.connect(gain).connect(bus);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  private noise(o: NoiseOptions): void {
    const ctx = this.ctx;
    const bus = this.sfxBus;
    if (!ctx || !bus || !this.noiseBuffer) return;

    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = o.kind ?? 'bandpass';
    filter.Q.value = o.q ?? 1;
    const from = o.from ?? 800;
    filter.frequency.setValueAtTime(from, t0);
    if (o.to !== undefined) {
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + o.dur);
    }

    const gain = ctx.createGain();
    const peak = o.gain ?? 0.15;
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);

    src.connect(filter).connect(gain).connect(bus);
    src.start(t0);
    src.stop(t0 + o.dur + 0.05);
  }

  // ---------------------------------------------------------- sound design
  /**
   * @param intensity 0..1 - used by `pour` to pitch the splash by volume, so a
   * four-unit pour sounds heavier than a one-unit trickle.
   */
  play(name: SfxName, intensity = 0.5): void {
    if (!this.ctx) return;
    switch (name) {
      case 'select':
        this.tone({ freq: 620, glideTo: 880, dur: 0.09, type: 'sine', gain: 0.16 });
        this.noise({ dur: 0.05, from: 2400, to: 4200, gain: 0.04, kind: 'highpass' });
        break;

      case 'deselect':
        this.tone({ freq: 720, glideTo: 480, dur: 0.09, type: 'sine', gain: 0.12 });
        break;

      case 'swap':
        this.tone({ freq: 520, glideTo: 700, dur: 0.07, type: 'triangle', gain: 0.12 });
        break;

      case 'pour': {
        // Liquid = broadband noise sweeping down through a resonant band,
        // plus a low body tone that deepens with the amount being poured.
        const dur = 0.26 + intensity * 0.22;
        this.noise({ dur, from: 1800 - intensity * 500, to: 420, gain: 0.1, q: 2.2 });
        this.tone({ freq: 300 - intensity * 90, glideTo: 170, dur, type: 'sine', gain: 0.1 });
        for (let i = 0; i < 3; i++) {
          this.tone({
            freq: 900 + Math.random() * 500,
            glideTo: 500,
            dur: 0.07,
            type: 'sine',
            gain: 0.035,
            delay: 0.05 + i * 0.07,
          });
        }
        break;
      }

      case 'land':
        this.noise({ dur: 0.14, from: 900, to: 260, gain: 0.09, q: 1.4 });
        this.tone({ freq: 200, glideTo: 130, dur: 0.13, type: 'sine', gain: 0.09 });
        break;

      case 'invalid':
        this.tone({ freq: 180, dur: 0.1, type: 'square', gain: 0.07 });
        this.tone({ freq: 150, dur: 0.12, type: 'square', gain: 0.06, delay: 0.07 });
        break;

      case 'tubeComplete': {
        const notes = [784, 988, 1175]; // G5 B5 D6
        notes.forEach((f, i) =>
          this.tone({ freq: f, dur: 0.3, type: 'sine', gain: 0.13, delay: i * 0.055 }),
        );
        this.noise({ dur: 0.3, from: 3000, to: 6000, gain: 0.03, kind: 'highpass', delay: 0.05 });
        break;
      }

      case 'star': {
        // intensity carries the star index (0,1,2) so each rings higher.
        const base = [1046, 1318, 1568][Math.min(2, Math.round(intensity))] ?? 1046;
        this.tone({ freq: base, dur: 0.5, type: 'sine', gain: 0.16 });
        this.tone({ freq: base * 2, dur: 0.35, type: 'sine', gain: 0.05 });
        break;
      }

      case 'win': {
        const notes = [523, 659, 784, 1046, 1318]; // C major run
        notes.forEach((f, i) =>
          this.tone({ freq: f, dur: 0.55, type: 'triangle', gain: 0.14, delay: i * 0.075 }),
        );
        this.noise({ dur: 0.9, from: 2000, to: 7000, gain: 0.035, kind: 'highpass', delay: 0.1 });
        break;
      }

      case 'coin':
        this.tone({ freq: 988, dur: 0.07, type: 'square', gain: 0.07 });
        this.tone({ freq: 1319, dur: 0.16, type: 'square', gain: 0.07, delay: 0.06 });
        break;

      case 'button':
        this.tone({ freq: 440, glideTo: 620, dur: 0.06, type: 'triangle', gain: 0.11 });
        break;

      case 'powerup':
        this.tone({ freq: 400, glideTo: 1200, dur: 0.28, type: 'triangle', gain: 0.12 });
        this.noise({ dur: 0.3, from: 1200, to: 5000, gain: 0.04, kind: 'highpass' });
        break;

      case 'stuck':
        this.tone({ freq: 400, glideTo: 300, dur: 0.2, type: 'triangle', gain: 0.11 });
        this.tone({ freq: 300, glideTo: 200, dur: 0.3, type: 'triangle', gain: 0.1, delay: 0.16 });
        break;

      case 'unlock':
        this.tone({ freq: 660, glideTo: 990, dur: 0.22, type: 'sine', gain: 0.14 });
        this.tone({ freq: 990, glideTo: 1320, dur: 0.3, type: 'sine', gain: 0.1, delay: 0.14 });
        break;

      case 'cork':
        // A cork seating: a short woody thump with a bright click on top.
        this.noise({ dur: 0.08, from: 1400, to: 300, gain: 0.14, q: 1.2, kind: 'lowpass' });
        this.tone({ freq: 560, glideTo: 240, dur: 0.11, type: 'sine', gain: 0.12 });
        this.tone({ freq: 1500, dur: 0.035, type: 'triangle', gain: 0.045, delay: 0.005 });
        break;
    }
  }

  // ----------------------------------------------------------------- music
  private startMusic(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicBus || this.musicRunning) return;
    this.musicRunning = true;
    this.musicBus.gain.setTargetAtTime(MUSIC_GAIN, ctx.currentTime, 0.8);
    this.nextNoteTime = ctx.currentTime + 0.1;
    this.step = 0;
    this.musicTimer = window.setInterval(() => this.scheduleMusic(), 120);
  }

  private stopMusic(): void {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
    if (this.ctx && this.musicBus) {
      this.musicBus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
    }
    this.musicRunning = false;
  }

  /**
   * Lookahead scheduler: a timer this coarse cannot place notes accurately, so
   * it queues them slightly ahead against the audio clock instead.
   *
   * The arrangement is a quiet music box: a soft sine pad holds each chord in
   * the middle register while sparse plucked notes sparkle one and two octaves
   * above. No bass line, no filter sweeps, no detuned beating - light and
   * pleasant at length rather than thick.
   */
  private scheduleMusic(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;

    const STEP = 0.36; // ~83bpm in eighth notes; 8 steps per chord
    const horizon = ctx.currentTime + 0.4;
    while (this.nextNoteTime < horizon) {
      const bar = Math.floor(this.step / 8);
      const chord = PROGRESSION[bar % PROGRESSION.length] as number[];
      const beat = this.step % 8;
      const t = this.nextNoteTime;

      // Soft sustained pad on the downbeat of each bar.
      if (beat === 0) {
        for (const midi of chord) this.pad(ctx, bus, noteHz(midi), t, 3.1);
      }

      // Music-box melody: gentle rising contour with rests, an octave up.
      if ((beat === 1 || beat === 3 || beat === 4 || beat === 6) && Math.random() > 0.3) {
        const tone = chord[(bar + beat) % chord.length] as number;
        const octave = beat === 6 && Math.random() > 0.5 ? 24 : 12;
        this.pluck(ctx, bus, noteHz(tone + octave), t, octave === 24 ? 0.035 : 0.055);
      }

      this.nextNoteTime += STEP;
      this.step++;
    }
  }

  private pad(ctx: AudioContext, bus: GainNode, freq: number, t: number, dur: number): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();

    osc.type = 'sine';
    osc.frequency.value = freq;
    osc.detune.value = (Math.random() - 0.5) * 4; // barely-there movement, no beating

    filter.type = 'lowpass';
    filter.frequency.value = 1600;

    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 1.1);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    osc.connect(filter).connect(gain).connect(bus);
    osc.start(t);
    osc.stop(t + dur + 0.1);
  }

  /** Music-box timbre: a sine fundamental with a faint, faster-dying octave. */
  private pluck(
    ctx: AudioContext, bus: GainNode, freq: number, t: number, peak = 0.055,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    osc.connect(gain).connect(bus);
    osc.start(t);
    osc.stop(t + 1);

    const shimmer = ctx.createOscillator();
    const shimmerGain = ctx.createGain();
    shimmer.type = 'sine';
    shimmer.frequency.value = freq * 2;
    shimmerGain.gain.setValueAtTime(0.0001, t);
    shimmerGain.gain.exponentialRampToValueAtTime(peak * 0.3, t + 0.006);
    shimmerGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    shimmer.connect(shimmerGain).connect(bus);
    shimmer.start(t);
    shimmer.stop(t + 0.5);
  }
}

export const audio = new AudioEngine();

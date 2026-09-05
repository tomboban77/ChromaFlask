// Pixi's default WebGL uniform sync builds functions with `new Function`,
// which the production Content Security Policy forbids (script-src 'self',
// no 'unsafe-eval'). This entry point swaps in a static implementation.
// Must be imported before the Application is created.
import 'pixi.js/unsafe-eval';
import { Application, Container } from 'pixi.js';
import { ParticleField, Starfield, StreamView } from './effects';

export type UpdateFn = (dt: number) => void;

/**
 * Owns the Pixi renderer, the layer stack and the frame loop.
 *
 * The canvas is transparent so the CSS background gradient shows through -
 * cheaper and crisper than painting a full-screen gradient every frame.
 */
export class GameStage {
  readonly app = new Application();

  readonly starfield = new Starfield();
  readonly boardLayer = new Container();
  readonly stream = new StreamView();
  readonly particles = new ParticleField();

  private readonly updaters = new Set<UpdateFn>();
  private resizeObserver: ResizeObserver | null = null;
  private onLayout: ((w: number, h: number) => void) | null = null;

  async init(host: HTMLElement): Promise<void> {
    await this.app.init({
      backgroundAlpha: 0,
      antialias: true,
      // Capped at 2: beyond that the fill-rate cost on high-DPI phones buys
      // nothing a player can see.
      resolution: Math.min(window.devicePixelRatio || 1, 2),
      autoDensity: true,
      resizeTo: host,
      preference: 'webgl',
      powerPreference: 'high-performance',
    });

    const canvas = this.app.canvas;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    // Pixi handles pointer events; stop the browser hijacking them as scroll.
    canvas.style.touchAction = 'none';
    host.appendChild(canvas);

    this.app.stage.addChild(this.starfield, this.boardLayer, this.stream, this.particles);

    this.app.ticker.add((ticker) => {
      // Clamp: a backgrounded tab resumes with a huge delta that would teleport
      // every animation.
      const dt = Math.min(ticker.deltaMS / 1000, 1 / 20);
      this.watchFrameRate(ticker.deltaMS, host);
      this.starfield.update(dt);
      this.stream.update(dt);
      this.particles.update(dt);
      for (const fn of this.updaters) fn(dt);
    });

    this.observeResize(host);
  }

  get rendererType(): string {
    return this.app.renderer.name;
  }

  // ------------------------------------------------- adaptive resolution
  /** Current canvas resolution (device pixels per CSS pixel). */
  get currentResolution(): number {
    return this.app.renderer.resolution;
  }

  private frameAccumMs = 0;
  private frameCount = 0;
  private slowWindows = 0;

  /**
   * Fill rate is the cost that scales with the phone, not the puzzle: a
   * 2x-density, antialiased canvas is four times the pixels of a 1x one. If
   * frames stay slow for two consecutive two-second windows, drop one step
   * (2 -> 1.5 -> 1) and never go back up, so there is no oscillation. Frames
   * are measured, not devices guessed; a fast phone never sees this fire.
   */
  private watchFrameRate(deltaMS: number, host: HTMLElement): void {
    // Ignore the first frame after a pause/resume (huge delta) and idle frames.
    if (deltaMS > 250) return;
    this.frameAccumMs += deltaMS;
    this.frameCount += 1;
    if (this.frameAccumMs < 2000) return;
    const avg = this.frameAccumMs / this.frameCount;
    this.frameAccumMs = 0;
    this.frameCount = 0;
    // 45 fps on a 60 Hz display; comfortably below "smooth", clearly above noise.
    this.slowWindows = avg > 22 ? this.slowWindows + 1 : 0;
    if (this.slowWindows < 2) return;
    this.slowWindows = 0;
    const current = this.app.renderer.resolution;
    if (current <= 1) return;
    const next = Math.max(1, Math.round((current - 0.5) * 2) / 2);
    this.app.renderer.resize(host.clientWidth, host.clientHeight, next);
    this.starfield.resize(this.width, this.height);
    this.onLayout?.(this.width, this.height);
    console.info(`[stage] frames averaging ${avg.toFixed(0)} ms; render resolution ${current} -> ${next}`);
  }

  get width(): number {
    return this.app.screen.width;
  }

  get height(): number {
    return this.app.screen.height;
  }

  addUpdater(fn: UpdateFn): () => void {
    this.updaters.add(fn);
    return () => this.updaters.delete(fn);
  }

  setLayoutHandler(fn: (w: number, h: number) => void): void {
    this.onLayout = fn;
    this.emitLayout();
  }

  private observeResize(host: HTMLElement): void {
    this.resizeObserver = new ResizeObserver(() => {
      // resizeTo already resizes the renderer; we only need to reflow content.
      this.app.resize();
      this.starfield.resize(this.width, this.height);
      this.emitLayout();
    });
    this.resizeObserver.observe(host);
    this.starfield.resize(this.width, this.height);
  }

  private emitLayout(): void {
    if (this.onLayout && this.width > 0 && this.height > 0) {
      this.onLayout(this.width, this.height);
    }
  }

  /**
   * Stop the frame loop while the game screen is hidden (other screens, or a
   * background tab). Idempotent: Pixi's ticker ignores redundant start/stop.
   */
  setPaused(paused: boolean): void {
    if (paused) this.app.ticker.stop();
    else this.app.ticker.start();
  }

  destroy(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.updaters.clear();
    this.app.destroy(true, { children: true });
  }
}

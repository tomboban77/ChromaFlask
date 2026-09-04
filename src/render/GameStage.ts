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

  /** Stop rendering while a modal or a background tab has the screen. */
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

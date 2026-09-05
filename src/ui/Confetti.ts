/**
 * DOM-canvas confetti, layered *above* the modal root so celebrations rain
 * over the win dialog (the Pixi confetti lives under it, behind the backdrop).
 *
 * Self-contained rAF loop that only runs while pieces are alive, so the layer
 * costs nothing outside the two seconds it is on screen.
 */

interface Piece {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vrot: number;
  w: number;
  h: number;
  color: string;
  wobble: number;
  wobbleSpeed: number;
  life: number;
  shape: 'rect' | 'circle';
}

const COLORS = ['#22d3ee', '#a855f7', '#ffb020', '#f5365c', '#2bd97c', '#ffffff', '#ff7ab8'];

export class Confetti {
  private readonly ctx: CanvasRenderingContext2D;
  private pieces: Piece[] = [];
  private raf: number | null = null;
  private lastTime = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    /** Checked at burst time so reduced-motion players get a quiet win. */
    private readonly enabled: () => boolean = () => true,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Confetti: 2d context unavailable');
    this.ctx = ctx;
  }

  /** Two side cannons plus a top rain - reads as a real celebration. */
  burst(intensity: 1 | 2 = 1): void {
    if (!this.enabled()) return;
    this.fit();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const count = intensity === 2 ? 140 : 80;

    for (let i = 0; i < count; i++) {
      const fromLeft = i % 2 === 0;
      const cannon = i < count * 0.6;
      const speed = 320 + Math.random() * 420;
      const angle = cannon
        ? (fromLeft ? -0.35 : Math.PI + 0.35) + (Math.random() - 0.5) * 0.9
        : Math.PI / 2 + (Math.random() - 0.5) * 0.6;
      this.pieces.push({
        x: cannon ? (fromLeft ? -10 : w + 10) : Math.random() * w,
        y: cannon ? h * (0.45 + Math.random() * 0.25) : -20 - Math.random() * h * 0.3,
        vx: Math.cos(angle) * (cannon ? speed : speed * 0.1),
        vy: cannon ? -Math.abs(Math.sin(angle)) * speed : 60 + Math.random() * 120,
        rot: Math.random() * Math.PI * 2,
        vrot: (Math.random() - 0.5) * 14,
        w: 6 + Math.random() * 7,
        h: 8 + Math.random() * 8,
        color: COLORS[(Math.random() * COLORS.length) | 0] as string,
        wobble: Math.random() * Math.PI * 2,
        wobbleSpeed: 4 + Math.random() * 6,
        life: 2.2 + Math.random() * 1.2,
        shape: Math.random() < 0.3 ? 'circle' : 'rect',
      });
    }

    this.canvas.style.display = 'block';
    if (this.raf === null) {
      this.lastTime = performance.now();
      this.raf = requestAnimationFrame((t) => this.tick(t));
    }
  }

  clear(): void {
    this.pieces = [];
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas.style.display = 'none';
  }

  private fit(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private tick(time: number): void {
    const dt = Math.min((time - this.lastTime) / 1000, 1 / 20);
    this.lastTime = time;

    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.ctx.clearRect(0, 0, w, h);

    for (const p of this.pieces) {
      p.life -= dt;
      if (p.life <= 0 || p.y > h + 30) continue;
      p.vy += 620 * dt; // gravity
      p.vx *= 1 - 1.6 * dt; // drag
      p.vy *= 1 - 0.4 * dt;
      p.wobble += p.wobbleSpeed * dt;
      p.x += (p.vx + Math.sin(p.wobble) * 26) * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;

      this.ctx.save();
      this.ctx.translate(p.x, p.y);
      this.ctx.rotate(p.rot);
      this.ctx.globalAlpha = Math.min(1, p.life * 1.6);
      this.ctx.fillStyle = p.color;
      if (p.shape === 'circle') {
        this.ctx.beginPath();
        this.ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        this.ctx.fill();
      } else {
        // Scale on the wobble fakes a 3D flutter for free.
        this.ctx.scale(1, 0.4 + Math.abs(Math.sin(p.wobble)) * 0.6);
        this.ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      }
      this.ctx.restore();
    }
    this.pieces = this.pieces.filter((p) => p.life > 0 && p.y <= h + 30);

    if (this.pieces.length > 0) {
      this.raf = requestAnimationFrame((t) => this.tick(t));
    } else {
      this.raf = null;
      this.ctx.clearRect(0, 0, w, h);
      this.canvas.style.display = 'none';
    }
  }
}

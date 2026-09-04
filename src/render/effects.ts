import { Container, Graphics } from 'pixi.js';
import { colorOf } from './theme';

/**
 * The falling column of liquid between a tilted bottle and its target.
 *
 * Drawn as a parabola rather than a straight line: horizontal travel is linear
 * while vertical travel accelerates, which is what falling liquid actually
 * does and is the difference between "a coloured rectangle" and a pour.
 */
export class StreamView extends Container {
  private readonly gfx = new Graphics();
  private active = false;
  private phase = 0;

  private fromX = 0;
  private fromY = 0;
  private toX = 0;
  private toY = 0;
  private color = 0xffffff;
  private lightColor = 0xffffff;
  private thickness = 6;

  constructor() {
    super();
    this.addChild(this.gfx);
    this.eventMode = 'none';
    this.visible = false;
  }

  set(fromX: number, fromY: number, toX: number, toY: number, colorId: number, thickness: number): void {
    const col = colorOf(colorId);
    this.fromX = fromX;
    this.fromY = fromY;
    this.toX = toX;
    this.toY = toY;
    this.color = col.base;
    this.lightColor = col.light;
    this.thickness = thickness;
    this.active = true;
    this.visible = true;
  }

  stop(): void {
    this.active = false;
    this.visible = false;
    this.gfx.clear();
  }

  update(dt: number): void {
    if (!this.active) return;
    this.phase += dt * 14;
    this.redraw();
  }

  private redraw(): void {
    const g = this.gfx;
    g.clear();

    const steps = 12;
    const left: Array<[number, number]> = [];
    const right: Array<[number, number]> = [];
    const dx = this.toX - this.fromX;
    const dy = this.toY - this.fromY;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = this.fromX + dx * t;
      // Quadratic fall: the stream leaves the lip sideways and drops away.
      const y = this.fromY + dy * (t * t);
      // Taper as it stretches, plus a light ripple so it never looks static.
      const taper = 1 - 0.32 * t;
      const ripple = Math.sin(this.phase + t * 7) * this.thickness * 0.07;
      const w = (this.thickness * taper) / 2 + ripple;
      left.push([x - w, y]);
      right.push([x + w, y]);
    }

    const poly: number[] = [];
    for (const [x, y] of left) poly.push(x, y);
    for (let i = right.length - 1; i >= 0; i--) {
      const p = right[i] as [number, number];
      poly.push(p[0], p[1]);
    }
    g.poly(poly).fill({ color: this.color });

    // inner highlight, offset slightly to suggest a rounded column
    const hi: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = this.fromX + dx * t;
      const y = this.fromY + dy * (t * t);
      hi.push(x - this.thickness * 0.16, y);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const x = this.fromX + dx * t;
      const y = this.fromY + dy * (t * t);
      hi.push(x + this.thickness * 0.02, y);
    }
    g.poly(hi).fill({ color: this.lightColor, alpha: 0.45 });
  }
}

type ParticleShape = 'rect' | 'circle';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: number;
  alpha: number;
  rot: number;
  vrot: number;
  gravity: number;
  drag: number;
  shape: ParticleShape;
}

/**
 * Lightweight particle system drawn into a single Graphics per frame.
 *
 * At the few-hundred-particle scale this game needs, one batched Graphics
 * rebuild is cheaper than managing hundreds of sprite objects.
 */
export class ParticleField extends Container {
  private readonly gfx = new Graphics();
  private readonly particles: Particle[] = [];
  private readonly max = 420;

  constructor() {
    super();
    this.addChild(this.gfx);
    this.eventMode = 'none';
  }

  get count(): number {
    return this.particles.length;
  }

  private spawn(p: Particle): void {
    if (this.particles.length >= this.max) this.particles.shift();
    this.particles.push(p);
  }

  /** Droplets kicked up where the stream meets the surface. */
  splash(x: number, y: number, colorId: number, count = 6): void {
    const col = colorOf(colorId);
    for (let i = 0; i < count; i++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.0;
      const speed = 40 + Math.random() * 110;
      this.spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        maxLife: 0.28 + Math.random() * 0.3,
        size: 1.6 + Math.random() * 2.6,
        color: Math.random() > 0.5 ? col.base : col.light,
        alpha: 1,
        rot: 0,
        vrot: 0,
        gravity: 620,
        drag: 0.9,
        shape: 'circle',
      });
    }
  }

  /** Ring of sparks when a tube is completed. */
  sparkle(x: number, y: number, colorId: number, count = 18): void {
    const col = colorOf(colorId);
    for (let i = 0; i < count; i++) {
      const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
      const speed = 70 + Math.random() * 130;
      this.spawn({
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 40,
        life: 0,
        maxLife: 0.5 + Math.random() * 0.4,
        size: 2 + Math.random() * 3,
        color: Math.random() > 0.4 ? col.light : 0xffffff,
        alpha: 1,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 12,
        gravity: 240,
        drag: 0.94,
        shape: Math.random() > 0.5 ? 'rect' : 'circle',
      });
    }
  }

  /** Level-complete celebration falling from above the viewport. */
  confetti(width: number, count = 90): void {
    const colors = [0xf5365c, 0x22d3ee, 0xffb020, 0xa855f7, 0x2bd97c, 0x4f7cff, 0xff6fb5, 0xffffff];
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: Math.random() * width,
        y: -20 - Math.random() * 220,
        vx: (Math.random() - 0.5) * 90,
        vy: 130 + Math.random() * 190,
        life: 0,
        maxLife: 2.4 + Math.random() * 1.4,
        size: 4 + Math.random() * 6,
        color: colors[Math.floor(Math.random() * colors.length)] as number,
        alpha: 1,
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 14,
        gravity: 55,
        drag: 0.995,
        shape: Math.random() > 0.35 ? 'rect' : 'circle',
      });
    }
  }

  clear(): void {
    this.particles.length = 0;
    this.gfx.clear();
  }

  update(dt: number): void {
    const list = this.particles;
    if (list.length === 0) return;

    // integrate, compacting dead particles out in one pass
    let write = 0;
    for (let i = 0; i < list.length; i++) {
      const p = list[i] as Particle;
      p.life += dt;
      if (p.life >= p.maxLife) continue;

      p.vy += p.gravity * dt;
      const d = Math.pow(p.drag, dt * 60);
      p.vx *= d;
      p.vy *= d;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;

      const t = p.life / p.maxLife;
      p.alpha = t < 0.75 ? 1 : 1 - (t - 0.75) / 0.25;

      list[write++] = p;
    }
    list.length = write;

    this.redraw();
  }

  private redraw(): void {
    const g = this.gfx;
    g.clear();
    for (const p of this.particles) {
      if (p.shape === 'circle') {
        g.circle(p.x, p.y, p.size / 2).fill({ color: p.color, alpha: p.alpha });
      } else {
        // Graphics has no per-shape rotation, so emit the rotated quad directly.
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        const hw = p.size / 2;
        const hh = p.size / 3;
        g.poly([
          p.x + (-hw * c - -hh * s), p.y + (-hw * s + -hh * c),
          p.x + (hw * c - -hh * s), p.y + (hw * s + -hh * c),
          p.x + (hw * c - hh * s), p.y + (hw * s + hh * c),
          p.x + (-hw * c - hh * s), p.y + (-hw * s + hh * c),
        ]).fill({ color: p.color, alpha: p.alpha });
      }
    }
  }
}

/** Slow drifting starfield behind the board. */
export class Starfield extends Container {
  private readonly gfx = new Graphics();
  private stars: Array<{ x: number; y: number; r: number; a: number; tw: number; sp: number }> = [];
  private t = 0;
  private w = 0;
  private h = 0;

  constructor() {
    super();
    this.addChild(this.gfx);
    this.eventMode = 'none';
  }

  resize(width: number, height: number): void {
    this.w = width;
    this.h = height;
    const count = Math.round(Math.min(90, (width * height) / 12000));
    this.stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: 0.6 + Math.random() * 1.8,
      a: 0.25 + Math.random() * 0.5,
      tw: Math.random() * Math.PI * 2,
      sp: 0.4 + Math.random() * 1.4,
    }));
  }

  update(dt: number): void {
    if (this.stars.length === 0) return;
    this.t += dt;
    const g = this.gfx;
    g.clear();
    for (const s of this.stars) {
      s.y += s.sp * dt * 6;
      if (s.y > this.h + 4) {
        s.y = -4;
        s.x = Math.random() * this.w;
      }
      const twinkle = 0.6 + 0.4 * Math.sin(this.t * 2 + s.tw);
      g.circle(s.x, s.y, s.r).fill({ color: 0xbfd8ff, alpha: s.a * twinkle });
    }
  }
}

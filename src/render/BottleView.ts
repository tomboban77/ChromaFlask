import { Container, Graphics, Point, Rectangle } from 'pixi.js';
import { TUBE_CAPACITY } from '@/core/board';
import type { ColorId } from '@/core/types';
import { BOTTLE, GLASS, bottleHeight, colorOf, type GlyphKind } from './theme';

/** A contiguous run of one colour. `amount` may be fractional mid-pour. */
export interface Band {
  color: ColorId;
  amount: number;
}

interface Geometry {
  bodyW: number;
  totalH: number;
  /** Silhouette waypoints, top-down. */
  yCollar: number;
  yNeck: number;
  yBody: number;
  yBottom: number;
  collarW: number;
  neckW: number;
  /** Liquid cavity (the straight-sided body), in bottle-local space. */
  ix: number;
  iy: number;
  iw: number;
  ih: number;
  bottomR: number;
}

function computeGeometry(bodyW: number): Geometry {
  const t = GLASS.thickness;
  const yCollar = BOTTLE.collarH * bodyW;
  const yNeck = yCollar + BOTTLE.neckH * bodyW;
  const yBody = yNeck + BOTTLE.shoulderH * bodyW;
  const yBottom = yBody + BOTTLE.bodyH * bodyW;
  return {
    bodyW,
    totalH: bottleHeight(bodyW),
    yCollar,
    yNeck,
    yBody,
    yBottom,
    collarW: BOTTLE.collarW * bodyW,
    neckW: BOTTLE.neckW * bodyW,
    ix: -bodyW / 2 + t,
    iy: yBody,
    iw: bodyW - 2 * t,
    ih: yBottom - t - yBody,
    bottomR: Math.max(2, BOTTLE.bottomRadius * bodyW - t),
  };
}

/**
 * One bottle: glass, liquid, and the selection/complete states.
 *
 * The container's pivot sits at the mouth (local 0,0), which is what makes the
 * pour animation simple - rotating about the pivot keeps the spout pinned over
 * the target while the body swings away.
 */
export class BottleView extends Container {
  readonly index: number;

  private geo: Geometry;
  private bands: Band[] = [];

  private readonly cavity = new Graphics();
  private readonly liquidLayer = new Container();
  private readonly liquid = new Graphics();
  private readonly liquidMask = new Graphics();
  private readonly glass = new Graphics();
  private readonly glow = new Graphics();
  private readonly flash = new Graphics();

  /** Surface agitation, 0..1, decaying. Drives the sine wave on the top band. */
  private wobble = 0;
  private wavePhase = Math.random() * Math.PI * 2;
  private dirty = true;
  private colorblind = false;
  private lastRotation = 0;

  constructor(index: number, bodyWidth: number) {
    super();
    this.index = index;
    this.geo = computeGeometry(bodyWidth);

    this.liquidLayer.addChild(this.liquid);
    this.liquidLayer.addChild(this.liquidMask);
    this.liquidLayer.mask = this.liquidMask;

    this.addChild(this.glow, this.cavity, this.liquidLayer, this.glass, this.flash);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.flash.alpha = 0;
    this.glow.alpha = 0;

    this.redrawChrome();
  }

  // ------------------------------------------------------------- geometry
  get bodyWidth(): number {
    return this.geo.bodyW;
  }

  get totalHeight(): number {
    return this.geo.totalH;
  }

  resize(bodyWidth: number): void {
    this.geo = computeGeometry(bodyWidth);
    this.redrawChrome();
    this.dirty = true;
  }

  /** World-space point where liquid leaves the mouth, accounting for tilt. */
  spoutWorld(direction: 1 | -1): Point {
    const lip = new Point((this.geo.collarW / 2) * direction, 0);
    return this.toGlobal(lip);
  }

  /** World-space centre of the mouth. */
  mouthWorld(): Point {
    return this.toGlobal(new Point(0, 0));
  }

  /**
   * Local y of the liquid surface for an upright bottle. The pour stream aims
   * here, so it lands on the surface rather than the floor of the tube.
   */
  surfaceLocalY(unitsOverride?: number): number {
    const total = unitsOverride ?? this.totalUnits();
    const g = this.geo;
    const frac = Math.min(1, total / TUBE_CAPACITY);
    return g.iy + g.ih - frac * g.ih;
  }

  /** World-space y of the current liquid surface. */
  surfaceWorldY(): number {
    return this.toGlobal(new Point(0, this.surfaceLocalY())).y;
  }

  // ---------------------------------------------------------------- state
  setBands(bands: Band[]): void {
    this.bands = bands;
    this.dirty = true;
  }

  /** Convenience: build bands from raw tube contents by grouping colour runs. */
  setContents(tube: readonly ColorId[]): void {
    const bands: Band[] = [];
    for (const c of tube) {
      const last = bands[bands.length - 1];
      if (last && last.color === c) last.amount += 1;
      else bands.push({ color: c, amount: 1 });
    }
    this.setBands(bands);
  }

  totalUnits(): number {
    let n = 0;
    for (const b of this.bands) n += b.amount;
    return n;
  }

  setColorblind(on: boolean): void {
    if (this.colorblind === on) return;
    this.colorblind = on;
    this.dirty = true;
  }

  /** Kick the surface into motion - called on landing, lifting and settling. */
  agitate(strength = 1): void {
    this.wobble = Math.min(1, this.wobble + strength);
    this.dirty = true;
  }

  setSelected(on: boolean): void {
    this.glow.alpha = on ? 1 : 0;
  }

  flashComplete(): void {
    this.flash.alpha = 0.8;
  }

  // --------------------------------------------------------------- ticking
  /** @param dt seconds since last frame */
  update(dt: number): void {
    if (this.wobble > 0.0005) {
      // Critically-ish damped decay: settles in roughly half a second.
      this.wobble *= Math.exp(-4.5 * dt);
      this.wavePhase += dt * 11;
      this.dirty = true;
    } else if (this.wobble !== 0) {
      this.wobble = 0;
      this.dirty = true;
    }

    if (this.flash.alpha > 0) {
      this.flash.alpha = Math.max(0, this.flash.alpha - dt * 2.2);
    }

    // Tilting changes the counter-rotation, so the liquid must be rebuilt.
    if (this.rotation !== this.lastRotation) {
      this.lastRotation = this.rotation;
      this.dirty = true;
    }

    if (this.dirty) {
      this.redrawLiquid();
      this.dirty = false;
    }
  }

  // --------------------------------------------------------------- drawing
  /**
   * The bottle silhouette as one continuous path: collar, neck, flared
   * shoulder, straight body, rounded base. Drawing it in a single pass (rather
   * than stacking separate shapes) is what keeps the neck visually attached.
   *
   * @param inset shrink the outline by this much on every side, for the cavity.
   */
  private outline(g: Graphics, inset = 0): void {
    const geo = this.geo;
    const w = geo.bodyW - inset * 2;
    const cw = Math.max(4, geo.collarW - inset * 2);
    const nw = Math.max(3, geo.neckW - inset * 2);

    const y0 = inset;
    const y1 = geo.yCollar;
    const y2 = geo.yNeck;
    const y3 = geo.yBody;
    const y4 = geo.yBottom - inset;

    const br = Math.max(1, BOTTLE.bottomRadius * geo.bodyW - inset);
    const cr = Math.min(BOTTLE.collarRadius * geo.bodyW, cw / 2 - 0.5);

    g.moveTo(-cw / 2 + cr, y0)
      .lineTo(cw / 2 - cr, y0)
      .quadraticCurveTo(cw / 2, y0, cw / 2, y0 + cr)
      .lineTo(cw / 2, y1)
      .lineTo(nw / 2, y1)
      .lineTo(nw / 2, y2)
      // shoulder: leaves the neck horizontally, meets the body vertically
      .quadraticCurveTo(w / 2, y2, w / 2, y3)
      .lineTo(w / 2, y4 - br)
      .quadraticCurveTo(w / 2, y4, w / 2 - br, y4)
      .lineTo(-w / 2 + br, y4)
      .quadraticCurveTo(-w / 2, y4, -w / 2, y4 - br)
      .lineTo(-w / 2, y3)
      .quadraticCurveTo(-w / 2, y2, -nw / 2, y2)
      .lineTo(-nw / 2, y1)
      .lineTo(-cw / 2, y1)
      .lineTo(-cw / 2, y0 + cr)
      .quadraticCurveTo(-cw / 2, y0, -cw / 2 + cr, y0)
      .closePath();
  }

  /** Static parts: cavity, glass, outline, highlights, hit area, glow. */
  private redrawChrome(): void {
    const g = this.geo;
    const t = GLASS.thickness;

    // --- dark cavity behind the liquid, so empty glass still reads as glass
    this.cavity.clear();
    this.outline(this.cavity, t * 0.6);
    this.cavity.fill({ color: GLASS.cavity, alpha: GLASS.cavityAlpha });

    // --- liquid clip region: the straight body, square top, rounded bottom
    this.liquidMask.clear();
    this.liquidMask
      .roundRect(g.ix, g.iy + g.ih - g.bottomR * 2, g.iw, g.bottomR * 2, g.bottomR)
      .fill(0xffffff)
      .rect(g.ix, g.iy, g.iw, g.ih - g.bottomR)
      .fill(0xffffff);

    // --- glass
    const gl = this.glass;
    gl.clear();

    // faint fill over the whole silhouette so the glass has body
    this.outline(gl, 0);
    gl.fill({ color: 0x9ec7e8, alpha: 0.06 });
    this.outline(gl, 0);
    gl.stroke({ width: 2.4, color: GLASS.rim, alpha: GLASS.rimAlpha, alignment: 0.5 });

    // collar ring, slightly brighter than the rest of the glass
    gl.roundRect(
      -g.collarW / 2, 0, g.collarW, g.yCollar,
      Math.min(BOTTLE.collarRadius * g.bodyW, g.yCollar / 2),
    ).fill({ color: 0xbcdcf5, alpha: 0.2 });

    // highlight riding over the shoulder curve
    gl.moveTo(-g.bodyW / 2 + t, g.yBody)
      .quadraticCurveTo(-g.bodyW / 2 + t, g.yNeck + t, -g.neckW / 2 + t, g.yNeck + t)
      .lineTo(-g.neckW / 2 + t * 2, g.yNeck + t * 2)
      .quadraticCurveTo(-g.bodyW / 2 + t * 2.6, g.yNeck + t * 2, -g.bodyW / 2 + t * 2.6, g.yBody)
      .closePath()
      .fill({ color: GLASS.specular, alpha: 0.12 });

    // specular stripe down the left of the body
    const bodyH = g.yBottom - g.yBody;
    const sx = -g.bodyW / 2 + g.bodyW * 0.15;
    const sw = Math.max(3, g.bodyW * 0.1);
    gl.roundRect(sx, g.yBody + bodyH * 0.05, sw, bodyH * 0.6, sw / 2)
      .fill({ color: GLASS.specular, alpha: 0.16 });

    // faint rim light down the right
    const rw = Math.max(2, g.bodyW * 0.05);
    gl.roundRect(g.bodyW / 2 - g.bodyW * 0.13, g.yBody + bodyH * 0.14, rw, bodyH * 0.5, rw / 2)
      .fill({ color: GLASS.specular, alpha: 0.07 });

    // --- completion flash overlay
    this.flash.clear();
    this.outline(this.flash, t * 0.6);
    this.flash.fill({ color: 0xffffff, alpha: 1 });

    // --- selection glow: soft outer halo built from stacked strokes
    this.glow.clear();
    for (let i = 4; i >= 1; i--) {
      this.outline(this.glow, -i * 3);
      this.glow.stroke({ width: 3, color: 0x8be9ff, alpha: 0.1 });
    }

    // --- generous touch target: at least 44px wide regardless of bottle size
    const padX = Math.max(0, (44 - g.bodyW) / 2) + 6;
    this.hitArea = new Rectangle(
      -g.bodyW / 2 - padX, -8, g.bodyW + padX * 2, g.totalH + 16,
    );
  }

  /**
   * Vertical span of the cavity measured along world "down", for a bottle
   * tilted by `theta`. Returned in world-aligned units so fill fractions can be
   * turned into surface heights.
   */
  private verticalExtent(theta: number): { minY: number; maxY: number } {
    const g = this.geo;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const corners: Array<[number, number]> = [
      [g.ix, g.iy],
      [g.ix + g.iw, g.iy],
      [g.ix + g.iw, g.iy + g.ih],
      [g.ix, g.iy + g.ih],
    ];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [px, py] of corners) {
      const qy = px * sin + py * cos;
      if (qy < minY) minY = qy;
      if (qy > maxY) maxY = qy;
    }
    return { minY, maxY };
  }

  /**
   * Redraw the liquid.
   *
   * Bands are world-horizontal regardless of how far the bottle is tilted, so
   * the surface behaves like real liquid rather than a rotating sticker.
   *
   * Everything is emitted in *bottle-local* space rather than counter-rotating
   * the graphics object: a world-horizontal strip `a <= y <= b` is the region
   * between two parallel lines whose normal is (sin, cos), so each band becomes
   * a quad spanned by the perpendicular direction. Drawing in local space keeps
   * the clip mask working exactly as it does when upright - counter-rotating the
   * graphics instead let the liquid escape the glass.
   */
  private redrawLiquid(): void {
    const gfx = this.liquid;
    gfx.clear();
    gfx.rotation = 0;

    if (this.bands.length === 0) return;

    const theta = this.rotation;
    const { minY, maxY } = this.verticalExtent(theta);
    const span = maxY - minY;
    const g = this.geo;

    const sin = Math.sin(theta);
    const cos = Math.cos(theta);
    // Unit normal pointing along world "down", and the along-surface direction.
    const nx = sin;
    const ny = cos;
    const dx = cos;
    const dy = -sin;
    // Long enough that the mask, not the quad, defines the silhouette.
    const reach = g.iw + g.ih;

    const unitH = span / TUBE_CAPACITY;
    const waveAmp = Math.min(unitH * 0.3, g.iw * 0.12) * this.wobble;
    const topIndex = this.bands.length - 1;

    let cum = 0;
    for (let i = 0; i < this.bands.length; i++) {
      const band = this.bands[i] as Band;
      if (band.amount <= 0.0001) continue;
      const col = colorOf(band.color);

      const yBottom = maxY - (cum / TUBE_CAPACITY) * span;
      cum += band.amount;
      const yTop = maxY - (cum / TUBE_CAPACITY) * span;
      const bandH = yBottom - yTop;
      const isTop = i === topIndex;
      const wavy = isTop && waveAmp > 0.05;

      this.strip(gfx, nx, ny, dx, dy, reach, yTop, yBottom, wavy ? waveAmp : 0);
      gfx.fill({ color: col.base });

      // Two stacked sheen bands fake a soft gradient falloff without
      // allocating a FillGradient (which would need explicit disposal).
      const sheenH = Math.min(bandH * 0.34, unitH * 0.34);
      if (sheenH > 0.6) {
        this.strip(gfx, nx, ny, dx, dy, reach, yTop, yTop + sheenH * 0.55, wavy ? waveAmp : 0);
        gfx.fill({ color: col.light, alpha: 0.3 });
        this.strip(gfx, nx, ny, dx, dy, reach, yTop + sheenH * 0.55, yTop + sheenH, 0);
        gfx.fill({ color: col.light, alpha: 0.14 });
      }
      const shadeH = Math.min(bandH * 0.2, unitH * 0.2);
      if (shadeH > 0.6) {
        this.strip(gfx, nx, ny, dx, dy, reach, yBottom - shadeH, yBottom, 0);
        gfx.fill({ color: col.dark, alpha: 0.18 });
      }

      // bright meniscus on the exposed surface
      if (isTop) {
        const lineH = Math.max(1.5, unitH * 0.055);
        this.strip(gfx, nx, ny, dx, dy, reach, yTop, yTop + lineH, wavy ? waveAmp : 0);
        gfx.fill({ color: col.light, alpha: 0.9 });
      }

      if (this.colorblind && bandH > unitH * 0.55) {
        const mid = (yTop + yBottom) / 2;
        this.drawGlyph(
          gfx, col.glyph, nx * mid, ny * mid, Math.min(unitH * 0.4, g.iw * 0.3),
        );
      }
    }
  }

  /**
   * Emit the band between world-heights `a` and `b` as a quad in bottle-local
   * space. `amp > 0` gives the top edge a sine wave along the surface.
   */
  private strip(
    gfx: Graphics,
    nx: number, ny: number, dx: number, dy: number,
    reach: number, a: number, b: number, amp: number,
  ): void {
    // Points at world-height h lie on the line h*(nx,ny) + t*(dx,dy).
    const at = (h: number, t: number): [number, number] => [nx * h + dx * t, ny * h + dy * t];

    if (amp <= 0) {
      const p0 = at(a, -reach);
      const p1 = at(a, reach);
      const p2 = at(b, reach);
      const p3 = at(b, -reach);
      gfx.poly([p0[0], p0[1], p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]]);
      return;
    }

    const steps = 16;
    const pts: number[] = [];
    const k = (Math.PI * 2 * 1.5) / (reach * 2);
    for (let i = 0; i <= steps; i++) {
      const t = -reach + (reach * 2 * i) / steps;
      const h = a + Math.sin(this.wavePhase + (t + reach) * k) * amp;
      const p = at(h, t);
      pts.push(p[0], p[1]);
    }
    const e1 = at(b, reach);
    const e0 = at(b, -reach);
    pts.push(e1[0], e1[1], e0[0], e0[1]);
    gfx.poly(pts);
  }

  /** Shape markers for the colourblind aid - one distinct glyph per colour. */
  private drawGlyph(gfx: Graphics, kind: GlyphKind, cx: number, cy: number, size: number): void {
    const r = size / 2;
    const alpha = 0.4;
    switch (kind) {
      case 'circle':
        gfx.circle(cx, cy, r * 0.8).fill({ color: 0xffffff, alpha });
        break;
      case 'triangle':
        gfx.moveTo(cx, cy - r).lineTo(cx + r, cy + r * 0.8).lineTo(cx - r, cy + r * 0.8)
          .closePath().fill({ color: 0xffffff, alpha });
        break;
      case 'square':
        gfx.rect(cx - r * 0.75, cy - r * 0.75, r * 1.5, r * 1.5).fill({ color: 0xffffff, alpha });
        break;
      case 'diamond':
        gfx.moveTo(cx, cy - r).lineTo(cx + r, cy).lineTo(cx, cy + r).lineTo(cx - r, cy)
          .closePath().fill({ color: 0xffffff, alpha });
        break;
      case 'cross':
        gfx.rect(cx - r * 0.9, cy - r * 0.28, r * 1.8, r * 0.56).fill({ color: 0xffffff, alpha });
        gfx.rect(cx - r * 0.28, cy - r * 0.9, r * 0.56, r * 1.8).fill({ color: 0xffffff, alpha });
        break;
      case 'ring':
        gfx.circle(cx, cy, r * 0.8)
          .stroke({ width: Math.max(1.5, r * 0.34), color: 0xffffff, alpha });
        break;
      case 'bar':
        gfx.rect(cx - r, cy - r * 0.3, r * 2, r * 0.6).fill({ color: 0xffffff, alpha });
        break;
      case 'star': {
        const spikes = 5;
        for (let i = 0; i < spikes * 2; i++) {
          const rad = i % 2 === 0 ? r : r * 0.45;
          const ang = (Math.PI / spikes) * i - Math.PI / 2;
          const px = cx + Math.cos(ang) * rad;
          const py = cy + Math.sin(ang) * rad;
          if (i === 0) gfx.moveTo(px, py);
          else gfx.lineTo(px, py);
        }
        gfx.closePath().fill({ color: 0xffffff, alpha });
        break;
      }
    }
  }
}

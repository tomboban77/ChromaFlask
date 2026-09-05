/**
 * Visual constants shared by the Pixi board and the DOM chrome.
 */

export interface LiquidColor {
  readonly name: string;
  /** Main body colour. */
  readonly base: number;
  /** Lighter tint used for the sheen band near the top of each unit. */
  readonly light: number;
  /** Darker tone used for the shadow band at the bottom of each unit. */
  readonly dark: number;
  /** CSS form, for DOM elements such as the tutorial and win chips. */
  readonly css: string;
  /** Distinct glyph drawn on each band when the colourblind aid is enabled. */
  readonly glyph: GlyphKind;
}

export type GlyphKind = 'circle' | 'triangle' | 'square' | 'diamond' | 'cross' | 'ring' | 'bar' | 'star';

/**
 * Ordered so that low-index colours - the ones used by the earliest levels -
 * are maximally far apart in hue. Level 1 is therefore red against cyan, which
 * stays legible under every common form of colour vision deficiency. The glyph
 * layer is the real accessibility guarantee once all eight are in play.
 */
export const PALETTE: readonly LiquidColor[] = [
  { name: 'Crimson', base: 0xf5365c, light: 0xff7b96, dark: 0xa8163a, css: '#f5365c', glyph: 'circle' },
  { name: 'Cyan',    base: 0x22d3ee, light: 0x7ceeff, dark: 0x0d8ba6, css: '#22d3ee', glyph: 'triangle' },
  { name: 'Amber',   base: 0xffb020, light: 0xffd57a, dark: 0xb87400, css: '#ffb020', glyph: 'square' },
  { name: 'Violet',  base: 0xa855f7, light: 0xd0a2ff, dark: 0x6d28d9, css: '#a855f7', glyph: 'diamond' },
  { name: 'Emerald', base: 0x2bd97c, light: 0x81f0b3, dark: 0x11914b, css: '#2bd97c', glyph: 'cross' },
  { name: 'Azure',   base: 0x4f7cff, light: 0x9db4ff, dark: 0x2544b8, css: '#4f7cff', glyph: 'ring' },
  { name: 'Rose',    base: 0xff6fb5, light: 0xffb0d6, dark: 0xc22d78, css: '#ff6fb5', glyph: 'bar' },
  { name: 'Lime',    base: 0xc8e64a, light: 0xe6f79a, dark: 0x87a013, css: '#c8e64a', glyph: 'star' },
];

export function colorOf(id: number): LiquidColor {
  return PALETTE[id % PALETTE.length] as LiquidColor;
}

export const GLASS = {
  /** Body outline / rim. */
  rim: 0x8fb8de,
  rimAlpha: 0.55,
  /** Dark interior seen through empty glass. */
  cavity: 0x0b1230,
  cavityAlpha: 0.55,
  /** Specular stripe down the left of the body. */
  specular: 0xffffff,
  thickness: 3,
} as const;

export const STAGE_BG = 0x0a0e2a;

/**
 * Vessel proportions, as multiples of body width, measured top-down:
 * collar (lip) -> neck -> flared shoulder -> straight body -> rounded base.
 * The shoulder is what makes the silhouette read as a bottle rather than as a
 * narrow box sitting on a wide one.
 */
export interface VesselSpec {
  readonly collarW: number;
  readonly collarH: number;
  readonly neckW: number;
  readonly neckH: number;
  /** Vertical run of the curve that flares the neck out to the full body. */
  readonly shoulderH: number;
  /** Straight-sided section that holds the liquid. */
  readonly bodyH: number;
  readonly bottomRadius: number;
  readonly collarRadius: number;
}

export const BOTTLE: VesselSpec = {
  collarW: 0.44,
  collarH: 0.12,
  neckW: 0.30,
  neckH: 0.14,
  shoulderH: 0.26,
  bodyH: 2.42,
  bottomRadius: 0.30,
  collarRadius: 0.05,
} as const;

/**
 * The Cauldron: wide gold-trimmed rim, a short tucked neck, and a round-
 * bellied pot. Deliberately squatter than a bottle so it reads as a different
 * kind of vessel at a glance.
 */
export const CAULDRON: VesselSpec = {
  collarW: 1.04,
  collarH: 0.15,
  neckW: 0.80,
  neckH: 0.06,
  shoulderH: 0.24,
  bodyH: 2.05,
  bottomRadius: 0.48,
  collarRadius: 0.07,
} as const;

export type VesselVariant = 'bottle' | 'cauldron';

export function vesselSpec(variant: VesselVariant): VesselSpec {
  return variant === 'cauldron' ? CAULDRON : BOTTLE;
}

export function vesselHeight(bodyWidth: number, variant: VesselVariant): number {
  const v = vesselSpec(variant);
  return bodyWidth * (v.collarH + v.neckH + v.shoulderH + v.bodyH);
}

/** Overall bottle height for a given body width (drives the board layout). */
export function bottleHeight(bodyWidth: number): number {
  return vesselHeight(bodyWidth, 'bottle');
}

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

/**
 * The One-Way Flask: bottle proportions with a wider, funnel-like collar so
 * it reads as "things go in here" before any glyph is drawn.
 */
export const ONE_WAY: VesselSpec = {
  collarW: 0.62,
  collarH: 0.16,
  neckW: 0.34,
  neckH: 0.12,
  shoulderH: 0.26,
  bodyH: 2.40,
  bottomRadius: 0.30,
  collarRadius: 0.06,
} as const;

export type VesselVariant = 'bottle' | 'cauldron' | 'oneway';

export function vesselSpec(variant: VesselVariant): VesselSpec {
  return variant === 'cauldron' ? CAULDRON : variant === 'oneway' ? ONE_WAY : BOTTLE;
}

export function vesselHeight(bodyWidth: number, variant: VesselVariant): number {
  const v = vesselSpec(variant);
  return bodyWidth * (v.collarH + v.neckH + v.shoulderH + v.bodyH);
}

/** Overall bottle height for a given body width (drives the board layout). */
export function bottleHeight(bodyWidth: number): number {
  return vesselHeight(bodyWidth, 'bottle');
}

// --------------------------------------------------------------- skins
/**
 * A bottle look: the glass tints and the cork of *plain* bottles. The
 * cauldron and the one-way flask keep their own colours in every skin so
 * they stay recognisable as different vessels. `classic` reproduces the
 * original constants exactly and is always owned.
 */
export interface GlassSkin {
  readonly id: string;
  /** Coins; 0 means free and always owned. */
  readonly price: number;
  readonly rim: number;
  readonly rimAlpha: number;
  /** Faint fill over the whole silhouette. */
  readonly body: number;
  readonly bodyAlpha: number;
  readonly collar: number;
  readonly collarAlpha: number;
  /** Dark interior seen through empty glass. */
  readonly cavity: number;
  readonly cavityAlpha: number;
  readonly cork: number;
  readonly corkDark: number;
  readonly corkEdge: number;
}

export const SKINS: readonly GlassSkin[] = [
  {
    id: 'classic', price: 0,
    rim: GLASS.rim, rimAlpha: GLASS.rimAlpha, body: 0x9ec7e8, bodyAlpha: 0.06,
    collar: 0xbcdcf5, collarAlpha: 0.2, cavity: GLASS.cavity, cavityAlpha: GLASS.cavityAlpha,
    cork: 0xd9a066, corkDark: 0xa8703c, corkEdge: 0x6b4420,
  },
  {
    id: 'frost', price: 300,
    rim: 0xdff4ff, rimAlpha: 0.8, body: 0xcfeeff, bodyAlpha: 0.14,
    collar: 0xffffff, collarAlpha: 0.35, cavity: 0x16223f, cavityAlpha: 0.5,
    cork: 0x9fb8c9, corkDark: 0x6b86a0, corkEdge: 0x3f5568,
  },
  {
    id: 'rose', price: 400,
    rim: 0xffa3cf, rimAlpha: 0.7, body: 0xff8ec4, bodyAlpha: 0.1,
    collar: 0xffc4e0, collarAlpha: 0.3, cavity: 0x2a0f24, cavityAlpha: 0.55,
    cork: 0xe8b86d, corkDark: 0xb88a3c, corkEdge: 0x6e4d18,
  },
  {
    id: 'amber', price: 500,
    rim: 0xffcf6a, rimAlpha: 0.75, body: 0xffb84a, bodyAlpha: 0.1,
    collar: 0xffe2a0, collarAlpha: 0.3, cavity: 0x2b1a05, cavityAlpha: 0.55,
    cork: 0x7a4b2a, corkDark: 0x4e2e17, corkEdge: 0x2b1708,
  },
  {
    id: 'emerald', price: 600,
    rim: 0x6fe89a, rimAlpha: 0.7, body: 0x3fd97a, bodyAlpha: 0.1,
    collar: 0xb5ffd0, collarAlpha: 0.3, cavity: 0x07261c, cavityAlpha: 0.55,
    cork: 0xd9a066, corkDark: 0xa8703c, corkEdge: 0x6b4420,
  },
  {
    id: 'obsidian', price: 800,
    rim: 0xb39dff, rimAlpha: 0.75, body: 0x1a1030, bodyAlpha: 0.35,
    collar: 0xd6c6ff, collarAlpha: 0.3, cavity: 0x050311, cavityAlpha: 0.8,
    cork: 0xffc531, corkDark: 0xb88a1c, corkEdge: 0x6e4d0a,
  },
];

export const DEFAULT_SKIN_ID = 'classic';

/** Unknown ids (an old save, a removed skin) fall back to classic. */
export function skinById(id: string): GlassSkin {
  return SKINS.find((s) => s.id === id) ?? (SKINS[0] as GlassSkin);
}

/** CSS hex for a Pixi colour number, for DOM previews. */
export function cssHex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

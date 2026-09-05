/**
 * Pure domain types for the liquid-sort puzzle.
 * This module (and everything in core/) must never import a rendering engine.
 */

/** A colour is an index into the active palette. */
export type ColorId = number;

/** A tube's contents, ordered bottom -> top. Length <= TUBE_CAPACITY. */
export type Tube = ColorId[];

/** The full playfield: an ordered list of tubes. Order is presentation-only. */
export type Board = Tube[];

/** A single pour of `count` units of `color` from tube `from` into tube `to`. */
export interface Move {
  readonly from: number;
  readonly to: number;
  readonly count: number;
  readonly color: ColorId;
}

/** The contiguous block of identical colour sitting at a tube's mouth. */
export interface TopRun {
  readonly color: ColorId;
  readonly count: number;
}

export interface LevelSpec {
  /** 1-based level number, also the generator seed. */
  readonly id: number;
  /** Distinct colours in play; each contributes exactly TUBE_CAPACITY units. */
  readonly colors: number;
  /** Empty tubes provided as working space. Fewer = harder. */
  readonly empties: number;
  /** Reject generated boards easier than this (in optimal moves). */
  readonly minPar: number;
  readonly name: string;
  /**
   * Murky potion: everything below each tube's top unit starts concealed and
   * is revealed as it surfaces. Purely visual - the board, solver and par are
   * unaffected - but it forces players to plan under uncertainty.
   */
  readonly murky?: boolean;
  /**
   * The Cauldron: an extra vessel (always tube index 0) that accepts any
   * colour on top - but the level only counts as won once it is empty again.
   * Flexible space that turns into a liability if used carelessly.
   */
  readonly cauldron?: boolean;
  /**
   * The Locked Bottle: one filled tube starts padlocked and cannot be poured
   * into or out of until `seals` other bottles have been completed. Forces
   * the player to plan which colours to finish first. Purely a restriction
   * on legal moves, so every existing solver bound stays admissible.
   */
  readonly lock?: { readonly seals: number };
  /**
   * The One-Way Flask: an extra, initially empty vessel (always the last
   * tube) that can be poured into but never out of - and must be full to
   * win. A commitment: whatever goes in stays, so one colour has to be
   * chosen for it and delivered in order.
   */
  readonly oneWay?: boolean;
}

/** Rule variations that change what the engine considers legal or solved. */
export interface BoardRules {
  /** When true, tube 0 is the Cauldron: accepts any colour, must end empty. */
  readonly cauldron: boolean;
  /** When set, tube `index` is padlocked until `seals` ordinary bottles are complete. */
  readonly lock?: { readonly index: number; readonly seals: number };
  /** When set, tube `index` is the One-Way Flask: pour in only, must end full. */
  readonly oneWay?: { readonly index: number };
}

/** A generated, verified-solvable puzzle. */
export interface GeneratedLevel {
  readonly spec: LevelSpec;
  readonly board: Board;
  /** Optimal (or best-found) solution length, used as the 3-star target. */
  readonly par: number;
  /** A full winning line, used to power the Hint powerup instantly. */
  readonly solution: readonly Move[];
}

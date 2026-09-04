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

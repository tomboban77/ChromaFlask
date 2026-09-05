/**
 * Web Worker entry: runs solver queries off the main thread.
 *
 * The expensive case is a *proof* that a position cannot be won - the search
 * has to exhaust its budget, which on a cauldron board is ~0.5 s of CPU on a
 * desktop and several seconds on a phone. Doing that on the UI thread right
 * after a pour is a visible stall; here it costs nothing the player can feel.
 *
 * Messages are plain data (boards are arrays of numbers) so structured
 * cloning is cheap. See services/SolverClient.ts for the request shapes.
 */
import { findHint, solvability } from './solver';
import type { Board, BoardRules } from './types';

export type SolverRequest =
  | { kind: 'solvability'; board: Board; rules: BoardRules; maxNodes: number }
  | { kind: 'hint'; board: Board; rules: BoardRules };

export interface SolverEnvelope {
  id: number;
  req: SolverRequest;
}

addEventListener('message', (event: MessageEvent<SolverEnvelope>) => {
  const { id, req } = event.data;
  const result =
    req.kind === 'hint'
      ? findHint(req.board, req.rules)
      : solvability(req.board, req.rules, req.maxNodes);
  postMessage({ id, result });
});

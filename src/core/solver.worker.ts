/**
 * Web Worker entry: runs solver queries off the main thread.
 *
 * The expensive cases are a *proof* that a position cannot be won (the search
 * has to exhaust its budget - ~0.5 s of CPU on a cauldron board on a desktop,
 * several seconds on a phone) and generating an endless-mode level (deal,
 * solve, repeat until a deal meets its par floor). Here neither costs the
 * player a dropped frame.
 *
 * Messages are plain data (boards are arrays of numbers) so structured
 * cloning is cheap. See services/SolverClient.ts for the request shapes.
 */
import { generateLevel } from './generator';
import { findHint, solvability } from './solver';
import type { Board, BoardRules, LevelSpec } from './types';

export type SolverRequest =
  | { kind: 'solvability'; board: Board; rules: BoardRules; maxNodes: number }
  | { kind: 'hint'; board: Board; rules: BoardRules }
  | { kind: 'generate'; spec: LevelSpec };

export interface SolverEnvelope {
  id: number;
  req: SolverRequest;
}

export type SolverReply =
  | { id: number; result: unknown }
  | { id: number; error: string };

export function runRequest(req: SolverRequest): unknown {
  switch (req.kind) {
    case 'hint':
      return findHint(req.board, req.rules);
    case 'solvability':
      return solvability(req.board, req.rules, req.maxNodes);
    case 'generate':
      return generateLevel(req.spec);
  }
}

addEventListener('message', (event: MessageEvent<SolverEnvelope>) => {
  const { id, req } = event.data;
  let reply: SolverReply;
  try {
    reply = { id, result: runRequest(req) };
  } catch (err) {
    reply = { id, error: err instanceof Error ? err.message : String(err) };
  }
  postMessage(reply);
});

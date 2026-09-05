/**
 * Promise API over the solver worker, with a synchronous fallback when
 * workers are unavailable (or the worker dies), so callers never have to care
 * where the search actually ran.
 */
import { findHint, solvability, type Solvability } from '@/core/solver';
import type { SolverEnvelope, SolverRequest } from '@/core/solver.worker';
import type { Board, BoardRules, Move } from '@/core/types';

interface Pending {
  req: SolverRequest;
  resolve: (result: unknown) => void;
}

function runSync(req: SolverRequest): unknown {
  return req.kind === 'hint'
    ? findHint(req.board, req.rules)
    : solvability(req.board, req.rules, req.maxNodes);
}

export class SolverClient {
  private worker: Worker | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();

  constructor() {
    try {
      if (typeof Worker === 'undefined') return;
      this.worker = new Worker(new URL('../core/solver.worker.ts', import.meta.url), {
        type: 'module',
      });
      this.worker.addEventListener('message', (ev: MessageEvent<{ id: number; result: unknown }>) => {
        const entry = this.pending.get(ev.data.id);
        if (!entry) return;
        this.pending.delete(ev.data.id);
        entry.resolve(ev.data.result);
      });
      // A dead worker must not leave promises hanging: answer everything in
      // flight on the main thread and stay synchronous from here on.
      this.worker.addEventListener('error', () => this.degrade());
    } catch {
      this.worker = null;
    }
  }

  get usingWorker(): boolean {
    return this.worker !== null;
  }

  private degrade(): void {
    console.warn('[solver] worker failed; falling back to main-thread search');
    this.worker?.terminate();
    this.worker = null;
    for (const [id, entry] of this.pending) {
      this.pending.delete(id);
      entry.resolve(runSync(entry.req));
    }
  }

  private post<T>(req: SolverRequest): Promise<T> {
    if (!this.worker) return Promise.resolve(runSync(req) as T);
    return new Promise<T>((resolve) => {
      const id = this.nextId++;
      this.pending.set(id, { req, resolve: resolve as (r: unknown) => void });
      const envelope: SolverEnvelope = { id, req };
      this.worker?.postMessage(envelope);
    });
  }

  /** Three-way solvability; 'unsolvable' is a proof (see core/solver.ts). */
  solvability(board: Board, rules: BoardRules, maxNodes: number): Promise<Solvability> {
    return this.post<Solvability>({ kind: 'solvability', board, rules, maxNodes });
  }

  /** First move of a winning line from this position, or null if none exists. */
  hint(board: Board, rules: BoardRules): Promise<Move | null> {
    return this.post<Move | null>({ kind: 'hint', board, rules });
  }
}

export const solverClient = new SolverClient();

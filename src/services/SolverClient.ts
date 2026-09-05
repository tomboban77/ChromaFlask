/**
 * Promise API over the solver worker, with a synchronous fallback when
 * workers are unavailable (or the worker dies), so callers never have to care
 * where the search actually ran.
 */
import type { Solvability } from '@/core/solver';
import { runRequest, type SolverEnvelope, type SolverReply, type SolverRequest } from '@/core/solver.worker';
import type { Board, BoardRules, GeneratedLevel, LevelSpec, Move } from '@/core/types';

interface Pending {
  req: SolverRequest;
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
}

function settleSync(entry: Pending): void {
  try {
    entry.resolve(runRequest(entry.req));
  } catch (err) {
    entry.reject(err instanceof Error ? err : new Error(String(err)));
  }
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
      this.worker.addEventListener('message', (ev: MessageEvent<SolverReply>) => {
        const entry = this.pending.get(ev.data.id);
        if (!entry) return;
        this.pending.delete(ev.data.id);
        if ('error' in ev.data) entry.reject(new Error(ev.data.error));
        else entry.resolve(ev.data.result);
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
      settleSync(entry);
    }
  }

  private post<T>(req: SolverRequest): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const entry: Pending = { req, resolve: resolve as (r: unknown) => void, reject };
      if (!this.worker) {
        settleSync(entry);
        return;
      }
      const id = this.nextId++;
      this.pending.set(id, entry);
      const envelope: SolverEnvelope = { id, req };
      this.worker.postMessage(envelope);
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

  /** Deal and prove a level for a spec (endless mode). Rejects if no deal met the floor. */
  generate(spec: LevelSpec): Promise<GeneratedLevel> {
    return this.post<GeneratedLevel>({ kind: 'generate', spec });
  }
}

export const solverClient = new SolverClient();

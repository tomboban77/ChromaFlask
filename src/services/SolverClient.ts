/**
 * Promise API over the solver worker, with a synchronous fallback when
 * workers are unavailable (or the worker dies), so callers never have to care
 * where the search actually ran.
 */
import type { Analysis } from '@/core/solver';
import { runRequest, type SolverEnvelope, type SolverReply, type SolverRequest } from '@/core/solver.worker';
import type { Board, BoardRules, GeneratedLevel, LevelSpec } from '@/core/types';

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

  /**
   * Whether this position can still be won, and the first move of a line if
   * so. The no-win warning and the Hint both use it (see core/solver.ts).
   */
  analyze(board: Board, rules: BoardRules): Promise<Analysis> {
    return this.post<Analysis>({ kind: 'analyze', board, rules });
  }

  /** Deal and prove a level for a spec (endless mode). Rejects if no deal met the floor. */
  generate(spec: LevelSpec): Promise<GeneratedLevel> {
    return this.post<GeneratedLevel>({ kind: 'generate', spec });
  }
}

export const solverClient = new SolverClient();

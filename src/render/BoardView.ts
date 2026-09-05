import { Container, Point } from 'pixi.js';
import gsap from 'gsap';
import {
  DEFAULT_RULES, TUBE_CAPACITY, applyPour, cloneBoard, isComplete, isDeadlocked,
  isSolved, lockActive, pourAmount, rulesFor, sealsRemaining, undoPour,
} from '@/core/board';
import { findHint } from '@/core/solver';
import type { Board, BoardRules, ColorId, GeneratedLevel, Move } from '@/core/types';
import { solverClient } from '@/services/SolverClient';
import { audio } from '@/audio/AudioEngine';
import { BottleView, type Band } from './BottleView';
import type { ParticleField, StreamView } from './effects';
import { SKINS, bottleHeight, type GlassSkin } from './theme';

const POUR_ANGLE = 0.92; // radians, about 53 degrees
const LIFT = 26;

export interface BoardCallbacks {
  onMove?: (move: Move, moveCount: number) => void;
  onWin?: () => void;
  onStuck?: () => void;
  /** Fired once per trap: the position is *proven* unwinnable (moves remain). */
  onNoWin?: () => void;
  onInvalid?: (index: number) => void;
  onSelectionChange?: (index: number | null) => void;
  onTubeComplete?: (index: number) => void;
  /** The player tapped the padlocked bottle; `sealsLeft` bottles still to seal. */
  onLockedTap?: (sealsLeft: number) => void;
  /** The padlock opened. */
  onUnlocked?: () => void;
  /** The player tried to pour *out of* the one-way flask. */
  onOneWayTap?: () => void;
}

interface Slot {
  x: number;
  y: number;
}

/** A saved mid-level position to mount instead of the level's opening board. */
export interface BoardRestore {
  readonly board: Board;
  readonly history: readonly Move[];
  readonly hidden: readonly number[];
}

/**
 * Build render bands from a unit stack, optionally stopping partway up so the
 * top band can be a fraction of a unit while liquid is in flight.
 */
function bandsUpTo(units: readonly ColorId[], limit: number): Band[] {
  const bands: Band[] = [];
  let acc = 0;
  for (const c of units) {
    if (acc >= limit - 0.0001) break;
    const take = Math.min(1, limit - acc);
    const last = bands[bands.length - 1];
    if (last && last.color === c) last.amount += take;
    else bands.push({ color: c, amount: take });
    acc += take;
  }
  return bands;
}

export class BoardView {
  readonly layer = new Container();

  private bottles: BottleView[] = [];
  private slots: Slot[] = [];
  private board: Board = [];
  private history: Move[] = [];
  /**
   * Murky levels: units still concealed at the bottom of each tube. A unit is
   * revealed permanently once it surfaces; undo never re-conceals. Purely
   * visual - the board itself always knows the truth.
   */
  private hidden: number[] = [];
  /** Rule variations for the mounted level (cauldron etc.). */
  private rules: BoardRules = DEFAULT_RULES;
  /** One "no way to win" warning per trap; re-armed by undo and new space. */
  private noWinWarned = false;
  private noWinTimer: number | null = null;

  private selected: number | null = null;
  private busy = false;
  private hintPair: { from: number; to: number } | null = null;
  private hintTimer: number | null = null;

  private viewW = 0;
  private viewH = 0;
  private bodyW = 60;

  private splashAccumulator = 0;
  private pendingIntro = false;
  /** Bumped on teardown so an in-flight pour can detect it is stale and bail. */
  private generation = 0;
  private pouring: number | null = null;
  private resolved = false;
  private motionScale = 1;
  private particlesEnabled = true;
  /** Glass look applied to every bottle mounted now or later. */
  private skin: GlassSkin = SKINS[0] as GlassSkin;

  constructor(
    private readonly stream: StreamView,
    private readonly particles: ParticleField,
    private readonly callbacks: BoardCallbacks = {},
  ) {
    this.layer.sortableChildren = true;
  }

  // ------------------------------------------------------------- lifecycle
  /**
   * Mount a level at its opening position, or - with `restore` - at a saved
   * mid-level position (board, move history and murk state as they were).
   * The caller validates the restore against the level first.
   */
  mount(level: GeneratedLevel, colorblind: boolean, restore?: BoardRestore): void {
    this.teardown();
    this.board = cloneBoard(restore ? restore.board : level.board);
    this.rules = rulesFor(level.spec);
    this.history = restore ? restore.history.map((m) => ({ ...m })) : [];
    this.selected = null;
    this.busy = false;
    this.noWinWarned = false;

    this.hidden = restore
      ? this.board.map((_, i) => restore.hidden[i] ?? 0)
      : this.board.map((tube) => (level.spec.murky ? Math.max(0, tube.length - 1) : 0));

    for (let i = 0; i < this.board.length; i++) {
      this.addBottleView(i, colorblind);
      this.bottles[i]?.setHidden(this.hidden[i] ?? 0);
    }
    this.syncAll();
    // A resumed board may already have sealed bottles; show them sealed, and
    // make sure nothing under a cork is still concealed.
    this.settleHidden();
    this.syncCaps(false);
    this.syncLock(false);
    // The game screen may still be display:none, in which case the host
    // measures 0x0. Defer the intro until a layout with real dimensions lands.
    this.pendingIntro = true;
    this.layout(this.viewW, this.viewH, false);
  }

  /** The cauldron, when present, is always tube 0. */
  private isCauldron(index: number): boolean {
    return this.rules.cauldron && index === 0;
  }

  /** The one-way flask, when present, is always the last tube. */
  private isOneWay(index: number): boolean {
    return this.rules.oneWay !== undefined && index === this.rules.oneWay.index;
  }

  private addBottleView(index: number, colorblind: boolean): BottleView {
    const view = new BottleView(
      index, this.bodyW,
      this.isCauldron(index) ? 'cauldron' : this.isOneWay(index) ? 'oneway' : 'bottle',
      this.skin,
    );
    view.setColorblind(colorblind);
    view.on('pointertap', () => this.handleTap(index));
    this.layer.addChild(view);
    this.bottles[index] = view;
    return view;
  }

  teardown(): void {
    this.generation += 1;
    this.pouring = null;
    this.resolved = false;
    if (this.noWinTimer !== null) {
      window.clearTimeout(this.noWinTimer);
      this.noWinTimer = null;
    }
    this.clearHint();
    for (const b of this.bottles) {
      // Per target, not the array: gsap.killTweensOf([...]) silently kills
      // nothing in GSAP 3.15, which let intro/layout tweens outlive their
      // destroyed bottles and throw on every frame. Scale is tweened on the
      // completion pulse, so it needs killing too (the cork is handled in
      // BottleView.destroy).
      gsap.killTweensOf(b);
      gsap.killTweensOf(b.scale);
      b.removeAllListeners();
      b.destroy({ children: true });
    }
    this.bottles = [];
    this.slots = [];
    this.layer.removeChildren();
    this.stream.stop();
    // Win confetti lives up to ~4 s; a new board should not start under it.
    this.particles.clear();
  }

  /** Staggered drop-in so the board assembles itself rather than appearing. */
  private introAnimation(): void {
    if (this.motionScale < 1) {
      for (const b of this.bottles) b.alpha = 1;
      return;
    }
    this.bottles.forEach((b, i) => {
      const slot = this.slots[i];
      if (!slot) return;
      b.y = slot.y - 70;
      b.alpha = 0;
      gsap.to(b, {
        y: slot.y,
        alpha: 1,
        duration: 0.42,
        delay: i * 0.05,
        ease: 'back.out(1.6)',
        onComplete: () => b.agitate(0.5),
      });
    });
  }

  setMotionScale(scale: number): void {
    this.motionScale = scale;
    this.particlesEnabled = scale >= 1;
  }

  setColorblind(on: boolean): void {
    for (const b of this.bottles) b.setColorblind(on);
  }

  /** Applies to mounted bottles at once and to every bottle mounted later. */
  setSkin(skin: GlassSkin): void {
    this.skin = skin;
    for (const b of this.bottles) b.setSkin(skin);
  }

  // ----------------------------------------------------------------- state
  get moveCount(): number {
    return this.history.length;
  }

  get canUndo(): boolean {
    return this.history.length > 0 && !this.busy;
  }

  get tubeCount(): number {
    return this.board.length;
  }

  get isBusy(): boolean {
    return this.busy;
  }

  /** True when no legal pour exists and the board is not solved. */
  get isDead(): boolean {
    return isDeadlocked(this.board, this.rules);
  }

  /** True once this board has been won (and the win reported). Cleared by undo. */
  get isResolved(): boolean {
    return this.resolved;
  }

  /**
   * True when the attempt is genuinely lost: no legal move remains, or the
   * solver has *proven* no winning line exists. This is what a heart is for;
   * a live board that the player simply walks away from is not a failure.
   */
  get isLost(): boolean {
    return !this.resolved && (this.noWinWarned || this.isDead);
  }

  snapshot(): Board {
    return cloneBoard(this.board);
  }

  /** Copies for persistence (mid-level resume). */
  historySnapshot(): Move[] {
    return this.history.map((m) => ({ ...m }));
  }

  hiddenSnapshot(): number[] {
    return this.hidden.slice();
  }

  private syncAll(): void {
    for (let i = 0; i < this.board.length; i++) {
      this.bottles[i]?.setContents(this.board[i] as ColorId[]);
    }
  }

  /** The padlocked bottle, if this level has one and the lock is engaged. */
  private isLockedTube(index: number): boolean {
    return this.rules.lock !== undefined && index === this.rules.lock.index &&
      lockActive(this.board, this.rules);
  }

  /** Padlock plate follows the rule state; opening animates and reports. */
  private syncLock(animate: boolean): void {
    if (!this.rules.lock) return;
    const view = this.bottles[this.rules.lock.index];
    if (!view) return;
    const active = lockActive(this.board, this.rules);
    view.setLocked(active, sealsRemaining(this.board, this.rules), animate, () => {
      const slot = this.slots[this.rules.lock?.index ?? -1];
      if (slot && this.particlesEnabled) {
        this.particles.sparkle(slot.x, slot.y + view.totalHeight * 0.5, 2, 16);
      }
      this.callbacks.onUnlocked?.();
    });
  }

  /** Cork on every full single-colour bottle, off everywhere else (never the cauldron). */
  private syncCaps(animate: boolean): void {
    for (let i = 0; i < this.board.length; i++) {
      const tube = this.board[i] as ColorId[];
      this.bottles[i]?.setCapped(isComplete(tube) && !this.isCauldron(i), animate);
    }
  }

  // ---------------------------------------------------------------- layout
  layout(width: number, height: number, animate = true): void {
    this.viewW = width;
    this.viewH = height;
    const n = this.bottles.length;
    if (n === 0 || width <= 0 || height <= 0) return;

    const rows = n <= 5 ? 1 : 2;
    const perRow = Math.ceil(n / rows);

    const gapX = Math.min(Math.max(width * 0.028, 8), 22);
    const gapY = Math.min(Math.max(height * 0.06, 16), 46);

    // Width-constrained size, then shrink further if the rows will not fit.
    let bodyW = Math.min((width - gapX * (perRow + 1)) / perRow, 104);
    let h = bottleHeight(bodyW);
    const maxH = (height - gapY * (rows + 1)) / rows;
    if (h > maxH) {
      h = maxH;
      bodyW = h / (bottleHeight(1));
    }
    bodyW = Math.max(24, bodyW);
    h = bottleHeight(bodyW);

    if (Math.abs(bodyW - this.bodyW) > 0.5) {
      this.bodyW = bodyW;
      for (const b of this.bottles) b.resize(bodyW);
    }

    const blockH = rows * h + (rows - 1) * gapY;
    const startY = (height - blockH) / 2;

    this.slots = [];
    let placed = 0;
    for (let r = 0; r < rows; r++) {
      const inRow = Math.min(perRow, n - placed);
      const rowW = inRow * bodyW + (inRow - 1) * gapX;
      const startX = (width - rowW) / 2 + bodyW / 2;
      const y = startY + r * (h + gapY);
      for (let c = 0; c < inRow; c++) {
        this.slots.push({ x: startX + c * (bodyW + gapX), y });
      }
      placed += inRow;
    }

    for (let i = 0; i < this.bottles.length; i++) {
      const b = this.bottles[i] as BottleView;
      const slot = this.slots[i] as Slot;
      // The pouring bottle is mid-arc; its transform belongs to the pour.
      if (this.pouring === i) continue;
      const lifted = this.selected === i ? LIFT : 0;
      if (animate && this.motionScale >= 1 && !this.pendingIntro) {
        gsap.to(b, { x: slot.x, y: slot.y - lifted, duration: 0.32, ease: 'power2.out' });
      } else {
        b.x = slot.x;
        b.y = slot.y - lifted;
      }
    }

    if (this.pendingIntro) {
      this.pendingIntro = false;
      this.introAnimation();
    }
  }

  // ----------------------------------------------------------------- input
  handleTap(index: number): void {
    if (this.busy) return;
    this.clearHint();

    const tube = this.board[index];
    if (!tube) return;

    // A padlocked bottle is neither a source nor a target until the lock opens.
    if (this.isLockedTube(index)) {
      this.rejectTap(index);
      this.callbacks.onLockedTap?.(sealsRemaining(this.board, this.rules));
      return;
    }

    if (this.selected === null) {
      // The one-way flask is never a source: nothing pours out of it.
      if (this.isOneWay(index)) {
        this.rejectTap(index);
        this.callbacks.onOneWayTap?.();
        return;
      }
      if (tube.length === 0) {
        this.rejectTap(index);
        return;
      }
      // A full uniform cauldron is NOT locked in - it still has to be emptied.
      if (isComplete(tube) && !this.isCauldron(index)) {
        this.rejectTap(index);
        return;
      }
      this.select(index);
      audio.play('select');
      return;
    }

    if (this.selected === index) {
      this.select(null);
      audio.play('deselect');
      return;
    }

    const from = this.selected;
    if (pourAmount(this.board, from, index, this.rules) > 0) {
      void this.pour(from, index);
      return;
    }

    // Not a legal target. If it could be a source, treat the tap as changing
    // your mind rather than as an error - far less punishing than a buzz.
    if (tube.length > 0 && !this.isOneWay(index) && (!isComplete(tube) || this.isCauldron(index))) {
      this.select(index);
      audio.play('swap');
      return;
    }

    this.rejectTap(index);
  }

  private rejectTap(index: number): void {
    audio.play('invalid');
    this.callbacks.onInvalid?.(index);
    const b = this.bottles[index];
    const slot = this.slots[index];
    if (!b || !slot) return;
    gsap.killTweensOf(b);
    gsap.fromTo(
      b,
      { x: slot.x - 7 },
      {
        x: slot.x,
        duration: 0.42,
        ease: 'elastic.out(1, 0.28)',
        onComplete: () => {
          b.x = slot.x;
        },
      },
    );
  }

  private select(index: number | null): void {
    if (this.selected === index) return;

    if (this.selected !== null) {
      const prev = this.bottles[this.selected];
      const prevSlot = this.slots[this.selected];
      if (prev && prevSlot) {
        prev.setSelected(false);
        gsap.to(prev, { y: prevSlot.y, duration: 0.18, ease: 'power2.out' });
      }
    }

    this.selected = index;

    if (index !== null) {
      const b = this.bottles[index];
      const slot = this.slots[index];
      if (b && slot) {
        b.setSelected(true);
        b.agitate(0.35);
        gsap.to(b, { y: slot.y - LIFT, duration: 0.22, ease: 'back.out(2.4)' });
      }
    }

    this.callbacks.onSelectionChange?.(index);
  }

  clearSelection(): void {
    this.select(null);
  }

  // ------------------------------------------------------------------ pour
  private async pour(from: number, to: number): Promise<void> {
    const src = this.bottles[from];
    const dst = this.bottles[to];
    const srcSlot = this.slots[from];
    const dstSlot = this.slots[to];
    if (!src || !dst || !srcSlot || !dstSlot) return;

    const amount = pourAmount(this.board, from, to, this.rules);
    if (amount === 0) return;

    const srcBefore = [...(this.board[from] as ColorId[])];
    const dstBefore = [...(this.board[to] as ColorId[])];
    const color = srcBefore[srcBefore.length - 1] as ColorId;

    const move = applyPour(this.board, from, to, this.rules);
    if (!move) return;
    this.history.push(move);

    this.busy = true;
    if (this.selected !== null) {
      this.bottles[this.selected]?.setSelected(false);
      this.selected = null;
      this.callbacks.onSelectionChange?.(null);
    }

    // A bottle may still be flying home from the previous pour; retarget rather
    // than snapping, so rapid tapping stays smooth.
    gsap.killTweensOf(src);
    gsap.killTweensOf(dst);
    dst.x = dstSlot.x;
    dst.y = dstSlot.y;
    dst.rotation = 0;

    const dir: 1 | -1 = dstSlot.x >= srcSlot.x ? 1 : -1;
    const angle = dir * POUR_ANGLE;
    const targetX = dstSlot.x - dir * this.bodyW * 0.34;
    // Lift well clear of the row: a bottle tilted this far sweeps a long arc,
    // and pouring *across* a neighbour instead of over it reads as a collision.
    const targetY = dstSlot.y - Math.max(24, this.bodyW * 0.62);

    src.zIndex = 100;

    const m = this.motionScale;
    const drainDur = (0.16 + 0.075 * amount) * m;
    const progress = { p: 0 };
    const gen = this.generation;
    this.pouring = from;

    try {
      // Phase 1 - lift and swing the bottle over the target. Purely visual.
      await gsap
        .timeline()
        .to(src, {
          x: srcSlot.x,
          y: srcSlot.y - LIFT,
          rotation: 0,
          duration: 0.1 * m,
          ease: 'power2.out',
        })
        .to(src, {
          x: targetX,
          y: targetY,
          rotation: angle,
          duration: 0.24 * m,
          ease: 'power2.inOut',
        });
      if (gen !== this.generation) return;

      audio.play('pour', Math.min(1, amount / TUBE_CAPACITY));

      // Phase 2 - drain, driving the fractional fills and the stream.
      await gsap.to(progress, {
        p: 1,
        duration: drainDur,
        ease: 'none',
        onUpdate: () => {
          this.renderPourFrame(
            src, dst, dstSlot, dir, srcBefore, dstBefore, color, amount, progress.p,
          );
        },
      });
      if (gen !== this.generation) return;

      // Phase 3 - landed.
      //
      // This runs in plain control flow rather than a GSAP callback on purpose:
      // a zero-duration `.call()` can be rendered twice by the timeline, which
      // previously double-fired the win and paid the reward out twice.
      this.stream.stop();
      src.setContents(this.board[from] as ColorId[]);
      dst.setContents(this.board[to] as ColorId[]);
      dst.agitate(0.95);
      audio.play('land');
      if (this.particlesEnabled) {
        this.particles.splash(dstSlot.x, dstSlot.y + dst.surfaceLocalY(), color, 9);
      }

      // Input reopens here - the player never waits for the return arc.
      this.pouring = null;
      this.busy = false;
      this.afterMove(move, to);

      // Phase 4 - drift home. Deliberately not awaited.
      gsap.to(src, {
        x: srcSlot.x,
        y: srcSlot.y,
        rotation: 0,
        duration: 0.22 * m,
        ease: 'power2.inOut',
        onComplete: () => {
          src.zIndex = 0;
          src.agitate(0.4);
        },
      });
    } finally {
      // Never leave the board wedged if a tween was killed mid-flight.
      if (gen === this.generation) {
        this.busy = false;
        this.pouring = null;
      }
    }
  }

  private renderPourFrame(
    src: BottleView, dst: BottleView, dstSlot: Slot, dir: 1 | -1,
    srcBefore: readonly ColorId[], dstBefore: readonly ColorId[],
    color: ColorId, amount: number, p: number,
  ): void {
    const moved = amount * p;

    src.setBands(bandsUpTo(srcBefore, srcBefore.length - moved));

    const dstBands = bandsUpTo(dstBefore, dstBefore.length);
    if (moved > 0.0001) {
      const last = dstBands[dstBands.length - 1];
      if (last && last.color === color) last.amount += moved;
      else dstBands.push({ color, amount: moved });
    }
    dst.setBands(dstBands);
    dst.agitate(0.06);

    // Stream runs from the tilted lip down to the rising surface.
    const spoutGlobal = src.spoutWorld(dir);
    const spout = this.layer.toLocal(spoutGlobal, undefined, new Point());
    const landY = dstSlot.y + dst.surfaceLocalY(dstBefore.length + moved);
    const width = Math.max(4, this.bodyW * 0.16);
    this.stream.set(spout.x, spout.y, dstSlot.x, landY, color, width);

    if (this.particlesEnabled) {
      this.splashAccumulator += 1;
      if (this.splashAccumulator >= 3) {
        this.splashAccumulator = 0;
        this.particles.splash(dstSlot.x, landY, color, 2);
      }
    }
  }

  /**
   * Reveal any concealed unit that has surfaced; never re-conceals. A
   * completed bottle reveals everything: the game knows it is one colour
   * (that is what the cork means), so a "?" under the cork would be a lie.
   */
  private settleHidden(): void {
    for (let i = 0; i < this.board.length; i++) {
      const tube = this.board[i];
      const complete = tube !== undefined && isComplete(tube) && !this.isCauldron(i);
      const cap = complete ? 0 : Math.max(0, (tube?.length ?? 0) - 1);
      const current = this.hidden[i] ?? 0;
      if (current > cap) {
        this.hidden[i] = cap;
        const view = this.bottles[i];
        if (view) {
          view.setHidden(cap);
          view.agitate(0.5);
        }
      }
    }
  }

  /** Completion, win and deadlock checks, run once the liquid has landed. */
  private afterMove(move: Move, target: number): void {
    this.settleHidden();
    this.callbacks.onMove?.(move, this.history.length);
    // Sealing a bottle may have opened the padlock.
    this.syncLock(true);

    // The cauldron never "completes" - even full and uniform it must empty out.
    const tube = this.board[target];
    if (tube && isComplete(tube) && !this.isCauldron(target)) {
      const view = this.bottles[target];
      const slot = this.slots[target];
      if (view && slot) {
        view.flashComplete();
        audio.play('tubeComplete');
        // The cork rockets in and seals the bottle; the pop lands ~0.5 s later.
        view.setCapped(true, this.motionScale >= 1, () => audio.play('cork'));
        if (this.particlesEnabled) {
          this.particles.sparkle(slot.x, slot.y + view.totalHeight * 0.55, tube[0] as ColorId, 20);
        }
        if (this.motionScale >= 1) {
          gsap.fromTo(
            view.scale,
            { x: 1, y: 1 },
            { x: 1.09, y: 1.09, duration: 0.16, yoyo: true, repeat: 1, ease: 'power2.out' },
          );
        }
      }
      this.callbacks.onTubeComplete?.(target);
    }

    if (isSolved(this.board, this.rules)) {
      // Awarding the reward twice would be a real economy bug; latch it.
      if (this.resolved) return;
      this.resolved = true;
      this.callbacks.onWin?.();
      return;
    }
    if (isDeadlocked(this.board, this.rules)) {
      this.callbacks.onStuck?.();
      return;
    }
    this.scheduleNoWinCheck();
  }

  /**
   * A player can pour themselves into a position that still has legal moves
   * but provably no winning line. Silently letting them flounder reads as
   * "this level is impossible", so prove it and say so - once per trap.
   *
   * The proof runs in the solver worker (exhausting the budget on a cauldron
   * board is ~0.5 s of CPU on a desktop, far more on a phone), budget-capped,
   * and only on boards up to ten tubes; anything inconclusive stays silent.
   * The result is discarded if the board moved on while it was computing.
   */
  private scheduleNoWinCheck(): void {
    if (this.noWinWarned || this.board.length > 10) return;
    if (this.noWinTimer !== null) window.clearTimeout(this.noWinTimer);

    const gen = this.generation;
    const moves = this.history.length;
    this.noWinTimer = window.setTimeout(() => {
      this.noWinTimer = null;
      if (gen !== this.generation || moves !== this.history.length || this.busy) return;
      void solverClient
        .solvability(cloneBoard(this.board), this.rules, 30_000)
        .then((result) => {
          if (gen !== this.generation || moves !== this.history.length) return;
          if (result === 'unsolvable' && !this.noWinWarned) {
            this.noWinWarned = true;
            this.callbacks.onNoWin?.();
          }
        });
    }, 150);
  }

  // -------------------------------------------------------------- powerups
  undo(): boolean {
    if (!this.canUndo) return false;
    this.clearHint();
    const move = this.history.pop();
    if (!move) return false;

    undoPour(this.board, move);
    this.resolved = false;
    this.noWinWarned = false; // undoing may have escaped the trap; re-arm
    this.settleHidden();
    this.select(null);
    // Unsealing a bottle re-engages the padlock, silently.
    this.syncLock(false);

    for (const idx of [move.from, move.to]) {
      const b = this.bottles[idx];
      if (!b) continue;
      b.setContents(this.board[idx] as ColorId[]);
      // Undoing the sealing pour unseals the bottle.
      b.setCapped(isComplete(this.board[idx] as ColorId[]) && !this.isCauldron(idx), false);
      b.agitate(0.7);
      if (this.motionScale >= 1) {
        const slot = this.slots[idx] as Slot;
        gsap.killTweensOf(b);
        b.rotation = 0;
        gsap.fromTo(
          b,
          { y: slot.y - 12 },
          { y: slot.y, duration: 0.3, ease: 'back.out(2)' },
        );
      }
    }
    audio.play('powerup');
    return true;
  }

  /** Adds an empty tube and reflows the board around it. */
  addTube(colorblind: boolean): boolean {
    if (this.busy) return false;
    this.clearHint();
    this.board.push([]);
    this.hidden.push(0);
    this.noWinWarned = false; // fresh space can reopen a winning line
    const view = this.addBottleView(this.board.length - 1, colorblind);
    view.alpha = 0;
    this.layout(this.viewW, this.viewH, true);
    const slot = this.slots[this.slots.length - 1] as Slot;
    view.x = slot.x;
    gsap.fromTo(
      view,
      { y: slot.y - 60, alpha: 0 },
      { y: slot.y, alpha: 1, duration: 0.45, ease: 'back.out(1.7)' },
    );
    audio.play('powerup');
    return true;
  }

  /**
   * Highlights the first move of a winning line. Resolves false if none
   * exists, or if the board changed while the worker was thinking (the
   * caller then refunds the powerup).
   */
  async showHint(): Promise<boolean> {
    if (this.busy) return false;
    this.clearHint();
    const gen = this.generation;
    const moves = this.history.length;
    const move = await solverClient.hint(cloneBoard(this.board), this.rules);
    if (gen !== this.generation || moves !== this.history.length || this.busy) return false;
    if (!move) return false;

    this.hintPair = { from: move.from, to: move.to };
    for (const idx of [move.from, move.to]) {
      const b = this.bottles[idx];
      if (!b) continue;
      b.setSelected(true);
      gsap.killTweensOf(b, 'alpha');
      gsap.fromTo(
        b,
        { alpha: 1 },
        { alpha: 0.55, duration: 0.45, yoyo: true, repeat: 7, ease: 'sine.inOut' },
      );
    }
    audio.play('powerup');
    this.hintTimer = window.setTimeout(() => this.clearHint(), 3800);
    return true;
  }

  private clearHint(): void {
    if (this.hintTimer !== null) {
      window.clearTimeout(this.hintTimer);
      this.hintTimer = null;
    }
    if (!this.hintPair) return;
    for (const idx of [this.hintPair.from, this.hintPair.to]) {
      const b = this.bottles[idx];
      if (!b) continue;
      gsap.killTweensOf(b, 'alpha');
      b.alpha = 1;
      if (this.selected !== idx) b.setSelected(false);
    }
    this.hintPair = null;
  }

  /** Whether a winning line still exists - drives the "restart?" nudge. */
  hasSolution(): boolean {
    return findHint(this.board, this.rules) !== null || isSolved(this.board, this.rules);
  }

  /** Next move of a winning line without any visual effect (tutorial hand). */
  hintMove(): Move | null {
    return findHint(this.board, this.rules);
  }

  /** Any tube the given tube may legally pour into right now. */
  firstLegalTarget(from: number): number | null {
    for (let i = 0; i < this.board.length; i++) {
      if (i !== from && pourAmount(this.board, from, i, this.rules) > 0) return i;
    }
    return null;
  }

  get selectedIndex(): number | null {
    return this.selected;
  }

  /**
   * A tube's centre in canvas CSS pixels (autoDensity makes global Pixi
   * coordinates equal CSS pixels), for positioning DOM overlays like the
   * tutorial hand.
   */
  tubeScreenPosition(index: number): { x: number; y: number; height: number } | null {
    const slot = this.slots[index];
    const view = this.bottles[index];
    if (!slot || !view) return null;
    const global = this.layer.toGlobal(new Point(slot.x, slot.y));
    return { x: global.x, y: global.y, height: view.totalHeight };
  }

  celebrate(width: number): void {
    if (this.particlesEnabled) this.particles.confetti(width, 110);
  }

  // ----------------------------------------------------------------- ticking
  update(dt: number): void {
    for (const b of this.bottles) b.update(dt);
  }
}

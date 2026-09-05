import './styles/main.css';

import { LEVELS, LEVEL_COUNT, endlessIndex, getLevelSpec, isEndless } from '@/core/levels';
import { CHAPTER_SIZE, chapterFor, isChapterEnd, type Chapter } from '@/core/chapters';
import { getCampaignLevel } from '@/core/campaign';
import { TUBE_CAPACITY } from '@/core/board';
import { solverClient } from '@/services/SolverClient';
import {
  COIN_SHOP, LIVES_MAX, coinsFor, starThresholds, starsFor,
  type CoinShopItem, type PowerupId,
} from '@/core/progression';
import type { GeneratedLevel } from '@/core/types';

import { SAVE_VERSION, SaveService, type InProgressState } from '@/services/SaveService';
import { AuthService } from '@/services/AuthService';
import { Analytics, POSTHOG_KEY, PostHogDriver } from '@/services/Analytics';
import { RemoteConfig } from '@/services/RemoteConfig';
import {
  IAP_CATALOG, Payments, getProduct, type IapProduct, type ProductId,
} from '@/services/Payments';
import {
  SUPPORT_CODE_ERROR_TEXT, applySupportCode, formatSupportId, supportMailto, verifySupportCode,
} from '@/services/Support';

import gsap from 'gsap';
import { audio } from '@/audio/AudioEngine';
import { GameStage } from '@/render/GameStage';
import { BoardView } from '@/render/BoardView';

import { $, ModalHost, ToastHost, el, escapeHtml, haptic, setHapticsEnabled } from '@/ui/dom';
import { Tutorial } from '@/ui/Tutorial';
import { Confetti } from '@/ui/Confetti';

type ScreenId = 'boot' | 'profile' | 'home' | 'map' | 'shop' | 'game';
const SCREENS: readonly ScreenId[] = ['boot', 'profile', 'home', 'map', 'shop', 'game'];

const AVATARS = ['🐱', '🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐧'];

const POWERUP_LABEL: Record<PowerupId, string> = { undo: 'Undo', hint: 'Hint', bottle: 'Bottle' };

const POWERUP_ICON: Record<PowerupId, string> = {
  undo: `<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.6-5.4M5 4v4h4" fill="none"
    stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  hint: `<svg viewBox="0 0 24 24"><path d="M12 3v2m6.4 1.6-1.4 1.4M21 12h-2M5 12H3m3.6-5.4L8 8m4 11
    a5 5 0 0 1-2-9.6A5 5 0 0 1 14 18.4V19a2 2 0 0 1-4 0Z" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  bottle: `<svg viewBox="0 0 24 24"><path d="M14 3h4v2.5l-1 1.2V20a1 1 0 0 1-1 1h-2a1 1 0 0 1-1-1
    V6.7l-1-1.2V3h2Z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/>
    <path d="M5 12h6M8 9v6" fill="none" stroke="currentColor" stroke-width="2.2"
    stroke-linecap="round"/></svg>`,
};

const HEART_ICON = `<svg viewBox="0 0 24 24" class="heart"><use href="#cf-heart"/></svg>`;
const COIN_ICON = `<span class="chip__icon chip__icon--coin"></span>`;

/**
 * A saved attempt is only trusted if it is plausibly this level: same colour
 * units in the same quantities, no tube over capacity, and no more tubes than
 * the level plus the bottle powerup could produce. Anything else (a corrupted
 * or hand-edited save, a level retuned since) starts fresh.
 */
function isValidRestore(level: GeneratedLevel, state: InProgressState, maxExtra: number): boolean {
  const base = level.board.length;
  if (state.board.length < base || state.board.length > base + maxExtra) return false;
  if (state.extraTubes !== state.board.length - base) return false;
  const count = (board: readonly (readonly number[])[]): Map<number, number> => {
    const m = new Map<number, number>();
    for (const tube of board) for (const c of tube) m.set(c, (m.get(c) ?? 0) + 1);
    return m;
  };
  if (state.board.some((tube) => tube.length > TUBE_CAPACITY)) return false;
  const want = count(level.board);
  const have = count(state.board);
  if (want.size !== have.size) return false;
  for (const [c, n] of want) if (have.get(c) !== n) return false;
  return Array.isArray(state.history) && Array.isArray(state.hidden);
}

/** "1h 12m" above an hour, "12:07" below, for lives countdowns. */
function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

class App {
  private readonly remote = new RemoteConfig();
  private readonly analytics = new Analytics();
  private readonly auth = new AuthService();
  private readonly payments = new Payments();
  private save!: SaveService;

  private readonly stage = new GameStage();
  private board!: BoardView;
  private toast!: ToastHost;
  private modal!: ModalHost;
  private tutorial!: Tutorial;
  private confetti!: Confetti;

  private level: GeneratedLevel | null = null;
  private levelId = 1;
  private attempt = 0;
  private attemptStartedAt = 0;
  private nudged = false;

  /** Powerup uses spent this attempt; free allowance comes from the economy. */
  private uses: Record<PowerupId, number> = { undo: 0, hint: 0, bottle: 0 };
  private extraTubes = 0;

  private chosenAvatar = AVATARS[0] as string;
  private current: ScreenId = 'boot';
  /** Where the shop's close button returns to. */
  private shopReturn: ScreenId = 'home';

  /**
   * Back-button support. One extra history entry (the "guard") exists exactly
   * while there is something to go back from - a non-root screen or an open
   * dialog. Back pops it, we act, and re-push it if there is still somewhere
   * to go back from. On the root screen with nothing open, back leaves the
   * app, which is what Android expects.
   */
  private guardPushed = false;
  private ignoreNextPop = false;

  async boot(): Promise<void> {
    this.setSplash(6, 'Mixing colours…');

    await this.remote.refresh();
    this.setSplash(20, 'Mixing colours…');
    this.save = new SaveService(this.remote.current.economy.startingCoins);
    // Off the boot path. Once the store is reachable, settle anything that was
    // paid for but never delivered (see Payments.ts lifecycle notes).
    void this.payments.init().then(() => this.restorePurchases());
    // The support ID doubles as the analytics identity, so a support email
    // can be matched to its funnel without collecting anything personal.
    // Gated by the "Share anonymous usage data" setting.
    if (POSTHOG_KEY) {
      this.analytics.addDriver(
        new PostHogDriver(POSTHOG_KEY, this.save.supportId, () => this.save.snapshot.settings.analytics),
      );
    }
    this.installErrorReporting();

    this.toast = new ToastHost($('#toast-root'));
    this.modal = new ModalHost($('#modal-root'));
    this.modal.onOpenChange = () => this.syncHistoryGuard();
    this.confetti = new Confetti(
      $<HTMLCanvasElement>('#fx-confetti'),
      () =>
        !this.save.snapshot.settings.reducedMotion &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );

    this.applySettings();
    this.setSplash(35, 'Warming the flasks…');

    await this.stage.init($('#board-host'));
    this.setSplash(80, 'Almost ready…');
    this.analytics.track({ type: 'app_start', renderer: this.stage.rendererType });

    this.board = new BoardView(this.stage.stream, this.stage.particles, {
      onMove: (_move, count) => this.onMove(count),
      onWin: () => this.onWin(),
      onStuck: () => this.onStuck(),
      onNoWin: () => this.onNoWin(),
      onSelectionChange: (i) => {
        if (i !== null) this.tutorial.notify('select');
        this.updateTutorialHand();
      },
      onTubeComplete: () => haptic(18),
      onInvalid: () => haptic([12, 40, 12]),
    });
    this.stage.boardLayer.addChild(this.board.layer);
    this.stage.addUpdater((dt) => this.board.update(dt));
    this.stage.setLayoutHandler((w, h) => this.board.layout(w, h));

    this.tutorial = new Tutorial(
      $('#coach'),
      $('#coach-text'),
      $('#coach-skip'),
      () => {
        this.save.update((d) => {
          d.tutorialDone = true;
        });
        this.updateTutorialHand();
        this.analytics.track({ type: 'tutorial_done' });
      },
      (step) => {
        this.updateTutorialHand();
        this.analytics.track({ type: 'tutorial_step', step });
      },
    );

    this.wireGlobal();
    this.wireProfile();
    this.wireHome();
    this.wireShop();
    this.wireGame();

    if (!this.save.persistent) {
      this.toast.show('Private browsing: progress will not be saved', 'warn', 3800);
    }

    this.installDevHooks();

    // Keep the lives chip and the tutorial hand honest without event plumbing.
    window.setInterval(() => {
      if (this.current === 'home') this.renderLivesChip();
      if (this.tutorial?.active) this.updateTutorialHand();
    }, 1000);

    // Offline support for the installed app. Production only: a worker would
    // fight the dev server's module graph and HMR.
    if (!import.meta.env.DEV && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch((err) => {
        console.warn('[sw] registration failed', err);
      });
    }

    await this.finishSplash();
    if (this.save.snapshot.profile) {
      this.renderHome();
      this.show('home');
    } else {
      this.show('profile');
    }
  }

  // ----------------------------------------------------------------- splash
  private readonly splashStartedAt = performance.now();

  /**
   * The bar tracks real boot milestones rather than a fixed timer, so a
   * returning player on a fast device is on the home screen in well under a
   * second instead of watching a scripted 1.6 s animation.
   */
  private setSplash(percent: number, phrase: string): void {
    $('#boot-bar').style.width = `${percent}%`;
    $('#boot-pct').textContent = `${phrase} ${percent}%`;
  }

  /** Hold the splash for a brief minimum so it never flashes, then complete. */
  private async finishSplash(minMs = 450): Promise<void> {
    const remaining = minMs - (performance.now() - this.splashStartedAt);
    if (remaining > 0) await new Promise((r) => window.setTimeout(r, remaining));
    this.setSplash(100, 'Ready');
    await new Promise((r) => window.setTimeout(r, 120));
  }

  // ------------------------------------------------------ error reporting
  /** Messages already reported this session; the same crash loop is sent once. */
  private readonly reportedErrors = new Set<string>();

  /**
   * Uncaught errors and rejections become analytics events, so a WebGL
   * context loss on one GPU or a storage quota error on one browser shows up
   * as a count in the dashboard rather than as a one-star review. Capped and
   * de-duplicated so a tight failure loop cannot flood the pipe.
   */
  private installErrorReporting(): void {
    window.addEventListener('error', (ev) => {
      this.reportError('error', ev.error ?? ev.message);
    });
    window.addEventListener('unhandledrejection', (ev) => {
      this.reportError('unhandledrejection', ev.reason);
    });
  }

  private reportError(source: 'error' | 'unhandledrejection' | 'boot', raw: unknown): void {
    if (this.reportedErrors.size >= 5) return;
    const err = raw instanceof Error ? raw : null;
    const message = String(err?.message ?? raw ?? 'unknown').slice(0, 300);
    if (this.reportedErrors.has(message)) return;
    this.reportedErrors.add(message);
    const event: Parameters<Analytics['track']>[0] = {
      type: 'client_error',
      source,
      message,
      saveVersion: SAVE_VERSION,
      ...(err?.stack ? { stack: err.stack.slice(0, 1500) } : {}),
      ...(this.stage?.app?.renderer ? { renderer: this.stage.rendererType } : {}),
      ...(this.level ? { level: this.levelId } : {}),
    };
    this.analytics.track(event);
  }

  /**
   * Boot could not complete (renderer init, missing DOM, a throwing driver).
   * Replace the endless splash with a plain, honest recovery control.
   */
  showBootFailure(err: unknown): void {
    console.error('[boot] failed', err);
    try {
      this.reportError('boot', err);
    } catch {
      /* analytics may itself be what failed */
    }
    const pct = document.querySelector<HTMLElement>('#boot-pct');
    const bar = document.querySelector<HTMLElement>('.splash');
    if (pct) pct.textContent = 'Something went wrong while loading.';
    if (bar) {
      const retry = el('button', 'btn btn--primary', 'Reload');
      retry.style.marginTop = '14px';
      retry.addEventListener('click', () => window.location.reload());
      bar.appendChild(retry);
    }
  }

  /**
   * Automation surface for the smoke test. Stripped from production builds by
   * the `import.meta.env.DEV` guard, so it cannot be used to cheat a release.
   */
  private installDevHooks(): void {
    if (!import.meta.env.DEV) return;
    const api = {
      tap: (i: number) => this.board.handleTap(i),
      start: (id: number) => this.startLevel(id),
      busy: () => this.board.isBusy,
      /** Nth move of the generated winning line, for deterministic tests. */
      move: (i: number) => this.level?.solution[i] ?? null,
      /** Test economy setup without depending on the live tuning. */
      addCoins: (n: number) => this.save.addCoins(n),
      /** Live GSAP tweens with their targets, for chasing animation-after-destroy bugs. */
      tweens: () =>
        gsap.globalTimeline.getChildren(true, true, false).map((t) => ({
          vars: Object.keys(t.vars).filter(
            (k) => !['duration', 'ease', 'delay', 'onComplete', 'onStart', 'onUpdate', 'yoyo', 'repeat'].includes(k),
          ),
          targets: t.targets().map((x: unknown) => {
            const o = x as { constructor: { name: string }; destroyed?: boolean; index?: number };
            return `${o.constructor.name}${o.index !== undefined ? `#${o.index}` : ''}${o.destroyed ? '(destroyed)' : ''}`;
          }),
          progress: Number(t.progress().toFixed(2)),
        })),
      state: () => ({
        screen: SCREENS.find((n) =>
          $(`#screen-${n}`).classList.contains('screen--active'),
        ),
        moves: this.board.moveCount,
        tubes: this.board.tubeCount,
        coins: this.save.coins,
        lives: this.save.lives.count,
        par: this.level?.par ?? null,
        modalOpen: this.modal.isOpen,
        winCount: this.winCount,
      }),
      /** Plays the generated winning line, waiting for each pour to land. */
      autoplay: async (): Promise<{ moves: number; log: string[] }> => {
        const solution = this.level?.solution ?? [];
        const log: string[] = [];
        this.board.clearSelection();
        for (const move of solution) {
          while (this.board.isBusy) await new Promise((r) => setTimeout(r, 30));
          const before = this.board.moveCount;
          this.board.handleTap(move.from);
          this.board.handleTap(move.to);
          await new Promise((r) => setTimeout(r, 60));
          while (this.board.isBusy) await new Promise((r) => setTimeout(r, 30));
          log.push(`${move.from}->${move.to} x${move.count}: ${before}=>${this.board.moveCount}`);
        }
        return { moves: this.board.moveCount, log };
      },
    };
    (window as unknown as Record<string, unknown>).__cf = api;
  }

  // ------------------------------------------------------------- plumbing
  private show(id: ScreenId): void {
    for (const name of SCREENS) {
      $(`#screen-${name}`).classList.toggle('screen--active', name === id);
    }
    this.current = id;

    const nav = $('#bottomnav');
    nav.hidden = !(id === 'home' || id === 'map');
    for (const tab of Array.from(nav.querySelectorAll<HTMLElement>('.bottomnav__tab'))) {
      tab.classList.toggle('bottomnav__tab--active', tab.dataset.nav === id);
    }

    // The Pixi host has no size while hidden; nudge a reflow once it is shown.
    if (id === 'game') requestAnimationFrame(() => this.stage.app.resize());
    // The canvas only exists on the game screen. Everywhere else the render
    // loop would be drawing starfield and bottles into a display:none host -
    // pure battery cost.
    this.stage.setPaused(id !== 'game' || document.hidden);
    this.updateTutorialHand();
    this.syncHistoryGuard();
  }

  // ---------------------------------------------------------- back button
  /** The screen the back button may exit from: home, or profile setup on first run. */
  private get rootScreen(): ScreenId {
    return this.save.snapshot.profile ? 'home' : 'profile';
  }

  private wireHistory(): void {
    window.history.replaceState({ cf: 'root' }, '');
    window.addEventListener('popstate', (ev) => {
      if (this.ignoreNextPop) {
        this.ignoreNextPop = false;
        return;
      }
      const state = ev.state as { cf?: string } | null;
      if (state?.cf === 'guard') {
        // Forward navigation back onto the guard: nothing to act on.
        this.guardPushed = true;
        return;
      }
      this.guardPushed = false;
      this.onBack();
      this.syncHistoryGuard();
    });
  }

  private syncHistoryGuard(): void {
    if (this.current === 'boot') return;
    const needed = this.current !== this.rootScreen || this.modal.isOpen;
    if (needed && !this.guardPushed) {
      window.history.pushState({ cf: 'guard' }, '');
      this.guardPushed = true;
    } else if (!needed && this.guardPushed) {
      // Back on the root with nothing open: drop the guard so the next back
      // press leaves the app instead of being swallowed.
      this.guardPushed = false;
      this.ignoreNextPop = true;
      window.history.back();
    }
  }

  /** What the back button does, per context. Mirrors the on-screen back affordances. */
  private onBack(): void {
    if (this.modal.isOpen) {
      // Non-dismissable dialogs (win, stuck) hold: the player must choose.
      if (this.modal.isDismissable) this.modal.close();
      return;
    }
    switch (this.current) {
      case 'game':
        this.confirmQuit();
        break;
      case 'shop':
        this.closeShop();
        break;
      case 'map':
        this.goHome();
        break;
      case 'profile':
        // Editing an existing look: back returns home. First-run setup is the root.
        if (this.save.snapshot.profile) this.goHome();
        break;
      case 'home':
      case 'boot':
        break;
    }
  }

  private applySettings(): void {
    const s = this.save.snapshot.settings;
    audio.setSfxEnabled(s.sfx);
    audio.setMusicEnabled(s.music);
    setHapticsEnabled(s.haptics);

    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const reduced = s.reducedMotion || prefersReduced;
    this.board?.setMotionScale(reduced ? 0.35 : 1);
  }

  private wireGlobal(): void {
    // Audio contexts may only start inside a user gesture. Deliberately NOT
    // once-only: iOS can suspend the context without a visibility change
    // (phone call, Siri, headphones unplugged), and the next tap must revive
    // it. unlock() is idempotent and near-free once the context exists.
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    document.addEventListener('visibilitychange', () => {
      const hidden = document.hidden;
      this.stage.setPaused(hidden || this.current !== 'game');
      if (hidden) {
        audio.suspend();
        this.save.flush();
      } else {
        audio.resume();
      }
    });

    window.addEventListener('pagehide', () => this.save.flush());

    this.wireHistory();

    // Desktop convenience: number keys pick a bottle, Escape drops it.
    window.addEventListener('keydown', (ev) => {
      if (!$('#screen-game').classList.contains('screen--active')) return;
      if (this.modal.isOpen) return;
      if (ev.key === 'Escape') {
        this.board.clearSelection();
        return;
      }
      const n = Number(ev.key);
      if (Number.isInteger(n)) {
        const index = n === 0 ? 9 : n - 1;
        if (index < this.board.tubeCount) this.board.handleTap(index);
      }
    });
  }

  // -------------------------------------------------------------- profile
  private wireProfile(): void {
    const grid = $('#avatar-grid');
    AVATARS.forEach((emoji, i) => {
      const node = el('button', 'avatar', emoji);
      node.setAttribute('role', 'radio');
      node.setAttribute('aria-checked', String(i === 0));
      node.setAttribute('aria-label', `Avatar ${i + 1}`);
      node.addEventListener('click', () => {
        this.chosenAvatar = emoji;
        for (const child of Array.from(grid.children)) {
          child.setAttribute('aria-checked', String(child === node));
        }
        audio.play('button');
      });
      grid.appendChild(node);
    });

    const input = $<HTMLInputElement>('#name-input');
    $('#btn-start-profile').addEventListener('click', () => {
      void this.createProfile(input.value);
    });
    $('#btn-guest').addEventListener('click', () => {
      void this.createProfile('');
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void this.createProfile(input.value);
    });
  }

  private async createProfile(name: string): Promise<void> {
    audio.unlock();
    audio.play('button');
    const profile = await this.auth.signIn(name, this.chosenAvatar);
    const consent = $<HTMLInputElement>('#analytics-consent').checked;
    this.save.update((d) => {
      d.profile = profile;
      d.settings.analytics = consent;
    });
    this.analytics.track({ type: 'profile_created', avatar: profile.avatar });
    this.renderHome();
    this.show('home');
  }

  // ----------------------------------------------------------------- home
  private wireHome(): void {
    $('#btn-settings-home').addEventListener('click', () => this.openSettings());
    $('#home-profile').addEventListener('click', () => {
      audio.play('button');
      haptic(8);
      this.showProfileDialog();
    });
    $('#home-coins-chip').addEventListener('click', () => {
      audio.play('button');
      haptic(8);
      this.openShop('home-coins');
    });
    $('#home-lives-chip').addEventListener('click', () => {
      audio.play('button');
      haptic(8);
      this.showLivesDialog();
    });
    $('#btn-play').addEventListener('click', () => {
      audio.play('button');
      haptic(10);
      const resume = this.save.inProgress;
      const next = this.save.highestUnlocked(LEVEL_COUNT);
      const done = this.save.campaignCleared(LEVEL_COUNT);
      if (resume) {
        void this.startLevel(resume.levelId);
      } else if (done >= LEVEL_COUNT) {
        // Campaign finished: Play goes straight on into endless mode.
        void this.startLevel(this.save.nextEndlessId(LEVEL_COUNT));
      } else {
        void this.startLevel(next);
      }
    });

    for (const tab of Array.from(document.querySelectorAll<HTMLElement>('.bottomnav__tab'))) {
      tab.addEventListener('click', () => {
        audio.play('button');
        haptic(8);
        const target = tab.dataset.nav;
        if (target === 'shop') {
          this.openShop('nav');
        } else if (target === 'map') {
          this.renderMap();
          this.show('map');
        } else {
          this.renderHome();
          this.show('home');
        }
      });
    }
  }

  private renderHome(): void {
    const profile = this.save.snapshot.profile;
    $('#home-avatar').textContent = profile?.avatar ?? '🐱';
    $('#home-coins').textContent = String(this.save.coins);
    this.renderLivesChip();

    const done = this.save.campaignCleared(LEVEL_COUNT);
    const endless = this.save.endlessCleared(LEVEL_COUNT);
    const next = this.save.highestUnlocked(LEVEL_COUNT);
    const chapter = done >= LEVEL_COUNT ? null : chapterFor(next);
    const progress = $('#home-progress');
    progress.textContent =
      `★ ${this.save.campaignStars(LEVEL_COUNT)}/${LEVEL_COUNT * 3} · ${done} of ${LEVEL_COUNT} levels cleared` +
      (endless > 0 ? ` · ${endless} endless` : '');
    if (chapter) {
      progress.appendChild(el('small', '', `Chapter ${chapter.index} · ${chapter.name}`));
    }
    const resume = this.save.inProgress;
    $('#btn-play').textContent = resume
      ? `Continue ${this.levelLabel(resume.levelId).toLowerCase()}`
      : done >= LEVEL_COUNT
        ? this.levelLabel(this.save.nextEndlessId(LEVEL_COUNT))
        : `Level ${next}`;
  }

  /** "Level 12" inside the campaign, "Endless #7" beyond it. */
  private levelLabel(id: number): string {
    return isEndless(id) ? `Endless #${endlessIndex(id)}` : `Level ${id}`;
  }

  private renderLivesChip(): void {
    const lives = this.save.lives;
    const count = $('#home-lives');
    const sub = $('#home-lives-sub');
    if (this.save.hasInfiniteLives) {
      count.textContent = '∞';
      sub.textContent = formatCountdown(lives.infiniteUntil - Date.now());
    } else {
      count.textContent = String(lives.count);
      sub.textContent =
        lives.count >= LIVES_MAX ? 'Full' : formatCountdown(lives.nextRegenAt - Date.now());
    }
  }

  // ------------------------------------------------------------------ map
  private renderMap(): void {
    const profile = this.save.snapshot.profile;
    $('#map-avatar').textContent = profile?.avatar ?? '🐱';
    $('#map-name').textContent = profile?.name ?? 'Player';
    $('#map-coins').textContent = String(this.save.coins);
    $('#map-stars').textContent = `${this.save.campaignStars(LEVEL_COUNT)}/${LEVEL_COUNT * 3}`;

    const unlocked = this.save.highestUnlocked(LEVEL_COUNT);
    const grid = $('#level-grid');
    grid.replaceChildren();

    for (const spec of LEVELS) {
      const record = this.save.levelRecord(spec.id);
      const locked = spec.id > unlocked;
      const isNext = spec.id === unlocked && !record;

      // A chapter header opens each block of twenty.
      if ((spec.id - 1) % CHAPTER_SIZE === 0) {
        const chapter = chapterFor(spec.id);
        if (chapter) grid.appendChild(this.buildChapterHeader(chapter, unlocked));
      }

      const node = el('button', 'node');
      if (locked) node.classList.add('node--locked');
      if (record) node.classList.add('node--done');
      if (isNext) node.classList.add('node--next');
      node.disabled = locked;
      node.setAttribute(
        'aria-label',
        locked
          ? `Level ${spec.id}, locked`
          : `Level ${spec.id}, ${spec.name}, ${record?.stars ?? 0} of 3 stars`,
      );

      node.appendChild(el('span', 'node__num', locked ? '🔒' : String(spec.id)));
      node.appendChild(el('span', 'node__name', spec.name));

      const stars = el('span', 'node__stars');
      for (let s = 1; s <= 3; s++) {
        const star = el('i', (record?.stars ?? 0) >= s ? 'on' : '', '★');
        stars.appendChild(star);
      }
      node.appendChild(stars);

      if (!locked) {
        node.addEventListener('click', () => {
          audio.play('button');
          void this.startLevel(spec.id);
        });
      }
      grid.appendChild(node);
    }

    // Once the campaign is done, the map ends in the door to endless mode.
    const done = this.save.campaignCleared(LEVEL_COUNT);
    if (done >= LEVEL_COUNT) {
      const nextEndless = this.save.nextEndlessId(LEVEL_COUNT);
      const node = el('button', 'node node--endless node--next');
      node.setAttribute('aria-label', `Endless mode, next is ${this.levelLabel(nextEndless)}`);
      node.appendChild(el('span', 'node__num', '∞'));
      node.appendChild(el('span', 'node__name', this.levelLabel(nextEndless)));
      node.appendChild(el('span', 'node__stars', ''));
      node.addEventListener('click', () => {
        audio.play('button');
        void this.startLevel(nextEndless);
      });
      grid.appendChild(node);
    }

    // 500 nodes is a long scroll: land the player on their current level.
    requestAnimationFrame(() => {
      grid.querySelector('.node--next, .node:not(.node--locked):last-of-type')
        ?.scrollIntoView({ block: 'center' });
    });

    const endless = this.save.endlessCleared(LEVEL_COUNT);
    $('#map-footnote').textContent =
      done >= LEVEL_COUNT
        ? `All ${LEVEL_COUNT} levels cleared · ${endless} endless ${endless === 1 ? 'level' : 'levels'} cleared`
        : `${done} of ${LEVEL_COUNT} levels cleared`;

    $('#btn-settings-map').onclick = () => this.openSettings();
  }

  /** Chapter number, name, stars earned of the chapter's 60, and a progress bar. */
  private buildChapterHeader(chapter: Chapter, unlocked: number): HTMLElement {
    let stars = 0;
    let cleared = 0;
    for (let id = chapter.first; id <= chapter.last; id++) {
      const r = this.save.levelRecord(id);
      if (r) {
        cleared += 1;
        stars += r.stars;
      }
    }
    const size = chapter.last - chapter.first + 1;
    const locked = chapter.first > unlocked;

    const head = el('div', 'chapter');
    head.style.setProperty('--chapter-accent', chapter.accent);
    if (locked) head.classList.add('chapter--locked');
    if (cleared === size) head.classList.add('chapter--done');
    head.setAttribute(
      'aria-label',
      `Chapter ${chapter.index}, ${chapter.name}, ${locked ? 'locked' : `${stars} of ${size * 3} stars`}`,
    );

    const row = el('div', 'chapter__head');
    row.appendChild(el('span', 'chapter__num', `Chapter ${chapter.index}`));
    row.appendChild(el('h3', 'chapter__name', chapter.name));
    row.appendChild(el('span', 'chapter__stars', locked ? '🔒' : `★ ${stars}/${size * 3}`));
    head.appendChild(row);

    const bar = el('div', 'chapter__bar');
    const fill = el('i');
    fill.style.width = `${Math.round((cleared / size) * 100)}%`;
    bar.appendChild(fill);
    head.appendChild(bar);
    return head;
  }

  // ----------------------------------------------------------------- shop
  private wireShop(): void {
    $('#btn-shop-close').addEventListener('click', () => {
      audio.play('button');
      this.closeShop();
    });
  }

  private openShop(source: string): void {
    this.analytics.track({ type: 'shop_open', source });
    if (this.current !== 'shop') this.shopReturn = this.current;
    this.renderShop();
    this.show('shop');
  }

  private closeShop(): void {
    let target = this.shopReturn === 'shop' ? 'home' : this.shopReturn;
    // The shop can be reached from the lives dialog after a win; there is no
    // board to return to in that case, only a finished one. Go home instead.
    if (target === 'game' && this.board.isResolved) target = 'home';
    if (target === 'home') this.renderHome();
    if (target === 'map') this.renderMap();
    if (target === 'game') this.updateHud();
    this.show(target);
    // Coming back to a board with no legal moves: put the rescue dialog back up.
    if (target === 'game' && this.board.isDead && !this.modal.isOpen) {
      this.showStuckDialog();
    }
  }

  private renderShop(): void {
    $('#shop-coins').textContent = String(this.save.coins);

    const iap = $('#shop-iap');
    iap.replaceChildren();

    if (this.payments.available) {
      for (const product of IAP_CATALOG.filter((p) => p.id.startsWith('cf.bundle'))) {
        iap.appendChild(this.buildBundleCard(product));
      }
      const packs = el('div', 'packs');
      for (const product of IAP_CATALOG.filter((p) => p.id.startsWith('cf.coins'))) {
        packs.appendChild(this.buildCoinPack(product));
      }
      iap.appendChild(packs);
      if (this.payments.driverName === 'simulated') {
        iap.appendChild(
          el('p', 'shop__legal', 'Development build - purchases are simulated, nothing is charged.'),
        );
      }
    } else {
      iap.appendChild(
        el(
          'div',
          'shop__unavailable',
          'Real-money purchases are only available in the ChromaFlask app from Google Play or the App Store. Everything below can be bought with coins you earn by playing.',
        ),
      );
    }

    const list = $('#shop-coin-items');
    list.replaceChildren();
    for (const item of COIN_SHOP) list.appendChild(this.buildCoinItem(item));
  }

  private buildBundleCard(product: IapProduct): HTMLElement {
    const card = el('div', 'bundle');
    if (product.badge === 'Best value') card.classList.add('bundle--best');
    if (product.badge) card.appendChild(el('span', 'bundle__badge', product.badge));

    const coins = el('div', 'bundle__coins');
    coins.innerHTML = `${COIN_ICON} ${product.coins.toLocaleString()}`;
    card.appendChild(coins);

    const items = el('div', 'bundle__items');
    if (product.infiniteLivesHours) {
      const chip = el('span', 'bundle__item');
      chip.innerHTML = `<svg viewBox="0 0 24 24"><use href="#cf-heart"/></svg> ∞ hearts ${product.infiniteLivesHours}h`;
      items.appendChild(chip);
    }
    for (const [pid, n] of Object.entries(product.powerups ?? {})) {
      items.appendChild(
        el('span', 'bundle__item', `${POWERUP_LABEL[pid as PowerupId]} ×${n}`),
      );
    }
    card.appendChild(items);

    const foot = el('div', 'bundle__foot');
    foot.appendChild(el('span', 'bundle__name', product.title));
    const buy = el('button', 'pricebtn', this.payments.displayPrice(product.id));
    buy.addEventListener('click', () => void this.purchaseIap(product, buy));
    foot.appendChild(buy);
    card.appendChild(foot);
    return card;
  }

  private buildCoinPack(product: IapProduct): HTMLElement {
    const pack = el('div', 'pack');
    const top = el('div', 'pack__top');
    top.appendChild(el('span', 'pack__coin'));
    top.appendChild(el('span', 'pack__amount', product.coins.toLocaleString()));
    pack.appendChild(top);
    const bottom = el('div', 'pack__bottom');
    const buy = el('button', 'pricebtn', this.payments.displayPrice(product.id));
    buy.addEventListener('click', () => void this.purchaseIap(product, buy));
    bottom.appendChild(buy);
    pack.appendChild(bottom);
    return pack;
  }

  private buildCoinItem(item: CoinShopItem): HTMLElement {
    const row = el('div', 'shopitem');

    const icon = el('span', 'shopitem__icon');
    icon.innerHTML =
      item.grant.kind === 'refillLives' ? HEART_ICON : POWERUP_ICON[item.grant.powerup];
    row.appendChild(icon);

    const body = el('div', 'shopitem__body');
    body.appendChild(el('div', 'shopitem__title', item.title));
    body.appendChild(el('div', 'shopitem__desc', item.desc));
    row.appendChild(body);

    const buy = el('button', 'pricebtn');
    buy.innerHTML = `${COIN_ICON} ${item.price}`;
    const heartsFull =
      item.grant.kind === 'refillLives' &&
      (this.save.hasInfiniteLives || this.save.lives.count >= LIVES_MAX);
    buy.disabled = heartsFull || this.save.coins < item.price;
    buy.addEventListener('click', () => this.buyCoinItem(item));
    row.appendChild(buy);
    return row;
  }

  /**
   * The dev build's fake store must never grant anything "automatically":
   * mirror the real platform sheet with an explicit confirm step.
   */
  private confirmSimulatedPurchase(product: IapProduct): Promise<boolean> {
    return new Promise((resolve) => {
      let decided = false;
      const decide = (value: boolean) => {
        if (decided) return;
        decided = true;
        resolve(value);
      };
      this.modal.open({
        title: 'Test purchase',
        bodyHtml:
          `This development build <b>simulates</b> the app store - in the released app, ` +
          `Google Play or the App Store shows its own payment sheet here.<br><br>` +
          `Buy <b>${product.title}</b> for <b>${this.payments.displayPrice(product.id)}</b>?`,
        inlineButtons: true,
        buttons: [
          { label: 'Cancel', kind: 'ghost', onClick: () => decide(false) },
          { label: 'Buy', kind: 'success', onClick: () => decide(true) },
        ],
        onClose: () => decide(false),
      });
    });
  }

  private async purchaseIap(product: IapProduct, button: HTMLButtonElement): Promise<void> {
    if (this.payments.driverName === 'simulated') {
      const proceed = await this.confirmSimulatedPurchase(product);
      if (!proceed) return;
    }
    button.disabled = true;
    this.analytics.track({ type: 'iap_start', product: product.id });
    const result = await this.payments.purchase(product.id);
    button.disabled = false;
    this.analytics.track({
      type: 'iap_result',
      product: product.id,
      ok: result.ok,
      ...(result.ok ? {} : { reason: result.reason }),
    });

    if (!result.ok) {
      if (result.reason === 'failed') {
        this.toast.show('Purchase did not go through - you were not charged', 'error', 3200);
      } else if (result.reason === 'unavailable') {
        this.toast.show('Purchases are not available here', 'warn');
      }
      return; // cancelled: stay quiet, the player changed their mind
    }

    await this.settlePurchase(result.productId, result.token);

    audio.play('unlock');
    haptic([15, 40, 25]);
    this.confetti.burst(1);
    this.toast.show(`${product.title} added - enjoy!`, 'info', 2600);
    this.renderShop();
  }

  /** Put a product's goods into the save. Pure grant; no store interaction. */
  private grantProduct(product: IapProduct): void {
    this.save.addCoins(product.coins);
    for (const [pid, n] of Object.entries(product.powerups ?? {})) {
      this.save.addInventory(pid as PowerupId, n ?? 0);
    }
    if (product.infiniteLivesHours) this.save.addInfiniteLives(product.infiniteLivesHours);
  }

  /**
   * Deliver a paid purchase exactly once, then release it at the store.
   *
   * Order matters: grant -> record the token (flushed to disk) -> consume. If
   * anything dies after the record, the next boot's restore sees the token as
   * already granted and only consumes. If it dies before, restore grants.
   * Returns true when goods were granted by this call.
   */
  private async settlePurchase(productId: ProductId, token: string | null): Promise<boolean> {
    const product = getProduct(productId);
    const alreadyGranted = token !== null && this.save.hasGrantedPurchase(token);
    if (!alreadyGranted) {
      this.grantProduct(product);
      if (token !== null) this.save.markPurchaseGranted(token);
      else this.save.flush();
    }
    if (token !== null) {
      // A failed consume is not a lost sale: the token stays pending at the
      // store and is retried on the next boot.
      await this.payments.consume(token);
    }
    return !alreadyGranted;
  }

  /** Boot-time sweep of purchases the store still holds as unconsumed. */
  private async restorePurchases(): Promise<void> {
    let pending;
    try {
      pending = await this.payments.listPending();
    } catch {
      return;
    }
    let restored = 0;
    for (const p of pending) {
      if (await this.settlePurchase(p.productId, p.token)) restored += 1;
    }
    if (restored > 0) {
      this.analytics.track({ type: 'iap_restored', count: restored });
      this.toast.show(
        restored === 1 ? 'Your purchase has been restored' : `${restored} purchases restored`,
        'info', 3200,
      );
      if (this.current === 'shop') this.renderShop();
      else if (this.current === 'home') this.renderHome();
      else if (this.current === 'game') this.updateHud();
    }
  }

  private buyCoinItem(item: CoinShopItem): void {
    if (!this.save.trySpend(item.price)) {
      audio.play('invalid');
      this.toast.show(`Not enough coins - ${item.price} needed`, 'warn');
      return;
    }
    if (item.grant.kind === 'refillLives') {
      this.save.refillLives();
    } else {
      this.save.addInventory(item.grant.powerup, item.grant.count);
    }
    this.analytics.track({ type: 'shop_coin_spend', item: item.id, price: item.price });
    audio.play('powerup');
    haptic(14);
    this.toast.show(`${item.title} added`, 'info', 1800);
    this.renderShop();
  }

  // ----------------------------------------------------------------- game
  private wireGame(): void {
    $('#btn-back').addEventListener('click', () => this.confirmQuit());
    $('#btn-restart').addEventListener('click', () => this.confirmRestart());
    $('#btn-settings-game').addEventListener('click', () => this.openSettings());
    $('#game-coins-chip').addEventListener('click', () => {
      audio.play('button');
      haptic(8);
      this.openShop('game-coins');
    });

    $('#btn-undo').addEventListener('click', () => void this.usePowerup('undo'));
    $('#btn-hint').addEventListener('click', () => void this.usePowerup('hint'));
    $('#btn-bottle').addEventListener('click', () => void this.usePowerup('bottle'));
  }

  /** Guards against a double tap while an endless level is being generated. */
  private starting = false;

  private async startLevel(id: number): Promise<void> {
    if (this.starting) return;
    // An attempt saved mid-level for this id is resumed; starting any other
    // level abandons it.
    const saved = this.save.inProgress;
    const resume = saved && saved.levelId === id ? saved : null;

    // Hearts gate every *fresh* level after the tutorial; a level already in
    // progress can always be continued - the heart was spent starting it.
    if (!resume && !this.save.canPlay && this.save.snapshot.tutorialDone) {
      this.analytics.track({ type: 'out_of_lives', level: id });
      this.showLivesDialog(id);
      return;
    }
    // Only now is the fresh start certain; a blocked start must not discard
    // an attempt saved on another level.
    if (!resume) this.save.setInProgress(null);

    this.levelId = id;
    this.attempt += 1;
    this.nudged = false;

    try {
      if (isEndless(id)) {
        // Generated on demand in the worker; usually well under a second, but a
        // cauldron deal on a slow phone can take a few, so say so.
        this.starting = true;
        const brewing = window.setTimeout(
          () => this.toast.show('Brewing a fresh potion…', 'info', 2600), 300,
        );
        try {
          this.level = await solverClient.generate(getLevelSpec(id));
        } finally {
          window.clearTimeout(brewing);
          this.starting = false;
        }
      } else {
        // Precomputed at build time; the generator is only a fallback.
        this.level = getCampaignLevel(id);
      }
    } catch (err) {
      console.error(err);
      this.toast.show('Could not build that level. Please try another.', 'error');
      return;
    }

    const maxExtra = this.remote.current.economy.maxExtraTubes;
    const restore = resume && isValidRestore(this.level, resume, maxExtra) ? resume : null;
    if (resume && !restore) this.save.setInProgress(null);

    this.attemptStartedAt = Date.now() - (restore?.elapsedMs ?? 0);
    this.uses = restore ? { ...restore.uses } : { undo: 0, hint: 0, bottle: 0 };
    this.extraTubes = restore?.extraTubes ?? 0;

    this.applySettings();
    this.board.mount(
      this.level,
      this.save.snapshot.settings.colorblind,
      restore ? { board: restore.board, history: restore.history, hidden: restore.hidden } : undefined,
    );
    this.updateHud();
    this.show('game');

    if (restore) {
      this.toast.show(`Continuing ${this.levelLabel(id).toLowerCase()}`, 'info', 1600);
    } else {
      this.save.bumpStat('plays');
      this.analytics.track({ type: 'level_start', level: id, attempt: this.attempt });
    }

    if (isEndless(id) && !this.save.snapshot.endlessSeen) {
      this.save.update((d) => {
        d.endlessSeen = true;
      });
      this.toast.show('Endless mode: fresh potions forever, and they keep getting harder', 'info', 4200);
    }

    if (id === 1 && !this.save.snapshot.tutorialDone) {
      window.setTimeout(() => this.tutorial.start(), 700);
    }

    // One-time introductions of the twist mechanics, one idea at a time.
    if (this.level.spec.cauldron && !this.save.snapshot.cauldronSeen) {
      this.save.update((d) => {
        d.cauldronSeen = true;
      });
      this.toast.show('The Cauldron takes any colour - but it must be empty to win!', 'info', 4200);
    } else if (this.level.spec.murky && !this.save.snapshot.murkySeen) {
      this.save.update((d) => {
        d.murkySeen = true;
      });
      this.toast.show('Murky potion! Colours reveal as they reach the top', 'info', 3800);
    }
  }

  /**
   * "More Lives" dialog: hearts state with a live countdown, a coin refill,
   * and a route to the shop's unlimited-hearts bundles. Doubles as the
   * out-of-hearts gate: pass `retryLevel` to start that level after a refill.
   */
  private showLivesDialog(retryLevel: number | null = null): void {
    const refill = COIN_SHOP.find((i) => i.grant.kind === 'refillLives');
    if (!refill) return;

    const content = el('div', 'livesdlg');

    const card = el('div', 'livesdlg__card');
    const heart = el('span', 'livesdlg__heart');
    heart.innerHTML = `<svg viewBox="0 0 24 24"><use href="#cf-heart"/></svg><b></b>`;
    const heartCount = heart.querySelector('b') as HTMLElement;
    card.appendChild(heart);
    const label = el('div', 'livesdlg__label');
    card.appendChild(label);
    const timerRow = el('div', 'livesdlg__timer');
    timerRow.innerHTML = `<span aria-hidden="true">⏱</span><b></b>`;
    const timeText = timerRow.querySelector('b') as HTMLElement;
    card.appendChild(timerRow);
    content.appendChild(card);

    const refillBtn = el('button', 'btn btn--success btn--wide livesdlg__btn');
    refillBtn.innerHTML = `Refill ${COIN_ICON} ${refill.price}`;
    content.appendChild(refillBtn);

    const shopBtn = el(
      'button', 'btn btn--primary btn--wide livesdlg__btn', 'Heart bundles in the Shop',
    );
    content.appendChild(shopBtn);

    const refresh = () => {
      const lives = this.save.lives;
      const infinite = this.save.hasInfiniteLives;
      const full = infinite || lives.count >= LIVES_MAX;
      heartCount.textContent = infinite ? '∞' : String(lives.count);
      if (infinite) {
        label.textContent = 'Unlimited hearts active!';
        timerRow.hidden = false;
        timeText.textContent = formatCountdown(lives.infiniteUntil - Date.now());
      } else if (full) {
        label.textContent = 'Your hearts are full!';
        timerRow.hidden = true;
      } else {
        label.textContent = 'Time to next life';
        timerRow.hidden = false;
        timeText.textContent = formatCountdown(lives.nextRegenAt - Date.now());
      }
      refillBtn.disabled = full || this.save.coins < refill.price;
    };

    // Set when the dialog hands off somewhere (retry or shop) so the close
    // handler knows the player did not simply dismiss it.
    let handedOff = false;

    refillBtn.addEventListener('click', () => {
      this.buyCoinItem(refill);
      refresh();
      if (retryLevel !== null && this.save.canPlay) {
        handedOff = true;
        this.modal.close();
        this.startLevel(retryLevel);
      }
    });
    shopBtn.addEventListener('click', () => {
      audio.play('button');
      handedOff = true;
      this.modal.close();
      this.openShop('lives');
    });

    // Tick the countdown while the dialog is up; onClose always cleans up.
    const timer = window.setInterval(refresh, 500);
    refresh();

    this.modal.open({
      title: 'More Lives',
      content,
      closeButton: true,
      onClose: () => {
        window.clearInterval(timer);
        // Out-of-hearts gate dismissed while standing on a finished board
        // (win -> "Next level" -> no hearts): there is nothing left to play
        // here, so go home rather than stranding the player on a solved level.
        if (!handedOff && this.current === 'game' && this.board.isResolved) {
          this.goHome();
        }
      },
    });
  }

  /**
   * Persist the current attempt so it survives the app being killed. Called
   * after every move and powerup. A board with nothing done on it stores
   * nothing; the tutorial level is never resumed mid-way (the coaching would
   * restart out of step).
   */
  private persistProgress(): void {
    if (!this.level || this.tutorial.active || this.board.isResolved) return;
    if (this.board.moveCount === 0 && this.extraTubes === 0) {
      this.save.setInProgress(null);
      return;
    }
    this.save.setInProgress({
      levelId: this.levelId,
      board: this.board.snapshot(),
      history: this.board.historySnapshot(),
      hidden: this.board.hiddenSnapshot(),
      extraTubes: this.extraTubes,
      uses: { ...this.uses },
      elapsedMs: Date.now() - this.attemptStartedAt,
    });
  }

  private restartLevel(): void {
    if (!this.level) return;
    this.save.setInProgress(null);
    this.uses = { undo: 0, hint: 0, bottle: 0 };
    this.extraTubes = 0;
    this.nudged = false;
    this.attemptStartedAt = Date.now();
    this.board.mount(this.level, this.save.snapshot.settings.colorblind);
    this.updateHud();
  }

  private onMove(count: number): void {
    haptic(10);
    this.save.bumpStat('pours');
    this.tutorial.notify('pour');
    this.updateTutorialHand();
    this.updateHud();
    this.persistProgress();

    // One gentle nudge if the player drifts well past par.
    const par = this.level?.par ?? 0;
    if (!this.nudged && count > par + this.remote.current.strugglingThreshold) {
      this.nudged = true;
      this.toast.show('Stuck? Try a hint.', 'info', 2600);
    }
    void count;
  }

  private updateHud(): void {
    $('#game-coins').textContent = String(this.save.coins);
    $('#game-level-label').textContent = this.levelLabel(this.levelId);
    const moves = this.board.moveCount;
    // "Ideal" is the proven minimum pours for this level (par, in golf terms -
    // but most players do not know the golf term).
    $('#game-move-label').textContent =
      `${moves} ${moves === 1 ? 'move' : 'moves'} · ideal ${this.level?.par ?? '-'}`;

    for (const id of ['undo', 'hint', 'bottle'] as PowerupId[]) {
      const stock = this.remainingUses(id) + this.save.inventoryCount(id);
      const badge = $(`#badge-${id}`);
      const button = $<HTMLButtonElement>(`#btn-${id}`);

      // Out of stock: the badge turns into a green "+" and the tap opens the shop.
      if (stock > 0) {
        badge.textContent = String(stock);
        badge.classList.remove('power__badge--buy');
      } else {
        badge.textContent = '+';
        badge.classList.add('power__badge--buy');
      }

      let disabled = false;
      if (id === 'undo') disabled = !this.board.canUndo;
      if (id === 'bottle') disabled = this.extraTubes >= this.remote.current.economy.maxExtraTubes;
      button.disabled = disabled;
    }
  }

  private remainingUses(id: PowerupId): number {
    return Math.max(0, this.remote.current.economy.freeUses[id] - this.uses[id]);
  }

  private async usePowerup(id: PowerupId): Promise<void> {
    if (this.board.isBusy) return;

    // Spend order: free allowance, then shop-bought stock. Out of both means
    // the shop opens - powerups are never silently charged to coins.
    let source: 'free' | 'owned';
    if (this.remainingUses(id) > 0) {
      source = 'free';
    } else if (this.save.tryUseInventory(id)) {
      source = 'owned';
    } else {
      audio.play('invalid');
      this.toast.show(`Out of ${POWERUP_LABEL[id]} - grab more in the shop`, 'warn', 2400);
      this.openShop('powerup');
      return;
    }

    let applied = false;
    switch (id) {
      case 'undo':
        applied = this.board.undo();
        if (!applied) this.toast.show('Nothing to undo', 'info', 1400);
        break;
      case 'hint':
        // Solved in the worker; the board may move on meanwhile, in which
        // case showHint resolves false and the use is refunded below.
        applied = await this.board.showHint();
        if (applied) this.save.bumpStat('hintsUsed');
        else this.toast.show('No winning move from here - try undo or restart', 'warn', 3000);
        break;
      case 'bottle':
        applied = this.board.addTube(this.save.snapshot.settings.colorblind);
        if (applied) this.extraTubes += 1;
        break;
    }

    if (!applied) {
      // Never charge for a powerup that did nothing.
      if (source === 'owned') this.save.addInventory(id, 1);
      this.updateHud();
      return;
    }

    if (source === 'free') this.uses[id] += 1;
    this.persistProgress();
    haptic(14);
    this.analytics.track({
      type: 'powerup_used',
      level: this.levelId,
      powerup: id,
      paid: source === 'owned',
    });
    this.updateHud();
  }

  // -------------------------------------------------------- tutorial hand
  /**
   * Points at the bottle the current tutorial step wants tapped. Driven by
   * board events plus a slow interval, so it survives resizes and mistaps.
   */
  private updateTutorialHand(): void {
    const hand = $('#tutorial-hand');
    const kind = this.tutorial?.pointer ?? null;
    if (!kind || this.current !== 'game') {
      hand.hidden = true;
      return;
    }

    // Pointing at "to" only makes sense while a bottle is held; if the player
    // dropped it mid-step, guide them back to picking one up.
    const selected = this.board.selectedIndex;
    const index =
      kind === 'to' && selected !== null
        ? this.board.firstLegalTarget(selected)
        : (this.board.hintMove()?.from ?? null);

    const pos = index !== null ? this.board.tubeScreenPosition(index) : null;
    if (!pos) {
      hand.hidden = true;
      return;
    }

    const host = $('#board-host').getBoundingClientRect();
    hand.style.left = `${host.left + pos.x}px`;
    hand.style.top = `${host.top + pos.y + pos.height * 0.55}px`;
    hand.hidden = false;
  }

  // ------------------------------------------------------------------ win
  private winCount = 0;

  private onWin(): void {
    const level = this.level;
    if (!level) return;
    this.winCount += 1;
    this.save.setInProgress(null);

    const moves = this.board.moveCount;
    const seconds = Math.round((Date.now() - this.attemptStartedAt) / 1000);
    const stars = starsFor(moves, level.par);
    const before = this.save.levelRecord(this.levelId);
    // Support unlocks store a sentinel; treat those as "no real best yet".
    const prevBest = before && before.bestMoves < 100_000 ? before.bestMoves : null;
    const { prevStars, isFirstClear } = this.save.recordClear(this.levelId, stars, moves);
    // Replays only pay for newly earned stars - see coinsFor.
    let reward = coinsFor(stars, prevStars, this.remote.current.economy);
    // First clear of a chapter's last level: the chapter is complete.
    const chapterDone = isFirstClear && isChapterEnd(this.levelId) ? chapterFor(this.levelId) : null;
    const chapterBonus = chapterDone ? this.remote.current.economy.chapterBonus : 0;
    reward += chapterBonus;
    this.save.addCoins(reward);
    if (chapterDone) this.analytics.track({ type: 'chapter_complete', chapter: chapterDone.index });
    this.save.bumpStat('wins');
    if (stars === 3) this.save.bumpStat('perfects');
    this.save.recordWinForStreak();
    const streak = this.save.snapshot.stats.streak;

    this.tutorial.finish();
    audio.duckMusic(2.2);
    audio.play('win');
    haptic([20, 60, 30, 60, 40]);
    this.board.celebrate(this.stage.width);

    this.analytics.track({
      type: 'level_complete',
      level: this.levelId,
      moves,
      par: level.par,
      stars,
      seconds,
    });

    // Finishing the last campaign level is the finale; the door to endless opens.
    const isLast = this.levelId === LEVEL_COUNT;
    const chapter = chapterFor(this.levelId);
    const eyebrow = chapter
      ? `Chapter ${chapter.index} · ${chapter.name}`
      : `Endless · ${level.spec.name}`;
    window.setTimeout(
      () => this.showWinModal({
        stars, moves, seconds, reward, isLast, prevStars, prevBest, streak,
        par: level.par, eyebrow, chapterDone, chapterBonus,
      }),
      620,
    );
  }

  /**
   * The win screen answers four questions in order: how well did I do
   * (stars, with the middle one raised), what did I earn and why (coins
   * counting up, with the breakdown), what would make it better (the exact
   * move count for the next star, or "Perfect!"), and what's next (one big
   * green button; replay and home as quiet options).
   */
  private showWinModal(w: {
    stars: number; moves: number; seconds: number; reward: number; isLast: boolean;
    prevStars: number | null; prevBest: number | null; streak: number;
    par: number; eyebrow: string; chapterDone: Chapter | null; chapterBonus: number;
  }): void {
    const eco = this.remote.current.economy;
    const reduced =
      this.save.snapshot.settings.reducedMotion ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const content = el('div', 'win');

    content.appendChild(el('div', 'win__name', w.eyebrow));

    // Chapter complete: a gold ribbon, and a peek at where the story goes next.
    if (w.chapterDone) {
      const ribbon = el('div', 'win__chapter', `Chapter ${w.chapterDone.index} complete!`);
      const next = chapterFor(w.chapterDone.last + 1);
      ribbon.appendChild(
        el('small', '', next ? `Next: ${next.name}` : 'The Grand Elixir is yours'),
      );
      content.appendChild(ribbon);
    }

    // Stars in an arc; unearned ones stay as dim outlines so 2/3 reads at a glance.
    const starRow = el('div', 'stars stars--arc');
    const starEls: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
      const s = el('i', '', '★');
      starRow.appendChild(s);
      starEls.push(s);
    }
    content.appendChild(starRow);

    // Verdict: celebrate a perfect, otherwise say exactly what the next star needs.
    if (w.stars === 3) {
      content.appendChild(el('div', 'perfect', 'Perfect!'));
    } else {
      const t = starThresholds(w.par);
      const need = w.stars === 2 ? t.three : t.two;
      content.appendChild(
        el('div', 'win__verdict', `Finish in ${need} moves or fewer for ${w.stars + 1} stars`),
      );
    }

    // Reward, with how it was earned. Replays that add no stars say so plainly.
    if (w.reward > 0) {
      const card = el('div', 'win__reward');
      const big = el('div', 'win__coins');
      big.innerHTML = `<span class="chip__icon chip__icon--coin"></span><b>+0</b>`;
      card.appendChild(big);
      const parts: string[] = [];
      if (w.prevStars === null) {
        parts.push(`Cleared +${eco.baseReward}`);
        parts.push(`${w.stars} star${w.stars === 1 ? '' : 's'} +${w.stars * eco.rewardPerStar}`);
        if (eco.firstClearBonus > 0) parts.push(`First clear +${eco.firstClearBonus}`);
      } else {
        const gained = Math.max(0, w.stars - w.prevStars);
        parts.push(`${gained} new star${gained === 1 ? '' : 's'} +${w.reward - w.chapterBonus}`);
      }
      if (w.chapterBonus > 0) parts.push(`Chapter complete +${w.chapterBonus}`);
      card.appendChild(el('div', 'win__breakdown', parts.join(' · ')));
      content.appendChild(card);
      const counter = big.querySelector('b') as HTMLElement;
      const startAt = reduced ? 0 : 180 + 3 * 260;
      window.setTimeout(() => this.countUp(counter, w.reward, reduced ? 0 : 700), startAt);
    } else {
      content.appendChild(el('div', 'win__note', 'All stars already earned on this level'));
    }

    // Stats, with a "New best" tag when the move count improved.
    const stats = el('div', 'statgrid statgrid--4');
    const time = w.seconds >= 60
      ? `${Math.floor(w.seconds / 60)}:${String(w.seconds % 60).padStart(2, '0')}`
      : `${w.seconds}s`;
    const isNewBest = w.prevBest !== null && w.moves < w.prevBest;
    const bestShown = w.prevBest === null ? w.moves : Math.min(w.prevBest, w.moves);
    stats.innerHTML = `
      <div><b>${w.moves}</b><span>Moves</span></div>
      <div><b>${w.par}</b><span>Ideal</span></div>
      <div><b>${time}</b><span>Time</span></div>
      <div class="${isNewBest ? 'statgrid__best' : ''}"><b>${bestShown}</b><span>${isNewBest ? 'New best!' : 'Best'}</span></div>`;
    content.appendChild(stats);

    // Progress through the campaign (or the endless tally), plus the streak
    // when there is one worth showing.
    const meta = el('div', 'win__meta');
    const endless = isEndless(this.levelId);
    const cleared = endless
      ? this.save.endlessCleared(LEVEL_COUNT)
      : this.save.campaignCleared(LEVEL_COUNT);
    const progress = el('div', 'win__progress');
    progress.innerHTML = endless
      ? `<span class="win__progress-label">${cleared} endless ${cleared === 1 ? 'level' : 'levels'} cleared</span>`
      : `<span class="win__progress-track"><i style="width:${Math.round((cleared / LEVEL_COUNT) * 100)}%"></i></span>` +
        `<span class="win__progress-label">${cleared} / ${LEVEL_COUNT} levels</span>`;
    meta.appendChild(progress);
    if (w.streak >= 2) meta.appendChild(el('span', 'win__streak', `🔥 ${w.streak} in a row`));
    content.appendChild(meta);

    // Actions: one obvious next step, two quiet alternatives.
    const actions = el('div', 'win__actions');
    const act = (label: string, cls: string, fn: () => void): HTMLButtonElement => {
      const b = el('button', cls, label);
      b.addEventListener('click', () => {
        audio.play('button');
        this.modal.close();
        fn();
      });
      return b;
    };
    // The campaign finale leads into endless mode; everything else leads to the next level.
    const nextLabel = w.isLast ? 'Start endless mode' : 'Next level';
    actions.appendChild(
      act(nextLabel, 'btn btn--success btn--wide win__next', () => {
        void this.startLevel(this.levelId + 1);
      }),
    );
    const row = el('div', 'modal__row');
    row.appendChild(act('Replay', 'btn btn--ghost', () => this.restartLevel()));
    row.appendChild(act('Home', 'btn btn--ghost', () => this.quitToHome()));
    actions.appendChild(row);
    content.appendChild(actions);

    this.modal.open({
      title: w.isLast ? `All ${LEVEL_COUNT} levels cleared!` : `${this.levelLabel(this.levelId)} complete!`,
      content,
      dismissable: false,
    });

    // Confetti rains over the dialog itself; a perfect run or a finished
    // chapter gets the big burst.
    this.confetti.burst(w.stars === 3 || w.chapterDone ? 2 : 1);

    // Ring the stars in one at a time so the score lands as a moment.
    starEls.forEach((node, i) => {
      window.setTimeout(() => {
        node.classList.add('pop');
        if (i < w.stars) {
          node.classList.add('on');
          audio.play('star', i);
        }
      }, 180 + i * 260);
    });

    window.setTimeout(() => audio.play('unlock'), 180 + 3 * 260 + 200);
  }

  /** Roll a "+N" counter up to its value with coin ticks along the way. */
  private countUp(node: HTMLElement, to: number, ms: number): void {
    if (ms <= 0) {
      node.textContent = `+${to}`;
      return;
    }
    const t0 = performance.now();
    let lastTick = 0;
    const step = (t: number): void => {
      const p = Math.min(1, (t - t0) / ms);
      const eased = 1 - Math.pow(1 - p, 3);
      node.textContent = `+${Math.round(eased * to)}`;
      if (p < 1) {
        if (t - lastTick > 95) {
          audio.play('coin');
          lastTick = t;
        }
        requestAnimationFrame(step);
      } else {
        node.textContent = `+${to}`;
      }
    };
    requestAnimationFrame(step);
  }

  // ---------------------------------------------------------------- stuck
  /** The solver proved no winning line remains, though legal moves do. */
  private onNoWin(): void {
    audio.play('stuck');
    haptic([16, 50, 16]);
    this.analytics.track({
      type: 'level_no_win', level: this.levelId, moves: this.board.moveCount,
    });
    this.toast.show('No way to win from here - use Undo or Restart', 'warn', 3400);
  }

  private onStuck(): void {
    audio.play('stuck');
    haptic([30, 80, 30]);
    this.analytics.track({ type: 'level_stuck', level: this.levelId, moves: this.board.moveCount });
    this.showStuckDialog();
  }

  private showStuckDialog(): void {
    this.modal.open({
      title: 'No moves left',
      bodyHtml: 'Every bottle is blocked. Undo a pour, add an empty bottle, or start over.',
      inlineButtons: false,
      buttons: [
        {
          label: 'Undo last pour',
          kind: 'primary',
          onClick: () => {
            void this.usePowerup('undo');
          },
        },
        {
          label: 'Add an empty bottle',
          kind: 'ghost',
          onClick: () => {
            void this.usePowerup('bottle');
          },
        },
        {
          label: this.heartCostLabel('Restart level'),
          kind: 'ghost',
          onClick: () => {
            // Restarting out of a dead end is a failed attempt.
            this.loseLife('failed');
            this.restartLevel();
          },
        },
      ],
      dismissable: false,
    });
  }

  /** Whether giving up on the current board right now would cost a heart. */
  private get heartAtStake(): boolean {
    return this.board.isLost && !this.tutorial.active && !this.save.hasInfiniteLives;
  }

  private heartCostLabel(label: string): string {
    return this.heartAtStake ? `${label} (costs a heart)` : label;
  }

  /**
   * One rule for hearts: they pay for *failures*. A board that is dead-ended
   * or proven unwinnable has been failed; restarting or leaving it costs a
   * heart. Walking away from a live board, or restarting one, is free - the
   * player only loses the moves they made.
   */
  private loseLife(cause: 'quit' | 'failed'): void {
    // Never punish a player who is still inside the level-1 tutorial.
    if (this.tutorial.active) return;
    if (!this.board.isLost) return;
    this.save.loseLife();
    this.save.breakStreak();
    this.analytics.track({ type: 'life_lost', level: this.levelId, cause });
  }

  // --------------------------------------------------------------- dialogs
  private confirmQuit(): void {
    if (this.board.moveCount === 0 || this.board.isResolved) {
      this.quitToHome();
      return;
    }
    const body = this.heartAtStake
      ? 'This level cannot be won from here. Leaving now costs a heart.'
      : 'Your progress on this attempt will be lost.';
    this.modal.open({
      title: 'Leave this level?',
      bodyHtml: body,
      inlineButtons: true,
      buttons: [
        { label: 'Stay', kind: 'ghost' },
        {
          label: 'Leave',
          kind: 'primary',
          onClick: () => {
            this.loseLife('quit');
            this.quitToHome();
          },
        },
      ],
    });
  }

  private quitToHome(): void {
    // Leaving a won board is navigation, not a quit: keep the funnel honest.
    if (!this.board.isResolved) {
      // The dialog said this attempt's progress would be lost; make it so.
      this.save.setInProgress(null);
      this.analytics.track({
        type: 'level_quit',
        level: this.levelId,
        moves: this.board.moveCount,
        seconds: Math.round((Date.now() - this.attemptStartedAt) / 1000),
      });
    }
    this.goHome();
  }

  /** Plain navigation to home, with no analytics side effects. */
  private goHome(): void {
    this.tutorial.abort();
    this.renderHome();
    this.show('home');
  }

  private confirmRestart(): void {
    if (this.board.moveCount === 0) return;
    const body = this.heartAtStake
      ? 'This level cannot be won from here. Restarting costs a heart.'
      : 'The board will be reset to the beginning.';
    this.modal.open({
      title: 'Restart level?',
      bodyHtml: body,
      inlineButtons: true,
      buttons: [
        { label: 'Cancel', kind: 'ghost' },
        {
          label: 'Restart',
          kind: 'primary',
          onClick: () => {
            // Same rule as the stuck dialog: only a lost board costs a heart.
            this.loseLife('failed');
            this.restartLevel();
          },
        },
      ],
    });
  }

  /** Profile card: identity, campaign progress and lifetime stats. */
  private showProfileDialog(): void {
    const s = this.save.snapshot;
    const stats = s.stats;

    const content = el('div', 'profdlg');

    const head = el('div', 'profdlg__head');
    const face = el('span', 'profdlg__avatar', s.profile?.avatar ?? '🐱');
    head.appendChild(face);
    const who = el('div', 'profdlg__who');
    who.appendChild(el('div', 'profdlg__name', s.profile?.name || 'Guest'));
    who.appendChild(
      el('div', 'profdlg__level', `Level ${this.save.highestUnlocked(LEVEL_COUNT)}`),
    );
    head.appendChild(who);
    content.appendChild(head);

    const grid = el('div', 'profdlg__grid');
    const rows: Array<[string, string]> = [
      ['Levels cleared', `${this.save.campaignCleared(LEVEL_COUNT)} / ${LEVEL_COUNT}`],
      ['Stars', `${this.save.campaignStars(LEVEL_COUNT)} / ${LEVEL_COUNT * 3}`],
      ['Endless cleared', String(this.save.endlessCleared(LEVEL_COUNT))],
      ['Perfect clears', String(stats.perfects)],
      ['Best win streak', String(stats.bestStreak)],
      ['Total pours', String(stats.pours)],
      ['Hints used', String(stats.hintsUsed)],
    ];
    for (const [label, value] of rows) {
      const cell = el('div', 'profdlg__stat');
      cell.appendChild(el('b', '', value));
      cell.appendChild(el('span', '', label));
      grid.appendChild(cell);
    }
    content.appendChild(grid);

    this.modal.open({
      title: 'Profile',
      content,
      closeButton: true,
      buttons: [
        { label: 'Change look', kind: 'primary', onClick: () => this.editProfile() },
        { label: 'How to play', kind: 'ghost', onClick: () => this.showHowTo() },
        { label: 'Settings', kind: 'ghost', onClick: () => this.openSettings() },
      ],
    });
  }

  /** Reopen the look-picker prefilled with the current identity. */
  private editProfile(): void {
    const profile = this.save.snapshot.profile;
    const input = $<HTMLInputElement>('#name-input');
    input.value = profile?.name ?? '';
    $<HTMLInputElement>('#analytics-consent').checked = this.save.snapshot.settings.analytics;
    this.chosenAvatar = profile?.avatar ?? this.chosenAvatar;
    for (const child of Array.from($('#avatar-grid').children)) {
      child.setAttribute('aria-checked', String(child.textContent === this.chosenAvatar));
    }
    this.show('profile');
  }

  private openSettings(): void {
    const s = this.save.snapshot.settings;
    const content = el('div');

    const rows: Array<[keyof typeof s, string, string]> = [
      ['sfx', 'Sound effects', 'Pours, taps and celebrations'],
      ['music', 'Music', 'Ambient background loop'],
      ['haptics', 'Vibration', 'Where the device supports it'],
      ['colorblind', 'Colourblind aid', 'Adds a shape marker to each colour'],
      ['reducedMotion', 'Reduced motion', 'Shorter animations, no particles'],
      // Keep last: the smoke test addresses the switches above by position.
      ['analytics', 'Share anonymous usage data', 'Which levels are played and where things break. Never your name or email'],
    ];

    for (const [key, label, desc] of rows) {
      const row = el('div', 'setting');
      const text = el('div');
      text.appendChild(el('div', 'setting__label', label));
      text.appendChild(el('div', 'setting__desc', desc));
      row.appendChild(text);

      const toggle = el('button', 'switch');
      toggle.setAttribute('role', 'switch');
      toggle.setAttribute('aria-label', label);
      toggle.setAttribute('aria-checked', String(s[key]));
      toggle.addEventListener('click', () => {
        const next = !(this.save.snapshot.settings[key] as boolean);
        this.save.update((d) => {
          (d.settings[key] as boolean) = next;
        });
        toggle.setAttribute('aria-checked', String(next));
        this.applySettings();
        if (key === 'colorblind') this.board.setColorblind(next);
        audio.play('button');
      });
      row.appendChild(toggle);
      content.appendChild(row);
    }

    content.appendChild(this.buildSupportSection());

    const profile = this.save.snapshot.profile;
    const footer = el('p', 'panel__hint');
    footer.innerHTML = profile
      ? `Playing as <b>${escapeHtml(profile.name)}</b> ${escapeHtml(profile.avatar)}`
      : 'Playing as guest';
    content.appendChild(footer);

    this.modal.open({
      title: 'Settings',
      content,
      buttons: [
        { label: 'How to play', kind: 'ghost', onClick: () => this.showHowTo() },
        { label: 'Done', kind: 'primary' },
      ],
    });
  }

  // ------------------------------------------------------------- support
  private buildSupportSection(): HTMLElement {
    const section = el('div');
    section.appendChild(el('div', 'modal__subhead', 'Help & support'));

    const supportRow = (
      label: string,
      desc: string,
      action: string,
      kind: 'ghost' | 'danger',
      onClick: () => void,
    ): void => {
      const row = el('div', 'setting');
      const text = el('div');
      text.appendChild(el('div', 'setting__label', label));
      text.appendChild(el('div', 'setting__desc', desc));
      row.appendChild(text);
      const button = el('button', `btn btn--${kind} btn--compact`, action);
      button.addEventListener('click', () => {
        audio.play('button');
        onClick();
      });
      row.appendChild(button);
      section.appendChild(row);
    };

    const supportId = formatSupportId(this.save.supportId);
    supportRow('Support ID', supportId, 'Copy', 'ghost', () => {
      navigator.clipboard?.writeText(supportId).then(
        () => this.toast.show('Support ID copied'),
        () => this.toast.show(`Your ID: ${supportId}`),
      );
    });

    supportRow('Contact us', 'Something broken? We answer by email', 'Email', 'ghost', () => {
      const level = this.save.highestUnlocked(LEVEL_COUNT);
      this.analytics.track({ type: 'support_email_open', level });
      window.location.href = supportMailto(this.save.supportId, level, SAVE_VERSION);
    });

    supportRow('Support code', 'Got a code from us? Redeem it here', 'Enter', 'ghost', () =>
      this.openSupportCodeEntry(),
    );

    supportRow('Privacy policy', 'What the game stores and sends', 'View', 'ghost', () => {
      window.open('./privacy.html', '_blank', 'noopener');
    });

    supportRow('Reset progress', 'Erase levels, coins and stats', 'Reset', 'danger', () =>
      this.confirmResetProgress(),
    );

    return section;
  }

  private openSupportCodeEntry(): void {
    const content = el('div');
    const input = el('input', 'field__input');
    input.placeholder = 'CF-XXXXX-XXXXX-XXXXX-XXXXX';
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Support code');
    content.appendChild(input);
    const status = el('p', 'panel__hint support-code__status');
    content.appendChild(status);

    const redeem = async (): Promise<void> => {
      const result = await verifySupportCode(
        input.value,
        this.save.supportId,
        this.save.snapshot.redeemedCodes,
      );
      if (!result.ok) {
        status.textContent = SUPPORT_CODE_ERROR_TEXT[result.reason];
        haptic([12, 40, 12]);
        return;
      }
      const applied = applySupportCode(result.code, this.save, LEVEL_COUNT);
      this.analytics.track({ type: 'support_code_redeemed', action: result.code.action });
      if (result.code.action === 'reset') {
        this.analytics.track({ type: 'progress_reset', source: 'support_code' });
      }
      this.modal.close();
      this.toast.show(applied.message);
      audio.play('win');
      if (applied.reload) {
        this.save.flush();
        window.setTimeout(() => window.location.reload(), 900);
      } else {
        this.refreshAfterSupportCode();
      }
    };

    this.modal.open({
      title: 'Support code',
      content,
      inlineButtons: true,
      buttons: [
        { label: 'Cancel', kind: 'ghost', onClick: () => this.openSettings() },
        {
          label: 'Redeem',
          kind: 'primary',
          onClick: () => {
            void redeem();
            return false; // stays open; redeem() closes it on success
          },
        },
      ],
    });
    window.setTimeout(() => input.focus(), 80);
  }

  /** A code may have changed coins, lives or unlocks under the open screen. */
  private refreshAfterSupportCode(): void {
    if (this.current === 'home') this.renderHome();
    else if (this.current === 'map') this.renderMap();
    else if (this.current === 'game') this.updateHud();
  }

  private confirmResetProgress(): void {
    this.modal.open({
      title: 'Reset progress?',
      bodyHtml: `
        <p style="text-align:left;margin:0">
          This erases your levels, stars, coins and stats on this device and
          restarts the game from level 1. Your settings are kept.
          <b>This cannot be undone.</b>
        </p>`,
      inlineButtons: true,
      buttons: [
        { label: 'Keep playing', kind: 'primary', onClick: () => this.openSettings() },
        {
          label: 'Reset',
          kind: 'danger',
          onClick: () => {
            this.analytics.track({ type: 'progress_reset', source: 'settings' });
            this.save.resetProgress();
            window.location.reload();
          },
        },
      ],
    });
  }

  private showHowTo(): void {
    const eco = this.remote.current.economy;
    this.modal.open({
      title: 'How to play',
      bodyHtml: `
        <div class="howto">
          <h3>Pouring</h3>
          <p>Tap a bottle to lift its top colour, then tap another bottle to pour.
             Liquid only pours onto the <b>same colour</b> or into an <b>empty bottle</b>,
             and the whole matching block moves at once if there is room.</p>
          <p>Fill a bottle with one colour and a cork seals it - that bottle is done.
             Seal every colour to win.</p>

          <h3>Stars and the ideal</h3>
          <p>Every level has an <b>ideal</b>: the fewest pours that can solve it, worked out
             exactly. Finish close to the ideal for <b>three stars</b>, a bit over for two.
             The win screen tells you the exact count the next star needs, and replaying a
             level earns coins for any stars you did not have yet.</p>

          <h3>Hearts</h3>
          <p>You lose a heart only when a level is truly <b>failed</b> - no pours left, or the
             game has proven it cannot be won from here - and you restart or leave it.
             Leaving or restarting a live level is free. Hearts refill one every 30 minutes.</p>

          <h3>Boosters</h3>
          <p>Each attempt starts with <b>${eco.freeUses.undo} free undos</b> and
             <b>${eco.freeUses.hint} free hint</b>. Extra bottles and more hints or undos come
             from the shop, bought with the coins you earn.</p>

          <h3>Twists</h3>
          <p>The gold-rimmed <b>Cauldron</b> accepts any colour on top but must be empty to win.
             <b>Murky potions</b> hide their colours until they reach the surface.</p>
        </div>`,
      buttons: [{ label: 'Got it', kind: 'primary' }],
    });
  }
}

const app = new App();
app.boot().catch((err: unknown) => app.showBootFailure(err));

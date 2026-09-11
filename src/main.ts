import './styles/main.css';

import { LEVELS, LEVEL_COUNT, endlessIndex, getLevelSpec, isEndless } from '@/core/levels';
import { CHAPTER_SIZE, chapterFor, isChapterEnd, type Chapter } from '@/core/chapters';
import { dailyId, dateFromDay, dayFromDailyId, isDaily, todayDayNumber } from '@/core/daily';
import { getCampaignLevel } from '@/core/campaign';
import { TUBE_CAPACITY } from '@/core/board';
import { solverClient } from '@/services/SolverClient';
import {
  COIN_SHOP, LIVES_MAX, LOGIN_CYCLE, LOGIN_REWARDS, coinsFor, loginCycleDay, loginRewardFor,
  starThresholds, starsFor,
  type CoinShopItem, type PowerupId,
} from '@/core/progression';
import { ACHIEVEMENTS, achievementById, unlockedAchievements } from '@/core/achievements';
import { CHAPTERS } from '@/core/chapters';
import type { GeneratedLevel } from '@/core/types';

import { SAVE_VERSION, SaveService, type InProgressState } from '@/services/SaveService';
import {
  CloudSaveService, deviceLabel, pickCloudDriver, type ProgressSummary, type SyncOutcome,
} from '@/services/CloudSave';
import { AuthService } from '@/services/AuthService';
import { Analytics, POSTHOG_KEY, PostHogDriver } from '@/services/Analytics';
import { RemoteConfig } from '@/services/RemoteConfig';
import {
  IAP_CATALOG, Payments, getProduct, type IapProduct, type PendingPurchase, type ProductId,
} from '@/services/Payments';
import { Ads, pickAdsDriver } from '@/services/Ads';
import {
  LEADERBOARD_UNLOCK_LEVEL, Leaderboard, leaderboardUnlocked, pickLeaderboardDriver,
} from '@/services/Leaderboard';
import { isNativeApp, platform } from '@/services/Platform';
import {
  applySupportCode, formatSupportId, supportMailto, verifySupportCode,
} from '@/services/Support';
import {
  SUPPORTED_LOCALES, applyStaticText, formatLongDate, formatNumber, resolveLocale, setLocale, t, tp,
  type MessageKey,
} from '@/i18n';

import gsap from 'gsap';
import { audio } from '@/audio/AudioEngine';
import { GameStage } from '@/render/GameStage';
import { BoardView } from '@/render/BoardView';
import { PALETTE, SKINS, cssHex, skinById, type GlassSkin } from '@/render/theme';

import {
  $, ModalHost, ToastHost, el, escapeHtml, haptic, installNativeHaptics, setHapticsEnabled,
} from '@/ui/dom';
import { Tutorial } from '@/ui/Tutorial';
import { Confetti } from '@/ui/Confetti';
import { installFormViewport } from '@/ui/formViewport';

installFormViewport();

type ScreenId = 'boot' | 'profile' | 'home' | 'map' | 'board' | 'shop' | 'game';
type WinMode = 'campaign' | 'endless' | 'daily';
const SCREENS: readonly ScreenId[] = ['boot', 'profile', 'home', 'map', 'board', 'shop', 'game'];

const AVATARS = ['🐱', '🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐧'];
const AVATAR_ART = [
  `<path d="M20 37 23 14 40 29A35 35 0 0 1 60 29L77 14l3 23a34 34 0 1 1-60 0Z" fill="#ff789f"/><path d="m25 29 1-9 8 8m41 1-1-9-8 8" fill="#ffc2d3"/><path d="M36 52h1m26 0h1" stroke="#26305f" stroke-width="8" stroke-linecap="round"/><path d="m46 62 4 3 4-3M50 65v4m0 0q-7 7-13 1m13-1q7 7 13 1" fill="none" stroke="#26305f" stroke-width="3" stroke-linecap="round"/>`,
  `<path d="M18 42 14 12l25 20a36 36 0 0 1 22 0l25-20-4 30a34 34 0 1 1-64 0Z" fill="#ff9838"/><path d="m20 22 15 13-13 8m58-21-15 13 13 8M28 60q22 27 44 0-8 5-22 5t-22-5Z" fill="#fff0dc"/><circle cx="36" cy="51" r="4" fill="#26305f"/><circle cx="64" cy="51" r="4" fill="#26305f"/><path d="m45 62 5 4 5-4" fill="#26305f"/>`,
  `<circle cx="50" cy="51" r="36" fill="#f6f3ff"/><ellipse cx="34" cy="46" rx="13" ry="16" fill="#30345d" transform="rotate(25 34 46)"/><ellipse cx="66" cy="46" rx="13" ry="16" fill="#30345d" transform="rotate(-25 66 46)"/><circle cx="36" cy="48" r="4" fill="#fff"/><circle cx="64" cy="48" r="4" fill="#fff"/><circle cx="36" cy="49" r="2" fill="#202442"/><circle cx="64" cy="49" r="2" fill="#202442"/><ellipse cx="50" cy="62" rx="6" ry="4" fill="#30345d"/><path d="M42 69q8 7 16 0" fill="none" stroke="#30345d" stroke-width="3" stroke-linecap="round"/>`,
  `<path d="M19 48q0-27 31-27t31 27v13q0 25-31 25T19 61Z" fill="#43d680"/><circle cx="32" cy="29" r="13" fill="#43d680"/><circle cx="68" cy="29" r="13" fill="#43d680"/><circle cx="32" cy="31" r="7" fill="#fff"/><circle cx="68" cy="31" r="7" fill="#fff"/><circle cx="34" cy="32" r="3" fill="#26305f"/><circle cx="66" cy="32" r="3" fill="#26305f"/><circle cx="38" cy="55" r="2" fill="#248c5b"/><circle cx="62" cy="55" r="2" fill="#248c5b"/><path d="M36 65q14 13 28 0" fill="none" stroke="#26305f" stroke-width="4" stroke-linecap="round"/>`,
  `<path d="M17 31 34 17l16 13 16-13 17 14-7 42-26 15-26-15Z" fill="#9a7bea"/><circle cx="35" cy="49" r="13" fill="#fff2ca"/><circle cx="65" cy="49" r="13" fill="#fff2ca"/><circle cx="37" cy="50" r="5" fill="#26305f"/><circle cx="63" cy="50" r="5" fill="#26305f"/><path d="m43 63 7 8 7-8-7-4Z" fill="#ffb33e"/><path d="M28 74q22 13 44 0" fill="none" stroke="#7252c3" stroke-width="3"/>`,
  `<path d="M26 55q-7-30 24-34 31 4 24 34 15 15 2 29-8 8-16-2-10 14-20 0-8 10-16 2-13-14 2-29Z" fill="#b866e9"/><circle cx="38" cy="49" r="6" fill="#fff"/><circle cx="62" cy="49" r="6" fill="#fff"/><circle cx="39" cy="50" r="2.5" fill="#26305f"/><circle cx="61" cy="50" r="2.5" fill="#26305f"/><path d="M40 63q10 9 20 0" fill="none" stroke="#26305f" stroke-width="3.5" stroke-linecap="round"/>`,
  `<path d="m52 13 8-9 2 17q22 7 20 34-2 31-32 31T18 55q-1-27 20-34Z" fill="#f8f5ff"/><path d="m48 18 6-15 8 18" fill="#ffd94f"/><path d="M27 35Q17 22 27 14q18 6 20 16" fill="#c788f2"/><path d="M38 49h1m23 0h1" stroke="#26305f" stroke-width="7" stroke-linecap="round"/><path d="M42 65q8 7 16 0" fill="none" stroke="#26305f" stroke-width="3" stroke-linecap="round"/><circle cx="69" cy="61" r="5" fill="#ff9ebd" opacity=".65"/>`,
  `<ellipse cx="50" cy="53" rx="32" ry="38" fill="#29335f"/><ellipse cx="50" cy="59" rx="23" ry="28" fill="#f6f3ff"/><path d="M25 26Q13 13 24 8q17 7 23 18m28 0Q87 13 76 8q-17 7-23 18" fill="#29335f"/><circle cx="39" cy="49" r="4" fill="#26305f"/><circle cx="61" cy="49" r="4" fill="#26305f"/><path d="m43 59 7 5 7-5-7-4Z" fill="#ffb33e"/><path d="M39 71q11 7 22 0" fill="none" stroke="#26305f" stroke-width="3" stroke-linecap="round"/>`,
] as const;

/**
 * Each drawing's own bounding square, measured from its rendered extents. The
 * paths were laid out freehand inside a 100x100 box but fill only 62-83 units
 * of it, off-centre by up to 5.5, so one shared viewBox drew them at visibly
 * different sizes. Framing each by its own bounds makes all eight present the
 * same footprint. Keep in step with AVATAR_ART above; remeasure with getBBox
 * if the art changes.
 */
const AVATAR_VIEW = [
  '13.5 14 73 73',
  '12.25 12 75.5 75.5',
  '14 15 72 72',
  '15 16 70 70',
  '14.5 17 71 71',
  '16.05 21 68 68',
  '8.6 3 83 83',
  '8.5 8 83 83',
] as const;

/** Render bundled vector avatars identically in every browser and app wrapper. */
function renderAvatar(node: HTMLElement, avatar = AVATARS[0] as string): void {
  const index = Math.max(0, AVATARS.indexOf(avatar));
  node.dataset.avatar = avatar;
  node.innerHTML = `<svg class="avatar__art" viewBox="${AVATAR_VIEW[index]}" aria-hidden="true">${AVATAR_ART[index]}</svg>`;
}

const powerupLabel = (id: PowerupId): string => t(`powerup.${id}`);
/** Catalog titles live in the string table so the shop reads in the player's language. */
const productTitle = (p: IapProduct): string => t(`product.${p.id}`);
const itemTitle = (item: CoinShopItem): string => t(`item.${item.id}.title` as MessageKey);

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
 * Shop preview of a bottle look: the same silhouette proportions as the board
 * (collar, neck, shoulder, body), two liquid bands, and the skin's own glass
 * tint, rim and cork. All values come from the skin, so the preview cannot
 * drift from what the board draws.
 */
function skinPreviewSvg(skin: GlassSkin): string {
  const rim = cssHex(skin.rim);
  const body = cssHex(skin.body);
  const c0 = (PALETTE[0] as { css: string }).css;
  const c1 = (PALETTE[1] as { css: string }).css;
  return `<svg viewBox="0 0 40 92" aria-hidden="true">
    <path d="M14 14 h12 v6 q9 4 9 14 v46 a5 5 0 0 1 -5 5 h-20 a5 5 0 0 1 -5 -5 v-46 q0 -10 9 -14 z"
      fill="${cssHex(skin.cavity)}" fill-opacity="${Math.min(1, skin.cavityAlpha + 0.25)}" />
    <rect x="5" y="58" width="30" height="22" fill="${c1}" />
    <path d="M5 80 v0 a5 5 0 0 0 5 5 h20 a5 5 0 0 0 5 -5 v-0 z" fill="${c1}" />
    <rect x="5" y="40" width="30" height="18" fill="${c0}" />
    <path d="M14 14 h12 v6 q9 4 9 14 v46 a5 5 0 0 1 -5 5 h-20 a5 5 0 0 1 -5 -5 v-46 q0 -10 9 -14 z"
      fill="${body}" fill-opacity="${Math.min(1, skin.bodyAlpha + 0.1)}"
      stroke="${rim}" stroke-opacity="${skin.rimAlpha}" stroke-width="2.4" />
    <rect x="12" y="10" width="16" height="6" rx="1.5" fill="${cssHex(skin.collar)}" fill-opacity="${skin.collarAlpha + 0.2}" />
    <rect x="11" y="3" width="18" height="10" rx="2.5" fill="${cssHex(skin.cork)}" stroke="${cssHex(skin.corkEdge)}" stroke-width="1.2" />
    <rect x="9" y="30" width="3" height="34" rx="1.5" fill="#fff" fill-opacity="0.18" />
  </svg>`;
}

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
  private readonly ads = new Ads(pickAdsDriver());
  private readonly leaderboard = new Leaderboard(pickLeaderboardDriver());
  private save!: SaveService;

  private readonly stage = new GameStage();
  private board!: BoardView;
  private cloud!: CloudSaveService;
  private toast!: ToastHost;
  private modal!: ModalHost;
  private tutorial!: Tutorial;
  private confetti!: Confetti;

  private level: GeneratedLevel | null = null;
  private levelId = 1;
  private attempt = 0;
  private attemptStartedAt = 0;
  private nudged = false;
  /** Star tier shown in the pill, to detect the moment one slips. */
  private hudTier: 1 | 2 | 3 = 3;

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
    this.setSplash(6, t('splash.mixing'));

    await this.remote.refresh();
    this.setSplash(20, t('splash.mixing'));
    this.save = new SaveService(this.remote.current.economy.startingCoins);
    // Language: the player's choice, else the device's. Static HTML text is
    // stamped once here; everything dynamic goes through t() as it renders.
    await setLocale(resolveLocale(this.save.snapshot.settings.language, navigator.languages));
    applyStaticText();
    // Cloud save: platform storage through the native bridge (simulated in
    // dev). Probed after the first screen is up so it never delays boot.
    this.cloud = new CloudSaveService(this.save, pickCloudDriver(), deviceLabel());
    this.cloud.onConflict = (cloud, local) => this.showCloudConflict(cloud, local);
    // Off the boot path. Once the store is reachable, settle anything that was
    // paid for but never delivered (see Payments.ts lifecycle notes).
    this.payments.onPending = (p) => void this.settleLatePurchase(p);
    void this.payments.init().then(() => this.restorePurchases());
    // Ads: consent, SDK and preloading, all off the boot path. A full-screen
    // ad silences the game and stops the render loop underneath it.
    this.ads.onAdStart = () => {
      audio.suspend();
      this.stage.setPaused(true);
    };
    this.ads.onAdEnd = () => {
      audio.resume();
      this.stage.setPaused(this.current !== 'game' || document.hidden);
    };
    void this.ads.init();
    // Leaderboard: platform ranking by campaign stars, gated on level 45.
    // Probed off the boot path, then the current total is posted so a player
    // who progressed on another device is not stale on the board.
    void this.leaderboard.init().then(() => {
      if (!this.leaderboard.available) return;
      // The screen may already be open and showing the app-only fallback.
      if (this.current === 'board') this.renderBoardScreen();
      if (leaderboardUnlocked(this.save.highestUnlocked(LEVEL_COUNT))) {
        void this.leaderboard.submit(this.save.campaignStars(LEVEL_COUNT));
      }
    });
    // iOS has no Vibration API; the Taptic Engine is reached through the native bridge.
    if (platform() === 'ios') void installNativeHaptics();
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
    this.setSplash(35, t('splash.warming'));

    await this.stage.init($('#board-host'));
    this.setSplash(80, t('splash.almost'));
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
      onInvalid: () => haptic([12, 40, 12], 'error'),
      onLockedTap: (left) => this.explainLock(left),
      onOneWayTap: () => this.explainOneWay(),
      onUnlocked: () => {
        audio.play('unlock');
        haptic([10, 30, 20], 'success');
        this.toast.show(t('toast.padlockOpen'), 'info', 1400);
      },
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
        // The pill was on the plain "ideal" line while coaching; bring the star
        // budget in now rather than on the next pour.
        this.updateHud();
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
      this.toast.show(t('toast.private'), 'warn', 3800);
    }

    this.installDevHooks();

    // Keep the lives chip and the tutorial hand honest without event plumbing.
    window.setInterval(() => {
      if (this.current === 'home') this.renderLivesChip();
      if (this.tutorial?.active) this.updateTutorialHand();
    }, 1000);

    // Offline support for the installed web app. Production only: a worker
    // would fight the dev server's module graph and HMR. Not in the native
    // wrapper either: its assets ship inside the app, and a worker there
    // could only serve a stale copy after an update.
    if (!import.meta.env.DEV && !isNativeApp() && 'serviceWorker' in navigator) {
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
    void this.cloud.init().then((outcome) => this.afterCloudOutcome(outcome, 'boot'));
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
    this.setSplash(100, t('splash.ready'));
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
    if (pct) pct.textContent = t('boot.failed');
    if (bar) {
      const retry = el('button', 'btn btn--primary', t('boot.reload'));
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
        level: this.levelId,
        skin: this.save.snapshot.cosmetics.skin,
        renderScale: this.stage.currentResolution,
        topRowY: this.board.topRowY,
        bodyW: this.board.bodyWidth,
        pourHeadroom: this.board.pourHeadroom,
        moves: this.board.moveCount,
        tubes: this.board.tubeCount,
        selected: this.board.selectedIndex,
        coins: this.save.coins,
        achievementCoins: this.achievementCoins,
        lives: this.save.lives.count,
        par: this.level?.par ?? null,
        modalOpen: this.modal.isOpen,
        winCount: this.winCount,
      }),
      lastShare: () => this.lastShareText,
      boardGeometry: () => this.board.geometry(),
      cloud: () => ({ ...this.cloud.state, driver: this.cloud.driver.id }),
      cloudSignIn: () => this.cloud.signIn(),
      cloudSync: () => this.cloud.sync('manual'),
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
    // Every screen opens at the top. Scroll containers otherwise keep the
    // position from the last visit (a shop left at the bottom reopens at the
    // bottom), which reads as the app jumping around.
    const screen = $(`#screen-${id}`);
    screen.scrollTop = 0;
    for (const scroller of Array.from(screen.querySelectorAll<HTMLElement>('.map, .shop'))) {
      scroller.scrollTop = 0;
    }

    const nav = $('#bottomnav');
    nav.hidden = !(id === 'home' || id === 'map' || id === 'board');
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
    if (id === 'home') {
      this.maybeShowLoginReward();
      this.maybeShowLeaderboardUnlock();
    }
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
      case 'board':
        this.goHome();
        break;
      case 'profile':
        // Editing an existing look: back returns home. First-run setup is the root.
        if (this.save.snapshot.profile) {
          this.leaveProfileEditor();
          this.goHome();
        }
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
    // Capture the gesture before Pixi or a button handles it, so the same tap
    // that requests a sound also unlocks audio on iOS WKWebView.
    window.addEventListener('pointerdown', unlock, { capture: true });
    window.addEventListener('keydown', unlock);

    // iOS WebKit only applies `:active` to touches when a touch listener exists
    // somewhere on the page. Without this, no button shows its pressed state.
    document.addEventListener('touchstart', () => {}, { passive: true });

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

    window.addEventListener('pagehide', () => {
      this.save.flush();
      void this.cloud.flushUpload();
    });

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
      const node = el('button', 'avatar');
      renderAvatar(node, emoji);
      node.setAttribute('role', 'radio');
      node.setAttribute('aria-checked', String(i === 0));
      node.setAttribute('aria-label', t('profile.avatarN', { n: i + 1 }));
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
    // Read the policy in place; the href stays as the fallback for a new tab.
    $('.consent__link').addEventListener('click', (ev) => {
      ev.preventDefault();
      audio.play('button');
      void this.showPrivacyPolicy();
    });
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') void this.createProfile(input.value);
    });
  }

  private async createProfile(name: string): Promise<void> {
    audio.unlock();
    audio.play('button');
    const consent = $<HTMLInputElement>('#analytics-consent').checked;
    const existing = this.save.snapshot.profile;
    if (this.editingProfile && existing) {
      // A change of look keeps the identity: same createdAt, no "created" event,
      // and an emptied name field keeps the old name rather than becoming "Player".
      const trimmed = name.trim().slice(0, 16);
      this.save.update((d) => {
        d.profile = { ...existing, name: trimmed || existing.name, avatar: this.chosenAvatar };
        d.settings.analytics = consent;
      });
    } else {
      const profile = await this.auth.signIn(name, this.chosenAvatar);
      this.save.update((d) => {
        d.profile = profile;
        d.settings.analytics = consent;
      });
      this.analytics.track({ type: 'profile_created', avatar: profile.avatar });
    }
    this.leaveProfileEditor();
    this.renderHome();
    this.show('home');
  }

  /** Restore the look-picker to its first-run form for whoever opens it next. */
  private leaveProfileEditor(): void {
    this.editingProfile = false;
    $<HTMLButtonElement>('#btn-guest').hidden = false;
    $('#btn-start-profile').textContent = t('profile.start');
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
        } else if (target === 'daily') {
          this.openDaily();
        } else if (target === 'map') {
          this.renderMap();
          this.show('map');
        } else if (target === 'board') {
          this.showBoard();
        } else {
          this.renderHome();
          this.show('home');
        }
      });
    }
  }

  /** Today's challenge: play it, or see today's result if it is already done. */
  private openDaily(): void {
    const today = todayDayNumber();
    const record = this.save.dailyRecord(today);
    if (record) {
      this.showDailyDoneDialog(record.stars, record.bestMoves, today);
    } else {
      void this.startLevel(dailyId(today));
    }
  }

  private renderHome(): void {
    const profile = this.save.snapshot.profile;
    renderAvatar($('#home-avatar'), profile?.avatar);
    $('#home-coins').textContent = String(this.save.coins);
    this.renderLivesChip();

    const done = this.save.campaignCleared(LEVEL_COUNT);
    const endless = this.save.endlessCleared(LEVEL_COUNT);
    const next = this.save.highestUnlocked(LEVEL_COUNT);
    const stars = this.save.campaignStars(LEVEL_COUNT);
    const chapter = done >= LEVEL_COUNT ? null : chapterFor(next);
    // Campaign card: chapter (or "complete" plus the endless tally), stars,
    // and a bar of levels cleared with its count.
    $('#home-chapter').textContent = chapter
      ? t('home.chapter', { n: chapter.index, name: chapter.name })
      : t('home.complete') + (endless > 0 ? t('home.endlessSuffix', { n: endless }) : '');
    $('#home-stars').textContent = t('home.starsOf', { stars: formatNumber(stars), max: formatNumber(LEVEL_COUNT * 3) });
    $('#home-levels').textContent = t('home.levelsOf', { done, total: LEVEL_COUNT });
    $('#home-bar-fill').style.width = `${(100 * done) / LEVEL_COUNT}%`;
    const bar = $('#home-bar');
    bar.setAttribute('aria-valuenow', String(done));
    bar.setAttribute('aria-label', t('home.progressAria', { done, total: LEVEL_COUNT, stars, max: LEVEL_COUNT * 3 }));
    this.renderDailyButton();
    const resume = this.save.inProgress;
    $('#btn-play').textContent = resume
      ? t('home.continue', { label: this.levelLabel(resume.levelId) })
      : done >= LEVEL_COUNT
        ? this.levelLabel(this.save.nextEndlessId(LEVEL_COUNT))
        : t('level.n', { n: next });
  }

  // ----------------------------------------------------------- leaderboard
  private showBoard(): void {
    this.renderBoardScreen();
    this.show('board');
  }

  /**
   * The leaderboard screen, in one of three honest states: locked with a
   * countdown, open with a score and a way into the platform's board, or open
   * but app-only (the web build has no platform account to rank against).
   * The tab is always there - a nav item that appears from nowhere at level 45
   * is a nav item nobody was waiting for.
   */
  private renderBoardScreen(): void {
    $('#btn-settings-board').onclick = () => this.openSettings();
    const profile = this.save.snapshot.profile;
    renderAvatar($('#board-avatar'), profile?.avatar);
    $('#board-name').textContent = profile?.name || t('prof.guest');
    const stars = this.save.campaignStars(LEVEL_COUNT);
    $('#board-stars').textContent = formatNumber(stars);

    const level = this.save.highestUnlocked(LEVEL_COUNT);
    const unlocked = leaderboardUnlocked(level);
    const body = $('#board-body');
    body.replaceChildren();

    const badge = el('div', `board__badge${unlocked ? '' : ' board__badge--locked'}`);
    badge.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#cf-trophy" /></svg>';
    body.appendChild(badge);

    if (!unlocked) {
      body.appendChild(el('h2', 'board__head', t('board.lockedTitle', { n: LEADERBOARD_UNLOCK_LEVEL })));
      const bar = el('div', 'board__bar');
      const fill = el('i');
      fill.style.width = `${Math.round((100 * level) / LEADERBOARD_UNLOCK_LEVEL)}%`;
      bar.appendChild(fill);
      bar.appendChild(el('span', '', t('board.lockedProgress', { level, target: LEADERBOARD_UNLOCK_LEVEL })));
      body.appendChild(bar);
      body.appendChild(el('p', 'board__note', tp('board.lockedRemaining', LEADERBOARD_UNLOCK_LEVEL - level)));
      const play = el('button', 'btn btn--success btn--wide board__cta', t('board.keepPlaying'));
      play.addEventListener('click', () => {
        audio.play('button');
        haptic(8);
        this.goHome();
      });
      body.appendChild(play);
    } else {
      body.appendChild(el('h2', 'board__head', t('board.unlockedTitle')));
      const score = el('div', 'board__score');
      score.appendChild(el('b', '', `★ ${formatNumber(stars)}`));
      score.appendChild(el('small', '', t('board.ofMax', { max: formatNumber(LEVEL_COUNT * 3) })));
      body.appendChild(score);
      if (this.leaderboard.available) {
        const view = el('button', 'btn btn--primary btn--wide board__cta', t('board.open'));
        view.addEventListener('click', () => {
          audio.play('button');
          haptic(8);
          void this.openLeaderboard();
        });
        body.appendChild(view);
      } else {
        // Web, or an app build whose board id is still a placeholder.
        body.appendChild(el('p', 'board__note', t('board.appOnly')));
      }
    }

    // How ranking works, in both states: it is the reason to keep replaying.
    body.appendChild(el('p', 'board__rule', t('board.how')));
  }

  /**
   * Hands off to the platform's own board UI. Nothing is rendered by us: Play
   * Games and Game Center both insist their leaderboards are shown in their
   * chrome, and their sheets already handle friends, scopes and profiles.
   */
  private async openLeaderboard(): Promise<void> {
    const stars = this.save.campaignStars(LEVEL_COUNT);
    // Post before opening, so the board the player is about to look at
    // already includes the run that got them here.
    await this.leaderboard.submit(stars);
    const outcome = await this.leaderboard.show();
    this.analytics.track({ type: 'leaderboard_open', outcome, stars });
    if (outcome === 'signed-out') this.toast.show(t('board.signedOut'), 'warn', 3600);
    else if (outcome === 'unavailable') this.toast.show(t('board.unavailable'), 'warn', 3000);
  }

  /**
   * One-time "leaderboard unlocked" moment, the same shape as the mechanic
   * intros. Deliberately on the home screen rather than the win screen: the
   * win screen already carries stars, coins, a chapter ribbon and achievement
   * toasts, and this would be the fifth thing shouting at once.
   */
  private maybeShowLeaderboardUnlock(): void {
    if (this.save.snapshot.leaderboardSeen) return;
    if (!this.leaderboard.available) return;
    const level = this.save.highestUnlocked(LEVEL_COUNT);
    if (!leaderboardUnlocked(level)) return;
    window.setTimeout(() => {
      if (this.current !== 'home' || this.modal.isOpen) return;
      if (this.save.snapshot.leaderboardSeen) return;
      this.save.update((d) => {
        d.leaderboardSeen = true;
      });
      this.analytics.track({ type: 'leaderboard_unlocked', level });
      audio.play('unlock');
      haptic([10, 30, 20], 'success');
      this.confetti.burst(1);
      this.modal.open({
        title: t('board.unlockTitle'),
        bodyHtml: escapeHtml(t('board.unlockBody', { n: LEADERBOARD_UNLOCK_LEVEL })),
        inlineButtons: true,
        buttons: [
          { label: t('common.gotIt'), kind: 'ghost' },
          // Into the screen, not straight to the platform overlay: this is
          // also the moment to show the player where the tab lives.
          { label: t('board.view'), kind: 'primary', onClick: () => this.showBoard() },
        ],
      });
    }, 500);
  }

  /** "Level 12" inside the campaign, "Endless #7" beyond it, or the daily. */
  private levelLabel(id: number): string {
    if (isDaily(id)) return t('level.daily');
    return isEndless(id) ? t('level.endless', { n: endlessIndex(id) }) : t('level.n', { n: id });
  }

  /**
   * Today's challenge is already cleared: show the result and when the next
   * one arrives (local midnight). Replaying is allowed but pays nothing new,
   * and says so.
   */
  private showDailyDoneDialog(stars: number, bestMoves: number, today: number): void {
    const content = el('div', 'dailydone');
    content.appendChild(
      el('div', 'dailydone__stars', `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`),
    );
    content.appendChild(el('div', 'dailydone__best', tp('daily.done.best', bestMoves)));
    const streak = this.save.dailyStreak(today);
    if (streak > 1) content.appendChild(el('div', 'win__streak', t('daily.streak', { n: streak })));
    const next = el('div', 'dailydone__next');
    content.appendChild(next);

    const refresh = () => {
      const now = new Date();
      const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
      next.textContent = t('daily.done.next', { time: formatCountdown(midnight.getTime() - now.getTime()) });
    };
    refresh();
    const timer = window.setInterval(refresh, 1000);

    this.modal.open({
      title: t('daily.done.title'),
      content,
      closeButton: true,
      buttons: [
        { label: t('daily.done.home'), kind: 'primary' },
        {
          label: t('daily.done.replay'),
          kind: 'ghost',
          onClick: () => {
            void this.startLevel(dailyId(today));
          },
        },
      ],
      onClose: () => window.clearInterval(timer),
    });
  }

  /**
   * The daily tab's status: the full sentence for screen readers, and a badge
   * everyone sees - a tick when today is done, the streak while it is alive,
   * a dot when a fresh potion is waiting.
   */
  private renderDailyButton(): void {
    const today = todayDayNumber();
    const record = this.save.dailyRecord(today);
    const streak = this.save.dailyStreak(today);
    const sub = $('#daily-sub');
    const badge = $('#daily-badge');
    badge.classList.remove('bottomnav__badge--done', 'bottomnav__badge--streak');
    if (record) {
      sub.textContent =
        t('daily.sub.done', { stars: `${'★'.repeat(record.stars)}${'☆'.repeat(3 - record.stars)}` }) +
        (streak > 1 ? t('daily.sub.streakSuffix', { n: streak }) : t('daily.sub.tomorrow'));
      badge.textContent = '✓';
      badge.classList.add('bottomnav__badge--done');
    } else if (streak > 0) {
      sub.textContent = t('daily.sub.keep', { n: streak });
      badge.textContent = `🔥${streak}`;
      badge.classList.add('bottomnav__badge--streak');
    } else {
      sub.textContent = t('daily.sub.fresh');
      badge.textContent = '!';
    }
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
        lives.count >= LIVES_MAX ? t('home.full') : formatCountdown(lives.nextRegenAt - Date.now());
    }
  }

  // ------------------------------------------------------------------ map
  private renderMap(): void {
    const profile = this.save.snapshot.profile;
    renderAvatar($('#map-avatar'), profile?.avatar);
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

      const skipped = !record && this.save.isSkipped(spec.id);
      const node = el('button', 'node');
      if (locked) node.classList.add('node--locked');
      if (record) node.classList.add('node--done');
      if (skipped) node.classList.add('node--skipped');
      if (isNext) node.classList.add('node--next');
      node.disabled = locked;
      node.setAttribute(
        'aria-label',
        locked
          ? t('map.nodeLocked', { n: spec.id })
          : skipped
            ? t('map.nodeSkipped', { n: spec.id, name: spec.name })
            : t('map.nodeAria', { n: spec.id, name: spec.name, stars: record?.stars ?? 0 }),
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
      node.setAttribute('aria-label', t('map.endlessAria', { label: this.levelLabel(nextEndless) }));
      node.appendChild(el('span', 'node__num', '∞'));
      node.appendChild(el('span', 'node__name', this.levelLabel(nextEndless)));
      node.appendChild(el('span', 'node__stars', ''));
      node.addEventListener('click', () => {
        audio.play('button');
        void this.startLevel(nextEndless);
      });
      grid.appendChild(node);
    }

    // 500 nodes is a long scroll: open with the player's current chapter at the
    // top of the list, so the map always starts at a "top" and the relevant
    // levels are the first thing in view. Scrolled on the map's own container -
    // scrollIntoView would also drag every scrollable ancestor.
    requestAnimationFrame(() => {
      const scroller = $('#screen-map .map');
      const target = grid.querySelector<HTMLElement>('.node--next, .node:not(.node--locked):last-of-type');
      const header = target ? this.chapterHeaderFor(target, grid) : null;
      scroller.scrollTop = header ? Math.max(0, header.offsetTop - scroller.offsetTop - 8) : 0;
    });

    const endless = this.save.endlessCleared(LEVEL_COUNT);
    $('#map-footnote').textContent =
      done >= LEVEL_COUNT
        ? tp('map.footAll', endless, { total: LEVEL_COUNT })
        : t('map.foot', { done, total: LEVEL_COUNT });

    $('#btn-settings-map').onclick = () => this.openSettings();
  }

  /** Chapter number, name, stars earned of the chapter's 60, and a progress bar. */
  /** The chapter header that precedes a level node in the map grid, if any. */
  private chapterHeaderFor(node: HTMLElement, grid: HTMLElement): HTMLElement | null {
    let cursor: Element | null = node;
    while (cursor && cursor !== grid) {
      if (cursor.classList.contains('chapter')) return cursor as HTMLElement;
      cursor = cursor.previousElementSibling;
    }
    return null;
  }

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
      t('chapter.aria', {
        n: chapter.index, name: chapter.name,
        status: locked ? t('chapter.locked') : t('chapter.starsOf', { stars, max: size * 3 }),
      }),
    );

    const row = el('div', 'chapter__head');
    row.appendChild(el('span', 'chapter__num', t('chapter.num', { n: chapter.index })));
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
        iap.appendChild(el('p', 'shop__legal', t('shop.dev')));
      }
    } else {
      iap.appendChild(el('div', 'shop__unavailable', t('shop.unavailable')));
    }

    const list = $('#shop-coin-items');
    list.replaceChildren();
    for (const item of COIN_SHOP) list.appendChild(this.buildCoinItem(item));
    this.renderSkins();
  }

  private buildBundleCard(product: IapProduct): HTMLElement {
    const card = el('div', 'bundle');
    if (product.badge === 'Best value') card.classList.add('bundle--best');
    if (product.badge) {
      card.appendChild(
        el('span', 'bundle__badge', t(product.badge === 'Best value' ? 'shop.badge.best' : 'shop.badge.popular')),
      );
    }

    const coins = el('div', 'bundle__coins');
    coins.innerHTML = `${COIN_ICON} ${product.coins.toLocaleString()}`;
    card.appendChild(coins);

    const items = el('div', 'bundle__items');
    if (product.infiniteLivesHours) {
      const chip = el('span', 'bundle__item');
      chip.innerHTML =
        `<svg viewBox="0 0 24 24"><use href="#cf-heart"/></svg> ` +
        t('shop.infiniteHearts', { n: product.infiniteLivesHours });
      items.appendChild(chip);
    }
    for (const [pid, n] of Object.entries(product.powerups ?? {})) {
      items.appendChild(
        el('span', 'bundle__item', `${powerupLabel(pid as PowerupId)} ×${n}`),
      );
    }
    card.appendChild(items);

    const foot = el('div', 'bundle__foot');
    foot.appendChild(el('span', 'bundle__name', productTitle(product)));
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

  // ------------------------------------------------------------- cosmetics
  /** Bottle looks: one card per skin; tap buys (once) then equips. */
  private renderSkins(): void {
    const host = $('#shop-skins');
    host.replaceChildren();
    for (const skin of SKINS) host.appendChild(this.buildSkinCard(skin));
  }

  private buildSkinCard(skin: GlassSkin): HTMLElement {
    const name = t(`skin.${skin.id}` as MessageKey);
    const owned = this.save.ownsSkin(skin.id);
    const equipped = this.save.snapshot.cosmetics.skin === skin.id;

    const card = el('button', 'skin');
    if (equipped) card.classList.add('skin--equipped');
    else if (owned) card.classList.add('skin--owned');
    card.setAttribute('aria-pressed', String(equipped));
    const status = equipped
      ? t('skin.status.equipped')
      : owned
        ? t('skin.status.owned')
        : t('skin.status.price', { n: skin.price });
    card.setAttribute('aria-label', t('skin.aria', { name, status }));

    const preview = el('span', 'skin__preview');
    preview.innerHTML = skinPreviewSvg(skin);
    card.appendChild(preview);
    card.appendChild(el('span', 'skin__name', name));

    const action = el('span', `skin__action${owned ? '' : ' skin__action--price'}`);
    if (equipped) action.textContent = t('skin.equipped');
    else if (owned) action.textContent = t('skin.equip');
    else action.innerHTML = `${COIN_ICON} ${skin.price}`;
    card.appendChild(action);

    card.addEventListener('click', () => this.onSkinTap(skin));
    return card;
  }

  private onSkinTap(skin: GlassSkin): void {
    if (this.save.snapshot.cosmetics.skin === skin.id) return;
    if (!this.save.ownsSkin(skin.id)) {
      if (!this.save.buySkin(skin.id, skin.price)) {
        audio.play('invalid');
        this.toast.show(t('shop.notEnough', { n: skin.price }), 'warn');
        return;
      }
      this.analytics.track({ type: 'shop_coin_spend', item: `skin.${skin.id}`, price: skin.price });
    }
    this.save.equipSkin(skin.id);
    this.analytics.track({ type: 'skin_equip', skin: skin.id });
    // Bottles on a mounted board change at once; future boards pick it up at mount.
    this.board.setSkin(skin);
    audio.play('button');
    this.toast.show(t('skin.equippedToast', { name: t(`skin.${skin.id}` as MessageKey) }));
    this.renderShop();
  }

  private buildCoinItem(item: CoinShopItem): HTMLElement {
    const row = el('div', 'shopitem');

    const icon = el('span', 'shopitem__icon');
    icon.innerHTML =
      item.grant.kind === 'refillLives' ? HEART_ICON : POWERUP_ICON[item.grant.powerup];
    row.appendChild(icon);

    const body = el('div', 'shopitem__body');
    body.appendChild(el('div', 'shopitem__title', itemTitle(item)));
    body.appendChild(el('div', 'shopitem__desc', t(`item.${item.id}.desc` as MessageKey)));
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
        title: t('shop.testTitle'),
        bodyHtml: t('shop.testBody', {
          title: escapeHtml(productTitle(product)),
          price: escapeHtml(this.payments.displayPrice(product.id)),
        }),
        inlineButtons: true,
        buttons: [
          { label: t('common.cancel'), kind: 'ghost', onClick: () => decide(false) },
          { label: t('shop.buy'), kind: 'success', onClick: () => decide(true) },
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
        this.toast.show(t('shop.failed'), 'error', 3200);
      } else if (result.reason === 'unavailable') {
        this.toast.show(t('shop.notAvailable'), 'warn');
      }
      return; // cancelled: stay quiet, the player changed their mind
    }

    await this.settlePurchase(result.productId, result.token);

    audio.play('unlock');
    haptic([15, 40, 25], 'success');
    this.confetti.burst(1);
    this.toast.show(t('shop.addedEnjoy', { title: productTitle(product) }), 'info', 2600);
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

  /**
   * A purchase the store completed while the sheet was not up (interrupted
   * checkout, Ask to Buy approved later): deliver it like a restored one.
   */
  private async settleLatePurchase(p: PendingPurchase): Promise<void> {
    if (!(await this.settlePurchase(p.productId, p.token))) return;
    this.analytics.track({ type: 'iap_restored', count: 1 });
    this.toast.show(tp('shop.restored', 1), 'info', 3200);
    if (this.current === 'shop') this.renderShop();
    else if (this.current === 'home') this.renderHome();
    else if (this.current === 'game') this.updateHud();
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
      this.toast.show(tp('shop.restored', restored), 'info', 3200);
      if (this.current === 'shop') this.renderShop();
      else if (this.current === 'home') this.renderHome();
      else if (this.current === 'game') this.updateHud();
    }
  }

  private buyCoinItem(item: CoinShopItem): void {
    if (!this.save.trySpend(item.price)) {
      audio.play('invalid');
      this.toast.show(t('shop.notEnough', { n: item.price }), 'warn');
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
    this.toast.show(t('shop.added', { title: itemTitle(item) }), 'info', 1800);
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
    this.hudTier = 3;

    try {
      if (isEndless(id) || isDaily(id)) {
        // Generated on demand in the worker; usually well under a second, but a
        // cauldron deal on a slow phone can take a few, so say so.
        this.starting = true;
        const brewing = window.setTimeout(
          () => this.toast.show(t('toast.brewing'), 'info', 2600), 300,
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
      this.toast.show(t('toast.buildFailed'), 'error');
      return;
    }

    const maxExtra = this.remote.current.economy.maxExtraTubes;
    const restore = resume && isValidRestore(this.level, resume, maxExtra) ? resume : null;
    if (resume && !restore) this.save.setInProgress(null);

    this.attemptStartedAt = Date.now() - (restore?.elapsedMs ?? 0);
    this.uses = restore ? { ...restore.uses } : { undo: 0, hint: 0, bottle: 0 };
    this.extraTubes = restore?.extraTubes ?? 0;

    this.applySettings();
    // The equipped look is read from the save at every mount, so a skin bought
    // between levels (or restored from an old save) is never missed.
    this.board.setSkin(skinById(this.save.snapshot.cosmetics.skin));
    this.board.mount(
      this.level,
      this.save.snapshot.settings.colorblind,
      restore ? { board: restore.board, history: restore.history, hidden: restore.hidden } : undefined,
    );
    this.updateHud();
    this.show('game');

    if (restore) {
      this.toast.show(t('toast.continuing', { label: this.levelLabel(id) }), 'info', 1600);
    } else {
      const chapter = chapterFor(id);
      this.showLevelIntro(
        this.levelLabel(id),
        isDaily(id)
          ? formatLongDate(dateFromDay(dayFromDailyId(id)))
          : chapter
            ? chapter.name
            : this.level.spec.name,
      );
      this.save.bumpStat('plays');
      this.analytics.track({ type: 'level_start', level: id, attempt: this.attempt });
    }

    if (this.level.spec.lock && !this.save.snapshot.lockSeen) {
      this.save.update((d) => {
        d.lockSeen = true;
      });
      this.toast.show(tp('intro.lock', this.level.spec.lock.seals), 'info', 4600);
    }

    if (this.level.spec.oneWay && !this.save.snapshot.oneWaySeen) {
      this.save.update((d) => {
        d.oneWaySeen = true;
      });
      this.toast.show(t('intro.oneWay'), 'info', 4800);
    }

    if (isEndless(id) && !this.save.snapshot.endlessSeen) {
      this.save.update((d) => {
        d.endlessSeen = true;
      });
      this.toast.show(t('intro.endless'), 'info', 4200);
    }

    if (id === 1 && !this.save.snapshot.tutorialDone) {
      window.setTimeout(() => this.tutorial.start(), 700);
    }

    // One-time introductions of the twist mechanics, one idea at a time.
    if (this.level.spec.cauldron && !this.save.snapshot.cauldronSeen) {
      this.save.update((d) => {
        d.cauldronSeen = true;
      });
      this.toast.show(t('intro.cauldron'), 'info', 4200);
    } else if (this.level.spec.murky && !this.save.snapshot.murkySeen) {
      this.save.update((d) => {
        d.murkySeen = true;
      });
      this.toast.show(t('intro.murky'), 'info', 3800);
    }
  }

  private introTimer: number | null = null;

  /** Title card over the board as a level opens; skipped under reduced motion. */
  private showLevelIntro(title: string, sub: string): void {
    const node = $('#levelintro');
    if (this.introTimer !== null) {
      window.clearTimeout(this.introTimer);
      this.introTimer = null;
    }
    const reduced =
      this.save.snapshot.settings.reducedMotion ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) {
      node.hidden = true;
      return;
    }
    $('#levelintro-title').textContent = title;
    $('#levelintro-sub').textContent = sub;
    node.classList.remove('levelintro--out', 'levelintro--in');
    node.hidden = false;
    // Force a style flush so re-adding the class restarts the animation.
    void node.offsetWidth;
    node.classList.add('levelintro--in');
    this.introTimer = window.setTimeout(() => {
      node.classList.add('levelintro--out');
      this.introTimer = window.setTimeout(() => {
        node.hidden = true;
        this.introTimer = null;
      }, 380);
    }, 1350);
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
    heart.innerHTML = `<svg viewBox="0 0 100 92"><use href="#cf-heart-3d"/></svg><b></b>`;
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
    refillBtn.innerHTML = `${escapeHtml(t('lives.refill'))} ${COIN_ICON} ${formatNumber(refill.price)}`;
    content.appendChild(refillBtn);

    // Rewarded ad (native builds): a heart for a short video, the player's
    // choice. With it present the shop steps back to a quiet third option.
    const adsOn = this.ads.available;
    const adBtn = el('button', 'btn btn--primary btn--wide livesdlg__btn', t('ads.watchHeart'));
    adBtn.hidden = !adsOn;
    content.appendChild(adBtn);
    let adBusy = false;

    const shopBtn = el(
      'button', `btn ${adsOn ? 'btn--ghost' : 'btn--primary'} btn--wide livesdlg__btn`, t('lives.shop'),
    );
    content.appendChild(shopBtn);

    const refresh = () => {
      const lives = this.save.lives;
      const infinite = this.save.hasInfiniteLives;
      const full = infinite || lives.count >= LIVES_MAX;
      heartCount.textContent = infinite ? '∞' : String(lives.count);
      if (infinite) {
        label.textContent = t('lives.infinite');
        timerRow.hidden = false;
        timeText.textContent = formatCountdown(lives.infiniteUntil - Date.now());
      } else if (full) {
        label.textContent = t('lives.full');
        timerRow.hidden = true;
      } else {
        label.textContent = t('lives.next');
        timerRow.hidden = false;
        timeText.textContent = formatCountdown(lives.nextRegenAt - Date.now());
      }
      refillBtn.disabled = full || this.save.coins < refill.price;
      adBtn.disabled = full || adBusy;
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
    adBtn.addEventListener('click', () => {
      if (adBusy) return;
      adBusy = true;
      audio.play('button');
      adBtn.textContent = t('ads.loading');
      refresh();
      void this.ads.showRewarded('lives').then((outcome) => {
        adBusy = false;
        adBtn.textContent = t('ads.watchHeart');
        this.analytics.track({ type: 'ad_rewarded', placement: 'lives', outcome });
        if (outcome === 'rewarded') {
          this.save.addLives(this.remote.current.ads.rewardedLives);
          audio.play('powerup');
          haptic(14);
          this.toast.show(t('ads.rewardHeart'), 'info', 1800);
          refresh();
          if (retryLevel !== null && this.save.canPlay) {
            handedOff = true;
            this.modal.close();
            void this.startLevel(retryLevel);
          }
          return;
        }
        refresh();
        // Closed early: the player changed their mind, nothing to report.
        if (outcome !== 'dismissed') this.toast.show(t('ads.unavailable'), 'warn', 3000);
      });
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
      title: t('lives.title'),
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
    this.hudTier = 3;
    this.attemptStartedAt = Date.now();
    this.board.mount(this.level, this.save.snapshot.settings.colorblind);
    this.updateHud();
  }

  /** Why the tap did nothing; throttled so a frustrated triple-tap reads as one message. */
  private lockToastAt = 0;
  private explainLock(sealsLeft: number): void {
    const now = performance.now();
    if (now - this.lockToastAt < 2500) return;
    this.lockToastAt = now;
    this.toast.show(tp('toast.locked', sealsLeft), 'warn', 2200);
  }

  private oneWayToastAt = 0;
  private explainOneWay(): void {
    const now = performance.now();
    if (now - this.oneWayToastAt < 2500) return;
    this.oneWayToastAt = now;
    this.toast.show(t('toast.oneWay'), 'warn', 2600);
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
      this.toast.show(t('toast.stuckHint'), 'info', 2600);
    }
    void count;
  }

  private updateHud(): void {
    $('#game-coins').textContent = String(this.save.coins);
    $('#game-level-label').textContent = this.levelLabel(this.levelId);
    this.updateMoveBudget();

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

  /**
   * The live star budget in the level pill. Thresholds come from
   * starThresholds(par), the same function the win screen grades with, so the
   * pill can never promise a star the result then withholds.
   *
   * Three pips show the tier the player is *currently* holding and the label
   * counts down the pours left before it slips. On the bottom tier there is
   * nothing left to lose, so it falls back to the plain "ideal" line - as it
   * does inside the level-1 tutorial, which should teach pouring, not
   * efficiency.
   */
  private updateMoveBudget(): void {
    const moves = this.board.moveCount;
    const movesText = tp('hud.moves', moves);
    const par = this.level?.par;
    const pips = $('#game-star-pips');
    const label = $('#game-move-label');
    const row = $('#hud-budget');
    const risk = (last: boolean, edge: boolean): void => {
      row.classList.toggle('hudbudget--last', last);
      row.classList.toggle('hudbudget--edge', edge);
    };

    if (par === undefined || this.tutorial.active) {
      pips.hidden = true;
      risk(false, false);
      this.hudTier = 3;
      // "Ideal" is the proven minimum pours for this level (par, in golf terms
      // - but most players do not know the golf term).
      label.textContent = t('hud.line', { moves: movesText, ideal: par ?? '-' });
      return;
    }

    const th = starThresholds(par);
    const tier = starsFor(moves, par);
    const spare = tier === 3 ? th.three - moves : tier === 2 ? th.two - moves : -1;

    pips.hidden = false;
    // Colour follows the same thresholds as the wording, so the row warns at a
    // glance instead of only on a read.
    risk(spare === 1, spare === 0);
    const stars = pips.querySelectorAll('i');
    stars.forEach((s, i) => s.classList.toggle('on', i < tier));

    // `spare` is how many further pours still keep this tier, so 0 means the
    // next one costs it - not that one is left.
    label.textContent =
      spare < 0
        ? t('hud.line', { moves: movesText, ideal: par })
        : spare === 0
          ? t('hud.budgetEdge', { moves: movesText })
          : spare === 1
            ? t('hud.budgetLast', { moves: movesText })
            : t('hud.budget', { moves: movesText, n: spare });

    if (tier < this.hudTier) {
      // The star just slipped: one short pulse so the loss is felt, not merely
      // read. Removing the class and reading offsetWidth restarts a running
      // animation, otherwise two quick losses only play once.
      pips.classList.remove('hudbudget__pips--drop');
      void pips.offsetWidth;
      pips.classList.add('hudbudget__pips--drop');
    }
    this.hudTier = tier;
  }

  private remainingUses(id: PowerupId): number {
    return Math.max(0, this.remote.current.economy.freeUses[id] - this.uses[id]);
  }

  private async usePowerup(id: PowerupId): Promise<void> {
    if (this.board.isBusy) return;
    // A hint already being solved: a second tap must not spend another use.
    if (id === 'hint' && this.hintPending) return;

    // Spend order: free allowance, then shop-bought stock. Out of both means
    // an offer (rewarded ad where available) or the shop - powerups are never
    // silently charged to coins.
    let source: 'free' | 'owned';
    if (this.remainingUses(id) > 0) {
      source = 'free';
    } else if (this.save.tryUseInventory(id)) {
      source = 'owned';
    } else {
      this.offerPowerup(id);
      return;
    }

    let applied = false;
    switch (id) {
      case 'undo':
        applied = this.board.undo();
        if (!applied) this.toast.show(t('powerup.nothingToUndo'), 'info', 1400);
        break;
      case 'hint': {
        // Solved in the worker; the board may move on meanwhile, in which
        // case showHint resolves false and the use is refunded below. A deep
        // board can take a second or more on a phone, so the button shows it
        // is thinking rather than looking dead.
        const button = $<HTMLButtonElement>('#btn-hint');
        this.hintPending = true;
        button.classList.add('power--busy');
        try {
          applied = await this.board.showHint();
        } finally {
          this.hintPending = false;
          button.classList.remove('power--busy');
        }
        if (applied) this.save.bumpStat('hintsUsed');
        else this.toast.show(t('powerup.noHint'), 'warn', 3000);
        break;
      }
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

  /**
   * Out of a powerup - free uses and stock both gone. Where ads exist the
   * player may watch one for a single use, with the shop as the second
   * choice; elsewhere the shop opens directly. On a dead-ended board the
   * No-moves dialog returns if nothing was gained, so the player is never
   * left staring at a lost board with no way out.
   */
  private offerPowerup(id: PowerupId): void {
    const name = powerupLabel(id);
    audio.play('invalid');
    if (!this.ads.available) {
      this.toast.show(t('powerup.out', { name }), 'warn', 2400);
      this.openShop('powerup');
      return;
    }
    const backToBoard = () => {
      if (this.current === 'game' && this.board.isLost && !this.modal.isOpen) this.showStuckDialog();
    };
    this.modal.open({
      title: t('ads.outTitle', { name }),
      bodyHtml: escapeHtml(t('ads.outBody')),
      inlineButtons: false,
      buttons: [
        {
          label: t('ads.watchPowerup', { name }),
          kind: 'success',
          onClick: () => {
            void this.rewardPowerup(id).then(backToBoard);
          },
        },
        { label: t('ads.shop'), kind: 'primary', onClick: () => this.openShop('powerup') },
        // The dialog is still closing when onClick runs; re-check after it is gone.
        { label: t('common.cancel'), kind: 'ghost', onClick: () => void window.setTimeout(backToBoard, 0) },
      ],
    });
  }

  /** Watch for one use, then spend it straight away - that is what the tap asked for. */
  private async rewardPowerup(id: PowerupId): Promise<void> {
    const outcome = await this.ads.showRewarded(id);
    this.analytics.track({ type: 'ad_rewarded', placement: id, outcome });
    if (outcome === 'rewarded') {
      this.save.addInventory(id, 1);
      audio.play('powerup');
      haptic(14);
      this.toast.show(t('ads.rewardPowerup', { name: powerupLabel(id) }), 'info', 1800);
      this.updateHud();
      if (this.current === 'game') await this.usePowerup(id);
    } else if (outcome !== 'dismissed') {
      this.toast.show(t('ads.unavailable'), 'warn', 3000);
    }
  }

  /**
   * Interstitial gate on the way out of a win screen. Campaign and endless
   * wins count; the daily and the tutorial never do, and a player who has
   * ever paid is never interrupted (the policy lives in Ads.ts). The next
   * step runs after the ad closes, or at once when there is none.
   */
  private async afterWinAd(next: () => void): Promise<void> {
    const level = this.levelId;
    const outcome = await this.ads.maybeShowInterstitial({
      level,
      payer: this.save.hasEverPurchased,
      eligible: !isDaily(level) && this.save.snapshot.tutorialDone,
      cfg: this.remote.current.ads,
    });
    if (outcome !== 'skipped') this.analytics.track({ type: 'ad_interstitial', level, outcome });
    next();
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
    const eco = this.remote.current.economy;
    const daily = isDaily(this.levelId);
    const day = daily ? dayFromDailyId(this.levelId) : 0;
    const before = daily ? this.save.dailyRecord(day) : this.save.levelRecord(this.levelId);
    // Support unlocks store a sentinel; treat those as "no real best yet".
    const prevBest = before && before.bestMoves < 100_000 ? before.bestMoves : null;
    // Daily clears are recorded in their own section, never in the campaign map.
    const cleared = daily
      ? this.save.recordDailyClear(day, stars, moves)
      : this.save.recordClear(this.levelId, stars, moves);
    const { prevStars, isFirstClear } = cleared;
    // Replays only pay for newly earned stars - see coinsFor.
    let reward = coinsFor(stars, prevStars, eco);
    // First clear of a chapter's last level: the chapter is complete.
    const chapterDone =
      !daily && isFirstClear && isChapterEnd(this.levelId) ? chapterFor(this.levelId) : null;
    const chapterBonus = chapterDone ? eco.chapterBonus : 0;
    // First clear of today's challenge: the daily bonus, and the streak moves.
    const dailyBonus = daily && isFirstClear ? eco.dailyBonus : 0;
    const dailyStreak = daily ? this.save.dailyStreak(todayDayNumber()) : 0;
    reward += chapterBonus + dailyBonus;
    this.save.addCoins(reward);
    if (chapterDone) this.analytics.track({ type: 'chapter_complete', chapter: chapterDone.index });
    if (daily && isFirstClear) this.analytics.track({ type: 'daily_complete', streak: dailyStreak });
    this.save.bumpStat('wins');
    if (stars === 3) this.save.bumpStat('perfects');
    this.save.recordWinForStreak();
    const streak = this.save.snapshot.stats.streak;
    this.checkAchievements();
    // Post the new star total. Cheap and idempotent: the service drops a score
    // it has already sent, and does nothing at all when the board is locked,
    // unavailable, or the player is signed out of the platform.
    if (leaderboardUnlocked(this.save.highestUnlocked(LEVEL_COUNT))) {
      void this.leaderboard.submit(this.save.campaignStars(LEVEL_COUNT));
    }

    this.tutorial.finish();
    audio.duckMusic(2.2);
    audio.play('win');
    haptic([20, 60, 30, 60, 40], 'success');
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
    const mode: WinMode = daily ? 'daily' : chapter ? 'campaign' : 'endless';
    const eyebrow = daily
      ? formatLongDate(dateFromDay(day))
      : chapter
        ? t('win.eyebrow.chapter', { n: chapter.index, name: chapter.name })
        : t('win.eyebrow.endless', { name: level.spec.name });
    window.setTimeout(
      () => this.showWinModal({
        stars, moves, seconds, reward, isLast, prevStars, prevBest, streak,
        par: level.par, eyebrow, chapterDone, chapterBonus, mode, dailyBonus, dailyStreak,
      }),
      620,
    );
  }

  // ---------------------------------------------------------- achievements
  /** Coins paid by achievements this session; lets the smoke test keep its economy sums exact. */
  private achievementCoins = 0;

  private achievementView() {
    const s = this.save.snapshot;
    let chaptersDone = 0;
    for (const c of CHAPTERS) {
      let all = true;
      for (let id = c.first; id <= c.last && all; id++) if (!this.save.levelRecord(id)) all = false;
      if (all) chaptersDone += 1;
    }
    return {
      wins: s.stats.wins,
      perfects: s.stats.perfects,
      pours: s.stats.pours,
      bestWinStreak: s.stats.bestStreak,
      bestDailyStreak: this.save.bestDailyStreak,
      campaignCleared: this.save.campaignCleared(LEVEL_COUNT),
      campaignStars: this.save.campaignStars(LEVEL_COUNT),
      chaptersDone,
      endlessCleared: this.save.endlessCleared(LEVEL_COUNT),
      campaignSize: LEVEL_COUNT,
    };
  }

  /** Award anything newly true. Each achievement pays once, ever. */
  private checkAchievements(): void {
    const fresh = unlockedAchievements(this.achievementView()).filter((id) => !this.save.hasAchievement(id));
    fresh.forEach((id, i) => {
      const a = achievementById(id);
      if (!a || !this.save.awardAchievement(id)) return;
      this.save.addCoins(a.coins);
      this.achievementCoins += a.coins;
      this.analytics.track({ type: 'achievement', id });
      // Staggered so several landing on one win read as a list, not a pile.
      window.setTimeout(() => {
        this.toast.show(t('achv.toast', { name: t(`achv.${a.id}.name` as MessageKey), n: a.coins }), 'info', 2600);
        audio.play('coin');
      }, 900 + i * 700);
    });
  }

  private showAchievementsDialog(): void {
    const view = this.achievementView();
    const content = el('div', 'achv');
    const done = ACHIEVEMENTS.filter((a) => this.save.hasAchievement(a.id)).length;
    content.appendChild(el('div', 'achv__count', t('achv.count', { n: done, total: ACHIEVEMENTS.length })));
    for (const a of ACHIEVEMENTS) {
      const earned = this.save.hasAchievement(a.id);
      const row = el('div', `achv__row${earned ? ' achv__row--done' : ''}`);
      row.appendChild(el('span', 'achv__badge', earned ? '🏅' : '🔒'));
      const text = el('div', 'achv__text');
      text.appendChild(el('div', 'achv__name', t(`achv.${a.id}.name` as MessageKey)));
      text.appendChild(el('div', 'achv__desc', t(`achv.${a.id}.desc` as MessageKey)));
      row.appendChild(text);
      row.appendChild(el('span', 'achv__coins', earned ? t('achv.earned') : `+${formatNumber(a.coins)}`));
      content.appendChild(row);
    }
    void view;
    this.modal.open({
      title: t('achv.title'),
      content,
      closeButton: true,
      buttons: [{ label: t('common.back'), kind: 'ghost', onClick: () => this.showProfileDialog() }],
    });
  }

  // ---------------------------------------------------------- login reward
  /**
   * First arrival at home each local day: the welcome-back reward. Once per
   * day, never over another dialog, never before a profile exists.
   */
  private maybeShowLoginReward(): void {
    if (!this.save.snapshot.profile) return;
    const today = todayDayNumber();
    if (this.save.loginClaimedToday(today)) return;
    window.setTimeout(() => {
      if (this.current !== 'home' || this.modal.isOpen) return;
      if (this.save.loginClaimedToday(today)) return;
      this.showLoginRewardDialog(today);
    }, 350);
  }

  private showLoginRewardDialog(today: number): void {
    const streak = this.save.loginStreakFor(today);
    const day = loginCycleDay(streak);
    const reward = loginRewardFor(streak);

    const content = el('div', 'login');
    content.appendChild(
      el('div', 'login__lead', streak > 1 ? t('login.dayN', { n: streak }) : t('login.welcome')),
    );
    // Four across then three, with the seventh doubled up: seven equal columns
    // left each tile too narrow to read on a phone, and day seven carries an
    // extra hearts bonus that needs the room.
    const tiles = el('div', 'login__tiles');
    for (let d = 1; d <= LOGIN_CYCLE; d++) {
      const tile = el('div', 'login__tile');
      if (d < day) tile.classList.add('login__tile--done');
      if (d === day) tile.classList.add('login__tile--today');
      if (d === LOGIN_CYCLE) tile.classList.add('login__tile--grand');
      tile.appendChild(el('small', '', t('login.day', { n: d })));

      const prize = el('span', 'login__prize');
      prize.appendChild(el('i', 'login__coin'));
      prize.appendChild(el('b', '', formatNumber(LOGIN_REWARDS[d - 1] as number)));
      if (d === LOGIN_CYCLE) {
        const heart = el('span', 'login__heart');
        heart.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#cf-heart"/></svg>`;
        prize.appendChild(heart);
      }
      tile.appendChild(prize);
      tiles.appendChild(tile);
    }
    content.appendChild(tiles);
    content.appendChild(el('div', 'login__hint', t('login.hint')));

    this.modal.open({
      title: t('login.title'),
      content,
      dismissable: false,
      buttons: [
        {
          label: t(reward.refillLives ? 'login.claimHearts' : 'login.claim', { n: reward.coins }),
          kind: 'success',
          onClick: () => {
            this.save.claimLogin(today);
            this.save.addCoins(reward.coins);
            if (reward.refillLives) this.save.refillLives();
            audio.play('coin');
            haptic([12, 30, 20], 'success');
            this.confetti.burst(1);
            this.analytics.track({ type: 'login_reward', day, coins: reward.coins });
            this.renderHome();
          },
        },
      ],
    });
  }

  /**
   * The win screen answers four questions in order: how well did I do
   * (stars, with the middle one raised), what did I earn and why (coins
   * counting up, with the breakdown), what would make it better (the exact
   * move count for the next star, or "Perfect!"), and what's next (one big
   * green button; replay and home as quiet options).
   */
  /**
   * The daily result as a few lines of plain text, the way word games are
   * shared: date, stars, moves against the proven ideal, streak, link. The
   * ideal is the hook - no other sort game can print one it has proven.
   */
  private dailyShareText(w: { stars: number; moves: number; par: number; dailyStreak: number }): string {
    const day = dayFromDailyId(this.levelId);
    const stars = '★'.repeat(w.stars) + '☆'.repeat(3 - w.stars);
    const lines = [
      t('share.headline', { date: formatLongDate(dateFromDay(day)) }),
      t('share.result', { stars, moves: tp('hud.moves', w.moves), ideal: w.par }),
    ];
    if (w.stars === 3) lines[1] += ` · ${t('win.perfect')}`;
    if (w.dailyStreak > 1) lines.push(t('daily.streak', { n: w.dailyStreak }));
    lines.push(window.location.origin + window.location.pathname);
    return lines.join('\n');
  }

  /**
   * Native share sheet where the browser has one (phones), otherwise the
   * clipboard, otherwise a dialog with the text selected for a manual copy.
   * A dismissed share sheet is not an error and says nothing.
   */
  /** The last share text built, for the smoke test (clipboard reads are unreliable headless). */
  private lastShareText = '';

  /** A hint request is in the worker; guards against double-spending on a second tap. */
  private hintPending = false;

  private async shareDailyResult(w: { stars: number; moves: number; par: number; dailyStreak: number }): Promise<void> {
    const text = this.dailyShareText(w);
    this.lastShareText = text;
    const nav = navigator as Navigator & { share?: (data: { text: string }) => Promise<void> };
    if (typeof nav.share === 'function') {
      try {
        await nav.share({ text });
        this.analytics.track({ type: 'daily_share', stars: w.stars, streak: w.dailyStreak, method: 'share' });
      } catch (err) {
        if ((err as { name?: string }).name !== 'AbortError') this.toast.show(t('share.failed'), 'warn');
      }
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      this.toast.show(t('share.copied'));
      this.analytics.track({ type: 'daily_share', stars: w.stars, streak: w.dailyStreak, method: 'copy' });
    } catch {
      // No clipboard access: show the text so it can be copied by hand. The
      // win modal is replaced; Back reopens nothing, home is a tap away.
      const box = el('textarea', 'field__input share__text');
      box.value = text;
      box.readOnly = true;
      box.rows = 5;
      this.modal.open({
        title: t('share.button'),
        content: box,
        buttons: [{ label: t('common.done'), kind: 'primary', onClick: () => this.quitToHome() }],
      });
      box.focus({ preventScroll: true });
      box.select();
    }
  }

  private showWinModal(w: {
    stars: number; moves: number; seconds: number; reward: number; isLast: boolean;
    prevStars: number | null; prevBest: number | null; streak: number;
    par: number; eyebrow: string; chapterDone: Chapter | null; chapterBonus: number;
    mode: WinMode; dailyBonus: number; dailyStreak: number;
  }): void {
    const eco = this.remote.current.economy;
    const reduced =
      this.save.snapshot.settings.reducedMotion ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const content = el('div', 'win');

    content.appendChild(el('div', 'win__name', w.eyebrow));

    // Chapter complete: a gold ribbon, and a peek at where the story goes next.
    if (w.chapterDone) {
      const ribbon = el('div', 'win__chapter', t('win.chapterDone', { n: w.chapterDone.index }));
      const next = chapterFor(w.chapterDone.last + 1);
      ribbon.appendChild(
        el('small', '', next ? t('win.nextChapter', { name: next.name }) : t('win.grandElixir')),
      );
      content.appendChild(ribbon);
    }

    // Stars in an arc; unearned ones stay as dim outlines so 2/3 reads at a glance.
    // A slowly turning sunburst sits behind them.
    const starRow = el('div', 'stars stars--arc');
    starRow.appendChild(el('div', 'win__burst'));
    const starEls: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
      const s = el('i', '', '★');
      starRow.appendChild(s);
      starEls.push(s);
    }
    content.appendChild(starRow);

    // Verdict: celebrate a perfect, otherwise say exactly what the next star needs.
    if (w.stars === 3) {
      // Inner span carries the gradient text clip; the wrapper carries the filter
      // (WebKit paints the two on one element as a solid box).
      const perfect = el('div', 'perfect');
      perfect.appendChild(el('span', undefined, t('win.perfect')));
      content.appendChild(perfect);
    } else {
      const th = starThresholds(w.par);
      const need = w.stars === 2 ? th.three : th.two;
      content.appendChild(el('div', 'win__verdict', t('win.verdict', { n: need, stars: w.stars + 1 })));
    }

    // Reward, with how it was earned. Replays that add no stars say so plainly.
    if (w.reward > 0) {
      const card = el('div', 'win__reward');
      const big = el('div', 'win__coins');
      big.innerHTML = `<span class="chip__icon chip__icon--coin"></span><b>+0</b>`;
      card.appendChild(big);
      const parts: string[] = [];
      if (w.prevStars === null) {
        parts.push(t('win.cleared', { n: eco.baseReward }));
        parts.push(tp('win.stars', w.stars, { coins: w.stars * eco.rewardPerStar }));
        if (eco.firstClearBonus > 0) parts.push(t('win.firstClear', { n: eco.firstClearBonus }));
      } else {
        const gained = Math.max(0, w.stars - w.prevStars);
        parts.push(tp('win.newStars', gained, { coins: w.reward - w.chapterBonus - w.dailyBonus }));
      }
      if (w.chapterBonus > 0) parts.push(t('win.chapterBonus', { n: w.chapterBonus }));
      if (w.dailyBonus > 0) parts.push(t('win.dailyBonus', { n: w.dailyBonus }));
      card.appendChild(el('div', 'win__breakdown', parts.join(' · ')));
      content.appendChild(card);
      const counter = big.querySelector('b') as HTMLElement;
      const startAt = reduced ? 0 : 180 + 3 * 260;
      // When the count lands, coins fountain up out of the reward card.
      const shower = (): void => {
        const r = card.getBoundingClientRect();
        if (r.width > 0) this.confetti.coins(r.left + r.width / 2, r.top + r.height / 2);
      };
      window.setTimeout(
        () => this.countUp(counter, w.reward, reduced ? 0 : 700, reduced ? undefined : shower),
        startAt,
      );
    } else {
      content.appendChild(el('div', 'win__note', t('win.allStars')));
    }

    // Stats, with a "New best" tag when the move count improved.
    const stats = el('div', 'statgrid statgrid--4');
    const time = w.seconds >= 60
      ? `${Math.floor(w.seconds / 60)}:${String(w.seconds % 60).padStart(2, '0')}`
      : `${w.seconds}s`;
    const isNewBest = w.prevBest !== null && w.moves < w.prevBest;
    const bestShown = w.prevBest === null ? w.moves : Math.min(w.prevBest, w.moves);
    stats.innerHTML = `
      <div><b>${w.moves}</b><span>${escapeHtml(t('win.moves'))}</span></div>
      <div><b>${w.par}</b><span>${escapeHtml(t('win.ideal'))}</span></div>
      <div><b>${time}</b><span>${escapeHtml(t('win.time'))}</span></div>
      <div class="${isNewBest ? 'statgrid__best' : ''}"><b>${bestShown}</b><span>${escapeHtml(t(isNewBest ? 'win.newBest' : 'win.best'))}</span></div>`;
    content.appendChild(stats);

    // Progress through the campaign (or the endless tally), plus the streak
    // when there is one worth showing.
    const meta = el('div', 'win__meta');
    if (w.mode === 'daily') {
      // The daily's progress *is* the streak.
      meta.appendChild(
        el('span', 'win__streak',
          w.dailyStreak > 1 ? t('daily.streak', { n: w.dailyStreak }) : t('daily.streakStarted')),
      );
    } else {
      const endless = w.mode === 'endless';
      const cleared = endless
        ? this.save.endlessCleared(LEVEL_COUNT)
        : this.save.campaignCleared(LEVEL_COUNT);
      const progress = el('div', 'win__progress');
      progress.innerHTML = endless
        ? `<span class="win__progress-label">${escapeHtml(tp('win.endlessCleared', cleared))}</span>`
        : `<span class="win__progress-track"><i style="width:${Math.round((cleared / LEVEL_COUNT) * 100)}%"></i></span>` +
          `<span class="win__progress-label">${escapeHtml(t('win.progress', { n: cleared, total: LEVEL_COUNT }))}</span>`;
      meta.appendChild(progress);
      if (w.streak >= 2) meta.appendChild(el('span', 'win__streak', t('win.inARow', { n: w.streak })));
    }
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
    if (w.mode === 'daily') {
      // There is no "next" daily until tomorrow: home is the way on.
      actions.appendChild(act(t('common.home'), 'btn btn--success btn--wide win__next', () => this.quitToHome()));
      const row = el('div', 'modal__row');
      // Share keeps the win screen open: the player comes back to it after the share sheet.
      const share = el('button', 'btn btn--ghost win__share', t('share.button'));
      share.addEventListener('click', () => {
        audio.play('button');
        void this.shareDailyResult(w);
      });
      row.appendChild(share);
      row.appendChild(act(t('common.replay'), 'btn btn--ghost', () => this.restartLevel()));
      actions.appendChild(row);
    } else {
      // The campaign finale leads into endless mode; everything else leads to the next level.
      // Every way off this screen passes the interstitial gate (afterWinAd).
      const nextLabel = w.isLast ? t('win.startEndless') : t('win.nextLevel');
      actions.appendChild(
        act(nextLabel, 'btn btn--success btn--wide win__next', () => {
          void this.afterWinAd(() => void this.startLevel(this.levelId + 1));
        }),
      );
      const row = el('div', 'modal__row');
      row.appendChild(
        act(t('common.replay'), 'btn btn--ghost', () => void this.afterWinAd(() => this.restartLevel())),
      );
      row.appendChild(
        act(t('common.home'), 'btn btn--ghost', () => void this.afterWinAd(() => this.quitToHome())),
      );
      actions.appendChild(row);
    }
    content.appendChild(actions);

    const dialog = this.modal.open({
      title: w.isLast
        ? t('win.titleAll', { n: LEVEL_COUNT })
        : t('win.title', { label: this.levelLabel(this.levelId) }),
      content,
      dismissable: false,
      // The board is finished and blurred behind the dialog; stop rendering
      // it. The win moment otherwise runs two full-screen canvases (board +
      // confetti) under a backdrop blur - the heaviest frame in the game on a
      // phone. Whatever screen comes next decides whether the loop resumes.
      onClose: () => this.stage.setPaused(this.current !== 'game' || document.hidden),
    });
    this.stage.setPaused(true);
    dialog.classList.add('modal--win');

    // Confetti rains over the dialog itself; a perfect run or a finished
    // chapter gets the big burst.
    this.confetti.burst(w.stars === 3 || w.chapterDone ? 2 : 1);

    // Ring the stars in one at a time so the score lands as a moment. The
    // third star of a perfect gets a flash and a second volley.
    starEls.forEach((node, i) => {
      window.setTimeout(() => {
        node.classList.add('pop');
        if (i < w.stars) {
          node.classList.add('on');
          audio.play('star', i);
          haptic(i === 2 ? 30 : 14);
          if (i === 2) {
            this.confetti.flash();
            this.confetti.burst(2);
          }
        }
      }, 180 + i * 260);
    });

    window.setTimeout(() => audio.play(w.stars === 3 ? 'fanfare' : 'unlock'), 180 + 3 * 260 + 200);
  }

  /** Roll a "+N" counter up to its value with coin ticks along the way. */
  private countUp(node: HTMLElement, to: number, ms: number, onDone?: () => void): void {
    if (ms <= 0) {
      node.textContent = `+${to}`;
      onDone?.();
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
        onDone?.();
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
    this.toast.show(t('toast.noWin'), 'warn', 3400);
  }

  private onStuck(): void {
    audio.play('stuck');
    haptic([30, 80, 30], 'error');
    this.analytics.track({ type: 'level_stuck', level: this.levelId, moves: this.board.moveCount });
    this.showStuckDialog();
  }

  private showStuckDialog(): void {
    this.modal.open({
      title: t('stuck.title'),
      bodyHtml: escapeHtml(t('stuck.body')),
      inlineButtons: false,
      buttons: [
        {
          label: t('stuck.undo'),
          kind: 'primary',
          onClick: () => {
            void this.usePowerup('undo');
          },
        },
        {
          label: t('stuck.bottle'),
          kind: 'ghost',
          onClick: () => {
            void this.usePowerup('bottle');
          },
        },
        {
          label: this.heartCostLabel(t('stuck.restart')),
          kind: 'ghost',
          onClick: () => {
            // Restarting out of a dead end is a failed attempt.
            this.loseLife('failed');
            this.restartLevel();
          },
        },
        ...(this.canSkip ? [this.skipButton()] : []),
      ],
      dismissable: false,
    });
  }

  /** Whether giving up on the current board right now would cost a heart. */
  private get heartAtStake(): boolean {
    return this.board.isLost && !this.tutorial.active && !this.save.hasInfiniteLives;
  }

  private heartCostLabel(label: string): string {
    return this.heartAtStake ? t('heart.cost', { label }) : label;
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

  // ------------------------------------------------------------------ skip
  /**
   * Skip is offered on campaign and endless levels, never on the daily (one
   * board per day, nothing to skip to) and never inside the tutorial.
   */
  private get canSkip(): boolean {
    return !isDaily(this.levelId) && !this.tutorial.active && !this.board.isResolved;
  }

  /**
   * Pay coins to move on without clearing. Costs no heart (nothing was
   * failed), records no clear, and the level stays on the map to come back
   * to. Without enough coins the shop opens and nothing is charged.
   */
  private skipLevel(): void {
    if (!this.canSkip) return;
    const price = this.remote.current.economy.skipPrice;
    if (!this.save.trySpend(price)) {
      audio.play('invalid');
      this.toast.show(t('shop.notEnough', { n: price }), 'warn');
      this.openShop('skip');
      return;
    }
    this.analytics.track({
      type: 'level_skip', level: this.levelId, moves: this.board.moveCount, price,
    });
    this.save.skipLevel(this.levelId);
    this.save.setInProgress(null);
    this.toast.show(t('skip.done'));
    void this.startLevel(this.levelId + 1);
  }

  private skipButton(): { label: string; kind: 'ghost'; onClick: () => void } {
    return {
      label: t('skip.button', { n: this.remote.current.economy.skipPrice }),
      kind: 'ghost',
      onClick: () => this.skipLevel(),
    };
  }

  // --------------------------------------------------------------- dialogs
  private confirmQuit(): void {
    if (this.board.moveCount === 0 || this.board.isResolved) {
      this.quitToHome();
      return;
    }
    const body = this.heartAtStake ? t('quit.bodyLost') : t('quit.body');
    this.modal.open({
      title: t('quit.title'),
      bodyHtml: escapeHtml(body),
      inlineButtons: true,
      buttons: [
        { label: t('quit.stay'), kind: 'ghost' },
        {
          label: t('quit.leave'),
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
    const body = this.heartAtStake ? t('restart.bodyLost') : t('restart.body');
    const restart = {
      label: t('restart.restart'),
      kind: 'primary' as const,
      onClick: () => {
        // Same rule as the stuck dialog: only a lost board costs a heart.
        this.loseLife('failed');
        this.restartLevel();
      },
    };
    const cancel = { label: t('common.cancel'), kind: 'ghost' as const };
    // With a skip on offer the three actions stack; a plain restart stays a two-button row.
    this.modal.open({
      title: t('restart.title'),
      bodyHtml: escapeHtml(body),
      inlineButtons: !this.canSkip,
      buttons: this.canSkip ? [restart, this.skipButton(), cancel] : [cancel, restart],
    });
  }

  /** Profile card: identity, campaign progress and lifetime stats. */
  private showProfileDialog(): void {
    const s = this.save.snapshot;
    const stats = s.stats;

    const content = el('div', 'profdlg');

    const head = el('div', 'profdlg__head');
    const face = el('span', 'profdlg__avatar');
    renderAvatar(face, s.profile?.avatar);
    head.appendChild(face);
    const who = el('div', 'profdlg__who');
    who.appendChild(el('div', 'profdlg__name', s.profile?.name || t('prof.guest')));
    who.appendChild(
      el('div', 'profdlg__level', t('level.n', { n: this.save.highestUnlocked(LEVEL_COUNT) })),
    );
    head.appendChild(who);
    // Edit lives on the card, next to what it edits, instead of as a big button below.
    const edit = el('button', 'btn btn--ghost btn--compact', t('prof.changeLook'));
    edit.addEventListener('click', () => {
      audio.play('button');
      // Enter the editor first so closing the dialog keeps its history guard.
      this.editProfile();
      this.modal.close();
    });
    head.appendChild(edit);
    content.appendChild(head);

    const grid = el('div', 'profdlg__grid');
    const rows: Array<[string, string]> = [
      [t('prof.levels'), `${this.save.campaignCleared(LEVEL_COUNT)} / ${LEVEL_COUNT}`],
      [t('prof.stars'), `${this.save.campaignStars(LEVEL_COUNT)} / ${LEVEL_COUNT * 3}`],
      [t('prof.endless'), String(this.save.endlessCleared(LEVEL_COUNT))],
      [t('prof.daily'), t('prof.dailyValue', { n: this.save.dailyStreak(todayDayNumber()), best: this.save.bestDailyStreak })],
      [t('prof.perfects'), formatNumber(stats.perfects)],
      [t('prof.winStreak'), String(stats.bestStreak)],
      [t('prof.pours'), formatNumber(stats.pours)],
      [t('prof.achievements'), `${s.achievements.length} / ${ACHIEVEMENTS.length}`],
    ];
    for (const [label, value] of rows) {
      const cell = el('div', 'profdlg__stat');
      cell.appendChild(el('b', '', value));
      cell.appendChild(el('span', '', label));
      grid.appendChild(cell);
    }
    content.appendChild(grid);

    // Two quiet actions side by side; Settings has its own gear on every screen.
    this.modal.open({
      title: t('prof.title'),
      content,
      closeButton: true,
      inlineButtons: true,
      buttons: [
        { label: t('prof.achievements'), kind: 'ghost', onClick: () => this.showAchievementsDialog() },
        { label: t('prof.howto'), kind: 'ghost', onClick: () => this.showHowTo() },
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
      child.setAttribute('aria-checked', String((child as HTMLElement).dataset.avatar === this.chosenAvatar));
    }
    // Editing an existing look: "play as guest" belongs to first run only, and
    // the primary action saves rather than starts.
    this.editingProfile = true;
    $<HTMLButtonElement>('#btn-guest').hidden = true;
    $('#btn-start-profile').textContent = t('profile.save');
    this.show('profile');
  }

  /** True while the look-picker is open to change an existing profile. */
  private editingProfile = false;

  /**
   * Settings, in the order a player scans them: who they are, the things
   * they change often (sound, language), accessibility, privacy, then help
   * and the one destructive action at the very bottom. Rare support tooling
   * (support ID, code redemption) lives one tap deeper in its own dialog.
   */
  private openSettings(): void {
    const s = this.save.snapshot.settings;
    const content = el('div');

    // Identity header - the same card the profile dialog uses, compacted.
    const profile = this.save.snapshot.profile;
    const head = el('div', 'profdlg__head profdlg__head--compact');
    const face = el('span', 'profdlg__avatar');
    renderAvatar(face, profile?.avatar);
    head.appendChild(face);
    const who = el('div', 'profdlg__who');
    who.appendChild(el('div', 'profdlg__name', profile?.name || t('prof.guest')));
    who.appendChild(
      el('div', 'profdlg__level', t('level.n', { n: this.save.highestUnlocked(LEVEL_COUNT) })),
    );
    head.appendChild(who);
    const edit = el('button', 'btn btn--ghost btn--compact', t('prof.changeLook'));
    edit.addEventListener('click', () => {
      audio.play('button');
      this.editProfile();
      this.modal.close();
    });
    head.appendChild(edit);
    content.appendChild(head);

    type Toggle = 'sfx' | 'music' | 'haptics' | 'colorblind' | 'reducedMotion' | 'analytics';
    const toggleRow = (key: Toggle, label: string, desc: string): HTMLElement => {
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
        const next = !this.save.snapshot.settings[key];
        this.save.update((d) => {
          d.settings[key] = next;
        });
        toggle.setAttribute('aria-checked', String(next));
        this.applySettings();
        if (key === 'colorblind') this.board.setColorblind(next);
        audio.play('button');
      });
      row.appendChild(toggle);
      return row;
    };

    // Switch order matters to the smoke test (it addresses them by index):
    // sfx, music, haptics, colourblind, reduced motion, analytics.
    content.appendChild(toggleRow('sfx', t('settings.sfx'), t('settings.sfxDesc')));
    content.appendChild(toggleRow('music', t('settings.music'), t('settings.musicDesc')));
    content.appendChild(toggleRow('haptics', t('settings.haptics'), t('settings.hapticsDesc')));
    content.appendChild(this.buildLanguageRow());

    content.appendChild(el('div', 'modal__subhead', t('settings.accessibility')));
    content.appendChild(toggleRow('colorblind', t('settings.colorblind'), t('settings.colorblindDesc')));
    content.appendChild(
      toggleRow('reducedMotion', t('settings.reducedMotion'), t('settings.reducedMotionDesc')),
    );

    content.appendChild(el('div', 'modal__subhead', t('settings.privacy')));
    content.appendChild(toggleRow('analytics', t('settings.analytics'), t('settings.analyticsDesc')));
    content.appendChild(
      this.actionRow(t('support.privacy'), t('support.privacyDesc'), t('support.view'), 'ghost', () =>
        void this.showPrivacyPolicy(() => this.openSettings()),
      ),
    );
    // EEA/UK law: consent given to the ads SDK must stay revisitable.
    if (this.ads.privacyOptionsRequired) {
      content.appendChild(
        this.actionRow(t('ads.privacy'), t('ads.privacyDesc'), t('ads.privacyBtn'), 'ghost', () =>
          void this.ads.showPrivacyOptions(),
        ),
      );
    }

    content.appendChild(el('div', 'modal__subhead', t('cloud.head')));
    for (const row of this.buildCloudRows()) content.appendChild(row);

    content.appendChild(el('div', 'modal__subhead', t('support.head')));
    content.appendChild(
      this.actionRow(t('support.head'), t('support.rowDesc'), t('support.open'), 'ghost', () =>
        this.openSupportDialog(),
      ),
    );
    content.appendChild(
      this.actionRow(t('support.reset'), t('support.resetDesc'), t('support.resetBtn'), 'danger', () =>
        this.confirmResetProgress(),
      ),
    );

    this.modal.open({
      title: t('common.settings'),
      content,
      buttons: [
        { label: t('prof.howto'), kind: 'ghost', onClick: () => this.showHowTo() },
        { label: t('common.done'), kind: 'primary' },
      ],
    });
  }

  /** Language picker: device default or any shipped locale. Applies with a reload. */
  private buildLanguageRow(): HTMLElement {
    const row = el('div', 'setting');
    const text = el('div');
    text.appendChild(el('div', 'setting__label', t('settings.language')));
    text.appendChild(el('div', 'setting__desc', t('settings.languageDesc')));
    row.appendChild(text);

    const select = el('select', 'field__input field__input--select');
    select.setAttribute('aria-label', t('settings.language'));
    const auto = el('option', '', t('settings.languageAuto'));
    auto.value = 'auto';
    select.appendChild(auto);
    for (const loc of SUPPORTED_LOCALES) {
      const opt = el('option', '', loc.name);
      opt.value = loc.code;
      select.appendChild(opt);
    }
    select.value = this.save.snapshot.settings.language;
    select.addEventListener('change', () => {
      this.save.update((d) => {
        d.settings.language = select.value;
      });
      this.save.flush();
      // Every screen holds rendered text; a reload is the honest way to redraw it all.
      window.location.reload();
    });
    row.appendChild(select);
    return row;
  }

  // ------------------------------------------------------------- support
  /**
   * The privacy policy, read inside the game. The same `privacy.html` the
   * store listings link to is fetched (the service worker precaches it, so
   * this works offline) and its article is shown in a scrollable dialog;
   * "Open in browser" remains for anyone who wants the standalone page.
   * `onBack` reopens whatever dialog the player came from.
   */
  private async showPrivacyPolicy(onBack?: () => void): Promise<void> {
    let article: HTMLElement | null = null;
    try {
      const res = await fetch('./privacy.html', { cache: 'no-cache' });
      if (res.ok) {
        const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
        const main = doc.querySelector('main');
        if (main) {
          // The dialog supplies the title; the page's own back link is meaningless here.
          main.querySelector('h1')?.remove();
          main.querySelector('a.back')?.remove();
          article = el('div', 'policy');
          // App-authored, same-origin HTML - never player input.
          article.innerHTML = main.innerHTML;
        }
      }
    } catch {
      article = null;
    }
    const content = article ?? el('p', 'panel__hint', t('support.privacyUnavailable'));
    this.modal.open({
      title: t('support.privacy'),
      content,
      buttons: [
        {
          label: t('support.openBrowser'),
          kind: 'ghost',
          onClick: () => {
            window.open('./privacy.html', '_blank', 'noopener');
            return false;
          },
        },
        { label: onBack ? t('common.back') : t('common.gotIt'), kind: 'primary', onClick: onBack },
      ],
    });
  }

  // ------------------------------------------------------------ cloud save
  private buildCloudRows(): HTMLElement[] {
    const s = this.cloud.state;
    if (!s.available) {
      const row = el('div', 'setting');
      const text = el('div');
      text.appendChild(el('div', 'setting__label', t('cloud.title')));
      text.appendChild(el('div', 'setting__desc', t('cloud.unavailable')));
      row.appendChild(text);
      return [row];
    }
    const signedIn = s.account !== null;
    const desc = s.busy
      ? t('cloud.syncing')
      : !signedIn
        ? t('cloud.signedOut')
        : s.lastError
          ? t('cloud.error')
          : t('cloud.synced', { when: this.relativeTime(s.lastSyncAt), account: s.account ?? '' });
    const main = this.actionRow(
      t('cloud.title'), desc, signedIn ? t('cloud.syncNow') : t('cloud.signIn'), 'ghost',
      () => {
        const run = signedIn ? this.cloud.sync('manual') : this.cloud.signIn();
        void run.then((outcome) => {
          this.afterCloudOutcome(outcome, signedIn ? 'manual' : 'signin');
          if (this.current !== 'game' || this.modal.isOpen) this.openSettings();
        });
      },
    );
    if (s.busy) main.querySelector('button')?.setAttribute('disabled', '');
    const rows = [main];
    if (signedIn) {
      rows.push(
        this.actionRow(t('cloud.signOut'), t('cloud.signOutDesc'), t('cloud.signOut'), 'ghost', () => {
          void this.cloud.signOut().then(() => {
            this.toast.show(t('cloud.signedOutToast'));
            this.openSettings();
          });
        }),
      );
    }
    return rows;
  }

  /** Toasts, analytics and the post-restore reload for any sync result. */
  private afterCloudOutcome(outcome: SyncOutcome, reason: 'boot' | 'signin' | 'manual' | 'choice'): void {
    if (outcome.action !== 'unavailable' && outcome.action !== 'signed-out') {
      this.analytics.track({ type: 'cloud_sync', reason, result: outcome.action });
    }
    switch (outcome.action) {
      case 'uploaded':
        if (reason !== 'boot') this.toast.show(t('cloud.uploaded'));
        break;
      case 'noop':
        if (reason === 'manual') this.toast.show(t('cloud.upToDate'));
        break;
      case 'failed':
        if (reason !== 'boot') this.toast.show(t('cloud.error'), 'warn');
        break;
      case 'restored':
        // Every screen holds rendered state; a reload is the honest way to show the restored save.
        this.save.flush();
        this.toast.show(t('cloud.restored'), 'info', 1400);
        window.setTimeout(() => window.location.reload(), 900);
        break;
      default:
        break;
    }
  }

  /** Cloud ahead of real local progress: the player picks which copy survives. */
  private showCloudConflict(cloud: ProgressSummary, local: ProgressSummary): void {
    // Never over another dialog (login reward, win screen): wait for a quiet moment.
    if (this.modal.isOpen) {
      window.setTimeout(() => this.showCloudConflict(cloud, local), 800);
      return;
    }
    this.modal.open({
      title: t('cloud.found.title'),
      bodyHtml: t('cloud.found.body', {
        device: escapeHtml(cloud.device),
        cloud: escapeHtml(this.progressText(cloud)),
        local: escapeHtml(this.progressText(local)),
      }),
      dismissable: false,
      buttons: [
        {
          label: t('cloud.useCloud'),
          kind: 'primary',
          onClick: () => {
            void this.cloud.restoreFromCloud().then((o) => this.afterCloudOutcome(o, 'choice'));
          },
        },
        {
          label: t('cloud.keepDevice'),
          kind: 'ghost',
          onClick: () => {
            void this.cloud.keepLocal().then((o) => this.afterCloudOutcome(o, 'choice'));
          },
        },
      ],
    });
  }

  private progressText(p: ProgressSummary): string {
    return t('cloud.summary', {
      level: p.level, stars: formatNumber(p.stars), coins: formatNumber(p.coins),
      date: formatLongDate(new Date(p.updatedAt)),
    });
  }

  private relativeTime(at: number): string {
    if (!at) return t('cloud.justNow');
    const minutes = Math.round((Date.now() - at) / 60_000);
    if (minutes < 1) return t('cloud.justNow');
    if (minutes < 60) return tp('cloud.minutesAgo', minutes);
    const hours = Math.round(minutes / 60);
    if (hours < 24) return tp('cloud.hoursAgo', hours);
    return formatLongDate(new Date(at));
  }

  /** A settings row whose control is a compact button rather than a switch. */
  private actionRow(
    label: string,
    desc: string,
    action: string,
    kind: 'ghost' | 'danger',
    onClick: () => void,
  ): HTMLElement {
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
    return row;
  }

  /**
   * Help & support: the tools a player only needs after something went
   * wrong. Kept out of the main settings list so it stays scannable.
   */
  private openSupportDialog(): void {
    const content = el('div');
    const supportId = formatSupportId(this.save.supportId);

    content.appendChild(
      this.actionRow(t('support.contact'), t('support.contactDesc'), t('support.email'), 'ghost', () => {
        const level = this.save.highestUnlocked(LEVEL_COUNT);
        this.analytics.track({ type: 'support_email_open', level });
        window.location.href = supportMailto(this.save.supportId, level, SAVE_VERSION);
      }),
    );
    content.appendChild(
      this.actionRow(t('support.id'), supportId, t('support.copy'), 'ghost', () => {
        navigator.clipboard?.writeText(supportId).then(
          () => this.toast.show(t('support.copied')),
          () => this.toast.show(t('support.yourId', { id: supportId })),
        );
      }),
    );
    content.appendChild(
      this.actionRow(t('support.code'), t('support.codeDesc'), t('support.enter'), 'ghost', () =>
        this.openSupportCodeEntry(),
      ),
    );

    this.modal.open({
      title: t('support.head'),
      content,
      buttons: [{ label: t('common.back'), kind: 'ghost', onClick: () => this.openSettings() }],
    });
  }

  private openSupportCodeEntry(): void {
    const content = el('div');
    const input = el('input', 'field__input');
    input.placeholder = 'CF-XXXXX-XXXXX-XXXXX-XXXXX';
    input.autocapitalize = 'characters';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', t('support.code'));
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
        status.textContent = t(`support.err.${result.reason}`);
        haptic([12, 40, 12], 'error');
        return;
      }
      // A support-code reset is a deliberate wipe too: hold cloud uploads until the player decides.
      if (result.code.action === 'reset') this.cloud.markLocalReset();
      const applied = applySupportCode(result.code, this.save, LEVEL_COUNT);
      this.analytics.track({ type: 'support_code_redeemed', action: result.code.action });
      if (result.code.action === 'reset') {
        this.analytics.track({ type: 'progress_reset', source: 'support_code' });
      }
      this.modal.close();
      this.toast.show(t(`support.applied.${applied.action}`, { n: applied.param }));
      audio.play('win');
      if (applied.reload) {
        this.save.flush();
        window.setTimeout(() => window.location.reload(), 900);
      } else {
        this.refreshAfterSupportCode();
      }
    };

    this.modal.open({
      title: t('support.code'),
      content,
      inlineButtons: true,
      buttons: [
        { label: t('common.cancel'), kind: 'ghost', onClick: () => this.openSupportDialog() },
        {
          label: t('support.redeem'),
          kind: 'primary',
          onClick: () => {
            void redeem();
            return false; // stays open; redeem() closes it on success
          },
        },
      ],
    });
    window.setTimeout(() => input.focus({ preventScroll: true }), 80);
  }

  /** A code may have changed coins, lives or unlocks under the open screen. */
  private refreshAfterSupportCode(): void {
    if (this.current === 'home') this.renderHome();
    else if (this.current === 'map') this.renderMap();
    else if (this.current === 'game') this.updateHud();
  }

  /**
   * Reset is the one irreversible thing a player can do to themselves, so the
   * dialog names what actually goes rather than a vague "progress": boosters,
   * bottle looks, achievements and the daily streak are all in there too.
   *
   * Two conditional lines carry the weight:
   *  - Anyone who has ever paid is told that bought coins and boosters are
   *    included and cannot be restored. That is true by design (the granted
   *    token ledger survives precisely so an old purchase is never re-granted
   *    as a freebie), and finding it out afterwards means a support email.
   *  - Anyone signed in to cloud save is told their cloud copy survives, which
   *    turns a terrifying button into a recoverable one.
   */
  private confirmResetProgress(): void {
    const parts = [`<p class="reset__line">${escapeHtml(t('reset.body'))}</p>`];
    if (this.save.hasEverPurchased) {
      parts.push(`<p class="reset__line reset__warn">${escapeHtml(t('reset.paid'))}</p>`);
    }
    if (this.cloud.state.available && this.cloud.state.account !== null) {
      parts.push(`<p class="reset__line reset__safe">${escapeHtml(t('reset.cloudSafe'))}</p>`);
    }
    parts.push(`<p class="reset__line"><b>${escapeHtml(t('reset.final'))}</b></p>`);
    this.modal.open({
      title: t('reset.title'),
      bodyHtml: parts.join(''),
      inlineButtons: true,
      buttons: [
        { label: t('reset.keep'), kind: 'primary', onClick: () => this.openSettings() },
        {
          label: t('support.resetBtn'),
          kind: 'danger',
          onClick: () => {
            this.analytics.track({ type: 'progress_reset', source: 'settings' });
            // The cloud copy is not touched by a reset; the next sync asks
            // which one to keep rather than uploading the wipe or undoing it.
            this.cloud.markLocalReset();
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
      title: t('howto.title'),
      bodyHtml: t('howto.body', { undo: eco.freeUses.undo, hint: eco.freeUses.hint }),
      buttons: [{ label: t('common.gotIt'), kind: 'primary' }],
    });
  }
}

const app = new App();
app.boot().catch((err: unknown) => app.showBootFailure(err));

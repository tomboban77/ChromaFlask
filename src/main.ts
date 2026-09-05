import './styles/main.css';

import { LEVELS, LEVEL_COUNT, getLevelSpec } from '@/core/levels';
import { generateLevel } from '@/core/generator';
import {
  COIN_SHOP, LIVES_MAX, coinsFor, starsFor,
  type CoinShopItem, type PowerupId,
} from '@/core/progression';
import type { GeneratedLevel } from '@/core/types';

import { SAVE_VERSION, SaveService } from '@/services/SaveService';
import { AuthService } from '@/services/AuthService';
import { Analytics, POSTHOG_KEY, PostHogDriver } from '@/services/Analytics';
import { RemoteConfig } from '@/services/RemoteConfig';
import { IAP_CATALOG, Payments, type IapProduct } from '@/services/Payments';
import {
  SUPPORT_CODE_ERROR_TEXT, applySupportCode, formatSupportId, supportMailto, verifySupportCode,
} from '@/services/Support';

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

  async boot(): Promise<void> {
    // The splash progress starts immediately so the first paint already moves.
    const splashDone = this.animateSplash();

    await this.remote.refresh();
    void this.payments.init();
    this.save = new SaveService(this.remote.current.economy.startingCoins);
    // The support ID doubles as the analytics identity, so a support email
    // can be matched to its funnel without collecting anything personal.
    if (POSTHOG_KEY) this.analytics.addDriver(new PostHogDriver(POSTHOG_KEY, this.save.supportId));

    this.toast = new ToastHost($('#toast-root'));
    this.modal = new ModalHost($('#modal-root'));
    this.confetti = new Confetti(
      $<HTMLCanvasElement>('#fx-confetti'),
      () =>
        !this.save.snapshot.settings.reducedMotion &&
        !window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    );

    this.applySettings();

    await this.stage.init($('#board-host'));
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

    await splashDone;
    if (this.save.snapshot.profile) {
      this.renderHome();
      this.show('home');
    } else {
      this.show('profile');
    }
  }

  /** Determinate splash bar: honest about the ~1.6s the boot actually takes. */
  private animateSplash(): Promise<void> {
    const bar = $('#boot-bar');
    const pct = $('#boot-pct');
    const phrases = ['Mixing colours…', 'Warming the flasks…', 'Almost ready…'];
    return new Promise((resolve) => {
      const t0 = performance.now();
      const duration = 1600;
      const tick = (t: number) => {
        const p = Math.min(1, (t - t0) / duration);
        const eased = 1 - Math.pow(1 - p, 2.2);
        const value = Math.round(eased * 100);
        bar.style.width = `${value}%`;
        const phrase = phrases[Math.min(phrases.length - 1, Math.floor(p * phrases.length))];
        pct.textContent = `${phrase} ${value}%`;
        if (p < 1) requestAnimationFrame(tick);
        else resolve();
      };
      requestAnimationFrame(tick);
    });
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
    this.updateTutorialHand();
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
      this.stage.setPaused(hidden);
      if (hidden) {
        audio.suspend();
        this.save.flush();
      } else {
        audio.resume();
      }
    });

    window.addEventListener('pagehide', () => this.save.flush());

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
    this.save.update((d) => {
      d.profile = profile;
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
      const next = this.save.highestUnlocked(LEVEL_COUNT);
      const done = Object.keys(this.save.snapshot.levels).length;
      if (done >= LEVEL_COUNT) {
        this.renderMap();
        this.show('map');
      } else {
        this.startLevel(next);
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

    const done = Object.keys(this.save.snapshot.levels).length;
    $('#home-progress').textContent =
      `★ ${this.save.totalStars}/${LEVEL_COUNT * 3} · ${done} of ${LEVEL_COUNT} levels cleared`;

    const next = this.save.highestUnlocked(LEVEL_COUNT);
    $('#btn-play').textContent = done >= LEVEL_COUNT ? 'Play again' : `Level ${next}`;
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
    $('#map-stars').textContent = `${this.save.totalStars}/${LEVEL_COUNT * 3}`;

    const unlocked = this.save.highestUnlocked(LEVEL_COUNT);
    const grid = $('#level-grid');
    grid.replaceChildren();

    for (const spec of LEVELS) {
      const record = this.save.levelRecord(spec.id);
      const locked = spec.id > unlocked;
      const isNext = spec.id === unlocked && !record;

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
          this.startLevel(spec.id);
        });
      }
      grid.appendChild(node);
    }

    // 200 nodes is a long scroll: land the player on their current level.
    requestAnimationFrame(() => {
      grid.querySelector('.node--next, .node:not(.node--locked):last-of-type')
        ?.scrollIntoView({ block: 'center' });
    });

    const done = Object.keys(this.save.snapshot.levels).length;
    $('#map-footnote').textContent =
      done >= LEVEL_COUNT
        ? 'All levels cleared. More coming soon.'
        : `${done} of ${LEVEL_COUNT} levels cleared`;

    $('#btn-settings-map').onclick = () => this.openSettings();
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
    const target = this.shopReturn === 'shop' ? 'home' : this.shopReturn;
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

    this.save.addCoins(product.coins);
    for (const [pid, n] of Object.entries(product.powerups ?? {})) {
      this.save.addInventory(pid as PowerupId, n ?? 0);
    }
    if (product.infiniteLivesHours) this.save.addInfiniteLives(product.infiniteLivesHours);

    audio.play('unlock');
    haptic([15, 40, 25]);
    this.confetti.burst(1);
    this.toast.show(`${product.title} added - enjoy!`, 'info', 2600);
    this.renderShop();
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

    $('#btn-undo').addEventListener('click', () => this.usePowerup('undo'));
    $('#btn-hint').addEventListener('click', () => this.usePowerup('hint'));
    $('#btn-bottle').addEventListener('click', () => this.usePowerup('bottle'));
  }

  private startLevel(id: number): void {
    // Hearts gate every level after the tutorial; regen or the shop restores them.
    if (!this.save.canPlay && this.save.snapshot.tutorialDone) {
      this.analytics.track({ type: 'out_of_lives', level: id });
      this.showLivesDialog(id);
      return;
    }

    this.levelId = id;
    this.attempt += 1;
    this.attemptStartedAt = Date.now();
    this.uses = { undo: 0, hint: 0, bottle: 0 };
    this.extraTubes = 0;
    this.nudged = false;

    try {
      this.level = generateLevel(getLevelSpec(id));
    } catch (err) {
      console.error(err);
      this.toast.show('Could not build that level. Please try another.', 'error');
      return;
    }

    this.applySettings();
    this.board.mount(this.level, this.save.snapshot.settings.colorblind);
    this.updateHud();
    this.show('game');

    this.save.bumpStat('plays');
    this.analytics.track({ type: 'level_start', level: id, attempt: this.attempt });

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

    refillBtn.addEventListener('click', () => {
      this.buyCoinItem(refill);
      refresh();
      if (retryLevel !== null && this.save.canPlay) {
        this.modal.close();
        this.startLevel(retryLevel);
      }
    });
    shopBtn.addEventListener('click', () => {
      audio.play('button');
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
      onClose: () => window.clearInterval(timer),
    });
  }

  private restartLevel(): void {
    if (!this.level) return;
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
    $('#game-level-label').textContent = `Level ${this.levelId}`;
    const moves = this.board.moveCount;
    $('#game-move-label').textContent =
      `${moves} ${moves === 1 ? 'move' : 'moves'} · par ${this.level?.par ?? '-'}`;

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

  private usePowerup(id: PowerupId): void {
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
        applied = this.board.showHint();
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

    const moves = this.board.moveCount;
    const seconds = Math.round((Date.now() - this.attemptStartedAt) / 1000);
    const stars = starsFor(moves, level.par);
    const { isFirstClear } = this.save.recordClear(this.levelId, stars, moves);
    const reward = coinsFor(stars, isFirstClear, this.remote.current.economy);
    this.save.addCoins(reward);
    this.save.bumpStat('wins');
    if (stars === 3) this.save.bumpStat('perfects');
    this.save.recordWinForStreak();

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

    const isLast = this.levelId >= LEVEL_COUNT;
    window.setTimeout(() => this.showWinModal(stars, moves, seconds, reward, isLast), 620);
  }

  private showWinModal(
    stars: number, moves: number, seconds: number, reward: number, isLast: boolean,
  ): void {
    const content = el('div');

    // A par run gets the full treatment.
    if (stars === 3) content.appendChild(el('div', 'perfect', 'Perfect!'));

    const starRow = el('div', 'stars');
    const starEls: HTMLElement[] = [];
    for (let i = 0; i < 3; i++) {
      const s = el('i', '', '★');
      starRow.appendChild(s);
      starEls.push(s);
    }
    content.appendChild(starRow);

    const reward$ = el('div', 'reward');
    reward$.innerHTML = `<span class="chip__icon chip__icon--coin"></span> +${reward} coins`;
    content.appendChild(reward$);

    const stats = el('div', 'statgrid');
    stats.innerHTML = `
      <div><b>${moves}</b><span>Moves</span></div>
      <div><b>${this.level?.par ?? '-'}</b><span>Par</span></div>
      <div><b>${seconds}s</b><span>Time</span></div>`;
    content.appendChild(stats);

    const buttons = isLast
      ? [
          { label: 'Back to home', kind: 'primary' as const, onClick: () => this.quitToHome() },
          { label: 'Play again', kind: 'ghost' as const, onClick: () => this.restartLevel() },
        ]
      : [
          {
            label: 'Next level',
            kind: 'success' as const,
            onClick: () => this.startLevel(this.levelId + 1),
          },
          { label: 'Home', kind: 'ghost' as const, onClick: () => this.quitToHome() },
        ];

    this.modal.open({
      title: isLast ? 'All levels cleared!' : 'Level complete!',
      content,
      buttons,
      dismissable: false,
    });

    // Confetti rains over the dialog itself; a perfect run gets the big burst.
    this.confetti.burst(stars === 3 ? 2 : 1);

    // Ring the stars in one at a time so the score lands as a moment.
    starEls.forEach((node, i) => {
      window.setTimeout(() => {
        node.classList.add('pop');
        if (i < stars) {
          node.classList.add('on');
          audio.play('star', i);
        }
      }, 180 + i * 260);
    });

    if (!isLast) {
      window.setTimeout(() => audio.play('unlock'), 180 + 3 * 260 + 200);
    }
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
          onClick: () => this.usePowerup('undo'),
        },
        {
          label: 'Add an empty bottle',
          kind: 'ghost',
          onClick: () => this.usePowerup('bottle'),
        },
        {
          label: 'Restart level',
          kind: 'ghost',
          onClick: () => {
            // Restarting out of a dead end counts as a failed attempt.
            this.loseLife('failed');
            this.restartLevel();
          },
        },
      ],
      dismissable: false,
    });
  }

  private loseLife(cause: 'quit' | 'failed'): void {
    // Never punish a player who is still inside the level-1 tutorial.
    if (this.tutorial.active) return;
    this.save.loseLife();
    this.save.breakStreak();
    this.analytics.track({ type: 'life_lost', level: this.levelId, cause });
  }

  // --------------------------------------------------------------- dialogs
  private confirmQuit(): void {
    if (this.board.moveCount === 0) {
      this.quitToHome();
      return;
    }
    const heartWarning =
      !this.save.hasInfiniteLives && !this.tutorial.active
        ? ' You will also lose a heart.'
        : '';
    this.modal.open({
      title: 'Leave this level?',
      bodyHtml: `Your progress on this attempt will be lost.${heartWarning}`,
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
    this.analytics.track({
      type: 'level_quit',
      level: this.levelId,
      moves: this.board.moveCount,
      seconds: Math.round((Date.now() - this.attemptStartedAt) / 1000),
    });
    this.tutorial.abort();
    this.renderHome();
    this.show('home');
  }

  private confirmRestart(): void {
    if (this.board.moveCount === 0) return;
    this.modal.open({
      title: 'Restart level?',
      bodyHtml: 'The board will be reset to the beginning.',
      inlineButtons: true,
      buttons: [
        { label: 'Cancel', kind: 'ghost' },
        { label: 'Restart', kind: 'primary', onClick: () => this.restartLevel() },
      ],
    });
  }

  /** Profile card: identity, campaign progress and lifetime stats. */
  private showProfileDialog(): void {
    const s = this.save.snapshot;
    const stats = s.stats;
    const cleared = Object.keys(s.levels).length;

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
      ['Levels cleared', `${cleared} / ${LEVEL_COUNT}`],
      ['Stars', `${this.save.totalStars} / ${LEVEL_COUNT * 3}`],
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
        { label: 'Settings', kind: 'ghost', onClick: () => this.openSettings() },
      ],
    });
  }

  /** Reopen the look-picker prefilled with the current identity. */
  private editProfile(): void {
    const profile = this.save.snapshot.profile;
    const input = $<HTMLInputElement>('#name-input');
    input.value = profile?.name ?? '';
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
    this.modal.open({
      title: 'How to play',
      bodyHtml: `
        <p style="text-align:left;margin:0 0 10px">
          Tap a bottle to lift its top colour, then tap another bottle to pour.
        </p>
        <p style="text-align:left;margin:0 0 10px">
          You can only pour onto the <b>same colour</b>, or into an <b>empty bottle</b>.
          The whole matching block moves at once, if there is room.
        </p>
        <p style="text-align:left;margin:0 0 10px">
          Fill every bottle with a single colour to win. Match <b>par</b> for three stars.
        </p>
        <p style="text-align:left;margin:0">
          Watch for twists: the gold-rimmed <b>Cauldron</b> accepts any colour but must be
          emptied to win, and <b>murky potions</b> hide their colours until they surface.
        </p>`,
      buttons: [{ label: 'Got it', kind: 'primary' }],
    });
  }
}

const app = new App();
void app.boot();

import './styles/main.css';

import { LEVELS, LEVEL_COUNT, getLevelSpec } from '@/core/levels';
import { generateLevel } from '@/core/generator';
import { coinsFor, starsFor, type PowerupId } from '@/core/progression';
import type { GeneratedLevel } from '@/core/types';

import { SaveService } from '@/services/SaveService';
import { AuthService } from '@/services/AuthService';
import { Analytics } from '@/services/Analytics';
import { RemoteConfig } from '@/services/RemoteConfig';

import { audio } from '@/audio/AudioEngine';
import { GameStage } from '@/render/GameStage';
import { BoardView } from '@/render/BoardView';

import { $, ModalHost, ToastHost, el, escapeHtml, haptic, setHapticsEnabled } from '@/ui/dom';
import { Tutorial } from '@/ui/Tutorial';

type ScreenId = 'boot' | 'profile' | 'map' | 'game';

const AVATARS = ['🐱', '🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐧'];

class App {
  private readonly remote = new RemoteConfig();
  private readonly analytics = new Analytics();
  private readonly auth = new AuthService();
  private save!: SaveService;

  private readonly stage = new GameStage();
  private board!: BoardView;
  private toast!: ToastHost;
  private modal!: ModalHost;
  private tutorial!: Tutorial;

  private level: GeneratedLevel | null = null;
  private levelId = 1;
  private attempt = 0;
  private attemptStartedAt = 0;
  private nudged = false;

  /** Powerup uses spent this attempt; free allowance comes from the economy. */
  private uses: Record<PowerupId, number> = { undo: 0, hint: 0, bottle: 0 };
  private extraTubes = 0;

  private chosenAvatar = AVATARS[0] as string;

  async boot(): Promise<void> {
    await this.remote.refresh();
    this.save = new SaveService(this.remote.current.economy.startingCoins);

    this.toast = new ToastHost($('#toast-root'));
    this.modal = new ModalHost($('#modal-root'));

    this.applySettings();

    await this.stage.init($('#board-host'));
    this.analytics.track({ type: 'app_start', renderer: this.stage.rendererType });

    this.board = new BoardView(this.stage.stream, this.stage.particles, {
      onMove: (_move, count) => this.onMove(count),
      onWin: () => this.onWin(),
      onStuck: () => this.onStuck(),
      onSelectionChange: (i) => {
        if (i !== null) this.tutorial.notify('select');
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
        this.analytics.track({ type: 'tutorial_done' });
      },
      (step) => this.analytics.track({ type: 'tutorial_step', step }),
    );

    this.wireGlobal();
    this.wireProfile();
    this.wireGame();

    if (!this.save.persistent) {
      this.toast.show('Private browsing: progress will not be saved', 'warn', 3800);
    }

    this.installDevHooks();

    // Let the boot animation breathe, then route to profile or straight in.
    window.setTimeout(() => {
      if (this.save.snapshot.profile) {
        this.renderMap();
        this.show('map');
      } else {
        this.show('profile');
      }
    }, 1100);
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
        screen: (['boot', 'profile', 'map', 'game'] as ScreenId[]).find((n) =>
          $(`#screen-${n}`).classList.contains('screen--active'),
        ),
        moves: this.board.moveCount,
        tubes: this.board.tubeCount,
        coins: this.save.coins,
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
    for (const name of ['boot', 'profile', 'map', 'game'] as ScreenId[]) {
      $(`#screen-${name}`).classList.toggle('screen--active', name === id);
    }
    // The Pixi host has no size while hidden; nudge a reflow once it is shown.
    if (id === 'game') requestAnimationFrame(() => this.stage.app.resize());
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
    // Audio contexts may only start inside a user gesture.
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });

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
    this.renderMap();
    this.show('map');
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

    const done = Object.keys(this.save.snapshot.levels).length;
    $('#map-footnote').textContent =
      done >= LEVEL_COUNT
        ? 'All levels cleared. More coming soon.'
        : `${done} of ${LEVEL_COUNT} levels cleared`;

    $('#btn-settings-map').onclick = () => this.openSettings();
  }

  // ----------------------------------------------------------------- game
  private wireGame(): void {
    $('#btn-back').addEventListener('click', () => this.confirmQuit());
    $('#btn-restart').addEventListener('click', () => this.confirmRestart());
    $('#btn-settings-game').addEventListener('click', () => this.openSettings());

    $('#btn-undo').addEventListener('click', () => this.usePowerup('undo'));
    $('#btn-hint').addEventListener('click', () => this.usePowerup('hint'));
    $('#btn-bottle').addEventListener('click', () => this.usePowerup('bottle'));
  }

  private startLevel(id: number): void {
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

    this.analytics.track({ type: 'level_start', level: id, attempt: this.attempt });

    if (id === 1 && !this.save.snapshot.tutorialDone) {
      window.setTimeout(() => this.tutorial.start(), 700);
    }
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
    this.tutorial.notify('pour');
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
      const remaining = this.remainingUses(id);
      const badge = $(`#badge-${id}`);
      const button = $<HTMLButtonElement>(`#btn-${id}`);

      if (remaining > 0) {
        badge.textContent = String(remaining);
        badge.classList.remove('power__badge--cost');
      } else {
        badge.textContent = String(this.remote.current.economy.prices[id]);
        badge.classList.add('power__badge--cost');
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

    const free = this.remainingUses(id) > 0;
    const price = this.remote.current.economy.prices[id];

    if (!free && !this.save.trySpend(price)) {
      audio.play('invalid');
      this.toast.show(`Not enough coins - ${price} needed`, 'warn');
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
        if (!applied) {
          this.toast.show('No winning move from here - try undo or restart', 'warn', 3000);
        }
        break;
      case 'bottle':
        applied = this.board.addTube(this.save.snapshot.settings.colorblind);
        if (applied) this.extraTubes += 1;
        break;
    }

    if (!applied) {
      // Never charge for a powerup that did nothing.
      if (!free) this.save.addCoins(price);
      this.updateHud();
      return;
    }

    if (free) this.uses[id] += 1;
    haptic(14);
    this.analytics.track({
      type: 'powerup_used',
      level: this.levelId,
      powerup: id,
      paid: !free,
    });
    this.updateHud();
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
          { label: 'Back to levels', kind: 'primary' as const, onClick: () => this.quitToMap() },
          { label: 'Play again', kind: 'ghost' as const, onClick: () => this.restartLevel() },
        ]
      : [
          {
            label: 'Next level',
            kind: 'success' as const,
            onClick: () => this.startLevel(this.levelId + 1),
          },
          { label: 'Levels', kind: 'ghost' as const, onClick: () => this.quitToMap() },
        ];

    this.modal.open({
      title: isLast ? 'All levels cleared!' : 'Level complete!',
      content,
      buttons,
      dismissable: false,
    });

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
  private onStuck(): void {
    audio.play('stuck');
    haptic([30, 80, 30]);
    this.analytics.track({ type: 'level_stuck', level: this.levelId, moves: this.board.moveCount });

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
        { label: 'Restart level', kind: 'ghost', onClick: () => this.restartLevel() },
      ],
      dismissable: false,
    });
  }

  // --------------------------------------------------------------- dialogs
  private confirmQuit(): void {
    if (this.board.moveCount === 0) {
      this.quitToMap();
      return;
    }
    this.modal.open({
      title: 'Leave this level?',
      bodyHtml: 'Your progress on this attempt will be lost.',
      inlineButtons: true,
      buttons: [
        { label: 'Stay', kind: 'ghost' },
        { label: 'Leave', kind: 'primary', onClick: () => this.quitToMap() },
      ],
    });
  }

  private quitToMap(): void {
    this.analytics.track({
      type: 'level_quit',
      level: this.levelId,
      moves: this.board.moveCount,
      seconds: Math.round((Date.now() - this.attemptStartedAt) / 1000),
    });
    this.tutorial.abort();
    this.renderMap();
    this.show('map');
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
        <p style="text-align:left;margin:0">
          Fill every bottle with a single colour to win. Match <b>par</b> for three stars.
        </p>`,
      buttons: [{ label: 'Got it', kind: 'primary' }],
    });
  }
}

const app = new App();
void app.boot();

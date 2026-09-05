/**
 * First-run coaching for level 1.
 *
 * Driven by real game events rather than timers, so the prompt always matches
 * what the player has actually done. Advancing requires performing the action,
 * which is what makes it teach instead of narrate.
 */

import { t } from '@/i18n';

export type TutorialTrigger = 'select' | 'pour' | 'complete';

interface Step {
  /** Message key; resolved when the step shows, so a language change applies. */
  text: 'tutorial.1' | 'tutorial.2' | 'tutorial.3' | 'tutorial.4';
  /** Event that advances this step, or null to auto-advance after `hold`. */
  advanceOn: TutorialTrigger | null;
  hold?: number;
  /** Which bottle of the current best move the hand pointer should tap. */
  pointer?: 'from' | 'to';
}

const STEPS: readonly Step[] = [
  { text: 'tutorial.1', advanceOn: 'select', pointer: 'from' },
  { text: 'tutorial.2', advanceOn: 'pour', pointer: 'to' },
  { text: 'tutorial.3', advanceOn: null, hold: 3200 },
  { text: 'tutorial.4', advanceOn: null, hold: 3000 },
];

export class Tutorial {
  private index = -1;
  private timer: number | null = null;
  private running = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly textEl: HTMLElement,
    private readonly skipBtn: HTMLElement,
    private readonly onFinish: () => void,
    private readonly onStep: (step: number) => void,
  ) {
    this.skipBtn.addEventListener('click', () => this.finish());
  }

  get active(): boolean {
    return this.running;
  }

  /** Where the hand pointer should aim during the current step, if anywhere. */
  get pointer(): 'from' | 'to' | null {
    if (!this.running) return null;
    return STEPS[this.index]?.pointer ?? null;
  }

  start(): void {
    this.running = true;
    this.index = -1;
    this.next();
  }

  /** Called by the game whenever something the tutorial might be waiting on happens. */
  notify(trigger: TutorialTrigger): void {
    if (!this.running) return;
    const step = STEPS[this.index];
    if (!step) return;
    if (step.advanceOn === trigger) this.next();
  }

  private next(): void {
    this.clearTimer();
    this.index++;

    const step = STEPS[this.index];
    if (!step) {
      this.finish();
      return;
    }

    this.root.hidden = false;
    // Re-trigger the entry animation on every step change.
    this.textEl.style.animation = 'none';
    void this.textEl.offsetWidth;
    this.textEl.style.animation = '';
    this.textEl.textContent = t(step.text);
    this.onStep(this.index);

    if (step.advanceOn === null) {
      this.timer = window.setTimeout(() => this.next(), step.hold ?? 2600);
    }
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
  }

  finish(): void {
    if (!this.running) return;
    this.clearTimer();
    this.running = false;
    this.root.hidden = true;
    this.onFinish();
  }

  /** Hide without marking the tutorial as completed (e.g. on quitting early). */
  abort(): void {
    this.clearTimer();
    this.running = false;
    this.root.hidden = true;
  }
}

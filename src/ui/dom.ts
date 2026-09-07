/** Small DOM helpers plus the toast and modal hosts. */
import type { NotificationType as HapticNotificationType } from '@capacitor/haptics';

export function $<T extends HTMLElement = HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Player-supplied text is the only untrusted string in the app - escape it. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

let hapticsEnabled = true;

export function setHapticsEnabled(on: boolean): void {
  hapticsEnabled = on;
}

/** What a multi-pulse pattern means, for engines that play cues rather than patterns. */
export type HapticCue = 'success' | 'warning' | 'error';

type NativeHaptics = (pattern: number | number[], cue: HapticCue) => Promise<void>;
let nativeHaptics: NativeHaptics | null = null;

/**
 * Short vibration where supported. Browsers and the Android wrapper play the
 * pattern through the Vibration API (silently ignored on iOS Safari); the iOS
 * wrapper routes through the Taptic Engine once `installNativeHaptics` has
 * run. Single pulses are taps (light/medium/heavy by length), patterns are
 * notification cues - pass `cue` for anything that is not a warning.
 */
export function haptic(pattern: number | number[], cue: HapticCue = 'warning'): void {
  if (!hapticsEnabled) return;
  if (nativeHaptics) {
    void nativeHaptics(pattern, cue).catch(() => undefined);
    return;
  }
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
  }
}

/**
 * iOS has no Vibration API; the Capacitor Haptics plugin reaches the Taptic
 * Engine instead. Loaded on demand so the web bundle never carries it. Any
 * failure leaves the Vibration API path in place.
 */
export async function installNativeHaptics(): Promise<void> {
  try {
    const { Haptics, ImpactStyle, NotificationType } = await import('@capacitor/haptics');
    const cues: Record<HapticCue, HapticNotificationType> = {
      success: NotificationType.Success,
      warning: NotificationType.Warning,
      error: NotificationType.Error,
    };
    nativeHaptics = async (pattern, cue) => {
      if (Array.isArray(pattern)) {
        await Haptics.notification({ type: cues[cue] });
        return;
      }
      const style = pattern <= 10 ? ImpactStyle.Light : pattern <= 18 ? ImpactStyle.Medium : ImpactStyle.Heavy;
      await Haptics.impact({ style });
    };
  } catch (err) {
    console.warn('[haptics] native bridge unavailable', err);
  }
}

// ------------------------------------------------------------------ toast
export class ToastHost {
  constructor(private readonly root: HTMLElement) {}

  show(message: string, kind: 'info' | 'warn' | 'error' = 'info', ms = 2100): void {
    const node = el('div', `toast${kind === 'info' ? '' : ` toast--${kind}`}`, message);
    this.root.appendChild(node);
    window.setTimeout(() => {
      node.classList.add('toast--out');
      window.setTimeout(() => node.remove(), 280);
    }, ms);
  }
}

// ------------------------------------------------------------------ modal
export interface ModalButton {
  label: string;
  kind?: 'primary' | 'success' | 'ghost' | 'danger';
  /** Return false to keep the modal open. */
  onClick?: () => void | boolean;
}

export interface ModalOptions {
  title: string;
  /** Trusted markup authored by the app, never player input. */
  bodyHtml?: string;
  content?: HTMLElement;
  buttons?: ModalButton[];
  /** Two buttons side by side rather than stacked. */
  inlineButtons?: boolean;
  dismissable?: boolean;
  /** Round red X in the top corner. */
  closeButton?: boolean;
  /** Cleanup hook - always runs when the dialog leaves the screen. */
  onClose?: () => void;
}

export class ModalHost {
  private current: HTMLElement | null = null;
  private onCloseCb: (() => void) | null = null;
  private lastFocus: HTMLElement | null = null;
  /** Fires after any open or close, for hosts that mirror dialog state (history, pausing). */
  onOpenChange: ((open: boolean) => void) | null = null;

  constructor(private readonly root: HTMLElement) {
    this.root.addEventListener('pointerdown', (ev) => {
      if (ev.target === this.root && this.dismissable) this.close();
    });
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && this.isOpen && this.dismissable) this.close();
    });
  }

  private dismissable = true;

  get isOpen(): boolean {
    return this.current !== null;
  }

  /** Whether Escape, the backdrop and the back button may close the open dialog. */
  get isDismissable(): boolean {
    return this.isOpen && this.dismissable;
  }

  open(options: ModalOptions): HTMLElement {
    // Replacing a dialog: tear the old one down without announcing "closed",
    // since the host is about to hear "open" anyway.
    this.closeInternal(false);
    this.lastFocus = document.activeElement as HTMLElement | null;
    this.dismissable = options.dismissable ?? true;
    this.onCloseCb = options.onClose ?? null;

    const modal = el('div', 'modal');
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    if (options.closeButton) {
      const x = el('button', 'modal__x');
      x.setAttribute('aria-label', 'Close');
      x.innerHTML =
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" ' +
        'fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';
      x.addEventListener('click', () => this.close());
      modal.appendChild(x);
    }

    const title = el('h2', 'modal__title', options.title);
    modal.appendChild(title);

    if (options.bodyHtml) {
      const body = el('div', 'modal__body');
      body.innerHTML = options.bodyHtml;
      modal.appendChild(body);
    }
    if (options.content) modal.appendChild(options.content);

    if (options.buttons?.length) {
      const actions = el('div', options.inlineButtons ? 'modal__row' : 'modal__actions');
      for (const spec of options.buttons) {
        const button = el('button', `btn btn--${spec.kind ?? 'ghost'}`, spec.label);
        button.addEventListener('click', () => {
          const keepOpen = spec.onClick?.() === false;
          // Close only the dialog this button belongs to. If the handler
          // opened another dialog, that one is now current and must survive.
          if (!keepOpen && this.current === modal) this.close();
        });
        actions.appendChild(button);
      }
      modal.appendChild(actions);
    }

    this.root.appendChild(modal);
    this.root.classList.add('modal-root--open');
    this.current = modal;

    // Move focus in so keyboard and screen-reader users land inside the dialog.
    window.setTimeout(() => modal.querySelector('button')?.focus({ preventScroll: true }), 60);
    this.onOpenChange?.(true);
    return modal;
  }

  close(): void {
    this.closeInternal(true);
  }

  private closeInternal(notify: boolean): void {
    if (!this.current) return;
    this.current.remove();
    this.current = null;
    this.root.classList.remove('modal-root--open');
    const cb = this.onCloseCb;
    this.onCloseCb = null;
    this.lastFocus?.focus?.({ preventScroll: true });
    this.lastFocus = null;
    // Always run: onClose is a cleanup hook (timers etc.), and skipping it when
    // one dialog replaces another would leak whatever the first one started.
    cb?.();
    // After the cleanup hook, which may itself have opened another dialog.
    if (notify) this.onOpenChange?.(this.isOpen);
  }
}

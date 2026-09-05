/** Small DOM helpers plus the toast and modal hosts. */

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

/** Short vibration where supported. Silently ignored on iOS Safari. */
export function haptic(pattern: number | number[]): void {
  if (!hapticsEnabled) return;
  try {
    navigator.vibrate?.(pattern);
  } catch {
    /* not supported */
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

  open(options: ModalOptions): HTMLElement {
    this.close();
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
          if (!keepOpen) this.close();
        });
        actions.appendChild(button);
      }
      modal.appendChild(actions);
    }

    this.root.appendChild(modal);
    this.root.classList.add('modal-root--open');
    this.current = modal;

    // Move focus in so keyboard and screen-reader users land inside the dialog.
    window.setTimeout(() => modal.querySelector('button')?.focus(), 60);
    return modal;
  }

  close(): void {
    if (!this.current) return;
    this.current.remove();
    this.current = null;
    this.root.classList.remove('modal-root--open');
    const cb = this.onCloseCb;
    this.onCloseCb = null;
    this.lastFocus?.focus?.();
    this.lastFocus = null;
    // Always run: onClose is a cleanup hook (timers etc.), and skipping it when
    // one dialog replaces another would leak whatever the first one started.
    cb?.();
  }
}

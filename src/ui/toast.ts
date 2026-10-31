import { el } from './dom';

let container: HTMLElement | null = null;

export function initToasts(parent: HTMLElement): void {
  container = el('div', { class: 'toasts' });
  parent.append(container);
}

/** Small transient notification (joins, leaves, errors). */
export function toast(text: string, kind: 'info' | 'warn' | 'error' | 'ok' = 'info', ms = 3500): void {
  if (!container) return;
  const t = el('div', { class: `toast ${kind}`, text });
  container.append(t);
  window.setTimeout(() => {
    t.classList.add('out');
    window.setTimeout(() => t.remove(), 400);
  }, ms);
}

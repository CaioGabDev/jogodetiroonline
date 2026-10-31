import { audio } from '../core/audio';

type Child = Node | string | null | undefined | false;

interface ElOpts {
  class?: string;
  text?: string;
  title?: string;
  attrs?: Record<string, string>;
  style?: Partial<CSSStyleDeclaration>;
  onClick?: (e: MouseEvent) => void;
}

/** Safe element builder: all strings become text nodes (never parsed as HTML). */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  opts: ElOpts = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (opts.class) e.className = opts.class;
  if (opts.text !== undefined) e.textContent = opts.text;
  if (opts.title) e.title = opts.title;
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) e.setAttribute(k, v);
  if (opts.style) Object.assign(e.style, opts.style);
  if (opts.onClick) {
    const cb = opts.onClick;
    e.addEventListener('click', (ev) => {
      audio.unlock();
      audio.uiClick();
      cb(ev as MouseEvent);
    });
  }
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    e.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return e;
}

export function clear(e: HTMLElement): void {
  while (e.firstChild) e.removeChild(e.firstChild);
}

export function show(e: HTMLElement, v: boolean): void {
  e.classList.toggle('hidden', !v);
}

export function button(text: string, onClick: () => void, cls = 'btn'): HTMLButtonElement {
  return el('button', { class: cls, text, onClick: () => onClick() });
}

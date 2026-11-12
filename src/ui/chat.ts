import { CHAT_MAX } from '../game/constants';
import { sanitizeText } from '../core/util';
import { el, show } from './dom';

/** Chat log + input. Opening is controlled by the game (Enter / U). */
export class Chat {
  readonly root: HTMLElement;
  private log: HTMLElement;
  private input: HTMLInputElement;
  private label: HTMLElement;
  private inputRow: HTMLElement;
  private teamMode = false;
  isOpen = false;
  onSend: ((text: string, team: boolean) => void) | null = null;
  onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.log = el('div', { class: 'chat-log' });
    this.label = el('span', { class: 'chat-label', text: 'TODOS:' });
    this.input = el('input', { class: 'chat-input', attrs: { maxlength: String(CHAT_MAX), autocomplete: 'off', spellcheck: 'false' } });
    this.inputRow = el('div', { class: 'chat-row hidden' }, [this.label, this.input]);
    this.root = el('div', { class: 'chat hidden' }, [this.log, this.inputRow]);
    parent.append(this.root);

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.code === 'Enter' || e.code === 'NumpadEnter') {
        e.preventDefault();
        const text = sanitizeText(this.input.value, CHAT_MAX);
        if (text) this.onSend?.(text, this.teamMode);
        this.close();
      } else if (e.code === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
  }

  show(v: boolean): void {
    show(this.root, v);
  }

  open(team: boolean): void {
    this.teamMode = team;
    this.label.textContent = team ? 'TIME:' : 'TODOS:';
    this.label.classList.toggle('team', team);
    this.isOpen = true;
    this.root.classList.add('open');
    show(this.inputRow, true);
    this.input.value = '';
    // Defer so the key that opened the chat isn't typed into it.
    window.setTimeout(() => this.input.focus(), 0);
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.root.classList.remove('open');
    show(this.inputRow, false);
    this.input.blur();
    this.onClose?.();
  }

  add(name: string | null, color: string, text: string, team = false, system = false): void {
    const row = el('div', { class: 'chat-msg' + (system ? ' sys' : '') }, [
      team ? el('span', { class: 'chat-team', text: '[TIME] ' }) : null,
      name !== null ? el('span', { class: 'chat-name', text: name + ': ', style: { color } }) : null,
      el('span', { text }),
    ]);
    this.log.append(row);
    while (this.log.children.length > 40) this.log.firstElementChild?.remove();
    this.log.scrollTop = this.log.scrollHeight;
    window.setTimeout(() => row.classList.add('old'), 9000);
  }

  clearLog(): void {
    while (this.log.firstChild) this.log.removeChild(this.log.firstChild);
  }
}

import { loadColor, loadNick, saveColor, saveNick } from '../core/settings';
import { normalizeCode, sanitizeText } from '../core/util';
import { FFA_COLORS, NAME_MAX } from '../game/constants';
import { el, show } from './dom';

export interface MenuCallbacks {
  onCreate(nick: string, color: string): void;
  onJoin(nick: string, color: string, code: string): void;
  onPractice(nick: string, color: string): void;
  onSettings(): void;
}

export class MainMenu {
  readonly root: HTMLElement;
  private nick: HTMLInputElement;
  private code: HTMLInputElement;
  private error: HTMLElement;
  private status: HTMLElement;
  private buttons: HTMLButtonElement[] = [];
  private color: string;
  private swatches: HTMLElement;

  constructor(parent: HTMLElement, cb: MenuCallbacks) {
    this.nick = el('input', {
      class: 'input big',
      attrs: { maxlength: String(NAME_MAX), placeholder: 'Seu nickname', autocomplete: 'off', spellcheck: 'false' },
    });
    this.nick.value = loadNick();
    this.nick.addEventListener('input', () => {
      this.setError('');
      saveNick(sanitizeText(this.nick.value, NAME_MAX));
    });

    const saved = loadColor();
    this.color = FFA_COLORS.includes(saved) ? saved : FFA_COLORS[Math.floor(Math.random() * FFA_COLORS.length)];
    this.swatches = el('div', { class: 'swatches' });
    this.renderSwatches();

    this.code = el('input', {
      class: 'input code',
      attrs: { maxlength: '6', placeholder: 'CÓDIGO', autocomplete: 'off', spellcheck: 'false' },
    });
    this.code.addEventListener('input', () => {
      const v = normalizeCode(this.code.value);
      if (v !== this.code.value) this.code.value = v;
      this.setError('');
    });

    const validNick = (): string | null => {
      const n = sanitizeText(this.nick.value, NAME_MAX);
      if (!n) {
        this.setError('Digite um nickname para jogar.');
        this.nick.focus();
        return null;
      }
      this.nick.value = n;
      saveNick(n);
      return n;
    };

    const create = el('button', {
      class: 'btn primary big',
      text: 'Criar Sala',
      onClick: () => {
        const n = validNick();
        if (n) cb.onCreate(n, this.color);
      },
    });
    const join = el('button', {
      class: 'btn big',
      text: 'Entrar na Sala',
      onClick: () => {
        const n = validNick();
        if (!n) return;
        const c = normalizeCode(this.code.value);
        if (c.length !== 6) {
          this.setError('O código da sala tem 6 caracteres (ex: AB12CD).');
          this.code.focus();
          return;
        }
        cb.onJoin(n, this.color, c);
      },
    });
    const practice = el('button', {
      class: 'btn ghost',
      text: 'Treino Offline (alvos)',
      onClick: () => {
        const n = validNick();
        if (n) cb.onPractice(n, this.color);
      },
    });
    const settingsBtn = el('button', { class: 'btn ghost', text: 'Configurações', onClick: () => cb.onSettings() });
    this.buttons = [create, join, practice, settingsBtn];
    this.code.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') join.click();
    });

    this.error = el('div', { class: 'error hidden' });
    this.status = el('div', { class: 'status hidden' });

    const card = el('div', { class: 'panel menu-panel' }, [
      el('div', { class: 'logo' }, [el('span', { text: 'ARENA' }), el('b', { text: 'FPS' })]),
      el('div', { class: 'subtitle', text: 'Multiplayer no navegador · até 10 jogadores' }),
      el('label', { class: 'field-label', text: 'Nickname' }),
      this.nick,
      el('label', { class: 'field-label', text: 'Sua cor (mata-mata)' }),
      this.swatches,
      create,
      el('div', { class: 'join-row' }, [this.code, join]),
      el('div', { class: 'row2' }, [practice, settingsBtn]),
      this.status,
      this.error,
    ]);
    const help = el('div', { class: 'panel help-panel' }, [
      el('h3', { text: 'Como jogar' }),
      ...[
        ['WASD', 'mover'],
        ['Espaço', 'pular'],
        ['Shift', 'correr'],
        ['C / Ctrl', 'agachar'],
        ['Mouse Esq.', 'atirar'],
        ['Mouse Dir.', 'mirar / luneta'],
        ['R', 'recarregar'],
        ['1-4 / Roda', 'trocar arma'],
        ['Tab', 'placar'],
        ['Enter / Y', 'chat / chat do time'],
        ['Esc', 'pausa'],
      ].map(([k, d]) => el('div', { class: 'help-row' }, [el('kbd', { text: k }), el('span', { text: d })])),
      el('p', { class: 'hint', text: 'Crie uma sala e mande o link para seus amigos. As teclas podem ser alteradas em Configurações.' }),
    ]);
    this.root = el('div', { class: 'screen menu hidden' }, [el('div', { class: 'menu-layout' }, [card, help])]);
    parent.append(this.root);
  }

  private renderSwatches(): void {
    while (this.swatches.firstChild) this.swatches.removeChild(this.swatches.firstChild);
    for (const c of FFA_COLORS) {
      const b = el('button', {
        class: 'swatch' + (c === this.color ? ' active' : ''),
        style: { background: c },
        title: c,
        onClick: () => {
          this.color = c;
          saveColor(c);
          this.renderSwatches();
        },
      });
      this.swatches.append(b);
    }
  }

  show(v: boolean): void {
    show(this.root, v);
    if (v) {
      this.setBusy(null);
      if (!this.nick.value) window.setTimeout(() => this.nick.focus(), 50);
    }
  }

  setCode(code: string): void {
    this.code.value = normalizeCode(code);
  }

  setError(msg: string): void {
    this.error.textContent = msg;
    show(this.error, !!msg);
  }

  /** Disables the buttons and shows a status line while connecting. */
  setBusy(text: string | null): void {
    this.buttons.forEach((b) => (b.disabled = text !== null));
    this.status.textContent = text ?? '';
    show(this.status, text !== null);
    if (text) this.setError('');
  }
}

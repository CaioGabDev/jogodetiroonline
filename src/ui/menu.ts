import { progress } from '../core/progress';
import { loadColor, loadNick, saveColor, saveNick } from '../core/settings';
import { normalizeCode, sanitizeText } from '../core/util';
import { ARSENAL_NAMES, BOMB_MAPS, FFA_COLORS, MAP_NAMES, MAX_PLAYERS, NAME_MAX, type MapId } from '../game/constants';
import { PRACTICE_LEVELS, PRACTICE_MODES, type PracticeLevel, type PracticeMode, type PracticeSetup } from '../game/practice';
import { skinById } from '../game/progression';
import { rankOf } from '../game/ranks';
import type { Profile } from '../net/account';
import type { RoomInfo } from '../net/directory';
import { coinLabel, xpBar } from './armory';
import { avatar } from './avatar';
import { clear, el, show } from './dom';
import { rankBadge } from './rankBadge';

export interface MenuCallbacks {
  onCreate(nick: string, color: string): void;
  onJoin(nick: string, color: string, code: string): void;
  onPractice(nick: string, color: string, map: MapId, setup: PracticeSetup): void;
  onSettings(): void;
  onArmory(): void;
  onLogin(): void;
  onLogout(): void;
  onProfile(): void;
  onRanking(): void;
}

const CONTROLS: Array<[string, string]> = [
  ['WASD', 'mover'],
  ['Espaço', 'pular / subir em borda'],
  ['Shift', 'correr (um toque basta)'],
  ['C na corrida', 'slide'],
  ['C / Ctrl', 'agachar'],
  ['Mouse Esq.', 'atirar'],
  ['Mouse Dir.', 'mirar / luneta'],
  ['R', 'recarregar'],
  ['V', 'golpe rápido'],
  ['Y', 'inspecionar arma'],
  ['1-4 / Roda', 'trocar arma'],
  ['B', 'inventário'],
  ['Tab', 'placar'],
  ['Enter / U', 'chat / chat do time'],
  ['Esc', 'pausa'],
];

/** 24×24 line icons for the shortcut tiles. */
const ICONS = {
  arsenal: 'M12 2v4M12 18v4M2 12h4M18 12h4M19 12a7 7 0 1 1-14 0a7 7 0 1 1 14 0ZM13 12a1 1 0 1 1-2 0a1 1 0 1 1 2 0Z',
  ranking: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4ZM7 6H4v1a4 4 0 0 0 3.5 4M17 6h3v1a4 4 0 0 1-3.5 4',
  controls: 'M3 7a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1ZM7 10h1M11 10h1M15 10h2M7 14h10',
  settings: 'M4 7h9M17 7h3M4 17h3M11 17h9M15 5v4M9 15v4M4 12h14M18 12h2',
};

function icon(name: keyof typeof ICONS): SVGSVGElement {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tile-icon');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', ICONS[name]);
  svg.append(path);
  return svg;
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
  private roomList: HTMLElement;
  private roomCount: HTMLElement;
  private rooms: RoomInfo[] = [];
  private roomsKey = '';
  private joinRoom: (code: string) => void;
  private busy = false;
  /** Top right: who is playing, level, XP, coins and the account buttons. */
  private playerCard: HTMLElement;
  private profile: Profile | null = null;
  private accountAvailable = false;
  private rating: number | null = null;
  private armorySub: HTMLElement;
  private rankingTile: HTMLButtonElement;
  private rankingSub: HTMLElement;
  private controls: HTMLElement;

  constructor(
    parent: HTMLElement,
    private cb: MenuCallbacks,
  ) {
    this.nick = el('input', {
      class: 'input big',
      attrs: { maxlength: String(NAME_MAX), placeholder: 'Seu nickname', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Nickname' },
    });
    this.nick.value = loadNick();
    this.nick.addEventListener('input', () => {
      this.setError('');
      saveNick(sanitizeText(this.nick.value, NAME_MAX));
      this.renderPlayer();
    });

    const saved = loadColor();
    this.color = FFA_COLORS.includes(saved) ? saved : FFA_COLORS[Math.floor(Math.random() * FFA_COLORS.length)];
    this.swatches = el('div', { class: 'swatches' });
    this.renderSwatches();

    this.code = el('input', {
      class: 'input code',
      attrs: { maxlength: '6', placeholder: 'CÓDIGO', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'Código da sala' },
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
      // The account name is not the nickname a guest typed.
      if (!this.nick.readOnly) saveNick(n);
      return n;
    };

    this.joinRoom = (code) => {
      const n = validNick();
      if (n) cb.onJoin(n, this.color, code);
    };

    const create = el('button', {
      class: 'btn primary big',
      text: 'Criar sala',
      onClick: () => {
        const n = validNick();
        if (n) cb.onCreate(n, this.color);
      },
    });
    const join = el('button', {
      class: 'btn',
      text: 'Entrar',
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
    this.code.addEventListener('keydown', (e) => {
      if (e.code === 'Enter' || e.code === 'NumpadEnter') join.click();
    });
    const practiceMap = el(
      'select',
      { attrs: { 'aria-label': 'Mapa do treino' } },
      (Object.keys(MAP_NAMES) as MapId[]).map((id) => el('option', { text: MAP_NAMES[id], attrs: { value: id } })),
    );
    const options = <T extends string>(label: string, names: Record<T, string>): HTMLSelectElement =>
      el(
        'select',
        { attrs: { 'aria-label': label } },
        (Object.keys(names) as T[]).map((id) => el('option', { text: names[id], attrs: { value: id } })),
      );
    const practiceMode = options('Modo do treino', PRACTICE_MODES);
    const practiceLevel = options('Dificuldade do treino', PRACTICE_LEVELS);
    // Bomb maps have their own practice, with the real round rules.
    const syncPractice = (): void => {
      const bomb = BOMB_MAPS.includes(practiceMap.value as MapId);
      practiceMode.disabled = practiceLevel.disabled = bomb;
      practiceMode.title = bomb ? 'Nos mapas do modo Bomba o treino é a partida de verdade' : '';
    };
    practiceMap.addEventListener('change', syncPractice);
    syncPractice();
    const practice = el('button', {
      class: 'btn',
      text: 'Treinar',
      onClick: () => {
        const n = validNick();
        if (n) cb.onPractice(n, this.color, practiceMap.value as MapId, { mode: practiceMode.value as PracticeMode, level: practiceLevel.value as PracticeLevel });
      },
    });

    this.error = el('div', { class: 'error hidden' });
    this.status = el('div', { class: 'status hidden' });

    const playPanel = el('section', { class: 'panel play-panel' }, [
      el('h3', { text: 'Jogar' }),
      el('label', { class: 'field-label', text: 'Nickname' }),
      this.nick,
      el('label', { class: 'field-label', text: 'Cor no mata-mata' }),
      this.swatches,
      create,
      el('div', { class: 'menu-divider', text: 'ou entre com um código' }),
      el('div', { class: 'join-row' }, [this.code, join]),
      el('div', { class: 'menu-divider', text: 'ou treine sozinho, contra alvos' }),
      el('div', { class: 'join-row practice-row' }, [practiceMap, practice]),
      el('div', { class: 'join-row practice-row' }, [practiceMode, practiceLevel]),
      this.status,
      this.error,
    ]);

    this.roomList = el('div', { class: 'room-list' });
    this.roomCount = el('span', { class: 'room-count' });
    const roomsPanel = el('section', { class: 'panel rooms-panel' }, [
      el('div', { class: 'rooms-head' }, [el('h3', { text: 'Salas abertas' }), this.roomCount]),
      this.roomList,
    ]);
    this.renderRooms();

    this.armorySub = el('small');
    this.rankingSub = el('small', { text: 'Os melhores por elo' });
    const tile = (name: keyof typeof ICONS, title: string, sub: HTMLElement, onClick: () => void): HTMLButtonElement =>
      el('button', { class: 'menu-tile', onClick }, [icon(name), el('span', { class: 'tile-text' }, [el('b', { text: title }), sub])]);
    const armoryTile = tile('arsenal', 'Arsenal e skins', this.armorySub, () => cb.onArmory());
    this.rankingTile = tile('ranking', 'Ranking', this.rankingSub, () => cb.onRanking());
    this.rankingTile.classList.add('hidden');
    const controlsTile = tile('controls', 'Controles', el('small', { text: 'Teclas do jogo' }), () => this.showControls(true));
    const settingsTile = tile('settings', 'Configurações', el('small', { text: 'Mira, vídeo, áudio e teclas' }), () => cb.onSettings());
    this.buttons = [create, join, practice];

    this.playerCard = el('div', { class: 'player-card' });
    progress.onChange(() => this.renderPlayer());
    this.renderPlayer();

    const top = el('header', { class: 'menu-top' }, [
      el('div', { class: 'menu-brand' }, [
        el('div', { class: 'logo' }, [el('span', { text: 'ARENA' }), el('b', { text: 'FPS' })]),
        el('div', { class: 'subtitle', text: 'Multiplayer no navegador · até 10 jogadores' }),
      ]),
      this.playerCard,
    ]);
    const shell = el('div', { class: 'menu-shell' }, [
      top,
      el('div', { class: 'menu-main' }, [playPanel, roomsPanel]),
      el('nav', { class: 'menu-tiles' }, [armoryTile, this.rankingTile, controlsTile, settingsTile]),
    ]);
    this.root = el('div', { class: 'screen menu hidden' }, [shell]);

    this.controls = el('div', { class: 'overlay controls-overlay hidden' }, [
      el('div', { class: 'panel controls-panel' }, [
        el('h2', { text: 'Controles' }),
        el(
          'div',
          { class: 'controls-grid' },
          CONTROLS.map(([k, d]) => el('div', { class: 'help-row' }, [el('kbd', { text: k }), el('span', { text: d })])),
        ),
        el('p', { class: 'hint', text: 'Todas as teclas podem ser trocadas em Configurações → Controles.' }),
        el('button', { class: 'btn primary', text: 'Fechar', onClick: () => this.showControls(false) }),
      ]),
    ]);
    this.controls.addEventListener('click', (e) => {
      if (e.target === this.controls) this.showControls(false);
    });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && !this.controls.classList.contains('hidden')) this.showControls(false);
    });
    parent.append(this.root, this.controls);
  }

  private showControls(v: boolean): void {
    show(this.controls, v);
  }

  /** Logged in, the profile name is the nickname. Without Supabase configured the account buttons stay hidden. */
  setAccount(profile: Profile | null, available: boolean): void {
    this.profile = profile;
    this.accountAvailable = available;
    show(this.rankingTile, available);
    this.nick.readOnly = profile !== null;
    this.nick.value = profile ? profile.username : loadNick();
    if (!profile) this.rating = null;
    this.renderPlayer();
  }

  /** Null hides the elo, when the rating couldn't be read. */
  setRating(rating: number | null): void {
    this.rating = rating;
    this.renderPlayer();
  }

  private renderPlayer(): void {
    const info = progress.levelInfo;
    const rank = progress.rank;
    const p = this.profile;
    const typed = p ? p.username : sanitizeText(this.nick.value, NAME_MAX);
    const name = typed || 'Convidado';

    const pic = p ? avatar(p.username, p.avatar_url, 'pc-avatar') : el('span', { class: 'avatar pc-avatar guest', text: Array.from(typed)[0]?.toUpperCase() ?? '?' });
    const tags: HTMLElement[] = [el('span', { class: 'pc-rank', text: `${rank.icon} ${rank.name} · Nv ${info.level}`, style: { color: rank.color } })];
    if (p && this.rating !== null) {
      const elo = rankOf(this.rating);
      tags.push(el('span', { class: 'pc-elo' }, [rankBadge(elo), el('span', { text: elo.label })]));
    }
    const actions: HTMLElement[] = [];
    if (this.accountAvailable && !p) {
      actions.push(el('button', { class: 'btn small primary', text: 'Entrar', title: 'Guarde seu progresso numa conta', onClick: () => this.cb.onLogin() }));
    } else if (p) {
      actions.push(
        el('button', { class: 'btn small', text: 'Perfil', onClick: () => this.cb.onProfile() }),
        el('button', { class: 'btn small ghost', text: 'Sair', onClick: () => this.cb.onLogout() }),
      );
    }

    clear(this.playerCard);
    this.playerCard.append(
      el('button', { class: 'pc-main', title: 'Abrir o Arsenal', onClick: () => this.cb.onArmory() }, [
        pic,
        el('span', { class: 'pc-info' }, [
          el('span', { class: 'pc-name-row' }, [el('b', { class: 'pc-name', text: name }), p || !typed ? null : el('span', { class: 'pc-guest', text: 'convidado' })]),
          el('span', { class: 'pc-tags' }, tags),
          xpBar(info.into, info.need),
        ]),
        coinLabel(progress.coins),
      ]),
    );
    if (actions.length) this.playerCard.append(el('div', { class: 'pc-actions' }, actions));
    this.armorySub.textContent = `${progress.coins.toLocaleString('pt-BR')} moedas · skin ${skinById(progress.equipped).name}`;
    if (p && this.rating !== null) this.rankingSub.textContent = `Você: ${rankOf(this.rating).label}`;
    else this.rankingSub.textContent = 'Os melhores por elo';
  }

  /** Redraws only when something changed, so a refresh can't swallow a click on a row. */
  setRooms(rooms: RoomInfo[]): void {
    const key = JSON.stringify(rooms);
    if (key === this.roomsKey) return;
    this.roomsKey = key;
    this.rooms = rooms;
    this.renderRooms();
  }

  private renderRooms(): void {
    clear(this.roomList);
    this.roomCount.textContent = this.rooms.length ? String(this.rooms.length) : '';
    if (this.rooms.length === 0) {
      this.roomList.append(
        el('div', { class: 'rooms-empty' }, [
          el('b', { text: 'Nenhuma sala aberta agora' }),
          el('span', { text: 'Crie uma: ela aparece aqui para todo mundo, e você pode mandar o link para os amigos.' }),
        ]),
      );
      return;
    }
    const status = { lobby: 'No lobby', playing: 'Em partida', ended: 'Resultados' };
    for (const r of this.rooms) {
      const full = r.players >= MAX_PLAYERS;
      const join = el('button', {
        class: 'btn small' + (full ? '' : ' primary'),
        text: full ? 'Cheia' : 'Entrar',
        onClick: () => this.joinRoom(r.code),
      });
      join.disabled = full || this.busy;
      this.roomList.append(
        el('div', { class: 'room-row' }, [
          el('div', { class: 'room-info' }, [
            el('b', { text: `Sala de ${r.host}` }),
            el('small', { text: `${MAP_NAMES[r.map]} · ${ARSENAL_NAMES[r.arsenal]} · ${r.mode === 'bomb' ? 'Bomba' : r.mode === 'tdm' ? 'Times' : 'FFA'}` }),
          ]),
          el('span', { class: 'room-players' + (r.phase === 'playing' ? ' live' : ''), text: `${r.players}/${MAX_PLAYERS} · ${status[r.phase]}` }),
          join,
        ]),
      );
    }
  }

  private renderSwatches(): void {
    clear(this.swatches);
    for (const c of FFA_COLORS) {
      const b = el('button', {
        class: 'swatch' + (c === this.color ? ' active' : ''),
        style: { background: c },
        title: c,
        attrs: { 'aria-label': `Cor ${c}` },
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
    if (!v) this.showControls(false);
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
    this.busy = text !== null;
    this.renderRooms();
    this.status.textContent = text ?? '';
    show(this.status, text !== null);
    if (text) this.setError('');
  }
}

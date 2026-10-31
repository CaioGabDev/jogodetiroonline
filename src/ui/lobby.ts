import {
  FFA_COLORS,
  KILL_LIMITS,
  MAX_PLAYERS,
  TEAM_COLORS,
  TEAM_NAMES,
  TIME_LIMITS,
  type MatchConfig,
  type Team,
} from '../game/constants';
import type { LobbyState, PlayerInfo } from '../net/protocol';
import { clear, el, show } from './dom';
import { toast } from './toast';

export interface LobbyCallbacks {
  onStart(): void;
  onLeave(): void;
  onTeam(t: Team): void;
  onColor(c: string): void;
  onConfig(patch: Partial<MatchConfig>): void;
  onBalance(): void;
}

export function inviteLink(code: string): string {
  return `${location.origin}${location.pathname}?sala=${code}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0' } });
    ta.value = text;
    document.body.append(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export class Lobby {
  readonly root: HTMLElement;
  private codeEl: HTMLElement;
  private players: HTMLElement;
  private config: HTMLElement;
  private actions: HTMLElement;
  private countEl: HTMLElement;
  private state: LobbyState | null = null;
  private localId = -1;

  constructor(
    parent: HTMLElement,
    private cb: LobbyCallbacks,
  ) {
    this.codeEl = el('div', { class: 'room-code' });
    const copyLink = el('button', {
      class: 'btn small',
      text: 'Copiar link',
      onClick: async () => {
        if (!this.state) return;
        const ok = await copyText(inviteLink(this.state.code));
        toast(ok ? 'Link copiado! Envie para seus amigos.' : 'Não foi possível copiar.', ok ? 'ok' : 'error');
      },
    });
    const copyCode = el('button', {
      class: 'btn small ghost',
      text: 'Copiar código',
      onClick: async () => {
        if (!this.state) return;
        const ok = await copyText(this.state.code);
        toast(ok ? 'Código copiado!' : 'Não foi possível copiar.', ok ? 'ok' : 'error');
      },
    });
    this.countEl = el('span', { class: 'count' });
    this.players = el('div', { class: 'lobby-players' });
    this.config = el('div', { class: 'lobby-config' });
    this.actions = el('div', { class: 'lobby-actions' });

    const panel = el('div', { class: 'panel lobby-panel' }, [
      el('div', { class: 'lobby-head' }, [
        el('div', {}, [el('div', { class: 'field-label', text: 'Código da sala' }), this.codeEl]),
        el('div', { class: 'lobby-copy' }, [copyLink, copyCode]),
      ]),
      el('div', { class: 'lobby-body' }, [
        el('div', { class: 'lobby-col' }, [el('h3', {}, ['Jogadores ', this.countEl]), this.players]),
        el('div', { class: 'lobby-col' }, [el('h3', { text: 'Partida' }), this.config]),
      ]),
      this.actions,
    ]);
    this.root = el('div', { class: 'screen lobby hidden' }, [panel]);
    parent.append(this.root);
  }

  show(v: boolean): void {
    show(this.root, v);
  }

  update(state: LobbyState, localId: number): void {
    this.state = state;
    this.localId = localId;
    const isHost = state.hostId === localId;
    const me = state.players.find((p) => p.id === localId);
    this.codeEl.textContent = state.code;
    const humans = state.players.filter((p) => !p.bot);
    this.countEl.textContent = `(${humans.length}/${MAX_PLAYERS})`;

    // Players
    clear(this.players);
    if (state.config.mode === 'tdm') {
      const cols = el('div', { class: 'team-cols' });
      for (const team of ['red', 'blue'] as Team[]) {
        const list = humans.filter((p) => p.team === team);
        const col = el('div', { class: 'team-col', style: { borderColor: TEAM_COLORS[team] } }, [
          el('div', { class: 'team-title', style: { color: TEAM_COLORS[team] } }, [
            `${TEAM_NAMES[team]} (${list.length})`,
          ]),
          ...list.map((p) => this.playerRow(p, TEAM_COLORS[team])),
        ]);
        if (me && me.team !== team) {
          col.append(el('button', { class: 'btn small', text: `Entrar no ${TEAM_NAMES[team]}`, onClick: () => this.cb.onTeam(team) }));
        }
        cols.append(col);
      }
      this.players.append(cols);
    } else {
      humans.forEach((p) => this.players.append(this.playerRow(p, p.color)));
      if (me) {
        const used = new Set(humans.filter((p) => p.id !== localId).map((p) => p.color));
        const sw = el('div', { class: 'swatches' });
        for (const c of FFA_COLORS) {
          sw.append(
            el('button', {
              class: 'swatch' + (c === me.color ? ' active' : '') + (used.has(c) ? ' taken' : ''),
              style: { background: c },
              title: used.has(c) ? 'Cor em uso' : c,
              onClick: () => {
                if (!used.has(c)) this.cb.onColor(c);
              },
            }),
          );
        }
        this.players.append(el('div', { class: 'field-label', text: 'Sua cor' }), sw);
      }
    }

    // Config
    clear(this.config);
    const c = state.config;
    const sel = <T extends string | number>(
      label: string,
      opts: Array<[T, string]>,
      value: T,
      apply: (v: T) => Partial<MatchConfig>,
    ): HTMLElement => {
      if (!isHost) {
        return el('div', { class: 'cfg-row' }, [el('span', { text: label }), el('b', { text: opts.find((o) => o[0] === value)?.[1] ?? String(value) })]);
      }
      const s = el('select');
      opts.forEach(([v, l]) => {
        const o = el('option', { text: l });
        o.value = String(v);
        if (v === value) o.selected = true;
        s.append(o);
      });
      s.addEventListener('change', () => {
        const f = opts.find(([v]) => String(v) === s.value);
        if (f) this.cb.onConfig(apply(f[0]));
      });
      return el('div', { class: 'cfg-row' }, [el('span', { text: label }), s]);
    };
    this.config.append(
      sel<'ffa' | 'tdm'>(
        'Modo',
        [
          ['ffa', 'Mata-mata (FFA)'],
          ['tdm', 'Mata-mata em equipe (TDM)'],
        ],
        c.mode,
        (v) => ({ mode: v }),
      ),
      sel<number>('Limite de kills', KILL_LIMITS.map((k) => [k, `${k} kills`] as [number, string]), c.killLimit, (v) => ({ killLimit: v })),
      sel<number>('Tempo', TIME_LIMITS.map((t) => [t, `${t} min`] as [number, string]), c.timeLimit, (v) => ({ timeLimit: v })),
    );
    if (c.mode === 'tdm') {
      this.config.append(
        sel<string>(
          'Fogo amigo',
          [
            ['off', 'Desligado'],
            ['on', 'Ligado'],
          ],
          c.friendlyFire ? 'on' : 'off',
          (v) => ({ friendlyFire: v === 'on' }),
        ),
      );
    }

    // Actions
    clear(this.actions);
    this.actions.append(el('button', { class: 'btn ghost', text: 'Sair', onClick: () => this.cb.onLeave() }));
    if (isHost) {
      if (c.mode === 'tdm') this.actions.append(el('button', { class: 'btn', text: 'Auto-balancear times', onClick: () => this.cb.onBalance() }));
      const start = el('button', { class: 'btn primary big', text: 'Iniciar partida', onClick: () => this.cb.onStart() });
      this.actions.append(start);
      if (humans.length < 2) this.actions.append(el('div', { class: 'hint', text: 'Você pode iniciar sozinho, mas é mais divertido com amigos: copie o link acima.' }));
    } else {
      this.actions.append(el('div', { class: 'waiting', text: 'Aguardando o host iniciar a partida…' }));
    }
  }

  private playerRow(p: PlayerInfo, color: string): HTMLElement {
    return el('div', { class: 'player-row' + (p.id === this.localId ? ' me' : '') }, [
      el('span', { class: 'sb-dot', style: { background: color } }),
      el('span', { class: 'pname', text: p.name }),
      p.host ? el('span', { class: 'tag', text: 'HOST' }) : null,
      p.id === this.localId ? el('span', { class: 'tag you', text: 'VOCÊ' }) : null,
    ]);
  }
}

import { TEAM_COLORS, TEAM_NAMES, type GameMode } from '../game/constants';
import type { EndMsg } from '../net/protocol';
import { clear, el, show } from './dom';

export interface ResultsCallbacks {
  onRematch(): void;
  onLobby(): void;
  onLeave(): void;
}

export class Results {
  readonly root: HTMLElement;
  private banner: HTMLElement;
  private sub: HTMLElement;
  private mvp: HTMLElement;
  private table: HTMLElement;
  private actions: HTMLElement;

  constructor(
    parent: HTMLElement,
    private cb: ResultsCallbacks,
  ) {
    this.banner = el('div', { class: 'res-banner' });
    this.sub = el('div', { class: 'res-sub' });
    this.mvp = el('div', { class: 'res-mvp' });
    this.table = el('div', { class: 'res-table' });
    this.actions = el('div', { class: 'lobby-actions' });
    const panel = el('div', { class: 'panel results-panel' }, [this.banner, this.sub, this.mvp, this.table, this.actions]);
    this.root = el('div', { class: 'overlay results hidden' }, [panel]);
    parent.append(this.root);
  }

  show(v: boolean): void {
    show(this.root, v);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  render(m: EndMsg, mode: GameMode, localId: number, isHost: boolean, offline: boolean, myTeam: string): void {
    let won = false;
    if (mode === 'tdm') {
      if (m.winnerTeam) {
        won = m.winnerTeam === myTeam;
        this.banner.textContent = won ? 'VITÓRIA!' : 'DERROTA';
        this.sub.textContent = `Time ${TEAM_NAMES[m.winnerTeam]} venceu · ${m.teams[0]} x ${m.teams[1]}`;
        this.sub.style.color = TEAM_COLORS[m.winnerTeam];
      } else {
        this.banner.textContent = 'EMPATE';
        this.sub.textContent = `${m.teams[0]} x ${m.teams[1]}`;
        this.sub.style.color = '';
      }
    } else {
      const w = m.results.find((r) => r.id === m.winnerId);
      won = m.winnerId === localId;
      this.banner.textContent = w ? (won ? 'VITÓRIA!' : 'FIM DE PARTIDA') : 'EMPATE';
      this.sub.textContent = w ? `${w.name} venceu com ${w.kills} kills` : 'Ninguém ficou sozinho no topo';
      this.sub.style.color = w?.color ?? '';
    }
    this.sub.textContent += m.reason === 'time' ? ' (tempo esgotado)' : '';
    this.banner.classList.toggle('win', won);

    clear(this.mvp);
    const mvp = m.results.find((r) => r.id === m.mvp);
    if (mvp) {
      this.mvp.append(
        el('div', { class: 'mvp-label', text: '★ MVP' }),
        el('div', { class: 'mvp-name', text: mvp.name, style: { color: mode === 'tdm' ? TEAM_COLORS[mvp.team] : mvp.color } }),
        el('div', { class: 'mvp-stats', text: `${mvp.kills} kills · ${mvp.deaths} mortes · ${mvp.damage} dano · ${mvp.headshots} HS` }),
      );
    }

    clear(this.table);
    const t = el('table', { class: 'sb-table' });
    t.append(
      el('tr', {}, ['#', 'Jogador', 'Kills', 'Mortes', 'K/D', 'Dano', 'HS'].map((h, i) => el('th', { text: h, class: i === 1 ? 'left' : '' }))),
    );
    m.results.forEach((r, i) => {
      const kd = r.deaths === 0 ? r.kills.toFixed(2) : (r.kills / r.deaths).toFixed(2);
      const color = mode === 'tdm' ? TEAM_COLORS[r.team] : r.color;
      t.append(
        el('tr', { class: r.id === localId ? 'me' : '' }, [
          el('td', { text: String(i + 1) }),
          el('td', { class: 'left' }, [el('span', { class: 'sb-dot', style: { background: color } }), el('span', { text: r.name }), r.id === m.mvp ? el('span', { class: 'tag', text: 'MVP' }) : null]),
          el('td', { text: String(r.kills) }),
          el('td', { text: String(r.deaths) }),
          el('td', { text: kd }),
          el('td', { text: String(r.damage) }),
          el('td', { text: String(r.headshots) }),
        ]),
      );
    });
    this.table.append(t);

    clear(this.actions);
    this.actions.append(el('button', { class: 'btn ghost', text: 'Sair', onClick: () => this.cb.onLeave() }));
    if (isHost) {
      if (!offline) this.actions.append(el('button', { class: 'btn', text: 'Voltar ao lobby', onClick: () => this.cb.onLobby() }));
      this.actions.append(el('button', { class: 'btn primary big', text: 'Revanche', onClick: () => this.cb.onRematch() }));
    } else {
      this.actions.append(el('div', { class: 'waiting', text: 'Aguardando o host (revanche ou lobby)…' }));
    }
  }
}

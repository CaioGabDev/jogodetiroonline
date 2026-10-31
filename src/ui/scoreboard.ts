import { TEAM_COLORS, TEAM_NAMES, type GameMode, type Team } from '../game/constants';
import { clear, el, show } from './dom';

export interface ScoreEntry {
  id: number;
  name: string;
  color: string;
  team: Team;
  kills: number;
  deaths: number;
  ping: number;
  bot: boolean;
  host: boolean;
  alive: boolean;
}

export class Scoreboard {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private title: HTMLElement;

  constructor(parent: HTMLElement) {
    this.title = el('div', { class: 'sb-title' });
    this.body = el('div', { class: 'sb-body' });
    this.root = el('div', { class: 'scoreboard hidden' }, [this.title, this.body]);
    parent.append(this.root);
  }

  show(v: boolean): void {
    show(this.root, v);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  render(mode: GameMode, entries: ScoreEntry[], localId: number, teams: [number, number], subtitle: string): void {
    clear(this.body);
    this.title.textContent = (mode === 'tdm' ? 'MATA-MATA EM EQUIPE' : 'MATA-MATA') + (subtitle ? ` — ${subtitle}` : '');
    const sorted = [...entries].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || a.id - b.id);
    if (mode === 'tdm') {
      for (const team of ['red', 'blue'] as Team[]) {
        const score = team === 'red' ? teams[0] : teams[1];
        const head = el('div', { class: 'sb-team', style: { borderColor: TEAM_COLORS[team] } }, [
          el('span', { text: TEAM_NAMES[team].toUpperCase(), style: { color: TEAM_COLORS[team] } }),
          el('span', { class: 'sb-team-score', text: String(score) }),
        ]);
        this.body.append(head, this.table(sorted.filter((e) => e.team === team), localId));
      }
    } else {
      this.body.append(this.table(sorted, localId));
    }
  }

  private table(rows: ScoreEntry[], localId: number): HTMLElement {
    const t = el('table', { class: 'sb-table' });
    t.append(
      el('tr', {}, [
        el('th', { text: '#' }),
        el('th', { text: 'Jogador', class: 'left' }),
        el('th', { text: 'Kills' }),
        el('th', { text: 'Mortes' }),
        el('th', { text: 'K/D' }),
        el('th', { text: 'Ping' }),
      ]),
    );
    rows.forEach((r, i) => {
      const kd = r.deaths === 0 ? r.kills.toFixed(2) : (r.kills / r.deaths).toFixed(2);
      const tags: string[] = [];
      if (r.host) tags.push('HOST');
      if (r.bot) tags.push('BOT');
      t.append(
        el('tr', { class: (r.id === localId ? 'me ' : '') + (r.alive ? '' : 'dead') }, [
          el('td', { text: String(i + 1) }),
          el('td', { class: 'left' }, [
            el('span', { class: 'sb-dot', style: { background: r.color } }),
            el('span', { text: r.name }),
            ...tags.map((tg) => el('span', { class: 'tag', text: tg })),
          ]),
          el('td', { text: String(r.kills) }),
          el('td', { text: String(r.deaths) }),
          el('td', { text: kd }),
          el('td', { text: r.bot ? '—' : String(r.ping) }),
        ]),
      );
    });
    return t;
  }
}

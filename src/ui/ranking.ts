import { account } from '../net/account';
import { loadRanking, type RankRow } from '../net/ranking';
import { avatar } from './avatar';
import { clear, el, show } from './dom';

/** Top players by kills, plus the logged-in player's own place when it falls outside the list. */
export class RankingScreen {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private mine: HTMLElement;
  private request = 0;

  constructor(parent: HTMLElement) {
    this.list = el('div', { class: 'rank-list' });
    this.mine = el('div', { class: 'rank-mine' });
    const panel = el('div', { class: 'panel rank-panel' }, [
      el('h2', { text: 'Ranking' }),
      el('div', { class: 'rank-row rank-head' }, [
        el('span', { text: '#' }),
        el('span', { text: 'Jogador' }),
        el('span', { class: 'rank-num', text: 'Kills' }),
        el('span', { class: 'rank-num', text: 'Mortes' }),
      ]),
      this.list,
      this.mine,
      el('p', { class: 'hint', text: 'Contam as partidas online com outro jogador, jogadas até o fim com uma conta.' }),
      el('button', { class: 'btn ghost', text: 'Fechar', onClick: () => this.close() }),
    ]);
    this.root = el('div', { class: 'overlay ranking hidden' }, [panel]);
    parent.append(this.root);
  }

  open(): void {
    show(this.root, true);
    void this.refresh();
  }

  close(): void {
    show(this.root, false);
  }

  private row(r: RankRow): HTMLElement {
    const me = r.user_id === account.profile?.id;
    return el('div', { class: 'rank-row' + (me ? ' me' : '') }, [
      el('span', { class: 'rank-place', text: String(r.place) }),
      el('span', { class: 'rank-player' }, [avatar(r.username, r.avatar_url), el('span', { class: 'pname', text: r.username })]),
      el('span', { class: 'rank-num', text: String(r.kills) }),
      el('span', { class: 'rank-num', text: String(r.deaths) }),
    ]);
  }

  private message(text: string): void {
    clear(this.list);
    clear(this.mine);
    this.list.append(el('p', { class: 'hint', text }));
  }

  private async refresh(): Promise<void> {
    const request = ++this.request;
    this.message('Carregando…');
    const data = await loadRanking().catch(() => null);
    if (request !== this.request) return;
    if (!data) {
      this.message('Não foi possível carregar o ranking. Tente de novo.');
      return;
    }
    if (data.top.length === 0) {
      this.message('Ninguém no ranking ainda. Jogue uma partida online com sua conta!');
      return;
    }
    clear(this.list);
    data.top.forEach((r) => this.list.append(this.row(r)));
    const listed = data.top.some((r) => r.user_id === data.me?.user_id);
    if (data.me && !listed) this.mine.append(this.row(data.me));
  }
}

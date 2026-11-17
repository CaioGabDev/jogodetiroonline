import { missions } from '../core/missions';
import { MAP_NAMES, type MapId } from '../game/constants';
import { MISSIONS, msUntilReset, type MissionDef, type MissionPeriod } from '../game/missions';
import { account } from '../net/account';
import { coinLabel } from './armory';
import { clear, el, show } from './dom';
import { toast } from './toast';

const fmt = (n: number): string => n.toLocaleString('pt-BR');
const MODE_LABELS: Record<string, string> = { ffa: 'FFA', tdm: 'Times', bomb: 'Bomba', gungame: 'Gun Game' };

function resetIn(period: MissionPeriod): string {
  const ms = msUntilReset(period);
  const h = Math.floor(ms / 3600000);
  if (h >= 24) return `renova em ${Math.floor(h / 24)}d ${h % 24}h`;
  return `renova em ${h}h ${Math.floor((ms % 3600000) / 60000)}min`;
}

/** Daily and weekly missions, and the last online matches. */
export class MissionsScreen {
  readonly root: HTMLElement;
  private body: HTMLElement;
  private tabs: HTMLElement;
  private tab: 'missoes' | 'historico' = 'missoes';
  private busy = false;

  constructor(parent: HTMLElement) {
    this.body = el('div', { class: 'missions-body' });
    this.tabs = el('div', { class: 'missions-tabs' });
    const panel = el('div', { class: 'panel missions-panel' }, [
      el('h2', { text: 'Missões e histórico' }),
      this.tabs,
      this.body,
      el('button', { class: 'btn ghost', text: 'Fechar', onClick: () => this.close() }),
    ]);
    this.root = el('div', { class: 'overlay missions hidden' }, [panel]);
    parent.append(this.root);
    missions.onChange(() => this.visible && this.render());
    window.addEventListener('keydown', (e) => {
      if (this.visible && e.code === 'Escape') this.close();
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.render();
    show(this.root, true);
  }

  close(): void {
    show(this.root, false);
  }

  private render(): void {
    clear(this.tabs);
    const tab = (id: typeof this.tab, label: string): HTMLElement =>
      el('button', {
        class: 'btn small' + (this.tab === id ? ' primary' : ''),
        text: label,
        onClick: () => {
          this.tab = id;
          this.render();
        },
      });
    const ready = missions.ready;
    this.tabs.append(tab('missoes', ready ? `Missões (${ready})` : 'Missões'), tab('historico', 'Histórico'));
    clear(this.body);
    if (this.tab === 'missoes') this.renderMissions();
    else this.renderHistory();
  }

  private renderMissions(): void {
    for (const period of ['daily', 'weekly'] as MissionPeriod[]) {
      this.body.append(
        el('div', { class: 'missions-head' }, [el('h3', { text: period === 'daily' ? 'Diárias' : 'Semanais' }), el('span', { class: 'hint', text: resetIn(period) })]),
      );
      for (const m of MISSIONS.filter((x) => x.period === period)) this.body.append(this.mission(m));
    }
    this.body.append(
      el('p', {
        class: 'hint',
        text: account.profile
          ? 'As moedas vão para a sua conta. Alvos e treinos de mira contam no Treinar; abates, headshots e vitórias, nas partidas online.'
          : 'Jogando como convidado: missões e moedas ficam neste navegador. Alvos e treinos de mira contam no Treinar.',
      }),
    );
  }

  private mission(m: MissionDef): HTMLElement {
    const { done, claimed } = missions.progressOf(m);
    const complete = done >= m.goal;
    const pct = Math.min(100, (done / m.goal) * 100);
    let action: HTMLElement;
    if (claimed) action = el('span', { class: 'mission-done', text: 'Resgatada ✓' });
    else if (complete)
      action = el('button', {
        class: 'btn small primary',
        text: 'Resgatar',
        onClick: () => void this.claim(m),
      });
    else action = coinLabel(m.reward);
    return el('div', { class: 'mission' + (claimed ? ' claimed' : complete ? ' complete' : '') }, [
      el('div', { class: 'mission-info' }, [
        el('div', { class: 'mission-text', text: m.text }),
        el('div', { class: 'xp-bar' }, [el('div', { class: 'xp-fill', style: { width: `${pct}%` } }), el('span', { text: `${fmt(done)} / ${fmt(m.goal)}` })]),
      ]),
      action,
    ]);
  }

  private async claim(m: MissionDef): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.body.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      const r = await missions.claim(m.id);
      if (r === 'ok') toast(`+${fmt(m.reward)} moedas: ${m.text}`, 'ok');
      else if (r === 'claimed') toast('Essa missão já foi resgatada neste período.', 'info');
      else toast('Não deu para resgatar agora. Tente de novo.', 'error');
    } finally {
      this.busy = false;
      if (this.visible) this.render();
    }
  }

  private renderHistory(): void {
    const list = missions.history;
    if (!list.length) {
      this.body.append(el('p', { class: 'hint', text: 'Nenhuma partida online ainda. As últimas 30 aparecem aqui.' }));
      return;
    }
    const wins = list.filter((h) => h.won).length;
    const kills = list.reduce((a, h) => a + h.kills, 0);
    const deaths = list.reduce((a, h) => a + h.deaths, 0);
    this.body.append(
      el('p', { class: 'hint', text: `Últimas ${list.length}: ${wins} vitórias · K/D ${(kills / Math.max(1, deaths)).toFixed(2).replace('.', ',')}` }),
      el('div', { class: 'history-row history-head' }, ['Resultado', 'Mapa · modo', 'K / D', 'HS', 'Dano', 'Quando'].map((t) => el('span', { text: t }))),
    );
    for (const h of list) {
      const when = new Date(h.t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
      this.body.append(
        el('div', { class: 'history-row' + (h.won ? ' won' : ' lost') }, [
          el('span', { class: 'history-result', text: (h.won ? 'Vitória' : 'Derrota') + (h.mvp ? ' · MVP' : '') }),
          el('span', { text: `${MAP_NAMES[h.map as MapId] ?? h.map} · ${MODE_LABELS[h.mode] ?? h.mode}` }),
          el('span', { text: `${h.kills} / ${h.deaths}` }),
          el('span', { text: String(h.headshots) }),
          el('span', { text: fmt(h.damage) }),
          el('span', { class: 'hint', text: when }),
        ]),
      );
    }
  }
}

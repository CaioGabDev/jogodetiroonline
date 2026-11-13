import { sanitizeText } from '../core/util';
import { NAME_MAX } from '../game/constants';
import { progress } from '../core/progress';
import { statLines, type CareerStats } from '../game/stats';
import { account } from '../net/account';
import { saveAvatar, saveUsername } from '../net/profile';
import { loadMyStats } from '../net/ranking';
import { avatar } from './avatar';
import { clear, el, show } from './dom';
import { toast } from './toast';

/** Name and picture of the logged-in player. */
export class ProfileScreen {
  readonly root: HTMLElement;
  private picture: HTMLElement;
  private file: HTMLInputElement;
  private name: HTMLInputElement;
  private save: HTMLButtonElement;
  private pick: HTMLButtonElement;
  private error: HTMLElement;
  private edit: HTMLElement;
  private stats: HTMLElement;
  private statsNote: HTMLElement;
  private request = 0;

  constructor(parent: HTMLElement) {
    this.picture = el('div', { class: 'profile-picture' });
    this.file = el('input', { class: 'hidden', attrs: { type: 'file', accept: 'image/png,image/jpeg,image/webp' } });
    this.file.addEventListener('change', () => {
      const f = this.file.files?.[0];
      this.file.value = '';
      if (f) void this.run(() => saveAvatar(f), 'Foto atualizada!');
    });
    this.pick = el('button', { class: 'btn small', text: 'Trocar foto', onClick: () => this.file.click() });
    this.name = el('input', { class: 'input', attrs: { maxlength: String(NAME_MAX), autocomplete: 'off', spellcheck: 'false' } });
    this.save = el('button', { class: 'btn primary', text: 'Salvar nome', attrs: { type: 'submit' } });
    this.error = el('div', { class: 'error hidden' });

    const form = el('form', { class: 'auth-form' }, [el('label', { class: 'field-label', text: 'Nome de jogador' }), this.name, this.error, this.save]);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const n = sanitizeText(this.name.value, NAME_MAX);
      if (n.length < 3) this.setError('O nome precisa de pelo menos 3 caracteres.');
      else void this.run(() => saveUsername(n), 'Nome atualizado!');
    });

    this.stats = el('div', { class: 'stat-grid' });
    this.statsNote = el('p', { class: 'hint' });
    this.edit = el('div', { class: 'profile-edit' }, [
      el('div', { class: 'profile-head' }, [this.picture, this.pick, this.file]),
      form,
      el('p', { class: 'hint', text: 'Esse nome aparece nas partidas e no ranking.' }),
    ]);
    const panel = el('div', { class: 'panel auth-panel profile-panel' }, [
      el('h2', { text: 'Perfil' }),
      el('h3', { class: 'stat-title', text: 'Estatísticas' }),
      this.stats,
      this.statsNote,
      this.edit,
      el('button', { class: 'btn ghost', text: 'Fechar', onClick: () => this.close() }),
    ]);
    this.root = el('div', { class: 'overlay profile hidden' }, [panel]);
    parent.append(this.root);
  }

  open(): void {
    this.setError('');
    this.name.value = account.profile?.username ?? '';
    this.drawPicture();
    show(this.edit, account.profile !== null);
    show(this.root, true);
    void this.loadStats();
  }

  /** Logged in, the totals come from the account; a guest sees this browser's. */
  private async loadStats(): Promise<void> {
    const request = ++this.request;
    const guest = account.profile === null;
    this.statsNote.textContent = guest ? 'Estatísticas deste navegador. Entre numa conta para guardar e levar para outros lugares.' : 'Contam as partidas online com outro jogador, jogadas até o fim.';
    if (guest) return this.drawStats(progress.career);
    this.drawStats(null);
    const stats = await loadMyStats().catch(() => null);
    if (request !== this.request) return;
    if (stats) this.drawStats(stats);
    else this.statsNote.textContent = 'Não foi possível carregar as estatísticas.';
  }

  private drawStats(stats: CareerStats | null): void {
    clear(this.stats);
    if (!stats) {
      this.stats.append(el('p', { class: 'hint', text: 'Carregando…' }));
      return;
    }
    for (const s of statLines(stats)) {
      this.stats.append(el('div', { class: 'stat' }, [el('small', { text: s.label }), el('b', { text: s.value }), s.note ? el('span', { text: s.note }) : null]));
    }
  }

  close(): void {
    show(this.root, false);
  }

  private drawPicture(): void {
    const p = account.profile;
    clear(this.picture);
    if (p) this.picture.append(avatar(p.username, p.avatar_url, 'big'));
  }

  private setError(msg: string): void {
    this.error.textContent = msg;
    show(this.error, !!msg);
  }

  private async run(attempt: () => Promise<string | null>, done: string): Promise<void> {
    this.save.disabled = this.pick.disabled = true;
    this.setError('');
    let error: string | null;
    try {
      error = await attempt();
    } catch (e) {
      console.error('Falha ao salvar o perfil', e);
      error = 'Sem conexão com o servidor de contas. Tente de novo.';
    }
    this.save.disabled = this.pick.disabled = false;
    if (error) {
      this.setError(error);
      return;
    }
    toast(done, 'ok');
    this.drawPicture();
  }
}

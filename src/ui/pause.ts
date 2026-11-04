import { TEAM_NAMES, type Team } from '../game/constants';
import { el, show } from './dom';
import { copyText, inviteLink } from './lobby';
import { toast } from './toast';

export interface PauseCallbacks {
  onResume(): void;
  onSettings(): void;
  onLeave(): void;
  onTeam(team: Team): void;
}

/** ESC menu. The match keeps running in the background. */
export class PauseMenu {
  readonly root: HTMLElement;
  private codeRow: HTMLElement;
  private code = '';
  private title: HTMLElement;
  private teamBtn: HTMLElement;
  private otherTeam: Team | null = null;

  constructor(parent: HTMLElement, cb: PauseCallbacks) {
    this.title = el('h2', { text: 'PAUSA' });
    this.teamBtn = el('button', {
      class: 'btn hidden',
      onClick: () => {
        if (this.otherTeam) cb.onTeam(this.otherTeam);
      },
    });
    this.codeRow = el('div', { class: 'pause-code' });
    const panel = el('div', { class: 'panel pause-panel' }, [
      this.title,
      el('p', { class: 'hint', text: 'A partida continua rodando.' }),
      el('button', { class: 'btn primary big', text: 'Continuar', onClick: () => cb.onResume() }),
      this.teamBtn,
      el('button', { class: 'btn', text: 'Configurações', onClick: () => cb.onSettings() }),
      el('button', { class: 'btn danger', text: 'Sair da partida', onClick: () => cb.onLeave() }),
      this.codeRow,
    ]);
    this.root = el('div', { class: 'overlay pause hidden' }, [panel]);
    parent.append(this.root);
  }

  show(v: boolean, firstTime = false): void {
    show(this.root, v);
    this.title.textContent = firstTime ? 'PRONTO?' : 'PAUSA';
  }

  /** The team the button moves the player to, or null to hide it (no teams in this match). */
  setOtherTeam(team: Team | null): void {
    this.otherTeam = team;
    show(this.teamBtn, team !== null);
    if (team) this.teamBtn.textContent = `Ir para o time ${TEAM_NAMES[team]}`;
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  setRoom(code: string, offline: boolean): void {
    this.code = code;
    while (this.codeRow.firstChild) this.codeRow.removeChild(this.codeRow.firstChild);
    if (offline) return;
    this.codeRow.append(
      el('span', { text: 'Sala ' }),
      el('b', { text: code }),
      el('button', {
        class: 'btn small ghost',
        text: 'Copiar link',
        onClick: async () => {
          const ok = await copyText(inviteLink(this.code));
          toast(ok ? 'Link copiado!' : 'Não foi possível copiar.', ok ? 'ok' : 'error');
        },
      }),
    );
  }
}

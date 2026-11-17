import { account } from '../net/account';
import { social, type Friend, type Invite, type SocialState } from '../net/social';
import { avatar } from './avatar';
import { clear, el, show } from './dom';
import { toast } from './toast';

export interface SocialCallbacks {
  /** Room this player is in (online), or null. */
  currentRoom(): string | null;
  /** Joins a friend's room, leaving the current one. */
  joinRoom(code: string): void;
  /** Asks for a new poll right away (after an action). */
  refresh(): void;
}

const REQUEST_MSGS: Record<string, string> = {
  ok: 'Pedido de amizade enviado!',
  accepted: 'Vocês agora são amigos!',
  not_found: 'Ninguém com esse nome.',
  self: 'Esse é você.',
  exists: 'Vocês já são amigos ou o pedido já foi enviado.',
  full: 'Lista de amigos cheia (200).',
};
const INVITE_MSGS: Record<string, string> = {
  ok: 'Convite enviado!',
  wait: 'Espere alguns segundos antes de convidar de novo.',
  no_room: 'Entre numa sala online primeiro.',
  not_friends: 'Só dá para convidar amigos.',
  full: 'O grupo está cheio (5).',
};

/** Friends list, requests, the party, and the invite cards that pop up anywhere. */
export class SocialScreen {
  readonly root: HTMLElement;
  private list: HTMLElement;
  private partyBox: HTMLElement;
  private input: HTMLInputElement;
  private cards: HTMLElement;
  private state: SocialState = { friends: [], invites: [], party: null };
  /** Invites already shown, so a poll doesn't bring them back after a dismiss. */
  private seen = new Set<number>();

  constructor(
    parent: HTMLElement,
    private cb: SocialCallbacks,
  ) {
    this.input = el('input', { class: 'input', attrs: { placeholder: 'Nome do jogador', maxlength: '16', spellcheck: 'false' } });
    const add = el('button', { class: 'btn primary', text: 'Adicionar', onClick: () => void this.add() });
    this.input.addEventListener('keydown', (e) => {
      if (e.code === 'Enter') void this.add();
    });
    this.partyBox = el('div', { class: 'party-box' });
    this.list = el('div', { class: 'friend-list' });
    const panel = el('div', { class: 'panel social-panel' }, [
      el('h2', { text: 'Amigos' }),
      el('div', { class: 'friend-add' }, [this.input, add]),
      this.partyBox,
      this.list,
      el('button', { class: 'btn ghost', text: 'Fechar', onClick: () => this.close() }),
    ]);
    this.root = el('div', { class: 'overlay social hidden' }, [panel]);
    this.cards = el('div', { class: 'invite-cards' });
    parent.append(this.root, this.cards);
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
    this.cb.refresh();
    window.setTimeout(() => this.input.focus(), 50);
  }

  close(): void {
    show(this.root, false);
  }

  /** Friends waiting for an answer, for the menu badge. */
  get pending(): number {
    return this.state.friends.filter((f) => f.status === 'incoming').length;
  }

  update(state: SocialState): void {
    this.state = state;
    if (this.visible) this.render();
    this.renderCards();
  }

  private async act(task: Promise<string | boolean | void | null>, msgs?: Record<string, string>): Promise<void> {
    const r = await task;
    if (msgs && typeof r === 'string') toast(msgs[r] ?? 'Não deu certo. Tente de novo.', r === 'ok' || r === 'accepted' ? 'ok' : 'warn');
    else if (r === null) toast('Sem conexão com o servidor. Tente de novo.', 'error');
    this.cb.refresh();
  }

  private async add(): Promise<void> {
    const n = this.input.value.trim();
    if (n.length < 3) return;
    this.input.value = '';
    await this.act(social.request(n), REQUEST_MSGS);
  }

  private render(): void {
    clear(this.partyBox);
    const me = account.profile?.id;
    const p = this.state.party;
    if (p) {
      const leader = p.leader === me;
      this.partyBox.append(
        el('div', { class: 'party-head' }, [
          el('h3', { text: `Grupo (${p.members.length}/5)` }),
          el('button', { class: 'btn small', text: 'Sair do grupo', onClick: () => void this.act(social.leaveParty()) }),
        ]),
        el(
          'div',
          { class: 'party-members' },
          p.members.map((m) => el('span', { class: 'party-member' + (m.online ? ' online' : '') }, [el('i'), m.username + (m.id === p.leader ? ' ★' : '')])),
        ),
        el('p', {
          class: 'hint',
          text: leader ? 'Você é o líder: quem está no grupo entra junto na sala em que você entrar.' : 'O líder (★) escolhe a sala: você entra junto com ele.',
        }),
      );
    } else {
      this.partyBox.append(el('p', { class: 'hint', text: 'Chame amigos para um grupo e entrem juntos nas salas.' }));
    }

    clear(this.list);
    const friends = this.state.friends;
    if (!friends.length) this.list.append(el('p', { class: 'hint', text: 'Nenhum amigo ainda. Adicione pelo nome do jogador.' }));
    for (const f of friends) this.list.append(this.row(f));
  }

  private row(f: Friend): HTMLElement {
    const here = this.cb.currentRoom();
    const actions: HTMLElement[] = [];
    let status: string;
    if (f.status === 'incoming') {
      status = 'Quer ser seu amigo';
      actions.push(
        el('button', { class: 'btn small primary', text: 'Aceitar', onClick: () => void this.act(social.respond(f.id, true)) }),
        el('button', { class: 'btn small', text: 'Recusar', onClick: () => void this.act(social.respond(f.id, false)) }),
      );
    } else if (f.status === 'outgoing') {
      status = 'Pedido enviado';
      actions.push(el('button', { class: 'btn small', text: 'Cancelar', onClick: () => void this.act(social.remove(f.id)) }));
    } else {
      status = f.online ? (f.room ? `Na sala ${f.room}` : 'Online') : 'Offline';
      if (f.online && f.room && f.room !== here) actions.push(el('button', { class: 'btn small primary', text: 'Entrar', onClick: () => this.cb.joinRoom(f.room!) }));
      if (here && f.room !== here) actions.push(el('button', { class: 'btn small', text: 'Chamar p/ sala', onClick: () => void this.act(social.inviteRoom(f.id, here), INVITE_MSGS) }));
      if (!this.state.party?.members.some((m) => m.id === f.id)) actions.push(el('button', { class: 'btn small', text: 'Chamar p/ grupo', onClick: () => void this.act(social.inviteParty(f.id), INVITE_MSGS) }));
      actions.push(
        el('button', {
          class: 'btn small ghost',
          text: 'Remover',
          onClick: () => {
            if (window.confirm(`Remover ${f.username} dos amigos?`)) void this.act(social.remove(f.id));
          },
        }),
      );
    }
    return el('div', { class: 'friend-row' + (f.online && f.status === 'accepted' ? ' online' : '') }, [
      avatar(f.username, f.avatar),
      el('div', { class: 'friend-info' }, [el('b', { text: f.username }), el('span', { class: 'hint', text: status })]),
      el('div', { class: 'friend-actions' }, actions),
    ]);
  }

  /** Invite cards in the corner, until answered or they expire. */
  private renderCards(): void {
    const live = new Set(this.state.invites.map((i) => i.id));
    for (const card of [...this.cards.children] as HTMLElement[]) if (!live.has(Number(card.dataset.id))) card.remove();
    for (const i of this.state.invites) {
      if (this.seen.has(i.id)) continue;
      this.seen.add(i.id);
      this.cards.append(this.card(i));
    }
  }

  private card(i: Invite): HTMLElement {
    const card = el('div', { class: 'invite-card' });
    card.dataset.id = String(i.id);
    const done = (accept: boolean): void => {
      card.remove();
      void social.answer(i.id, accept).then((r) => {
        if (accept && i.kind === 'party') toast(r === 'ok' ? `Você entrou no grupo de ${i.name}.` : r === 'full' ? 'O grupo está cheio.' : 'Esse convite expirou.', r === 'ok' ? 'ok' : 'warn');
        this.cb.refresh();
      });
      if (accept && i.kind === 'room' && i.room) this.cb.joinRoom(i.room);
    };
    card.append(
      el('div', { text: i.kind === 'room' ? `${i.name} te chamou para a sala ${i.room}` : `${i.name} te chamou para o grupo` }),
      el('div', { class: 'invite-actions' }, [
        el('button', { class: 'btn small primary', text: i.kind === 'room' ? 'Entrar' : 'Entrar no grupo', onClick: () => done(true) }),
        el('button', { class: 'btn small ghost', text: 'Agora não', onClick: () => done(false) }),
      ]),
    );
    return card;
  }
}

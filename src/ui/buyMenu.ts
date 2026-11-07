import { ITEM, ITEM_NAMES, SHOP, SHOP_MENU, isWeaponItem } from '../game/bomb';
import { WEAPONS } from '../game/weapons';
import { clear, el, show } from './dom';

export interface BuyState {
  money: number;
  /** Primary, if any, and pistol. */
  ld: number[];
  armor: number;
  helmet: boolean;
  defuseKit: boolean;
  mag: number[];
  attacker: boolean;
  /** The other players on the team. */
  team: Array<{ name: string; money: number }>;
}

/** Why this can't be bought right now, or null. */
function blocked(item: number, s: BuyState): string | null {
  const price = SHOP[item]?.price ?? 0;
  if (item === ITEM.KEVLAR && s.armor >= 100) return 'Você já tem';
  if (item === ITEM.HELMET && s.helmet) return 'Você já tem';
  if (item === ITEM.HELMET && s.armor <= 0) return 'Compre o colete antes';
  if (item === ITEM.KIT && s.defuseKit) return 'Você já tem';
  if (item === ITEM.KIT && s.attacker) return 'Só para a defesa';
  if (s.ld.includes(item)) return 'Você já tem';
  const max = SHOP[item]?.max;
  if (max !== undefined && s.mag[item] >= max) return 'Limite atingido';
  return price > s.money ? 'Sem dinheiro' : null;
}

const describe = (item: number): string => {
  if (item === ITEM.KEVLAR) return 'Reduz o dano no corpo';
  if (item === ITEM.HELMET) return 'Protege de headshots';
  if (item === ITEM.KIT) return 'Desarma em 5 s, não em 10';
  return WEAPONS[item].desc;
};

/** Buy screen of the bomb mode. The host has the last word: every click is a request. */
export class BuyMenu {
  readonly root: HTMLElement;
  private money: HTMLElement;
  private body: HTMLElement;
  private team: HTMLElement;
  /** Last state drawn: redrawing under the cursor would lose a click. */
  private drawn = '';

  constructor(
    parent: HTMLElement,
    private onBuy: (item: number) => void,
    onDone: () => void,
  ) {
    this.money = el('div', { class: 'loadout-timer' });
    this.body = el('div', { class: 'loadout-body' });
    this.team = el('div', { class: 'buy-team' });
    const panel = el('div', { class: 'panel loadout-panel' }, [
      el('div', { class: 'loadout-head' }, [el('h2', { text: 'Comprar' }), this.money]),
      this.team,
      this.body,
      el('button', { class: 'btn primary big', text: 'Fechar (B)', onClick: () => onDone() }),
    ]);
    this.root = el('div', { class: 'overlay buy-menu hidden' }, [panel]);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(state: BuyState): void {
    this.update(state);
    show(this.root, true);
  }

  close(): void {
    show(this.root, false);
  }

  update(state: BuyState): void {
    const key = JSON.stringify(state);
    if (key === this.drawn) return;
    this.drawn = key;
    this.money.textContent = `$${state.money}`;
    clear(this.team);
    for (const mate of state.team) this.team.append(el('span', {}, [`${mate.name} `, el('b', { text: `$${mate.money}` })]));
    clear(this.body);
    for (const { title, items } of SHOP_MENU) {
      const cards = items.map((item) => {
        const why = blocked(item, state);
        const name = isWeaponItem(item) ? WEAPONS[item].name : ITEM_NAMES[item];
        // Buying has to be quick: name and price, with the description on hover.
        const card = el('button', { class: 'loadout-card', title: describe(item), onClick: () => this.onBuy(item) }, [
          el('b', { text: name }),
          el('small', { class: 'loadout-mag', text: why ?? `$${SHOP[item]?.price}` }),
        ]);
        card.disabled = why !== null;
        return card;
      });
      this.body.append(el('div', { class: 'loadout-col' }, [el('h3', { text: title }), el('div', { class: 'loadout-grid' }, cards)]));
    }
  }
}

import { LETHALS, PISTOLS, PRIMARIES, TACTICALS, W, WEAPONS, magLabel } from '../game/weapons';
import { clear, el, show } from './dom';

const SLOTS = [
  { name: 'Slot 1 (primária)', items: PRIMARIES },
  { name: 'Slot 2 (primária)', items: PRIMARIES },
  { name: 'Slot 3 (pistola)', items: PISTOLS },
  { name: 'Letal (ao renascer)', items: LETHALS },
  { name: 'Tática (ao renascer)', items: TACTICALS },
];

/** Mid-match weapon screen: pick a slot, then the weapon that goes in it. Applies on every click. */
export class Inventory {
  readonly root: HTMLElement;
  private slotsEl: HTMLElement;
  private grid: HTMLElement;
  private loadout: number[] = [];
  private slot = 0;
  private grenades = true;

  constructor(
    parent: HTMLElement,
    private onChange: (weapons: number[]) => void,
    onDone: () => void,
  ) {
    this.slotsEl = el('div', { class: 'inventory-slots' });
    this.grid = el('div', { class: 'loadout-grid' });
    const panel = el('div', { class: 'panel loadout-panel' }, [
      el('h2', { text: 'Inventário' }),
      this.slotsEl,
      this.grid,
      el('button', { class: 'btn primary big', text: 'Fechar (B)', onClick: () => onDone() }),
    ]);
    this.root = el('div', { class: 'overlay inventory hidden' }, [panel]);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(loadout: number[], grenades: boolean): void {
    this.grenades = grenades;
    this.loadout = [...loadout];
    this.slot = 0;
    this.render();
    show(this.root, true);
  }

  close(): void {
    show(this.root, false);
  }

  /** A weapon already in the other primary slot trades places with the one being replaced. */
  private assign(id: number): void {
    const other = this.loadout.indexOf(id);
    if (other >= 0 && other !== this.slot) this.loadout[other] = this.loadout[this.slot];
    this.loadout[this.slot] = id;
    this.render();
    this.onChange([...this.loadout]);
  }

  private render(): void {
    clear(this.slotsEl);
    this.loadout.forEach((id, i) => {
      // Slots past the pistol hold equipment, which a guns-only match doesn't have.
      if (i > 2 && !this.grenades) return;
      this.slotsEl.append(
        el(
          'button',
          {
            class: 'loadout-card' + (i === this.slot ? ' active' : ''),
            onClick: () => {
              this.slot = i;
              this.render();
            },
          },
          [el('small', { text: SLOTS[i].name }), el('b', { text: WEAPONS[id].name })],
        ),
      );
    });
    clear(this.grid);
    for (const w of SLOTS[this.slot].items) {
      if (w.id === W.LAUNCHER && !this.grenades) continue;
      this.grid.append(
        el(
          'button',
          { class: 'loadout-card' + (this.loadout[this.slot] === w.id ? ' active' : ''), onClick: () => this.assign(w.id) },
          [el('b', { text: w.name }), el('small', { text: w.desc }), el('small', { class: 'loadout-mag', text: magLabel(w) })],
        ),
      );
    }
  }
}

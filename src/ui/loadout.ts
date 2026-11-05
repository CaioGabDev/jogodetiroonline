import { PISTOLS, PRIMARIES, fillLoadout, type WeaponDef } from '../game/weapons';
import { el, show } from './dom';

/**
 * Timed spawn screen: two primaries and a pistol. Every click is sent to the host right away,
 * so whatever is selected when the time runs out is what the player gets.
 */
export class LoadoutPicker {
  readonly root: HTMLElement;
  private timer: HTMLElement;
  private cards = new Map<number, HTMLElement>();
  private primaries: number[] = [];
  private pistol: number | null = null;
  private endsAt = 0;
  private interval = 0;

  constructor(
    parent: HTMLElement,
    private onChange: (weapons: number[], confirmed: boolean) => void,
  ) {
    this.timer = el('div', { class: 'loadout-timer' });
    const column = (title: string, weapons: WeaponDef[], pick: (id: number) => void): HTMLElement =>
      el('div', { class: 'loadout-col' }, [
        el('h3', { text: title }),
        el(
          'div',
          { class: 'loadout-grid' },
          weapons.map((w) => {
            const card = el('button', { class: 'loadout-card', onClick: () => pick(w.id) }, [
              el('b', { text: w.name }),
              el('small', { text: w.desc }),
              el('small', { class: 'loadout-mag', text: `Pente: ${w.mag}` }),
            ]);
            this.cards.set(w.id, card);
            return card;
          }),
        ),
      ]);
    const panel = el('div', { class: 'panel loadout-panel' }, [
      el('div', { class: 'loadout-head' }, [el('h2', { text: 'Escolha suas armas' }), this.timer]),
      el('div', { class: 'loadout-body' }, [
        column('Primárias (escolha 2)', PRIMARIES, (id) => this.pickPrimary(id)),
        column('Pistola (escolha 1)', PISTOLS, (id) => this.pickPistol(id)),
      ]),
      el('button', { class: 'btn primary big', text: 'Confirmar', onClick: () => this.onChange(this.current(), true) }),
    ]);
    this.root = el('div', { class: 'overlay loadout hidden' }, [panel]);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(ms: number): void {
    this.primaries = [];
    this.pistol = null;
    this.endsAt = performance.now() + ms;
    this.refresh();
    this.tick();
    clearInterval(this.interval);
    this.interval = window.setInterval(() => this.tick(), 100);
    show(this.root, true);
  }

  close(): void {
    clearInterval(this.interval);
    show(this.root, false);
  }

  private current(): number[] {
    return fillLoadout(this.primaries, this.pistol);
  }

  private tick(): void {
    this.timer.textContent = String(Math.max(0, Math.ceil((this.endsAt - performance.now()) / 1000)));
  }

  /** Picking a third primary replaces the oldest one. */
  private pickPrimary(id: number): void {
    const i = this.primaries.indexOf(id);
    if (i >= 0) this.primaries.splice(i, 1);
    else {
      this.primaries.push(id);
      if (this.primaries.length > 2) this.primaries.shift();
    }
    this.changed();
  }

  private pickPistol(id: number): void {
    this.pistol = this.pistol === id ? null : id;
    this.changed();
  }

  private changed(): void {
    this.refresh();
    this.onChange(this.current(), false);
  }

  private refresh(): void {
    this.cards.forEach((card, id) => {
      card.classList.toggle('active', this.primaries.includes(id) || this.pistol === id);
    });
  }
}

import { LETHALS, PISTOLS, PRIMARIES, TACTICALS, fillLoadout, magLabel, type WeaponDef } from '../game/weapons';
import { el, show } from './dom';

/**
 * Timed spawn screen: two primaries, a pistol, a lethal and a tactical. Every click is sent to the host right away,
 * so whatever is selected when the time runs out is what the player gets.
 */
export class LoadoutPicker {
  readonly root: HTMLElement;
  private timer: HTMLElement;
  private cards = new Map<number, HTMLElement>();
  private primaries: number[] = [];
  private pistol: number | null = null;
  private lethal: number | null = null;
  private tactical: number | null = null;
  private endsAt = 0;
  private interval = 0;

  constructor(
    parent: HTMLElement,
    private onChange: (weapons: number[], confirmed: boolean) => void,
  ) {
    this.timer = el('div', { class: 'loadout-timer' });
    const section = (title: string, weapons: WeaponDef[], pick: (id: number) => void): HTMLElement[] => [
      el('h3', { text: title }),
      el(
        'div',
        { class: 'loadout-grid' },
        weapons.map((w) => {
          const card = el('button', { class: 'loadout-card', onClick: () => pick(w.id) }, [
            el('b', { text: w.name }),
            el('small', { text: w.desc }),
            el('small', { class: 'loadout-mag', text: magLabel(w) }),
          ]);
          this.cards.set(w.id, card);
          return card;
        }),
      ),
    ];
    const panel = el('div', { class: 'panel loadout-panel' }, [
      el('div', { class: 'loadout-head' }, [el('h2', { text: 'Escolha suas armas' }), this.timer]),
      el('div', { class: 'loadout-body' }, [
        el('div', { class: 'loadout-col' }, section('Primárias (escolha 2)', PRIMARIES, (id) => this.pickPrimary(id))),
        el('div', { class: 'loadout-col' }, section('Pistola (escolha 1)', PISTOLS, (id) => this.pickPistol(id))),
        el('div', { class: 'loadout-col' }, [
          ...section('Letal (escolha 1)', LETHALS, (id) => this.pickLethal(id)),
          ...section('Tática (escolha 1)', TACTICALS, (id) => this.pickTactical(id)),
        ]),
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
    this.lethal = null;
    this.tactical = null;
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
    return fillLoadout(this.primaries, this.pistol, this.lethal, this.tactical);
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

  private pickLethal(id: number): void {
    this.lethal = this.lethal === id ? null : id;
    this.changed();
  }

  private pickTactical(id: number): void {
    this.tactical = this.tactical === id ? null : id;
    this.changed();
  }

  private changed(): void {
    this.refresh();
    this.onChange(this.current(), false);
  }

  private refresh(): void {
    this.cards.forEach((card, id) => {
      card.classList.toggle('active', this.primaries.includes(id) || [this.pistol, this.lethal, this.tactical].includes(id));
    });
  }
}

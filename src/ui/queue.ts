import { el, show } from './dom';

/** "Searching for a ranked match" overlay, with the time waited and a cancel button. */
export class QueueScreen {
  readonly root: HTMLElement;
  private status: HTMLElement;
  private time: HTMLElement;
  private started = 0;
  private timer = 0;

  constructor(parent: HTMLElement, onCancel: () => void) {
    this.status = el('p', { class: 'hint' });
    this.time = el('div', { class: 'queue-time' });
    const panel = el('div', { class: 'panel queue-panel' }, [
      el('h2', { text: 'Ranqueada' }),
      el('div', { class: 'queue-spinner' }),
      this.time,
      this.status,
      el('p', { class: 'hint', text: 'Mata-mata contra jogadores com elo parecido com o seu. Quanto mais tempo na fila, mais a busca abre.' }),
      el('button', { class: 'btn', text: 'Cancelar', onClick: onCancel }),
    ]);
    this.root = el('div', { class: 'overlay queue hidden' }, [panel]);
    parent.append(this.root);
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(): void {
    this.started = performance.now();
    this.setStatus('Entrando na fila…');
    this.tick();
    window.clearInterval(this.timer);
    this.timer = window.setInterval(() => this.tick(), 500);
    show(this.root, true);
  }

  close(): void {
    window.clearInterval(this.timer);
    show(this.root, false);
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  private tick(): void {
    const s = Math.floor((performance.now() - this.started) / 1000);
    this.time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
}

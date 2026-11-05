import {
  ACTION_LABELS,
  FPS_LIMITS,
  keyLabel,
  settings,
  type Action,
  type CrosshairStyle,
  type Settings,
} from '../core/settings';
import { input } from '../core/input';
import { clamp } from '../core/util';
import { WEAPONS } from '../game/weapons';
import { clear, el, show } from './dom';
import { drawCrosshair } from './crosshair';
import { toast } from './toast';

type Tab = 'controls' | 'weapons' | 'video' | 'audio' | 'crosshair' | 'hud';

const TABS: Array<[Tab, string]> = [
  ['controls', 'Controles'],
  ['weapons', 'Armas'],
  ['video', 'Vídeo'],
  ['audio', 'Áudio'],
  ['crosshair', 'Mira'],
  ['hud', 'HUD'],
];

/** Settings modal. Every change is validated, persisted and applied immediately. */
export class SettingsUI {
  readonly root: HTMLElement;
  private content: HTMLElement;
  private tabBtns = new Map<Tab, HTMLElement>();
  private tab: Tab = 'controls';
  private onCloseCb: (() => void) | null = null;
  private listening: { action: Action; slot: 0 | 1; btn: HTMLElement } | null = null;
  private unhook: (() => void) | null = null;
  private preview: HTMLCanvasElement | null = null;

  constructor(parent: HTMLElement) {
    const tabs = el('div', { class: 'tabs' });
    for (const [id, label] of TABS) {
      const b = el('button', { class: 'tab', text: label, onClick: () => this.setTab(id) });
      this.tabBtns.set(id, b);
      tabs.append(b);
    }
    this.content = el('div', { class: 'settings-content' });
    const footer = el('div', { class: 'settings-footer' }, [
      el('button', {
        class: 'btn ghost',
        text: 'Restaurar padrão',
        onClick: () => {
          if (confirm('Restaurar todas as configurações para o padrão?')) {
            settings.reset();
            this.render();
            toast('Configurações restauradas', 'ok');
          }
        },
      }),
      el('button', { class: 'btn primary', text: 'Fechar', onClick: () => this.close() }),
    ]);
    const panel = el('div', { class: 'panel settings-panel' }, [el('h2', { text: 'Configurações' }), tabs, this.content, footer]);
    this.root = el('div', { class: 'overlay settings hidden' }, [panel]);
    this.root.addEventListener('mousedown', (e) => {
      if (e.target === this.root) this.close();
    });
    parent.append(this.root);
  }

  get isOpen(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(onClose?: () => void): void {
    this.onCloseCb = onClose ?? null;
    show(this.root, true);
    this.render();
    this.unhook = input.addKeyHook((code, e) => {
      if (this.listening) {
        e.preventDefault();
        if (code === 'Escape') this.stopListening();
        else this.assign(code);
        return true;
      }
      if (code === 'Escape' && this.isOpen) {
        e.preventDefault();
        this.close();
        return true;
      }
      return false;
    });
  }

  close(): void {
    if (!this.isOpen) return;
    this.stopListening();
    show(this.root, false);
    this.unhook?.();
    this.unhook = null;
    const cb = this.onCloseCb;
    this.onCloseCb = null;
    cb?.();
  }

  private setTab(t: Tab): void {
    this.tab = t;
    this.render();
  }

  private render(): void {
    this.tabBtns.forEach((b, id) => b.classList.toggle('active', id === this.tab));
    clear(this.content);
    this.preview = null;
    const s = settings.get();
    switch (this.tab) {
      case 'controls':
        this.renderControls(s);
        break;
      case 'weapons':
        this.renderWeapons(s);
        break;
      case 'video':
        this.renderVideo(s);
        break;
      case 'audio':
        this.renderAudio(s);
        break;
      case 'crosshair':
        this.renderCrosshair(s);
        break;
      case 'hud':
        this.renderHud(s);
        break;
    }
  }

  // ------------------------------------------------------------------ widgets

  private row(label: string, control: HTMLElement, hint?: string): HTMLElement {
    return el('div', { class: 'set-row' }, [
      el('label', { class: 'set-label' }, [label, hint ? el('small', { text: hint }) : null]),
      el('div', { class: 'set-control' }, [control]),
    ]);
  }

  private slider(
    min: number,
    max: number,
    step: number,
    value: number,
    onChange: (v: number) => void,
    numeric = true,
    fmt: (v: number) => string = (v) => String(v),
  ): HTMLElement {
    const range = el('input', { attrs: { type: 'range', min: String(min), max: String(max), step: String(step) } });
    range.value = String(value);
    const decimals = step < 1 ? String(step).split('.')[1]?.length ?? 2 : 0;
    const wrap = el('div', { class: 'slider' }, [range]);
    let num: HTMLInputElement | null = null;
    let out: HTMLElement | null = null;
    if (numeric) {
      num = el('input', { class: 'num', attrs: { type: 'number', min: String(min), max: String(max), step: String(step) } });
      num.value = value.toFixed(decimals);
      wrap.append(num);
      num.addEventListener('change', () => {
        const v = clamp(parseFloat(num!.value) || min, min, max);
        num!.value = v.toFixed(decimals);
        range.value = String(v);
        onChange(v);
      });
    } else {
      out = el('span', { class: 'slider-val', text: fmt(value) });
      wrap.append(out);
    }
    range.addEventListener('input', () => {
      const v = parseFloat(range.value);
      if (num) num.value = v.toFixed(decimals);
      if (out) out.textContent = fmt(v);
      onChange(v);
    });
    return wrap;
  }

  private toggle(value: boolean, onChange: (v: boolean) => void): HTMLElement {
    const cb = el('input', { attrs: { type: 'checkbox' } });
    cb.checked = value;
    cb.addEventListener('change', () => onChange(cb.checked));
    return el('label', { class: 'switch' }, [cb, el('span')]);
  }

  private select<T extends string | number>(options: Array<[T, string]>, value: T, onChange: (v: T) => void): HTMLElement {
    const sel = el('select');
    options.forEach(([v, label]) => {
      const o = el('option', { text: label });
      o.value = String(v);
      if (v === value) o.selected = true;
      sel.append(o);
    });
    sel.addEventListener('change', () => {
      const found = options.find(([v]) => String(v) === sel.value);
      if (found) onChange(found[0]);
    });
    return sel;
  }

  private segmented<T extends string>(options: Array<[T, string]>, value: T, onChange: (v: T) => void): HTMLElement {
    const wrap = el('div', { class: 'segmented' });
    options.forEach(([v, label]) => {
      const b = el('button', {
        class: 'seg' + (v === value ? ' active' : ''),
        text: label,
        onClick: () => {
          wrap.querySelectorAll('.seg').forEach((x) => x.classList.remove('active'));
          b.classList.add('active');
          onChange(v);
        },
      });
      wrap.append(b);
    });
    return wrap;
  }

  // ------------------------------------------------------------------ tabs

  private renderControls(s: Settings): void {
    const c = this.content;
    c.append(
      el('h3', { text: 'Mouse' }),
      this.row(
        'Sensibilidade',
        this.slider(0.1, 10, 0.05, s.sensitivity, (v) => settings.update((d) => (d.sensitivity = v))),
      ),
      this.row(
        'Sensibilidade na mira (ADS)',
        this.slider(0.1, 10, 0.05, s.adsSensitivity, (v) => settings.update((d) => (d.adsSensitivity = v))),
        'Escalada automaticamente pelo zoom de cada arma',
      ),
      this.row('Inverter eixo Y', this.toggle(s.invertY, (v) => settings.update((d) => (d.invertY = v)))),
      this.row(
        'Mirar (ADS)',
        this.segmented(
          [
            ['hold', 'Segurar'],
            ['toggle', 'Alternar'],
          ],
          s.adsMode,
          (v) => settings.update((d) => (d.adsMode = v)),
        ),
      ),
      this.row(
        'Agachar',
        this.segmented(
          [
            ['hold', 'Segurar'],
            ['toggle', 'Alternar'],
          ],
          s.crouchMode,
          (v) => settings.update((d) => (d.crouchMode = v)),
        ),
      ),
      el('h3', { text: 'Teclas' }),
      el('p', { class: 'hint', text: 'Clique em um campo e pressione a nova tecla ou botão do mouse. Esc cancela, Backspace limpa.' }),
    );
    const table = el('div', { class: 'binds' });
    (Object.keys(ACTION_LABELS) as Action[]).forEach((a) => {
      const btns = ([0, 1] as const).map((slot) => {
        const b = el('button', { class: 'bind', text: keyLabel(s.binds[a][slot]) });
        b.addEventListener('click', (e) => {
          e.preventDefault();
          this.startListening(a, slot, b);
        });
        return b;
      });
      table.append(el('div', { class: 'bind-row' }, [el('span', { text: ACTION_LABELS[a] }), ...btns]));
    });
    c.append(table);
    c.append(el('p', { class: 'hint', text: 'Esc (pausa) e roda do mouse (trocar arma) são fixos. Ctrl+W só é bloqueado em tela cheia no Chrome e no Edge; nos outros navegadores aparece um aviso antes de fechar.' }));
  }

  private startListening(action: Action, slot: 0 | 1, btn: HTMLElement): void {
    this.stopListening();
    this.listening = { action, slot, btn };
    btn.textContent = 'Pressione…';
    btn.classList.add('listening');
    // Mouse buttons: start on next tick so the click that opened listening isn't captured.
    window.setTimeout(() => {
      if (!this.listening) return;
      const onMouse = (e: MouseEvent): void => {
        if (!this.listening) return;
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('mousedown', onMouse, true);
        this.assign('Mouse' + e.button);
      };
      window.addEventListener('mousedown', onMouse, true);
      this.mouseCleanup = () => window.removeEventListener('mousedown', onMouse, true);
    }, 0);
  }

  private mouseCleanup: (() => void) | null = null;

  private stopListening(): void {
    this.mouseCleanup?.();
    this.mouseCleanup = null;
    if (this.listening) {
      const { action, slot, btn } = this.listening;
      btn.classList.remove('listening');
      btn.textContent = keyLabel(settings.get().binds[action][slot]);
    }
    this.listening = null;
  }

  private assign(code: string): void {
    if (!this.listening) return;
    const { action, slot } = this.listening;
    const clearing = code === 'Backspace' || code === 'Delete';
    if (code === 'Escape') return this.stopListening();
    let movedFrom: Action | null = null;
    settings.update((d) => {
      if (!clearing) {
        // A key can only control one action: remove it elsewhere.
        for (const a of Object.keys(d.binds) as Action[]) {
          for (const i of [0, 1] as const) {
            if (d.binds[a][i] === code && !(a === action && i === slot)) {
              d.binds[a][i] = '';
              movedFrom = a;
            }
          }
        }
      }
      d.binds[action][slot] = clearing ? '' : code;
    });
    this.listening = null;
    this.mouseCleanup?.();
    this.mouseCleanup = null;
    if (movedFrom) toast(`"${keyLabel(code)}" foi removida de ${ACTION_LABELS[movedFrom as Action]}`, 'warn');
    this.render();
  }

  private renderVideo(s: Settings): void {
    this.content.append(
      this.row('Campo de visão (FOV)', this.slider(70, 110, 1, s.fov, (v) => settings.update((d) => (d.fov = v)))),
      this.row(
        'Qualidade',
        this.segmented(
          [
            ['low', 'Baixa'],
            ['medium', 'Média'],
            ['high', 'Alta'],
          ],
          s.quality,
          (v) => settings.update((d) => (d.quality = v)),
        ),
        'Afeta sombras, resolução de pixels e antialiasing',
      ),
      this.row('Sombras', this.toggle(s.shadows, (v) => settings.update((d) => (d.shadows = v)))),
      this.row(
        'Limite de FPS',
        this.select(
          FPS_LIMITS.map((f) => [f, f === 0 ? 'Sem limite (VSync)' : `${f} FPS`] as [number, string]),
          s.fpsLimit,
          (v) => settings.update((d) => (d.fpsLimit = v)),
        ),
      ),
      this.row(
        'Escala de resolução',
        this.slider(
          0.5,
          1,
          0.05,
          s.resolutionScale,
          (v) => settings.update((d) => (d.resolutionScale = v)),
          false,
          (v) => `${Math.round(v * 100)}%`,
        ),
      ),
    );
  }

  private renderAudio(s: Settings): void {
    const pct = (v: number): string => `${Math.round(v * 100)}%`;
    this.content.append(
      this.row('Volume geral', this.slider(0, 1, 0.01, s.masterVolume, (v) => settings.update((d) => (d.masterVolume = v)), false, pct)),
      this.row('Efeitos', this.slider(0, 1, 0.01, s.sfxVolume, (v) => settings.update((d) => (d.sfxVolume = v)), false, pct)),
      this.row('Interface', this.slider(0, 1, 0.01, s.uiVolume, (v) => settings.update((d) => (d.uiVolume = v)), false, pct)),
    );
  }

  private renderCrosshair(s: Settings): void {
    const c = s.crosshair;
    this.preview = el('canvas', { class: 'xhair-preview' });
    this.preview.width = 160;
    this.preview.height = 120;
    const redraw = (): void => {
      if (this.preview) drawCrosshair(this.preview, settings.get().crosshair);
    };
    const upd = (fn: (d: Settings) => void): void => {
      settings.update(fn);
      redraw();
    };
    const color = el('input', { attrs: { type: 'color' } });
    color.value = c.color;
    color.addEventListener('input', () => upd((d) => (d.crosshair.color = color.value)));
    const presets = el('div', { class: 'swatches' });
    for (const col of ['#00ff88', '#ffffff', '#ff3b3b', '#ffd400', '#00e5ff', '#ff4dff']) {
      presets.append(
        el('button', {
          class: 'swatch',
          style: { background: col },
          onClick: () => {
            color.value = col;
            upd((d) => (d.crosshair.color = col));
          },
        }),
      );
    }
    this.content.append(
      el('div', { class: 'xhair-wrap' }, [this.preview]),
      this.row(
        'Estilo',
        this.segmented<CrosshairStyle>(
          [
            ['cross', 'Cruz'],
            ['dot', 'Ponto'],
            ['circle', 'Círculo'],
          ],
          c.style,
          (v) => upd((d) => (d.crosshair.style = v)),
        ),
      ),
      this.row('Cor', el('div', { class: 'color-row' }, [color, presets])),
      this.row('Tamanho', this.slider(1, 30, 1, c.size, (v) => upd((d) => (d.crosshair.size = v)))),
      this.row('Espessura', this.slider(1, 8, 1, c.thickness, (v) => upd((d) => (d.crosshair.thickness = v)))),
      this.row('Espaçamento (gap)', this.slider(0, 20, 1, c.gap, (v) => upd((d) => (d.crosshair.gap = v)))),
      this.row('Contorno', this.toggle(c.outline, (v) => upd((d) => (d.crosshair.outline = v)))),
      this.row('Ponto central', this.toggle(c.centerDot, (v) => upd((d) => (d.crosshair.centerDot = v)))),
    );
    redraw();
  }

  private renderWeapons(s: Settings): void {
    this.content.append(
      el('p', {
        class: 'hint',
        text: 'Monte sua roda de armas: marque o que você leva e use as setas para mudar a ordem. A primeira é a arma inicial, e a roda do mouse segue essa ordem. Em Só sniper e Só doze valem só as armas do modo, sem a sua ordem, e no Gun Game a arma depende das suas kills.',
      }),
    );
    const unused = WEAPONS.filter((w) => !s.loadout.includes(w.id)).map((w) => w.id);
    [...s.loadout, ...unused].forEach((id) => {
      const pos = s.loadout.indexOf(id);
      const toggle = this.toggle(pos >= 0, (on) => {
        if (!on && settings.get().loadout.length === 1) toast('Escolha pelo menos uma arma.', 'warn');
        else settings.update((d) => (d.loadout = on ? [...d.loadout, id] : d.loadout.filter((x) => x !== id)));
        this.render();
      });
      const arrow = (text: string, title: string, to: number): HTMLElement => {
        const b = el('button', { class: 'btn small ghost', text, title, onClick: () => this.moveWeapon(pos, to) });
        b.disabled = to < 0 || to >= s.loadout.length;
        return b;
      };
      const control = el('div', { class: 'wheel-control' }, [
        pos >= 0 ? arrow('▲', 'Subir', pos - 1) : null,
        pos >= 0 ? arrow('▼', 'Descer', pos + 1) : null,
        toggle,
      ]);
      this.content.append(this.row(pos >= 0 ? `${pos + 1}. ${WEAPONS[id].name}` : WEAPONS[id].name, control));
    });
  }

  private moveWeapon(from: number, to: number): void {
    settings.update((d) => {
      [d.loadout[from], d.loadout[to]] = [d.loadout[to], d.loadout[from]];
    });
    this.render();
  }

  private renderHud(s: Settings): void {
    this.content.append(
      this.row('Mostrar FPS', this.toggle(s.showFps, (v) => settings.update((d) => (d.showFps = v)))),
      this.row('Mostrar ping', this.toggle(s.showPing, (v) => settings.update((d) => (d.showPing = v)))),
      this.row(
        'Tamanho do killfeed',
        this.slider(2, 10, 1, s.killfeedSize, (v) => settings.update((d) => (d.killfeedSize = v)), false, (v) => `${v} linhas`),
      ),
    );
  }
}

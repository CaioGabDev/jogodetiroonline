import { progress } from '../core/progress';
import { account } from '../net/account';
import { RANKS, SKINS, rankFor, skinById, type BladeShape, type InspectStyle, type Rank, type SkinDef } from '../game/progression';
import { W, WEAPONS } from '../game/weapons';
import { SkinPreview } from '../render/skinPreview';
import { clear, el, show } from './dom';
import { toast } from './toast';

const fmt = (n: number): string => n.toLocaleString('pt-BR');

// Same noise as the shader in render/skins.ts, so the preview matches the gun.
function hash(x: number, y: number, z: number): number {
  const fr = (v: number): number => v - Math.floor(v);
  x = fr(x * 0.3183099 + 0.1) * 17;
  y = fr(y * 0.3183099 + 0.1) * 17;
  z = fr(z * 0.3183099 + 0.1) * 17;
  return fr(x * y * z * (x + y + z));
}
function noise(x: number, y: number, z: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const iz = Math.floor(z);
  const s = (t: number): number => t * t * (3 - 2 * t);
  const fx = s(x - ix);
  const fy = s(y - iy);
  const fz = s(z - iz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  const h = (dx: number, dy: number, dz: number): number => hash(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), fx), l(h(0, 1, 0), h(1, 1, 0), fx), fy),
    l(l(h(0, 0, 1), h(1, 0, 1), fx), l(h(0, 1, 1), h(1, 1, 1), fx), fy),
    fz,
  );
}
const fbm = (x: number, y: number, z: number): number =>
  0.55 * noise(x, y, z) + 0.3 * noise(x * 2.03 + 7.1, y * 2.03 + 7.1, z * 2.03 + 7.1) + 0.15 * noise(x * 4.01 + 3.7, y * 4.01 + 3.7, z * 4.01 + 3.7);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const mix = (a: number[], b: number[], t: number): number[] => a.map((v, i) => v + (b[i] - v) * t);
const smooth = (e0: number, e1: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/** Draws the skin as it lies on the side of a gun half a meter long. */
function drawPreview(canvas: HTMLCanvasElement, skin: SkinDef): void {
  const w = (canvas.width = 120);
  const h = (canvas.height = 56);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (skin.colors.length === 0) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#3a3f47');
    g.addColorStop(1, '#1b1e23');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  const cols = [0, 1, 2, 3].map((i) => rgb(skin.colors[i % skin.colors.length]));
  const pick = (n: number): number[] => (n < 0.44 ? cols[0] : n < 0.52 ? cols[1] : n < 0.6 ? cols[2] : cols[3]);
  const img = ctx.createImageData(w, h);
  const m = 0.5 / w;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const z = px * m;
      const y = (h - py) * m;
      const x = 0.03;
      let c: number[];
      let glow = 0;
      switch (skin.pattern) {
        case 'solid':
          c = cols[0];
          break;
        case 'camo':
          c = pick(fbm(x * 14, y * 14, z * 14));
          break;
        case 'digital': {
          const q = (v: number): number => Math.floor(v * 70) / 70;
          c = pick(fbm(q(x) * 12, q(y) * 12, q(z) * 12));
          break;
        }
        case 'stripes': {
          const s = Math.sin(z * 48 + y * 20 + fbm(x * 9, y * 9, z * 9) * 7);
          glow = s >= 0.3 ? 1 : 0;
          c = glow ? cols[1] : cols[0];
          break;
        }
        case 'scan': {
          const band = (y * 38) % 1 > 0.84 ? 1 : 0;
          glow = band;
          c = band ? cols[2] : mix(cols[0], cols[1], Math.min(1, z * 1.6));
          break;
        }
        case 'prisma': {
          const hue = (z * 1.4 + y * 2 + fbm(x * 6, y * 6, z * 6) * 0.25) % 1;
          c = [0, 4, 2].map((o) => Math.min(1, Math.max(0, Math.abs(((hue * 6 + o) % 6) - 3) - 1)) * 255);
          glow = 0.6;
          break;
        }
        default: {
          const n = fbm(x * 9, y * 9, z * 9);
          glow = smooth(0.5, 0.68, n);
          c = mix(mix(cols[0], cols[1], smooth(0.36, 0.56, n)), cols[2], smooth(0.62, 0.76, n));
        }
      }
      // A soft top light and a polished streak for shiny skins.
      const light = 0.8 + 0.35 * (py < h * 0.4 ? 1 - py / (h * 0.4) : 0);
      const streak = skin.shine > 0.5 ? Math.max(0, 1 - Math.abs(px - py * 1.6 - 30) / 10) * skin.shine * 90 : 0;
      // Glowing parts light up as they do in the game, where they don't depend on the scene's light.
      const k = light + glow * skin.glow * 1.4;
      const i = (py * w + px) * 4;
      img.data[i] = Math.min(255, c[0] * k + streak);
      img.data[i + 1] = Math.min(255, c[1] * k + streak);
      img.data[i + 2] = Math.min(255, c[2] * k + streak);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}

/** Rank icon, name and level, colored by rank. */
export function levelBadge(level: number, compact = false): HTMLElement {
  const r = rankFor(level);
  return el('span', { class: 'level-badge' + (compact ? ' compact' : ''), title: `${r.name} · nível ${level}`, style: { color: r.color, borderColor: r.color } }, [
    el('span', { class: 'rank-icon', text: r.icon }),
    compact ? null : el('span', { text: r.name }),
    el('b', { text: compact ? String(level) : `Nv ${level}` }),
  ]);
}

export function coinLabel(n: number): HTMLElement {
  return el('span', { class: 'coins' }, [el('i', { class: 'coin' }), el('b', { text: fmt(n) })]);
}

/** XP bar for the current level. */
export function xpBar(into: number, need: number): HTMLElement {
  const pct = need > 0 ? Math.min(100, (into / need) * 100) : 100;
  return el('div', { class: 'xp-bar' }, [
    el('div', { class: 'xp-fill', style: { width: `${pct}%` } }),
    el('span', { text: need > 0 ? `${fmt(into)} / ${fmt(need)} XP` : 'Nível máximo' }),
  ]);
}

const INSPECT_NAMES: Record<InspectStyle, string> = { default: 'normal', spin: 'giro no cano', flip: 'arremesso', twirl: 'rodopio', butterfly: 'abre e fecha' };
const BLADE_NAMES: Record<BladeShape, string> = { baioneta: 'baioneta', karambit: 'karambit', borboleta: 'borboleta', cutelo: 'cutelo', tanto: 'tantō' };

/** Guns the showcase can show, all with a loaded model. */
const SHOWCASE_GUNS = [W.RIFLE, W.SMG, W.SNIPER, W.SHOTGUN, W.DEAGLE, W.PISTOL];

function nextRank(level: number): Rank | null {
  return RANKS.find((r) => r.level > level) ?? null;
}

/** Profile, ranks and the weapon skin shop. */
export class Armory {
  readonly root: HTMLElement;
  private head: HTMLElement;
  private grid: HTMLElement;
  private premiumGrid: HTMLElement;
  private knifeGrid: HTMLElement;
  private where: HTMLElement;
  private preview = new SkinPreview();
  private showcaseInfo: HTMLElement;
  private gunChips: HTMLElement;
  /** Skin and gun in the showcase. */
  private selected = '';
  private gun: number = W.RIFLE;
  /** A purchase or equip is on its way to the account. */
  private busy = false;
  private onClose: (() => void) | null = null;

  constructor(parent: HTMLElement) {
    this.head = el('div', { class: 'armory-head' });
    this.grid = el('div', { class: 'skin-grid' });
    this.premiumGrid = el('div', { class: 'skin-grid premium' });
    this.knifeGrid = el('div', { class: 'skin-grid knives' });
    this.where = el('p', { class: 'hint' });
    this.showcaseInfo = el('div', { class: 'showcase-info' });
    this.gunChips = el('div', { class: 'gun-chips' });
    const showcase = el('div', { class: 'showcase' }, [
      el('div', { class: 'showcase-stage' }, [this.preview.canvas, this.gunChips]),
      this.showcaseInfo,
    ]);
    const close = el('button', { class: 'btn primary', text: 'Fechar', onClick: () => this.close() });
    const panel = el('div', { class: 'panel armory-panel' }, [
      el('h2', { text: 'Arsenal' }),
      this.head,
      showcase,
      el('h3', { text: 'Coleção premium' }),
      el('p', { class: 'hint', text: 'Mudam o formato da arma, a cor dos tiros, têm efeito de abate que todo mundo vê e inspeção própria (Y).' }),
      this.premiumGrid,
      el('h3', { text: 'Facas' }),
      el('p', { class: 'hint', text: 'Cada faca tem modelo e inspeção próprios, e se equipa separada da skin das armas.' }),
      this.knifeGrid,
      el('h3', { text: 'Skins' }),
      el('p', { class: 'hint', text: 'A skin vale para todas as suas armas, e os outros jogadores também a veem. As de patente são grátis ao chegar no nível; as outras se compram com moedas.' }),
      this.grid,
      el('div', { class: 'armory-foot' }, [this.where, close]),
    ]);
    this.root = el('div', { class: 'overlay armory hidden' }, [panel]);
    window.addEventListener('keydown', (e) => {
      if (!this.visible) return;
      if (e.code === 'Escape') this.close();
      if (e.code === 'KeyY' && !e.repeat) this.preview.inspect();
    });
    parent.append(this.root);
    progress.onChange(() => {
      if (this.visible) this.render();
    });
  }

  get visible(): boolean {
    return !this.root.classList.contains('hidden');
  }

  open(onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.selected = progress.equipped;
    this.render();
    show(this.root, true);
    this.preview.start();
  }

  close(): void {
    show(this.root, false);
    this.preview.stop();
    this.onClose?.();
    this.onClose = null;
  }

  private render(): void {
    const info = progress.levelInfo;
    const rank = progress.rank;
    const next = nextRank(info.level);
    const st = progress.stats;
    clear(this.head);
    this.head.append(
      el('div', { class: 'armory-rank' }, [
        el('div', { class: 'big-rank', style: { color: rank.color, borderColor: rank.color } }, [el('span', { text: rank.icon })]),
        el('div', { class: 'armory-rank-info' }, [
          el('div', { class: 'rank-name', text: rank.name, style: { color: rank.color } }),
          el('div', { class: 'rank-level', text: `Nível ${info.level}` }),
          xpBar(info.into, info.need),
          el('div', { class: 'hint', text: next ? `Próxima patente: ${next.name} no nível ${next.level}` : 'Patente máxima!' }),
        ]),
        el('div', { class: 'armory-wallet' }, [
          coinLabel(progress.coins),
          el('div', { class: 'hint', text: `${fmt(st.matches)} partidas · ${fmt(st.wins)} vitórias · ${fmt(st.kills)} abates` }),
        ]),
      ]),
    );

    this.where.textContent = progress.remote
      ? `Progresso salvo na conta de ${account.profile?.username ?? 'você'}.`
      : account.available
        ? 'Jogando como convidado: o progresso fica só neste navegador. Entre numa conta para guardá-lo.'
        : 'O progresso fica salvo neste navegador.';
    clear(this.grid);
    clear(this.premiumGrid);
    clear(this.knifeGrid);
    if (progress.loading) {
      this.grid.append(el('p', { class: 'hint', text: 'Carregando o progresso da conta…' }));
      return;
    }
    for (const s of SKINS) (s.slot === 'faca' ? this.knifeGrid : s.fx ? this.premiumGrid : this.grid).append(this.card(s, info.level));
    this.renderShowcase(info.level);
  }

  private select(id: string): void {
    this.selected = id;
    this.render();
  }

  private renderShowcase(level: number): void {
    const s = skinById(this.selected);
    this.preview.show(s.id, this.gun);
    clear(this.gunChips);
    for (const w of s.slot === 'faca' ? [] : SHOWCASE_GUNS) {
      this.gunChips.append(
        el('button', {
          class: 'gun-chip' + (w === this.gun ? ' active' : ''),
          text: WEAPONS[w].short,
          onClick: () => {
            this.gun = w;
            this.renderShowcase(progress.level);
          },
        }),
      );
    }
    const { status, action } = this.actionFor(s, level);
    const feats: string[] = s.knife
      ? [`Modelo: ${BLADE_NAMES[s.knife.blade]}`, s.knife.edge ? 'Fio que brilha e acende no golpe' : 'Acabamento próprio', `Inspeção: ${INSPECT_NAMES[s.knife.inspect]}`]
      : s.fx
        ? ['Formato próprio', 'Tiros coloridos', 'Efeito de abate', `Inspeção: ${INSPECT_NAMES[s.fx.inspect]}`]
        : [s.pattern === 'solid' ? 'Cor sólida' : 'Padrão na arma toda'];
    clear(this.showcaseInfo);
    this.showcaseInfo.append(
      s.fx ? el('span', { class: 'premium-tag', text: 'PREMIUM' }) : '',
      el('div', { class: 'showcase-name', text: s.name }),
      s.tagline ? el('p', { class: 'hint', text: s.tagline }) : '',
      el('div', { class: 'feat-list' }, feats.map((f) => el('span', { class: 'feat', text: f }))),
      el('div', { class: 'skin-status', text: status }),
      el('div', { class: 'showcase-actions' }, [el('button', { class: 'btn', text: 'Inspecionar (Y)', onClick: () => this.preview.inspect() }), action]),
    );
  }

  /** One request at a time, with the buttons off meanwhile. */
  private async run(task: () => Promise<void>): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.grid.querySelectorAll('button').forEach((b) => (b.disabled = true));
    try {
      await task();
    } finally {
      this.busy = false;
      if (this.visible) this.render();
    }
  }

  private card(s: SkinDef, level: number): HTMLElement {
    const canvas = el('canvas', { class: 'skin-preview' });
    drawPreview(canvas, s);
    const { status, action } = this.actionFor(s, level);
    const classes = ['skin-card', s.fx ? 'premium' : '', progress.isEquipped(s.id) ? 'equipped' : '', level < s.level ? 'locked' : '', this.selected === s.id ? 'selected' : ''];
    const card = el('div', { class: classes.filter(Boolean).join(' '), title: 'Ver na vitrine' }, [
      canvas,
      s.fx ? el('span', { class: 'premium-tag small', text: 'PREMIUM' }) : null,
      el('div', { class: 'skin-name', text: s.name }),
      el('div', { class: 'skin-status', text: status }),
      action,
    ]);
    if (s.fx) card.style.setProperty('--skin-glow', s.fx.kill);
    // A click on the card shows it in the showcase; its button still buys or equips.
    card.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      this.select(s.id);
    });
    return card;
  }

  private actionFor(s: SkinDef, level: number): { status: string; action: HTMLElement } {
    const owned = progress.owns(s.id);
    const equipped = progress.isEquipped(s.id);
    const locked = level < s.level;

    let status: string;
    let action: HTMLElement;
    if (equipped) {
      status = 'Equipada';
      action = el('button', { class: 'btn small', text: 'Em uso', attrs: { disabled: '' } });
    } else if (owned) {
      status = 'Sua';
      action = el('button', {
        class: 'btn small primary',
        text: 'Equipar',
        onClick: () =>
          void this.run(async () => {
            if (!(await progress.equip(s.id))) toast('Não deu para equipar agora. Tente de novo.', 'error');
          }),
      });
    } else if (locked) {
      const r = rankFor(s.level);
      status = s.price > 0 ? `Nível ${s.level} · ${fmt(s.price)} moedas` : `Grátis no nível ${s.level}`;
      action = el('span', { class: 'skin-lock', text: `${r.icon} ${r.name}`, style: { color: r.color } });
    } else {
      const afford = progress.coins >= s.price;
      status = `${fmt(s.price)} moedas`;
      action = el('button', {
        class: 'btn small' + (afford ? ' primary' : ''),
        text: afford ? 'Comprar' : 'Sem moedas',
        onClick: () =>
          void this.run(async () => {
            const r = await progress.buy(s.id);
            if (r === 'ok') toast(`Skin ${s.name} comprada e equipada!`, 'ok');
            else if (r === 'coins') toast(`Faltam ${fmt(s.price - progress.coins)} moedas para a ${s.name}.`, 'warn');
            else if (r === 'error') toast('A compra não foi concluída. Tente de novo.', 'error');
          }),
      });
      if (!afford) (action as HTMLButtonElement).disabled = true;
    }

    return { status, action };
  }
}

import { settings } from '../core/settings';
import { formatTime } from '../core/util';
import { WEAPONS } from '../game/weapons';
import { clear, el, show } from './dom';
import { drawCrosshair } from './crosshair';

export interface FeedPlayer {
  name: string;
  color: string;
}

interface DmgIndicator {
  el: HTMLElement;
  srcX: number;
  srcZ: number;
  life: number;
}

interface DamageNumber {
  el: HTMLElement;
  x: number;
  y: number;
  z: number;
  age: number;
  drift: number;
}

const MAX_DAMAGE_NUMBERS = 16;
/** Seconds a damage number stays on screen. */
const DAMAGE_NUMBER_LIFE = 0.8;

export class Hud {
  readonly root: HTMLElement;
  private crosshair: HTMLCanvasElement;
  private hitmarkerEl: HTMLElement;
  private hpFill: HTMLElement;
  private hpText: HTMLElement;
  private ammoMag: HTMLElement;
  private ammoRes: HTMLElement;
  private weaponName: HTMLElement;
  private reloadBar: HTMLElement;
  private reloadFill: HTMLElement;
  private slots: HTMLElement[] = [];
  private equip: HTMLElement[] = [];
  private flashWhite: HTMLElement;
  private daze: HTMLElement;
  private timer: HTMLElement;
  private scoreL: HTMLElement;
  private scoreR: HTMLElement;
  private scoreMid: HTMLElement;
  private feed: HTMLElement;
  private dmgWrap: HTMLElement;
  private dmgFlash: HTMLElement;
  private lowHp: HTMLElement;
  private death: HTMLElement;
  private deathBy: HTMLElement;
  private deathTimer: HTMLElement;
  private protect: HTMLElement;
  private stats: HTMLElement;
  private scope: HTMLElement;
  private notice: HTMLElement;
  private damageLayer: HTMLElement;
  private damageNumbers: DamageNumber[] = [];
  private indicators: DmgIndicator[] = [];
  private lastSpread = -1;
  private hitTimer = 0;
  private noticeTimer = 0;
  private cache = new Map<HTMLElement, string>();

  /** Writes text only when it changed (avoids per-frame layout work). */
  private text(e: HTMLElement, v: string): void {
    if (this.cache.get(e) === v) return;
    this.cache.set(e, v);
    e.textContent = v;
  }

  private width(e: HTMLElement, pct: number): void {
    const v = `${pct}%`;
    const key = 'w:' + v;
    if (this.cache.get(e) === key) return;
    this.cache.set(e, key);
    e.style.width = v;
  }

  constructor(parent: HTMLElement) {
    this.crosshair = el('canvas', { class: 'crosshair' });
    this.crosshair.width = 160;
    this.crosshair.height = 160;
    this.hitmarkerEl = el('div', { class: 'hitmarker' }, [el('i'), el('i'), el('i'), el('i')]);

    this.hpFill = el('div', { class: 'hp-fill' });
    this.hpText = el('div', { class: 'hp-text', text: '100' });
    const hpBox = el('div', { class: 'hud-hp' }, [
      el('div', { class: 'hp-icon', text: '✚' }),
      this.hpText,
      el('div', { class: 'hp-bar' }, [this.hpFill]),
    ]);

    this.ammoMag = el('span', { class: 'ammo-mag', text: '30' });
    this.ammoRes = el('span', { class: 'ammo-res', text: '/ 90' });
    this.weaponName = el('div', { class: 'weapon-name', text: 'RIFLE' });
    this.reloadFill = el('div', { class: 'reload-fill' });
    this.reloadBar = el('div', { class: 'reload-bar hidden' }, [this.reloadFill]);
    const slotsEl = el('div', { class: 'weapon-slots' });
    WEAPONS.forEach((w, i) => {
      const s = el('div', { class: 'slot' }, [el('b', { text: String(i + 1) }), w.short]);
      this.slots.push(s);
      slotsEl.append(s);
    });
    this.equip = [el('div', { class: 'slot' }), el('div', { class: 'slot' })];
    const ammoBox = el('div', { class: 'hud-ammo' }, [
      el('div', { class: 'weapon-slots' }, this.equip),
      slotsEl,
      this.weaponName,
      el('div', { class: 'ammo-line' }, [this.ammoMag, this.ammoRes]),
      this.reloadBar,
    ]);

    this.timer = el('div', { class: 'timer', text: '10:00' });
    this.scoreL = el('div', { class: 'score-l' });
    this.scoreMid = el('div', { class: 'score-mid' });
    this.scoreR = el('div', { class: 'score-r' });
    const top = el('div', { class: 'hud-top' }, [
      el('div', { class: 'score-row' }, [this.scoreL, this.timer, this.scoreR]),
      this.scoreMid,
    ]);

    this.feed = el('div', { class: 'killfeed' });
    this.dmgWrap = el('div', { class: 'dmg-wrap' });
    this.dmgFlash = el('div', { class: 'dmg-flash' });
    this.lowHp = el('div', { class: 'low-hp' });
    this.flashWhite = el('div', { class: 'flash-white' });
    this.daze = el('div', { class: 'daze' });
    this.deathBy = el('div', { class: 'death-by' });
    this.deathTimer = el('div', { class: 'death-timer' });
    this.death = el('div', { class: 'death hidden' }, [
      el('div', { class: 'death-title', text: 'VOCÊ FOI ELIMINADO' }),
      this.deathBy,
      this.deathTimer,
    ]);
    this.protect = el('div', { class: 'protect hidden', text: 'PROTEÇÃO DE SPAWN' });
    this.stats = el('div', { class: 'stats' });
    this.scope = el('div', { class: 'scope hidden' }, [el('div', { class: 'scope-lines' })]);
    this.notice = el('div', { class: 'notice hidden' });
    this.damageLayer = el('div', { class: 'dmg-numbers' });

    this.root = el('div', { class: 'hud hidden' }, [
      this.scope,
      this.lowHp,
      this.daze,
      this.dmgFlash,
      this.dmgWrap,
      this.damageLayer,
      this.crosshair,
      this.hitmarkerEl,
      hpBox,
      ammoBox,
      top,
      this.feed,
      this.protect,
      this.notice,
      this.stats,
      this.death,
      this.flashWhite,
    ]);
    parent.append(this.root);
    this.redrawCrosshair(0);
    settings.onChange(() => {
      this.lastSpread = -1;
      this.redrawCrosshair(0);
      this.trimFeed();
    });
  }

  show(v: boolean): void {
    show(this.root, v);
  }

  redrawCrosshair(spread: number): void {
    const s = Math.round(spread);
    if (s === this.lastSpread) return;
    this.lastSpread = s;
    drawCrosshair(this.crosshair, settings.get().crosshair, s);
  }

  setCrosshairVisible(v: boolean): void {
    this.crosshair.style.visibility = v ? 'visible' : 'hidden';
  }

  setHealth(hp: number): void {
    const v = Math.max(0, Math.round(hp));
    this.text(this.hpText, String(v));
    this.width(this.hpFill, v);
    this.hpFill.classList.toggle('low', v <= 30);
    this.lowHp.style.opacity = v > 0 && v <= 35 ? String((1 - v / 35) * 0.8) : '0';
  }

  setAmmo(weapon: number, mag: number, reserve: number, reload: number): void {
    const def = WEAPONS[weapon];
    this.text(this.ammoMag, def.melee ? '∞' : String(mag));
    this.ammoMag.classList.toggle('empty', !def.melee && mag === 0);
    this.ammoMag.classList.toggle('low', mag > 0 && mag <= Math.ceil(def.mag * 0.25));
    this.text(this.ammoRes, def.melee ? '' : def.infiniteReserve ? '/ ∞' : `/ ${reserve}`);
    this.text(this.weaponName, def.name.toUpperCase());
    this.slots.forEach((s, i) => s.classList.toggle('active', i === weapon));
    show(this.reloadBar, reload >= 0);
    if (reload >= 0) this.width(this.reloadFill, Math.round(reload * 100));
  }

  /** One chip per thing to throw, with the key that throws it. */
  setEquipment(items: Array<{ key: string; name: string; left: number }>): void {
    this.equip.forEach((e, i) => {
      const item = items[i];
      show(e, item !== undefined);
      if (!item) return;
      this.text(e, `${item.key}  ${item.name} ×${item.left}`);
      e.classList.toggle('active', item.left > 0);
    });
  }

  /** Full strength at first, then fades: a flashbang stays white for a while, a concussion lets go sooner. */
  stun(blind: boolean, ms: number): void {
    const e = blind ? this.flashWhite : this.daze;
    const hold = blind ? 0.45 : 0.2;
    e.style.transition = 'none';
    e.style.opacity = '1';
    void e.offsetWidth;
    e.style.transition = `opacity ${ms * (1 - hold)}ms ease-in ${ms * hold}ms`;
    e.style.opacity = '0';
  }

  clearStun(): void {
    for (const e of [this.flashWhite, this.daze]) {
      e.style.transition = 'none';
      e.style.opacity = '0';
    }
  }

  /** Shows the weapons the player has, in wheel order, each with the number key that selects it. */
  setSlots(allowed: number[], keys: number[]): void {
    this.slots.forEach((s, i) => {
      show(s, allowed.includes(i));
      s.style.order = String(allowed.indexOf(i));
      this.text(s.firstElementChild as HTMLElement, String(keys.indexOf(i) + 1));
    });
  }

  setTimer(ms: number): void {
    this.text(this.timer, formatTime(ms));
    this.timer.classList.toggle('urgent', ms >= 0 && ms < 30000);
  }

  /** Top bar. For TDM pass team scores; for FFA pass own and leader. */
  setScore(left: { text: string; color: string }, right: { text: string; color: string }, mid: string): void {
    this.text(this.scoreL, left.text);
    this.scoreL.style.color = left.color;
    this.text(this.scoreR, right.text);
    this.scoreR.style.color = right.color;
    this.text(this.scoreMid, mid);
  }

  /** Floating number over the target. A small sideways offset keeps fast hits from stacking. */
  addDamageNumber(amount: number, kind: 'hit' | 'head' | 'kill', x: number, y: number, z: number): void {
    const e = el('div', { class: `dmg-number ${kind}`, text: String(amount) });
    this.damageLayer.append(e);
    this.damageNumbers.push({ el: e, x, y, z, age: 0, drift: (Math.random() - 0.5) * 36 });
    if (this.damageNumbers.length > MAX_DAMAGE_NUMBERS) this.damageNumbers.shift()?.el.remove();
  }

  /** `project` gives the screen position of a world point, or null when it's behind the camera. */
  updateDamageNumbers(dt: number, project: (x: number, y: number, z: number) => [number, number] | null): void {
    this.damageNumbers = this.damageNumbers.filter((n) => {
      n.age += dt;
      if (n.age >= DAMAGE_NUMBER_LIFE) {
        n.el.remove();
        return false;
      }
      const s = project(n.x, n.y, n.z);
      n.el.style.visibility = s ? 'visible' : 'hidden';
      if (s) {
        const t = n.age / DAMAGE_NUMBER_LIFE;
        n.el.style.opacity = String(Math.min(1, (1 - t) * 2.5));
        n.el.style.transform = `translate(-50%, -100%) translate(${s[0] + n.drift * t}px, ${s[1] - 42 * t}px)`;
      }
      return true;
    });
  }

  hitmarker(kind: 'hit' | 'head' | 'kill'): void {
    const h = this.hitmarkerEl;
    h.className = 'hitmarker';
    void h.offsetWidth; // restart animation
    h.classList.add('show', kind);
    clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => (h.className = 'hitmarker'), kind === 'kill' ? 450 : 250);
  }

  addKill(killer: FeedPlayer, victim: FeedPlayer, weapon: number, hs: boolean, mine: boolean): void {
    const row = el('div', { class: 'feed-row' + (mine ? ' mine' : '') }, [
      el('span', { text: killer.name, style: { color: killer.color } }),
      el('span', { class: 'feed-weapon', text: ` [${WEAPONS[weapon]?.short ?? '?'}${hs ? ' ✛HS' : ''}] ` }),
      el('span', { text: victim.name, style: { color: victim.color } }),
    ]);
    this.feed.append(row);
    this.trimFeed();
    window.setTimeout(() => {
      row.classList.add('fade');
      window.setTimeout(() => row.remove(), 600);
    }, 5500);
  }

  private trimFeed(): void {
    const max = settings.get().killfeedSize;
    while (this.feed.children.length > max) this.feed.firstElementChild?.remove();
  }

  clearFeed(): void {
    clear(this.feed);
  }

  /** Registers a damage source; direction is updated every frame relative to view yaw. */
  damageFrom(srcX: number, srcZ: number, amount: number): void {
    const e = el('div', { class: 'dmg-ind' }, [el('div', { class: 'dmg-arc' })]);
    this.dmgWrap.append(e);
    this.indicators.push({ el: e, srcX, srcZ, life: 1.6 });
    this.dmgFlash.style.transition = 'none';
    this.dmgFlash.style.opacity = String(Math.min(0.65, 0.2 + amount / 120));
    void this.dmgFlash.offsetWidth;
    this.dmgFlash.style.transition = 'opacity 0.5s ease-out';
    this.dmgFlash.style.opacity = '0';
  }

  updateIndicators(dt: number, px: number, pz: number, yaw: number): void {
    for (let i = this.indicators.length - 1; i >= 0; i--) {
      const d = this.indicators[i];
      d.life -= dt;
      if (d.life <= 0) {
        d.el.remove();
        this.indicators.splice(i, 1);
        continue;
      }
      // Angle of source relative to where we're looking (0 = in front, clockwise positive).
      const world = Math.atan2(d.srcX - px, d.srcZ - pz);
      const facing = Math.atan2(-Math.sin(yaw), -Math.cos(yaw));
      const rel = facing - world;
      d.el.style.transform = `rotate(${rel}rad)`;
      d.el.style.opacity = String(Math.min(1, d.life));
    }
  }

  clearIndicators(): void {
    this.indicators.forEach((d) => d.el.remove());
    this.indicators = [];
  }

  setDeath(byName: string | null, color: string, secondsLeft: number): void {
    show(this.death, byName !== null);
    if (byName === null) {
      this.cache.delete(this.deathBy);
      return;
    }
    const key = byName + color;
    if (this.cache.get(this.deathBy) !== key) {
      this.cache.set(this.deathBy, key);
      clear(this.deathBy);
      this.deathBy.append('Eliminado por ', el('b', { text: byName, style: { color } }));
    }
    this.text(this.deathTimer, secondsLeft > 0 ? `Renascendo em ${secondsLeft.toFixed(1)}s` : 'Renascendo…');
  }

  setProtected(v: boolean): void {
    show(this.protect, v);
  }

  setStats(fps: number | null, ping: number | null): void {
    const parts: string[] = [];
    if (fps !== null) parts.push(`${fps} FPS`);
    if (ping !== null) parts.push(`${Math.round(ping)} ms`);
    this.text(this.stats, parts.join('  ·  '));
    show(this.stats, parts.length > 0);
  }

  setScope(v: boolean): void {
    show(this.scope, v);
  }

  notify(text: string): void {
    this.notice.textContent = text;
    show(this.notice, true);
    this.notice.classList.remove('pop');
    void this.notice.offsetWidth;
    this.notice.classList.add('pop');
    clearTimeout(this.noticeTimer);
    this.noticeTimer = window.setTimeout(() => show(this.notice, false), 1600);
  }

  reset(): void {
    this.clearFeed();
    this.clearIndicators();
    this.setDeath(null, '', 0);
    this.setScope(false);
    this.setProtected(false);
    this.dmgFlash.style.opacity = '0';
    this.clearStun();
    this.damageNumbers.forEach((n) => n.el.remove());
    this.damageNumbers = [];
  }
}

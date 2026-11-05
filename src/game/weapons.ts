import type { Arsenal } from './constants';

/**
 * All weapon balance lives in this file: change a number in WEAPONS and the host,
 * the clients, the HUD and the loadout screen follow.
 */

export type WeaponCategory = 'primary' | 'pistol' | 'melee';

export type WeaponSound =
  | 'rifle'
  | 'smg'
  | 'lmg'
  | 'dmr'
  | 'shotgun'
  | 'sniper'
  | 'crossbow'
  | 'launcher'
  | 'pistol'
  | 'deagle'
  | 'revolver'
  | 'knife';

export interface WeaponDef {
  id: number;
  name: string;
  short: string;
  category: WeaponCategory;
  /** One line shown on the loadout screen. */
  desc: string;
  damage: number;
  /** Milliseconds between shots. */
  interval: number;
  auto: boolean;
  mag: number;
  reserve: number;
  maxReserve: number;
  infiniteReserve: boolean;
  pellets: number;
  spreadHip: number;
  spreadAds: number;
  spreadMove: number;
  spreadAir: number;
  /** Vertical recoil: radians of upward kick per shot. */
  kick: number;
  /** Horizontal recoil: radians per shot, multiplied by the pattern or a random value. */
  kickYaw: number;
  /** How fast recoil recovers after firing stops. */
  recover: number;
  /** Seconds. */
  reloadTime: number;
  zoom: number;
  adsTime: number;
  /** Meters. */
  range: number;
  falloff: { start: number; end: number; min: number } | null;
  tracer: number;
  ammoPickup: number;
  sound: WeaponSound;
  /** Strength of the first-person kick animation. */
  fireKick: number;
  /** Size of the gun on other players' models. */
  shape: { len: number; h: number };
  /** Horizontal recoil follows RECOIL_PATTERN instead of being random. */
  pattern?: boolean;
  /** Aiming looks through a full-screen scope. */
  scoped?: boolean;
  /** Movement speed multiplier while holding this weapon. */
  moveMul?: number;
  /** Shots per trigger pull; `interval` is the gap inside the burst. */
  burst?: number;
  /** Milliseconds between bursts. */
  burstPause?: number;
  /** Fires a physical projectile, simulated by the host, instead of an instant hit. */
  projectile?: { speed: number; gravity: number; kind: 'bolt' | 'grenade' };
  /** Damage in an area around the impact. `min` is the damage multiplier at the edge. */
  splash?: { radius: number; min: number };
  /** No flash, no tracer and a sound that only carries a few meters. */
  silent?: boolean;
  /** Close-range swing: no ammo, no reload, no ADS. */
  melee?: boolean;
}

/** Weapon ids. They are sent over the network and index WEAPONS. */
export const W = {
  RIFLE: 0,
  PISTOL: 1,
  SHOTGUN: 2,
  SNIPER: 3,
  KNIFE: 4,
  SMG: 5,
  LMG: 6,
  CROSSBOW: 7,
  DMR: 8,
  LAUNCHER: 9,
  DEAGLE: 10,
  REVOLVER: 11,
  AUTO_PISTOL: 12,
} as const;

export const WEAPONS: WeaponDef[] = [
  {
    id: W.RIFLE,
    name: 'Rifle de Assalto',
    short: 'RIFLE',
    category: 'primary',
    desc: 'Equilibrado, recuo médio',
    damage: 20,
    interval: 100,
    auto: true,
    mag: 30,
    reserve: 90,
    maxReserve: 180,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.022,
    spreadAds: 0.004,
    spreadMove: 0.03,
    spreadAir: 0.08,
    kick: 0.011,
    kickYaw: 0.006,
    recover: 6,
    reloadTime: 2.0,
    zoom: 1.35,
    adsTime: 0.16,
    range: 200,
    falloff: null,
    tracer: 0xffd27a,
    ammoPickup: 60,
    sound: 'rifle',
    fireKick: 1,
    shape: { len: 0.75, h: 0.12 },
    pattern: true,
  },
  {
    id: W.PISTOL,
    name: 'Pistola',
    short: 'PISTOLA',
    category: 'pistol',
    desc: 'Rápida, dano baixo',
    damage: 18,
    interval: 130,
    auto: false,
    mag: 12,
    reserve: 0,
    maxReserve: 0,
    infiniteReserve: true,
    pellets: 1,
    spreadHip: 0.015,
    spreadAds: 0.004,
    spreadMove: 0.02,
    spreadAir: 0.06,
    kick: 0.018,
    kickYaw: 0.004,
    recover: 9,
    reloadTime: 1.4,
    zoom: 1.2,
    adsTime: 0.12,
    range: 150,
    falloff: null,
    tracer: 0xfff0b0,
    ammoPickup: 0,
    sound: 'pistol',
    fireKick: 1,
    shape: { len: 0.35, h: 0.12 },
  },
  {
    id: W.SHOTGUN,
    name: 'Escopeta',
    short: 'ESCOPETA',
    category: 'primary',
    desc: 'Dano altíssimo de perto, fraca de longe',
    damage: 14,
    interval: 850,
    auto: false,
    mag: 8,
    reserve: 24,
    maxReserve: 40,
    infiniteReserve: false,
    pellets: 8,
    spreadHip: 0.075,
    spreadAds: 0.055,
    spreadMove: 0.015,
    spreadAir: 0.03,
    kick: 0.06,
    kickYaw: 0.01,
    recover: 5,
    reloadTime: 2.5,
    zoom: 1.15,
    adsTime: 0.14,
    range: 60,
    falloff: { start: 7, end: 28, min: 0.25 },
    tracer: 0xffb060,
    ammoPickup: 12,
    sound: 'shotgun',
    fireKick: 1.6,
    shape: { len: 0.85, h: 0.14 },
  },
  {
    id: W.SNIPER,
    name: 'Sniper',
    short: 'SNIPER',
    category: 'primary',
    desc: 'Mata com 1 tiro na cabeça, tiro lento',
    damage: 90,
    interval: 1300,
    auto: false,
    mag: 5,
    reserve: 20,
    maxReserve: 30,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.09,
    spreadAds: 0.0,
    spreadMove: 0.05,
    spreadAir: 0.12,
    // No camera recoil: at 4.2x zoom any kick throws the aim off, and recovering it drags the scope down.
    kick: 0,
    kickYaw: 0,
    recover: 4,
    reloadTime: 3.0,
    zoom: 4.2,
    adsTime: 0.25,
    range: 400,
    falloff: null,
    tracer: 0xbfe6ff,
    ammoPickup: 10,
    sound: 'sniper',
    fireKick: 1.6,
    shape: { len: 1.1, h: 0.11 },
    scoped: true,
  },
  {
    id: W.KNIFE,
    name: 'Faca',
    short: 'FACA',
    category: 'melee',
    desc: 'Corre bem mais rápido, alcance curto',
    damage: 70,
    interval: 500,
    auto: false,
    mag: 0,
    reserve: 0,
    maxReserve: 0,
    infiniteReserve: true,
    pellets: 1,
    spreadHip: 0,
    spreadAds: 0,
    spreadMove: 0,
    spreadAir: 0.015,
    kick: 0.015,
    kickYaw: 0,
    recover: 12,
    reloadTime: 0,
    zoom: 1,
    adsTime: 0.1,
    range: 2.4,
    falloff: null,
    tracer: 0xcdd4dc,
    ammoPickup: 0,
    sound: 'knife',
    fireKick: 1,
    shape: { len: 0.3, h: 0.05 },
    melee: true,
  },
  {
    id: W.SMG,
    name: 'SMG',
    short: 'SMG',
    category: 'primary',
    desc: 'Cadência alta, dano baixo, recuo leve',
    damage: 13,
    interval: 65,
    auto: true,
    mag: 30,
    reserve: 120,
    maxReserve: 210,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.026,
    spreadAds: 0.009,
    spreadMove: 0.018,
    spreadAir: 0.06,
    kick: 0.005,
    kickYaw: 0.004,
    recover: 8,
    reloadTime: 1.7,
    zoom: 1.25,
    adsTime: 0.13,
    range: 120,
    falloff: { start: 18, end: 60, min: 0.55 },
    tracer: 0xffe0a0,
    ammoPickup: 60,
    sound: 'smg',
    fireKick: 0.7,
    shape: { len: 0.5, h: 0.11 },
    pattern: true,
  },
  {
    id: W.LMG,
    name: 'LMG',
    short: 'LMG',
    category: 'primary',
    desc: 'Dano alto, recuo muito difícil, pesada',
    damage: 28,
    interval: 110,
    auto: true,
    mag: 100,
    reserve: 200,
    maxReserve: 300,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.05,
    spreadAds: 0.012,
    spreadMove: 0.05,
    spreadAir: 0.1,
    kick: 0.032,
    kickYaw: 0.024,
    recover: 3,
    reloadTime: 5.0,
    zoom: 1.3,
    adsTime: 0.3,
    range: 220,
    falloff: null,
    tracer: 0xffc060,
    ammoPickup: 100,
    sound: 'lmg',
    fireKick: 1.3,
    shape: { len: 0.95, h: 0.16 },
    pattern: true,
    moveMul: 0.72,
  },
  {
    id: W.CROSSBOW,
    name: 'Besta',
    short: 'BESTA',
    category: 'primary',
    desc: 'Silenciosa, dano alto, seta com queda',
    damage: 95,
    interval: 400,
    auto: false,
    mag: 1,
    reserve: 15,
    maxReserve: 25,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.012,
    spreadAds: 0,
    spreadMove: 0.02,
    spreadAir: 0.05,
    kick: 0.01,
    kickYaw: 0.002,
    recover: 6,
    reloadTime: 2.6,
    zoom: 1.8,
    adsTime: 0.2,
    range: 300,
    falloff: null,
    tracer: 0xd8d0b8,
    ammoPickup: 8,
    sound: 'crossbow',
    fireKick: 0.8,
    shape: { len: 0.7, h: 0.1 },
    projectile: { speed: 75, gravity: 9, kind: 'bolt' },
    silent: true,
  },
  {
    id: W.DMR,
    name: 'DMR',
    short: 'DMR',
    category: 'primary',
    desc: 'Tiro a tiro, boa em média distância',
    damage: 42,
    interval: 260,
    auto: false,
    mag: 15,
    reserve: 60,
    maxReserve: 90,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.03,
    spreadAds: 0.002,
    spreadMove: 0.03,
    spreadAir: 0.08,
    kick: 0.016,
    kickYaw: 0.004,
    recover: 7,
    reloadTime: 2.2,
    zoom: 2,
    adsTime: 0.2,
    range: 280,
    falloff: null,
    tracer: 0xe8e0c0,
    ammoPickup: 30,
    sound: 'dmr',
    fireKick: 1.2,
    shape: { len: 0.95, h: 0.11 },
    scoped: true,
  },
  {
    id: W.LAUNCHER,
    name: 'Lança-granadas',
    short: 'GRANADAS',
    category: 'primary',
    desc: 'Dano em área, projétil em arco',
    damage: 95,
    interval: 900,
    auto: false,
    mag: 6,
    reserve: 12,
    maxReserve: 18,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.012,
    spreadAds: 0.004,
    spreadMove: 0.02,
    spreadAir: 0.05,
    kick: 0.05,
    kickYaw: 0.01,
    recover: 5,
    reloadTime: 3.2,
    zoom: 1.2,
    adsTime: 0.2,
    range: 200,
    falloff: null,
    tracer: 0xffa040,
    ammoPickup: 6,
    sound: 'launcher',
    fireKick: 1.6,
    shape: { len: 0.7, h: 0.17 },
    projectile: { speed: 34, gravity: 16, kind: 'grenade' },
    splash: { radius: 5.5, min: 0.2 },
  },
  {
    id: W.DEAGLE,
    name: 'Desert Eagle',
    short: 'DEAGLE',
    category: 'pistol',
    desc: 'Dano muito alto, recuo forte, tiro lento',
    damage: 60,
    interval: 480,
    auto: false,
    mag: 7,
    reserve: 0,
    maxReserve: 0,
    infiniteReserve: true,
    pellets: 1,
    spreadHip: 0.02,
    spreadAds: 0.004,
    spreadMove: 0.03,
    spreadAir: 0.08,
    kick: 0.06,
    kickYaw: 0.014,
    recover: 6,
    reloadTime: 1.9,
    zoom: 1.25,
    adsTime: 0.15,
    range: 170,
    falloff: null,
    tracer: 0xffe6a0,
    ammoPickup: 0,
    sound: 'deagle',
    fireKick: 1.6,
    shape: { len: 0.42, h: 0.14 },
  },
  {
    id: W.REVOLVER,
    name: 'Revólver',
    short: 'REVÓLVER',
    category: 'pistol',
    desc: 'Dano alto, preciso, recarga lenta',
    damage: 48,
    interval: 380,
    auto: false,
    mag: 6,
    reserve: 0,
    maxReserve: 0,
    infiniteReserve: true,
    pellets: 1,
    spreadHip: 0.008,
    spreadAds: 0.001,
    spreadMove: 0.02,
    spreadAir: 0.06,
    kick: 0.03,
    kickYaw: 0.006,
    recover: 7,
    reloadTime: 3.0,
    zoom: 1.3,
    adsTime: 0.15,
    range: 190,
    falloff: null,
    tracer: 0xfff0c8,
    ammoPickup: 0,
    sound: 'revolver',
    fireKick: 1.3,
    shape: { len: 0.4, h: 0.13 },
  },
  {
    id: W.AUTO_PISTOL,
    name: 'Pistola Automática',
    short: 'AUTO',
    category: 'pistol',
    desc: 'Dispara em rajada, recuo médio',
    damage: 16,
    interval: 70,
    auto: false,
    mag: 20,
    reserve: 0,
    maxReserve: 0,
    infiniteReserve: true,
    pellets: 1,
    spreadHip: 0.02,
    spreadAds: 0.007,
    spreadMove: 0.022,
    spreadAir: 0.06,
    kick: 0.012,
    kickYaw: 0.006,
    recover: 8,
    reloadTime: 1.6,
    zoom: 1.2,
    adsTime: 0.12,
    range: 130,
    falloff: { start: 15, end: 50, min: 0.6 },
    tracer: 0xfff0b0,
    ammoPickup: 0,
    sound: 'pistol',
    fireKick: 0.8,
    shape: { len: 0.38, h: 0.15 },
    pattern: true,
    burst: 3,
    burstPause: 320,
  },
];

export const WEAPON_COUNT = WEAPONS.length;
export const HEADSHOT_MULT = 2;

/** Two primaries and a pistol. Used when the time to choose runs out. */
export const DEFAULT_LOADOUT: number[] = [W.RIFLE, W.SMG, W.PISTOL];

export const PRIMARIES = WEAPONS.filter((w) => w.category === 'primary');
export const PISTOLS = WEAPONS.filter((w) => w.category === 'pistol');

export function validLoadout(l: number[]): boolean {
  const [a, b, c] = l;
  return l.length === 3 && a !== b && WEAPONS[a]?.category === 'primary' && WEAPONS[b]?.category === 'primary' && WEAPONS[c]?.category === 'pistol';
}

/** Completes a partial choice with the default weapons. */
export function fillLoadout(primaries: number[], pistol: number | null): number[] {
  const chosen = primaries.slice(0, 2);
  for (const w of DEFAULT_LOADOUT.slice(0, 2)) if (chosen.length < 2 && !chosen.includes(w)) chosen.push(w);
  return [...chosen, pistol ?? DEFAULT_LOADOUT[2]];
}

/** Gun Game levels: every weapon, one kill each, from the easiest to the hardest. A kill on the last one wins. */
export const GUN_GAME_LADDER: number[] = [
  W.RIFLE,
  W.SMG,
  W.LMG,
  W.SHOTGUN,
  W.DMR,
  W.SNIPER,
  W.LAUNCHER,
  W.CROSSBOW,
  W.DEAGLE,
  W.REVOLVER,
  W.AUTO_PISTOL,
  W.PISTOL,
  W.KNIFE,
];

/** Weapons a player may use. `level` is the Gun Game level. Every mode keeps the knife for movement. */
export function allowedWeapons(arsenal: Arsenal, level: number, loadout: number[]): number[] {
  switch (arsenal) {
    case 'sniper':
      return [W.SNIPER, W.KNIFE];
    case 'shotgun':
      return [W.SHOTGUN, W.KNIFE];
    case 'gungame': {
      const w = GUN_GAME_LADDER[Math.min(level, GUN_GAME_LADDER.length - 1)];
      return w === W.KNIFE ? [w] : [w, W.KNIFE];
    }
    default:
      return [...loadout, W.KNIFE];
  }
}

/** Horizontal recoil pattern (multiplied by kickYaw), cycles after the end. */
export const RECOIL_PATTERN = [0, 0.3, -0.2, 0.5, 0.8, 0.4, -0.3, -0.9, -1.2, -0.6, 0.2, 0.9, 1.3, 0.8, -0.2, -1.0];

export function damageAt(def: WeaponDef, dist: number, head: boolean): number {
  let dmg = def.damage * (head ? HEADSHOT_MULT : 1);
  if (def.falloff) {
    const f = def.falloff;
    const t = Math.min(1, Math.max(0, (dist - f.start) / (f.end - f.start)));
    dmg *= 1 - t * (1 - f.min);
  }
  return dmg;
}

export function fullAmmo(): { mag: number[]; reserve: number[] } {
  return { mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve) };
}

import type { Arsenal } from './constants';

/**
 * All weapon balance lives in this file: change a number in WEAPONS and the host,
 * the clients, the HUD and the loadout screen follow.
 */

export type WeaponCategory = 'primary' | 'pistol' | 'melee' | 'lethal' | 'tactical' | 'objective';

export type ProjectileKind = 'bolt' | 'grenade' | 'knife' | 'bottle' | 'can';

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
  | 'knife'
  | 'throw';

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
  /** Damage multiplier on a headshot. */
  headMul: number;
  /** Milliseconds after a sprint before this weapon can fire or aim. */
  sprintOut: number;
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
  projectile?: {
    speed: number;
    gravity: number;
    kind: ProjectileKind;
    /** Seconds until it goes off. With a fuse it bounces instead of stopping at the first thing it hits. */
    fuse?: number;
    /** Radians added to the aim, so a throw at the crosshair lands near it. */
    loft?: number;
  };
  /** Damage in an area around the impact. `min` is the damage multiplier at the edge. */
  splash?: { radius: number; min: number };
  /** Burns the ground where it lands. */
  fire?: { radius: number; ms: number; dps: number };
  /** Longest effect on whoever the blast reaches. `blind` blinds, and depends on looking at it; otherwise it slows. */
  stun?: { radius: number; ms: number; blind: boolean };
  /** Fills the area with a cloud nobody sees through. Sold only in the bomb mode. */
  smoke?: { radius: number; ms: number };
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
  FRAG: 13,
  THROWING_KNIFE: 14,
  MOLOTOV: 15,
  FLASHBANG: 16,
  CONCUSSION: 17,
  SMOKE: 18,
  /** Not a weapon: it's here so the kill feed can name it. */
  BOMB: 19,
} as const;

type ThrownDef = Pick<WeaponDef, 'id' | 'name' | 'short' | 'category' | 'desc' | 'damage' | 'mag'> & Partial<WeaponDef>;

/** Thrown equipment lives in this table so ammo sync, projectiles and the kill feed work on it. What only guns use stays neutral. */
function thrown(d: ThrownDef): WeaponDef {
  return {
    interval: 0,
    auto: false,
    reserve: 0,
    maxReserve: 0,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0,
    spreadAds: 0,
    spreadMove: 0,
    spreadAir: 0,
    headMul: 1,
    sprintOut: 0,
    kick: 0,
    kickYaw: 0,
    recover: 1,
    reloadTime: 0,
    zoom: 1,
    adsTime: 0.2,
    range: 0,
    falloff: null,
    tracer: 0,
    ammoPickup: 0,
    sound: 'throw',
    fireKick: 0,
    shape: { len: 0, h: 0 },
    silent: true,
    ...d,
  };
}

export const WEAPONS: WeaponDef[] = [
  {
    id: W.RIFLE,
    name: 'Rifle de Assalto',
    short: 'RIFLE',
    category: 'primary',
    desc: 'Equilibrado, recuo médio',
    damage: 33,
    interval: 86,
    auto: true,
    mag: 30,
    reserve: 90,
    maxReserve: 180,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.03,
    spreadAds: 0.003,
    spreadMove: 0.02,
    spreadAir: 0.06,
    kick: 0.006,
    kickYaw: 0.004,
    recover: 6,
    reloadTime: 2.2,
    zoom: 1.35,
    adsTime: 0.2,
    range: 200,
    falloff: { start: 38, end: 40, min: 0.76 },
    tracer: 0xffd27a,
    ammoPickup: 60,
    sound: 'rifle',
    fireKick: 1,
    shape: { len: 0.75, h: 0.12 },
    pattern: true,
    headMul: 1.4,
    sprintOut: 200,
    moveMul: 0.95,
  },
  {
    id: W.PISTOL,
    name: 'Pistola',
    short: 'PISTOLA',
    category: 'pistol',
    desc: 'Rápida, dano baixo',
    damage: 34,
    interval: 130,
    auto: false,
    mag: 12,
    reserve: 0,
    maxReserve: 0,
    infiniteReserve: true,
    pellets: 1,
    spreadHip: 0.012,
    spreadAds: 0.004,
    spreadMove: 0.012,
    spreadAir: 0.06,
    kick: 0.01,
    kickYaw: 0.004,
    recover: 9,
    reloadTime: 1.6,
    zoom: 1.2,
    adsTime: 0.13,
    range: 150,
    falloff: { start: 12, end: 14, min: 0.6 },
    tracer: 0xfff0b0,
    ammoPickup: 0,
    sound: 'pistol',
    fireKick: 1,
    shape: { len: 0.35, h: 0.12 },
    headMul: 1.4,
    sprintOut: 120,
  },
  {
    id: W.SHOTGUN,
    name: 'Escopeta',
    short: 'ESCOPETA',
    category: 'primary',
    desc: 'Mata com 1 tiro de perto, fraca de longe',
    damage: 20,
    interval: 800,
    auto: false,
    mag: 7,
    reserve: 21,
    maxReserve: 35,
    infiniteReserve: false,
    pellets: 7,
    spreadHip: 0.065,
    spreadAds: 0.055,
    spreadMove: 0.015,
    spreadAir: 0.03,
    kick: 0.04,
    kickYaw: 0.01,
    recover: 5,
    reloadTime: 3,
    zoom: 1.15,
    adsTime: 0.2,
    range: 60,
    falloff: { start: 6, end: 16, min: 0.3 },
    tracer: 0xffb060,
    ammoPickup: 12,
    sound: 'shotgun',
    fireKick: 1.6,
    shape: { len: 0.85, h: 0.14 },
    headMul: 1,
    sprintOut: 200,
  },
  {
    id: W.SNIPER,
    name: 'Sniper',
    short: 'SNIPER',
    category: 'primary',
    desc: 'Mata com 1 tiro no corpo, tiro lento',
    damage: 100,
    interval: 1200,
    auto: false,
    mag: 5,
    reserve: 15,
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
    reloadTime: 3.4,
    zoom: 4.2,
    adsTime: 0.35,
    range: 400,
    falloff: null,
    tracer: 0xbfe6ff,
    ammoPickup: 10,
    sound: 'sniper',
    fireKick: 1.6,
    shape: { len: 1.1, h: 0.11 },
    scoped: true,
    headMul: 1.5,
    sprintOut: 300,
    moveMul: 0.9,
  },
  {
    id: W.KNIFE,
    name: 'Faca',
    short: 'FACA',
    category: 'melee',
    desc: 'Mata com 1 golpe, alcance curto',
    damage: 150,
    interval: 700,
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
    range: 2.8,
    falloff: null,
    tracer: 0xcdd4dc,
    ammoPickup: 0,
    sound: 'knife',
    fireKick: 1,
    shape: { len: 0.3, h: 0.05 },
    melee: true,
    headMul: 1,
    sprintOut: 0,
  },
  {
    id: W.SMG,
    name: 'SMG',
    short: 'SMG',
    category: 'primary',
    desc: 'Mata rápido de perto, perde dano de longe',
    damage: 33,
    interval: 67,
    auto: true,
    mag: 30,
    reserve: 120,
    maxReserve: 210,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.02,
    spreadAds: 0.008,
    spreadMove: 0.012,
    spreadAir: 0.06,
    kick: 0.004,
    kickYaw: 0.003,
    recover: 8,
    reloadTime: 2,
    zoom: 1.25,
    adsTime: 0.15,
    range: 120,
    falloff: { start: 13, end: 15, min: 0.6 },
    tracer: 0xffe0a0,
    ammoPickup: 60,
    sound: 'smg',
    fireKick: 0.7,
    shape: { len: 0.5, h: 0.11 },
    pattern: true,
    headMul: 1.4,
    sprintOut: 150,
  },
  {
    id: W.LMG,
    name: 'LMG',
    short: 'LMG',
    category: 'primary',
    desc: 'Dano alto, pente grande, pesada',
    damage: 40,
    interval: 86,
    auto: true,
    mag: 100,
    reserve: 200,
    maxReserve: 300,
    infiniteReserve: false,
    pellets: 1,
    spreadHip: 0.05,
    spreadAds: 0.01,
    spreadMove: 0.05,
    spreadAir: 0.1,
    kick: 0.012,
    kickYaw: 0.01,
    recover: 4,
    reloadTime: 7,
    zoom: 1.3,
    adsTime: 0.35,
    range: 220,
    falloff: { start: 40, end: 42, min: 0.75 },
    tracer: 0xffc060,
    ammoPickup: 100,
    sound: 'lmg',
    fireKick: 1.3,
    shape: { len: 0.95, h: 0.16 },
    pattern: true,
    moveMul: 0.85,
    headMul: 1.25,
    sprintOut: 350,
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
    headMul: 1.5,
    sprintOut: 250,
    moveMul: 0.95,
  },
  {
    id: W.DMR,
    name: 'DMR',
    short: 'DMR',
    category: 'primary',
    desc: 'Tiro a tiro, boa em média distância',
    damage: 45,
    interval: 200,
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
    kick: 0.012,
    kickYaw: 0.004,
    recover: 7,
    reloadTime: 2.4,
    zoom: 2,
    adsTime: 0.25,
    range: 280,
    falloff: { start: 40, end: 42, min: 0.75 },
    tracer: 0xe8e0c0,
    ammoPickup: 30,
    sound: 'dmr',
    fireKick: 1.2,
    shape: { len: 0.95, h: 0.11 },
    scoped: true,
    headMul: 1.5,
    sprintOut: 250,
    moveMul: 0.95,
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
    mag: 3,
    reserve: 6,
    maxReserve: 9,
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
    adsTime: 0.3,
    range: 200,
    falloff: null,
    tracer: 0xffa040,
    ammoPickup: 3,
    sound: 'launcher',
    fireKick: 1.6,
    shape: { len: 0.7, h: 0.17 },
    projectile: { speed: 34, gravity: 16, kind: 'grenade' },
    splash: { radius: 5.5, min: 0.2 },
    headMul: 1,
    sprintOut: 350,
    moveMul: 0.85,
  },
  {
    id: W.DEAGLE,
    name: 'Desert Eagle',
    short: 'DEAGLE',
    category: 'pistol',
    desc: '1 tiro na cabeça até 15 m, recuo forte, tiro lento',
    damage: 50,
    interval: 350,
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
    kick: 0.035,
    kickYaw: 0.014,
    recover: 6,
    reloadTime: 1.9,
    zoom: 1.25,
    adsTime: 0.15,
    range: 170,
    falloff: { start: 15, end: 17, min: 0.6 },
    tracer: 0xffe6a0,
    ammoPickup: 0,
    sound: 'deagle',
    fireKick: 1.6,
    shape: { len: 0.42, h: 0.14 },
    // 50 × 2 = 100: a headshot kills, up to where the falloff starts (15 m).
    headMul: 2,
    sprintOut: 150,
  },
  {
    id: W.REVOLVER,
    name: 'Revólver',
    short: 'REVÓLVER',
    category: 'pistol',
    desc: 'Dano alto, preciso, recarga lenta',
    damage: 50,
    interval: 330,
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
    kick: 0.02,
    kickYaw: 0.006,
    recover: 7,
    reloadTime: 3.0,
    zoom: 1.3,
    adsTime: 0.15,
    range: 190,
    falloff: { start: 18, end: 20, min: 0.68 },
    tracer: 0xfff0c8,
    ammoPickup: 0,
    sound: 'revolver',
    fireKick: 1.3,
    shape: { len: 0.4, h: 0.13 },
    headMul: 1.5,
    sprintOut: 150,
  },
  {
    id: W.AUTO_PISTOL,
    name: 'Pistola Automática',
    short: 'AUTO',
    category: 'pistol',
    desc: 'Dispara em rajada, recuo médio',
    damage: 25,
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
    falloff: { start: 10, end: 12, min: 0.6 },
    tracer: 0xfff0b0,
    ammoPickup: 0,
    sound: 'pistol',
    fireKick: 0.8,
    shape: { len: 0.38, h: 0.15 },
    pattern: true,
    burst: 3,
    burstPause: 320,
    headMul: 1.4,
    sprintOut: 120,
  },
  thrown({
    id: W.FRAG,
    name: 'Granada',
    short: 'GRANADA',
    category: 'lethal',
    desc: 'Quica e explode em 2,2 s, mata de perto',
    damage: 160,
    mag: 1,
    projectile: { speed: 20, gravity: 14, kind: 'grenade', fuse: 2.2, loft: 0.12 },
    splash: { radius: 7, min: 0.1 },
  }),
  thrown({
    id: W.THROWING_KNIFE,
    name: 'Faca de arremesso',
    short: 'ARREMESSO',
    category: 'lethal',
    desc: 'Mata com 1 acerto direto, sem dano em área',
    damage: 150,
    mag: 1,
    projectile: { speed: 36, gravity: 7, kind: 'knife' },
  }),
  thrown({
    id: W.MOLOTOV,
    name: 'Molotov',
    short: 'MOLOTOV',
    category: 'lethal',
    desc: 'Quebra ao bater e queima o chão por 6 s',
    damage: 0,
    mag: 1,
    projectile: { speed: 20, gravity: 14, kind: 'bottle', loft: 0.12 },
    fire: { radius: 3.5, ms: 6000, dps: 40 },
  }),
  thrown({
    id: W.FLASHBANG,
    name: 'Flashbang',
    short: 'FLASH',
    category: 'tactical',
    desc: 'Cega e ensurdece, pior para quem olha',
    damage: 0,
    mag: 2,
    projectile: { speed: 20, gravity: 14, kind: 'can', fuse: 1.4, loft: 0.12 },
    stun: { radius: 16, ms: 4500, blind: true },
  }),
  thrown({
    id: W.CONCUSSION,
    name: 'Concussão',
    short: 'CONCUSSÃO',
    category: 'tactical',
    desc: 'Deixa lento, sem corrida e com a mira pesada',
    damage: 0,
    mag: 2,
    projectile: { speed: 20, gravity: 14, kind: 'can', fuse: 1.4, loft: 0.12 },
    stun: { radius: 10, ms: 5000, blind: false },
  }),
  thrown({
    id: W.SMOKE,
    name: 'Fumaça',
    short: 'FUMAÇA',
    category: 'tactical',
    desc: 'Cobre a passagem por 17 s e corta a visão',
    damage: 0,
    mag: 0,
    projectile: { speed: 20, gravity: 14, kind: 'can', fuse: 1.6, loft: 0.12 },
    smoke: { radius: 5.5, ms: 17000 },
  }),
  thrown({ id: W.BOMB, name: 'Bomba', short: 'BOMBA', category: 'objective', desc: '', damage: 0, mag: 0 }),
];

export const WEAPON_COUNT = WEAPONS.length;

/** Two primaries, a pistol, a lethal and a tactical. Used when the time to choose runs out. */
export const DEFAULT_LOADOUT: number[] = [W.RIFLE, W.SMG, W.PISTOL, W.FRAG, W.FLASHBANG];

export const PRIMARIES = WEAPONS.filter((w) => w.category === 'primary');
export const PISTOLS = WEAPONS.filter((w) => w.category === 'pistol');
export const LETHALS = WEAPONS.filter((w) => w.category === 'lethal');
export const TACTICALS = WEAPONS.filter((w) => w.category === 'tactical' && !w.smoke);

/** Line on the loadout cards. */
export function magLabel(w: WeaponDef): string {
  return w.category === 'lethal' || w.category === 'tactical' ? `Por vida: ${w.mag}` : `Pente: ${w.mag}`;
}

export function validLoadout(l: number[], grenades = true): boolean {
  const [a, b, c, d, e] = l;
  if (!grenades && l.includes(W.LAUNCHER)) return false;
  const is = (w: number, category: WeaponCategory): boolean => WEAPONS[w]?.category === category;
  return l.length === 5 && a !== b && is(a, 'primary') && is(b, 'primary') && is(c, 'pistol') && is(d, 'lethal') && is(e, 'tactical');
}

/** Completes a partial choice with the default weapons. */
export function fillLoadout(primaries: number[], pistol: number | null, lethal: number | null, tactical: number | null): number[] {
  const chosen = primaries.slice(0, 2);
  for (const w of DEFAULT_LOADOUT.slice(0, 2)) if (chosen.length < 2 && !chosen.includes(w)) chosen.push(w);
  return [...chosen, pistol ?? DEFAULT_LOADOUT[2], lethal ?? DEFAULT_LOADOUT[3], tactical ?? DEFAULT_LOADOUT[4]];
}

/** Gun Game levels: every weapon, one kill each, from the easiest to the hardest. A kill on the last one wins. */
const GUN_GAME_LADDER: number[] = [
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

/** Levels of a match. Without grenades the launcher's level is skipped. */
export function gunGameLadder(grenades: boolean): number[] {
  return grenades ? GUN_GAME_LADDER : GUN_GAME_LADDER.filter((w) => w !== W.LAUNCHER);
}

/** Weapons a player may use. `level` is the Gun Game level. Every mode keeps the knife for movement. */
export function allowedWeapons(arsenal: Arsenal, level: number, loadout: number[], grenades = true): number[] {
  switch (arsenal) {
    case 'sniper':
      return [W.SNIPER, W.KNIFE];
    case 'shotgun':
      return [W.SHOTGUN, W.KNIFE];
    case 'shop':
      return [...loadout, W.KNIFE];
    case 'gungame': {
      const ladder = gunGameLadder(grenades);
      const w = ladder[Math.min(level, ladder.length - 1)];
      return w === W.KNIFE ? [w] : [w, W.KNIFE];
    }
    default:
      return [...loadout.slice(0, 3), W.KNIFE];
  }
}

/** Equipment a player spawns with. Fixed until the next spawn, or swapping it in the inventory would refill it. */
export function spawnEquipment(arsenal: Arsenal, loadout: number[], grenades = true): number[] {
  return arsenal === 'all' && grenades ? loadout.slice(3) : [];
}

/** Horizontal recoil pattern (multiplied by kickYaw), cycles after the end. */
export const RECOIL_PATTERN = [0, 0.3, -0.2, 0.5, 0.8, 0.4, -0.3, -0.9, -1.2, -0.6, 0.2, 0.9, 1.3, 0.8, -0.2, -1.0];

export function damageAt(def: WeaponDef, dist: number, head: boolean): number {
  let dmg = def.damage * (head ? def.headMul : 1);
  if (def.falloff) {
    const f = def.falloff;
    const t = Math.min(1, Math.max(0, (dist - f.start) / (f.end - f.start)));
    dmg *= 1 - t * (1 - f.min);
  }
  return dmg;
}

export function blastDamage(def: WeaponDef, dist: number): number {
  const s = def.splash;
  return s ? def.damage * (1 - (dist / s.radius) * (1 - s.min)) : 0;
}

/** `facing` is 1 looking straight at the blast and -1 with the back to it. */
export function stunMs(def: WeaponDef, dist: number, facing: number): number {
  const s = def.stun;
  if (!s || dist >= s.radius) return 0;
  const closeness = 0.4 + 0.6 * (1 - dist / s.radius);
  return s.ms * closeness * (s.blind && facing < 0.3 ? 0.35 : 1);
}

export function fullAmmo(): { mag: number[]; reserve: number[] } {
  return { mag: WEAPONS.map((w) => w.mag), reserve: WEAPONS.map((w) => w.reserve) };
}

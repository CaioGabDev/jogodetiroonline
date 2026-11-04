import type { Arsenal } from './constants';

export interface WeaponDef {
  id: number;
  name: string;
  short: string;
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
  /** Radians of upward kick per shot. */
  kick: number;
  /** Horizontal recoil pattern multiplier (pattern below). */
  kickYaw: number;
  recover: number;
  reloadTime: number;
  zoom: number;
  adsTime: number;
  range: number;
  falloff: { start: number; end: number; min: number } | null;
  tracer: number;
  ammoPickup: number;
  melee?: boolean;
}

export const WEAPONS: WeaponDef[] = [
  {
    id: 0,
    name: 'Rifle Automático',
    short: 'RIFLE',
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
  },
  {
    id: 1,
    name: 'Pistola',
    short: 'PISTOLA',
    damage: 25,
    interval: 150,
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
    kick: 0.022,
    kickYaw: 0.004,
    recover: 9,
    reloadTime: 1.4,
    zoom: 1.2,
    adsTime: 0.12,
    range: 150,
    falloff: null,
    tracer: 0xfff0b0,
    ammoPickup: 0,
  },
  {
    id: 2,
    name: 'Escopeta',
    short: 'ESCOPETA',
    damage: 12,
    interval: 850,
    auto: false,
    mag: 6,
    reserve: 24,
    maxReserve: 36,
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
  },
  {
    id: 3,
    name: 'Sniper',
    short: 'SNIPER',
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
  },
  {
    id: 4,
    name: 'Faca',
    short: 'FACA',
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
    melee: true,
  },
];

export const WEAPON_COUNT = WEAPONS.length;

/** Gun Game: the weapon for each kill count (rifle, doze, sniper, pistol, knife). Getting past the end wins. */
export const GUN_GAME_LADDER = [0, 0, 2, 2, 3, 3, 1, 1, 4];

/** Weapons a player with this many kills may use. The single-weapon modes keep the knife for movement. */
export function allowedWeapons(arsenal: Arsenal, kills: number): number[] {
  switch (arsenal) {
    case 'sniper':
      return [3, 4];
    case 'shotgun':
      return [2, 4];
    case 'gungame':
      return [GUN_GAME_LADDER[Math.min(Math.max(kills, 0), GUN_GAME_LADDER.length - 1)]];
    default:
      return WEAPONS.map((w) => w.id);
  }
}
export const HEADSHOT_MULT = 2;

/** Rifle horizontal recoil pattern (multiplied by kickYaw), cycles after the end. */
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

import type { BombDef } from './mapData';
import { W, WEAPONS, damageAt, type WeaponDef } from './weapons';

/**
 * Rules of the bomb mode: timers, economy and the shop. Everything here is balance, so a number changed
 * in this file is all it takes. The flow of a round lives in the host.
 */
export const ROUND = {
  freezeMs: 15000,
  roundMs: 115000,
  /** Counted from the end of the freeze. */
  buyMs: 20000,
  /** Scoreboard pause between rounds. */
  overMs: 6000,
  bombMs: 40000,
  plantMs: 3200,
  defuseMs: 10000,
  defuseKitMs: 5000,
  /** How close to the bomb a defuse can start, in meters. */
  defuseReach: 2,
  pickupReach: 1.3,
  /** How close a weapon on the ground has to be to take it. */
  dropReach: 1.6,
  /** The blast goes through walls. Lethal to about 11 m from a body with no armor. */
  blastRadius: 28,
  blastDamage: 170,

  startMoney: 800,
  maxMoney: 16000,
  winElimination: 3250,
  winObjective: 3500,
  lossFirst: 1400,
  lossStep: 500,
  lossSteps: 5,
  /** To whoever planted or defused. */
  objectiveBonus: 300,
  /** To each attacker, on top of the loss bonus, when a planted bomb didn't win the round. */
  plantedLossBonus: 800,
  teamKillFine: 300,
} as const;

/** Things that are sold but aren't weapons. Weapons are sold by their id. */
export const ITEM = { KEVLAR: 100, HELMET: 101, KIT: 102 } as const;

/** Most throwables a player can carry, across all types. */
export const MAX_THROWN = 4;
/** A headshot in this mode, whatever the gun. */
const HEAD_MUL = 4;
/** Armor soaks this share of what it stops, for its own points. */
const ARMOR_WEAR = 0.5;

export interface ShopEntry {
  price: number;
  /** Paid for a kill with it. */
  reward: number;
  /** Share of the damage that gets through armor. */
  pen: number;
  /** Replaces the weapon's damage in this mode. */
  damage?: number;
  /** Copies a player can carry, for throwables. */
  max?: number;
}

export const SHOP: Partial<Record<number, ShopEntry>> = {
  [W.PISTOL]: { price: 200, reward: 300, pen: 0.5 },
  [W.AUTO_PISTOL]: { price: 500, reward: 300, pen: 0.6 },
  [W.REVOLVER]: { price: 600, reward: 300, pen: 0.9 },
  [W.DEAGLE]: { price: 700, reward: 300, pen: 0.9 },
  [W.SMG]: { price: 1250, reward: 600, pen: 0.6, damage: 27 },
  [W.SHOTGUN]: { price: 1100, reward: 900, pen: 0.5 },
  [W.CROSSBOW]: { price: 1700, reward: 300, pen: 0.85 },
  [W.DMR]: { price: 2000, reward: 300, pen: 0.8 },
  [W.RIFLE]: { price: 2900, reward: 300, pen: 0.775 },
  [W.SNIPER]: { price: 4750, reward: 100, pen: 0.97, damage: 115 },
  [W.LMG]: { price: 5200, reward: 300, pen: 0.8, damage: 32 },
  [W.KNIFE]: { price: 0, reward: 1500, pen: 0.85, damage: 55 },
  [W.FRAG]: { price: 300, reward: 300, pen: 1, damage: 96, max: 1 },
  [W.MOLOTOV]: { price: 400, reward: 300, pen: 1, max: 1 },
  [W.FLASHBANG]: { price: 200, reward: 300, pen: 1, max: 2 },
  [W.SMOKE]: { price: 300, reward: 300, pen: 1, max: 1 },
  [W.CONCUSSION]: { price: 200, reward: 300, pen: 1, max: 1 },
  [ITEM.KEVLAR]: { price: 650, reward: 0, pen: 1 },
  [ITEM.HELMET]: { price: 350, reward: 0, pen: 1 },
  [ITEM.KIT]: { price: 400, reward: 0, pen: 1 },
};

/** Columns of the buy menu. */
export const SHOP_MENU: Array<{ title: string; items: number[] }> = [
  { title: 'Pistolas', items: [W.PISTOL, W.AUTO_PISTOL, W.REVOLVER, W.DEAGLE] },
  { title: 'Primárias', items: [W.SMG, W.SHOTGUN, W.CROSSBOW, W.DMR, W.RIFLE, W.SNIPER, W.LMG] },
  { title: 'Granadas', items: [W.FLASHBANG, W.SMOKE, W.FRAG, W.MOLOTOV, W.CONCUSSION] },
  { title: 'Equipamento', items: [ITEM.KEVLAR, ITEM.HELMET, ITEM.KIT] },
];

export const ITEM_NAMES: Record<number, string> = { [ITEM.KEVLAR]: 'Colete', [ITEM.HELMET]: 'Capacete', [ITEM.KIT]: 'Kit de desarme' };

export const isWeaponItem = (item: number): boolean => WEAPONS[item] !== undefined;
export const isThrowable = (def: WeaponDef): boolean => def.category === 'lethal' || def.category === 'tactical';

/** What a bullet costs the target: health, and points off the armor. */
export function gunHit(def: WeaponDef, dist: number, head: boolean, armor: number, helmet: boolean): { hp: number; armor: number } {
  const entry = SHOP[def.id];
  const scale = (entry?.damage ?? def.damage) / def.damage;
  const raw = damageAt(def, dist, false) * scale * (head && !def.melee ? HEAD_MUL : 1);
  if (armor <= 0 || (head && !helmet)) return { hp: raw, armor: 0 };
  const hp = raw * (entry?.pen ?? 1);
  return { hp, armor: (raw - hp) * ARMOR_WEAR };
}

/** Pay for a lost round. `streak` counts this loss. */
export function lossBonus(streak: number): number {
  return ROUND.lossFirst + ROUND.lossStep * (Math.min(streak, ROUND.lossSteps) - 1);
}

export function inRect(r: readonly [number, number, number, number], x: number, z: number): boolean {
  return x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3];
}

/** Bomb site at this spot, if any. */
export function siteAt(bomb: BombDef, x: number, z: number): BombDef['sites'][number] | undefined {
  return bomb.sites.find((s) => inRect(s.rect, x, z));
}

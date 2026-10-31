import type { Team } from './constants';

export type MatKind = 'floor' | 'wall' | 'concrete' | 'crate' | 'metal' | 'trim' | 'red' | 'blue';

export interface BoxDef {
  min: [number, number, number];
  max: [number, number, number];
  mat: MatKind;
}

/** Wedge-shaped ramp. Height goes from y0 to y1 along `axis`; rise=+1 means it climbs toward +axis. */
export interface RampDef {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  y0: number;
  y1: number;
  axis: 'x' | 'z';
  rise: 1 | -1;
  mat: MatKind;
}

export interface SpawnDef {
  pos: [number, number, number];
  yaw: number;
}

export interface PickupDef {
  kind: 'health' | 'ammo';
  pos: [number, number, number];
}

export interface MapDef {
  size: number;
  boxes: BoxDef[];
  ramps: RampDef[];
  ffaSpawns: SpawnDef[];
  teamSpawns: Record<Team, SpawnDef[]>;
  pickups: PickupDef[];
}

const boxes: BoxDef[] = [];
const B = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKind): void => {
  boxes.push({ min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)], mat });
};
/** Box centered on (cx, cz) with footprint w x d. */
const C = (cx: number, cz: number, w: number, d: number, y0: number, h: number, mat: MatKind): void =>
  B(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, y0, y0 + h, mat);

const HALF = 40;
const WALL_H = 12;
const PLAT_H = 3.5;

// Floor and outer walls
B(-HALF - 1, -HALF - 1, HALF + 1, HALF + 1, -1, 0, 'floor');
B(-HALF - 1, -HALF - 1, HALF + 1, -HALF, 0, WALL_H, 'wall');
B(-HALF - 1, HALF, HALF + 1, HALF + 1, 0, WALL_H, 'wall');
B(-HALF - 1, -HALF, -HALF, HALF, 0, WALL_H, 'wall');
B(HALF, -HALF, HALF + 1, HALF, 0, WALL_H, 'wall');

// North elevated platform (sniper nest) with railings and cover
B(-12, -HALF, 12, -28, 0, PLAT_H, 'metal');
B(-8.5, -28.35, -2, -28, PLAT_H, PLAT_H + 1.1, 'trim');
B(2, -28.35, 8.5, -28, PLAT_H, PLAT_H + 1.1, 'trim');
C(-6, -35, 2, 2, PLAT_H, 1.6, 'crate');
C(6, -35, 2, 2, PLAT_H, 1.6, 'crate');
C(0, -38.5, 6, 1, PLAT_H, 1.1, 'trim');

// Central open area: pillars and a low plus-shaped cover
for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(sx * 7, sz * 7, 1.4, 1.4, 0, 6, 'concrete');
C(0, 0, 4.5, 0.7, 0, 1.1, 'trim');
C(0, 0, 0.7, 4.5, 0, 1.1, 'trim');

// L-shaped walls in each quadrant forming lanes
B(-24, -15, -14, -14, 0, 3.2, 'concrete');
B(-15, -14, -14, -8, 0, 3.2, 'concrete');
B(14, -15, 24, -14, 0, 3.2, 'concrete');
B(14, -14, 15, -8, 0, 3.2, 'concrete');
B(-24, 14, -14, 15, 0, 3.2, 'concrete');
B(-15, 8, -14, 14, 0, 3.2, 'concrete');
B(14, 14, 24, 15, 0, 3.2, 'concrete');
B(14, 8, 15, 14, 0, 3.2, 'concrete');

// South corridors
B(-22, 24, -4, 25, 0, 4.5, 'wall');
B(4, 24, 22, 25, 0, 4.5, 'wall');
B(-16, 31, 16, 32, 0, 4.5, 'wall');

// Team bases (west = red, east = blue) with front walls
B(-29, -16, -28, -5, 0, 4, 'red');
B(-29, 5, -28, 16, 0, 4, 'red');
B(28, -16, 29, -5, 0, 4, 'blue');
B(28, 5, 29, 16, 0, 4, 'blue');

// Crates (cover)
const crate = (x: number, z: number, s = 2, h = s, y0 = 0): void => C(x, z, s, s, y0, h, 'crate');
crate(-20, -26);
crate(-17.5, -24, 1.4, 1.2);
crate(20, -26);
crate(17.5, -24, 1.4, 1.2);
crate(-4, -17, 1.4, 1.2);
crate(4, -17, 1.4, 1.2);
crate(-20, 0);
crate(-20, 0, 1.2, 1, 2);
crate(20, 0);
crate(20, 0, 1.2, 1, 2);
crate(-10, 19);
crate(10, 19);
crate(-8.5, 21, 1.4, 1.2);
crate(-10, 28, 1.4, 1.2);
crate(10, 28, 1.4, 1.2);
crate(6, 36);
crate(-6, 36, 1.4, 1.2);
crate(-28, 35);
crate(28, 35);
crate(-35, -12);
crate(-35, 12);
crate(35, -12);
crate(35, 12);
crate(-32, -24, 1.4, 1.2);
crate(32, 24, 1.4, 1.2);
crate(-32, 24, 1.4, 1.2);
crate(32, -24, 1.4, 1.2);
crate(-25, -33);
crate(25, -33);
crate(-11, -6, 1.4, 1.2);
crate(11, 6, 1.4, 1.2);

const ramps: RampDef[] = [
  { minX: -12, maxX: -8.5, minZ: -28, maxZ: -18, y0: 0, y1: PLAT_H, axis: 'z', rise: -1, mat: 'metal' },
  { minX: 8.5, maxX: 12, minZ: -28, maxZ: -18, y0: 0, y1: PLAT_H, axis: 'z', rise: -1, mat: 'metal' },
];

/** Yaw that faces the map center from (x, z). */
const faceCenter = (x: number, z: number): number => Math.atan2(x, z);
const sp = (x: number, y: number, z: number, yaw = faceCenter(x, z)): SpawnDef => ({ pos: [x, y, z], yaw });

export const MAP: MapDef = {
  size: HALF * 2,
  boxes,
  ramps,
  ffaSpawns: [
    sp(-34, 0, -34),
    sp(34, 0, -34),
    sp(-34, 0, 34),
    sp(34, 0, 34),
    sp(-23, 0, 0),
    sp(23, 0, 0),
    sp(0, 0, 36),
    sp(0, PLAT_H, -33),
  ],
  teamSpawns: {
    red: [
      sp(-35, 0, -7),
      sp(-35, 0, -3.5),
      sp(-35, 0, 0),
      sp(-35, 0, 3.5),
      sp(-35, 0, 7),
      sp(-38, 0, -5),
      sp(-38, 0, 5),
    ].map((s) => ({ ...s, yaw: -Math.PI / 2 })),
    blue: [
      sp(35, 0, -7),
      sp(35, 0, -3.5),
      sp(35, 0, 0),
      sp(35, 0, 3.5),
      sp(35, 0, 7),
      sp(38, 0, -5),
      sp(38, 0, 5),
    ].map((s) => ({ ...s, yaw: Math.PI / 2 })),
  },
  pickups: [
    { kind: 'health', pos: [0, 0, -22] },
    { kind: 'health', pos: [0, 0, 28] },
    { kind: 'health', pos: [-30, 0, -30] },
    { kind: 'health', pos: [30, 0, 30] },
    { kind: 'health', pos: [0, PLAT_H, -36] },
    { kind: 'ammo', pos: [-20, 0, -6] },
    { kind: 'ammo', pos: [20, 0, 6] },
    { kind: 'ammo', pos: [-20, 0, 36] },
    { kind: 'ammo', pos: [20, 0, -34] },
  ],
};

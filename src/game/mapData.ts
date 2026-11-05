import type { MapId, Team } from './constants';

export type MatKind = 'floor' | 'wall' | 'concrete' | 'crate' | 'metal' | 'trim' | 'red' | 'blue' | 'sand';

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

/** Colored floor area marking a team's base. */
export interface BaseMark {
  team: Team;
  x: number;
  z: number;
  w: number;
  d: number;
}

export interface MapDef {
  size: number;
  /** Distances where the fog starts and where it fully hides the view. */
  fog: [number, number];
  boxes: BoxDef[];
  ramps: RampDef[];
  ffaSpawns: SpawnDef[];
  teamSpawns: Record<Team, SpawnDef[]>;
  pickups: PickupDef[];
  baseMarks: BaseMark[];
}

function builder(): {
  boxes: BoxDef[];
  B: (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKind) => void;
  C: (cx: number, cz: number, w: number, d: number, y0: number, h: number, mat: MatKind) => void;
  crate: (x: number, z: number, s?: number, h?: number, y0?: number) => void;
  shell: (half: number, wallH: number, floor: MatKind) => void;
} {
  const boxes: BoxDef[] = [];
  const B = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKind): void => {
    boxes.push({ min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)], mat });
  };
  /** Box centered on (cx, cz) with footprint w x d. */
  const C = (cx: number, cz: number, w: number, d: number, y0: number, h: number, mat: MatKind): void =>
    B(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, y0, y0 + h, mat);
  const crate = (x: number, z: number, s = 2, h = s, y0 = 0): void => C(x, z, s, s, y0, h, 'crate');
  /** Floor and the four outer walls. */
  const shell = (half: number, wallH: number, floor: MatKind): void => {
    B(-half - 1, -half - 1, half + 1, half + 1, -1, 0, floor);
    B(-half - 1, -half - 1, half + 1, -half, 0, wallH, 'wall');
    B(-half - 1, half, half + 1, half + 1, 0, wallH, 'wall');
    B(-half - 1, -half, -half, half, 0, wallH, 'wall');
    B(half, -half, half + 1, half, 0, wallH, 'wall');
  };
  return { boxes, B, C, crate, shell };
}

/** Yaw that faces the map center from (x, z). */
const faceCenter = (x: number, z: number): number => Math.atan2(x, z);
const sp = (x: number, y: number, z: number, yaw = faceCenter(x, z)): SpawnDef => ({ pos: [x, y, z], yaw });
/** Team spawns: red on the west side looks east, blue on the east side looks west. */
const facing = (list: SpawnDef[], yaw: number): SpawnDef[] => list.map((s) => ({ ...s, yaw }));

/** Balanced default map: mid-range lanes around an open center. */
function arena(): MapDef {
  const { boxes, B, C, crate, shell } = builder();
  const HALF = 40;
  const PLAT_H = 3.5;

  shell(HALF, 12, 'floor');

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

  return {
    size: HALF * 2,
    fog: [70, 260],
    boxes,
    ramps: [
      { minX: -12, maxX: -8.5, minZ: -28, maxZ: -18, y0: 0, y1: PLAT_H, axis: 'z', rise: -1, mat: 'metal' },
      { minX: 8.5, maxX: 12, minZ: -28, maxZ: -18, y0: 0, y1: PLAT_H, axis: 'z', rise: -1, mat: 'metal' },
    ],
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
      red: facing(
        [sp(-35, 0, -7), sp(-35, 0, -3.5), sp(-35, 0, 0), sp(-35, 0, 3.5), sp(-35, 0, 7), sp(-38, 0, -5), sp(-38, 0, 5)],
        -Math.PI / 2,
      ),
      blue: facing(
        [sp(35, 0, -7), sp(35, 0, -3.5), sp(35, 0, 0), sp(35, 0, 3.5), sp(35, 0, 7), sp(38, 0, -5), sp(38, 0, 5)],
        Math.PI / 2,
      ),
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
    baseMarks: [
      { team: 'red', x: -34.5, z: 0, w: 10, d: 18 },
      { team: 'blue', x: 34.5, z: 0, w: 10, d: 18 },
    ],
  };
}

/**
 * Big open valley for long-range fights: two forts face each other across about 110 m,
 * with a raised mesa in the middle, tall monoliths that break the longest sightlines,
 * and two flank lanes with a sniper tower each.
 */
function mirante(): MapDef {
  const { boxes, B, C, crate, shell } = builder();
  const HALF = 80;
  const FORT_H = 5;
  const MESA_H = 3;
  const TOWER_H = 7;
  const ramps: RampDef[] = [];

  shell(HALF, 14, 'sand');

  for (const s of [-1, 1]) {
    const team: MatKind = s < 0 ? 'red' : 'blue';

    // Fort: two blocks joined by a bridge, leaving a tunnel through the middle.
    B(s * 56, -18, s * 68, -3, 0, FORT_H, 'concrete');
    B(s * 56, 3, s * 68, 18, 0, FORT_H, 'concrete');
    B(s * 56, -3, s * 68, 3, 3.2, FORT_H, 'concrete');
    // Parapet facing the valley, with gaps to shoot through.
    B(s * 56, -18, s * 56.8, -8, FORT_H, FORT_H + 1.2, team);
    B(s * 56, -4, s * 56.8, 4, FORT_H, FORT_H + 1.2, team);
    B(s * 56, 8, s * 56.8, 18, FORT_H, FORT_H + 1.2, team);
    C(s * 62, -11, 2, 2, FORT_H, 1.6, 'crate');
    C(s * 62, 11, 2, 2, FORT_H, 1.6, 'crate');
    const minX = Math.min(s * 60, s * 64);
    const maxX = Math.max(s * 60, s * 64);
    ramps.push(
      { minX, maxX, minZ: -29, maxZ: -18, y0: 0, y1: FORT_H, axis: 'z', rise: 1, mat: 'metal' },
      { minX, maxX, minZ: 18, maxZ: 29, y0: 0, y1: FORT_H, axis: 'z', rise: -1, mat: 'metal' },
    );

    // Cover between the fort and the mesa. Low, so it hides a crouching player but not a standing one.
    C(s * 42, 0, 1, 14, 0, 1.3, 'trim');
    C(s * 26, -24, 1, 10, 0, 1.3, 'trim');
    C(s * 26, 24, 1, 10, 0, 1.3, 'trim');

    for (const t of [-1, 1]) {
      // Monoliths stop anyone from covering the whole valley from a single spot.
      C(s * 34, t * 14, 4, 4, 0, 10, 'concrete');

      // Broken walls that separate the valley from the flank lanes.
      B(s * 46, t * 44, s * 70, t * 45, 0, 4.5, 'wall');
      B(s * 10, t * 44, s * 30, t * 45, 0, 4.5, 'wall');

      crate(s * 52, t * 34);
      crate(s * 18, t * 36, 1.4, 1.2);
      crate(s * 55, t * 60);
      crate(s * 35, t * 58, 2, 2);
      crate(s * 35, t * 58, 1.2, 1, 2);
      crate(s * 22, t * 70, 1.4, 1.2);
      crate(s * 62, t * 75);
    }
  }

  // Central mesa with cover on top.
  B(-12, -12, 12, 12, 0, MESA_H, 'concrete');
  C(0, 0, 8, 0.8, MESA_H, 1.2, 'trim');
  C(0, 0, 0.8, 8, MESA_H, 1.2, 'trim');
  C(-8, -8, 2, 2, MESA_H, 1.6, 'crate');
  C(8, 8, 2, 2, MESA_H, 1.6, 'crate');
  ramps.push(
    { minX: -4, maxX: 4, minZ: -20, maxZ: -12, y0: 0, y1: MESA_H, axis: 'z', rise: 1, mat: 'metal' },
    { minX: -4, maxX: 4, minZ: 12, maxZ: 20, y0: 0, y1: MESA_H, axis: 'z', rise: -1, mat: 'metal' },
  );

  // Sniper towers in the flank lanes, with a low parapet and the ramp as the only way up.
  for (const t of [-1, 1]) {
    B(-5, t * 57, 5, t * 67, 0, TOWER_H, 'metal');
    B(-5, t * 57, -2, t * 57.6, TOWER_H, TOWER_H + 1.1, 'trim');
    B(2, t * 57, 5, t * 57.6, TOWER_H, TOWER_H + 1.1, 'trim');
    B(-5, t * 66.4, 5, t * 67, TOWER_H, TOWER_H + 1.1, 'trim');
    B(-5, t * 57.6, -4.4, t * 66.4, TOWER_H, TOWER_H + 1.1, 'trim');
    B(4.4, t * 57.6, 5, t * 66.4, TOWER_H, TOWER_H + 1.1, 'trim');
    ramps.push({
      minX: -2,
      maxX: 2,
      minZ: Math.min(t * 41, t * 57),
      maxZ: Math.max(t * 41, t * 57),
      y0: 0,
      y1: TOWER_H,
      axis: 'z',
      rise: t < 0 ? -1 : 1,
      mat: 'metal',
    });
  }

  const backOfFort = (x: number): SpawnDef[] => [
    sp(x, 0, -21),
    sp(x, 0, -14),
    sp(x, 0, -7),
    sp(x, 0, 0),
    sp(x, 0, 7),
    sp(x, 0, 14),
    sp(x, 0, 21),
  ];

  return {
    size: HALF * 2,
    fog: [160, 520],
    boxes,
    ramps,
    ffaSpawns: [
      sp(-72, 0, -72),
      sp(72, 0, -72),
      sp(-72, 0, 72),
      sp(72, 0, 72),
      sp(-48, 0, -24),
      sp(48, 0, 24),
      sp(-22, 0, 0),
      sp(22, 0, 0),
      sp(-20, 0, -58),
      sp(20, 0, 58),
      sp(0, TOWER_H, -62),
      sp(0, TOWER_H, 62),
    ],
    teamSpawns: {
      red: facing([...backOfFort(-74), sp(-71, 0, -3.5), sp(-71, 0, 3.5), sp(-71, 0, 10.5)], -Math.PI / 2),
      blue: facing([...backOfFort(74), sp(71, 0, -3.5), sp(71, 0, 3.5), sp(71, 0, 10.5)], Math.PI / 2),
    },
    pickups: [
      { kind: 'health', pos: [0, 0, -30] },
      { kind: 'health', pos: [0, 0, 30] },
      { kind: 'health', pos: [-40, 0, -60] },
      { kind: 'health', pos: [40, 0, 60] },
      { kind: 'health', pos: [5, MESA_H, -5] },
      { kind: 'ammo', pos: [-62, FORT_H, 0] },
      { kind: 'ammo', pos: [62, FORT_H, 0] },
      { kind: 'ammo', pos: [0, TOWER_H, -62] },
      { kind: 'ammo', pos: [0, TOWER_H, 62] },
      { kind: 'ammo', pos: [-5, MESA_H, 5] },
    ],
    baseMarks: [
      { team: 'red', x: -74, z: 0, w: 11, d: 48 },
      { team: 'blue', x: 74, z: 0, w: 11, d: 48 },
    ],
  };
}

/**
 * Small warehouse for constant fighting: tight lanes between containers, a catwalk loop
 * above them, and a bridge across the middle. Nowhere is far from a fight.
 */
function galpao(): MapDef {
  const { boxes, B, C, crate, shell } = builder();
  const HALF = 24;
  const CAT_H = 3;
  const INNER = 21;

  shell(HALF, 8, 'floor');

  // Catwalk loop along the walls.
  B(-HALF, -HALF, HALF, -INNER, 0, CAT_H, 'metal');
  B(-HALF, INNER, HALF, HALF, 0, CAT_H, 'metal');
  B(-HALF, -INNER, -INNER, INNER, 0, CAT_H, 'metal');
  B(INNER, -INNER, HALF, INNER, 0, CAT_H, 'metal');

  // Railings, open where the ramps and the bridge arrive.
  const RAIL = CAT_H + 1;
  B(-12, -INNER - 0.3, 12, -INNER, CAT_H, RAIL, 'trim');
  B(-12, INNER, 12, INNER + 0.3, CAT_H, RAIL, 'trim');
  for (const s of [-1, 1]) {
    B(s * INNER, -12, s * (INNER + 0.3), -2, CAT_H, RAIL, 'trim');
    B(s * INNER, 2, s * (INNER + 0.3), 12, CAT_H, RAIL, 'trim');
  }

  // Bridge across the middle, low enough to run underneath.
  B(-INNER, -1.5, INNER, 1.5, 2.6, CAT_H, 'metal');
  B(-9, -1.8, -3, -1.5, CAT_H, RAIL, 'trim');
  B(3, 1.5, 9, 1.8, CAT_H, RAIL, 'trim');
  C(-8, 0, 1, 1, 0, 2.6, 'concrete');
  C(8, 0, 1, 1, 0, 2.6, 'concrete');

  // Containers forming staggered lanes (rotationally symmetric, so no side has an edge).
  for (const s of [-1, 1]) {
    const team: MatKind = s < 0 ? 'red' : 'blue';
    C(s * 12, s * -9, 8, 2.4, 0, 2.4, team);
    C(s * 12, s * 9, 2.4, 6, 0, 2.4, 'metal');
    C(s * 3, s * -14, 2.4, 7, 0, 2.4, 'metal');
    C(s * 4, s * 7, 6, 2.4, 0, 2.4, team);
    C(s * 15, s * 16, 5, 2.4, 0, 2.4, 'metal');
    crate(s * 16, s * -3, 1.6, 1.2);
    crate(s * 6, s * -5, 1.4, 1.2);
    crate(s * 9, s * 15, 1.4, 1.2);
    crate(s * 17, s * 4, 1.4, 1.2);
  }

  return {
    size: HALF * 2,
    fog: [70, 260],
    boxes,
    ramps: [
      { minX: -INNER, maxX: -18, minZ: -INNER, maxZ: -13, y0: 0, y1: CAT_H, axis: 'z', rise: -1, mat: 'metal' },
      { minX: 18, maxX: INNER, minZ: 13, maxZ: INNER, y0: 0, y1: CAT_H, axis: 'z', rise: 1, mat: 'metal' },
      { minX: 13, maxX: INNER, minZ: -INNER, maxZ: -18, y0: 0, y1: CAT_H, axis: 'x', rise: 1, mat: 'metal' },
      { minX: -INNER, maxX: -13, minZ: 18, maxZ: INNER, y0: 0, y1: CAT_H, axis: 'x', rise: -1, mat: 'metal' },
    ],
    ffaSpawns: [
      sp(-19, 0, -6),
      sp(19, 0, 6),
      sp(-7, 0, 19),
      sp(7, 0, -19),
      sp(0, 0, -3.5),
      sp(0, 0, 3.5),
      sp(-22.5, CAT_H, -22.5),
      sp(22.5, CAT_H, 22.5),
      sp(-22.5, CAT_H, 22.5),
      sp(22.5, CAT_H, -22.5),
    ],
    teamSpawns: {
      red: facing(
        [sp(-19.5, 0, -9), sp(-19.5, 0, -6), sp(-19.5, 0, -3), sp(-19.5, 0, 0), sp(-19.5, 0, 3), sp(-19.5, 0, 6), sp(-19.5, 0, 9), sp(-22.5, CAT_H, 0)],
        -Math.PI / 2,
      ),
      blue: facing(
        [sp(19.5, 0, -9), sp(19.5, 0, -6), sp(19.5, 0, -3), sp(19.5, 0, 0), sp(19.5, 0, 3), sp(19.5, 0, 6), sp(19.5, 0, 9), sp(22.5, CAT_H, 0)],
        Math.PI / 2,
      ),
    },
    pickups: [
      { kind: 'health', pos: [0, CAT_H, 0] },
      { kind: 'health', pos: [-9, 0, 18] },
      { kind: 'health', pos: [9, 0, -18] },
      { kind: 'ammo', pos: [0, CAT_H, -22.5] },
      { kind: 'ammo', pos: [0, CAT_H, 22.5] },
      { kind: 'ammo', pos: [-13, 0, 0] },
      { kind: 'ammo', pos: [13, 0, 0] },
    ],
    baseMarks: [
      { team: 'red', x: -19.5, z: 0, w: 3, d: 22 },
      { team: 'blue', x: 19.5, z: 0, w: 3, d: 22 },
    ],
  };
}

export const MAPS: Record<MapId, MapDef> = { arena: arena(), mirante: mirante(), galpao: galpao() };

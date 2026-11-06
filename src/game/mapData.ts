import type { MapId, Team } from './constants';

export type MatKind = 'floor' | 'wall' | 'concrete' | 'crate' | 'metal' | 'trim' | 'red' | 'blue' | 'sand' | 'grass' | 'asphalt' | 'brick';

export interface BoxDef {
  min: [number, number, number];
  max: [number, number, number];
  mat: MatKind;
  /** Collision only: a prop shows what is there. */
  hidden?: boolean;
}

/** A 3D model stretched to fill a box. Purely visual: collision lives in `boxes`. */
export interface PropDef {
  /** `kit/name` under public/models/map. */
  model: string;
  x: number;
  y: number;
  z: number;
  /** Quarter turns around Y. */
  turn: number;
  /** Width (X), height and depth (Z), after turning. */
  size: [number, number, number];
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
  kind: 'ammo';
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

/** [x0, z0, x1, z1]. */
export type Rect = [number, number, number, number];

/** What makes a map playable in the bomb mode. In `teamSpawns`, red starts on attack. */
export interface BombDef {
  sites: Array<{ name: string; rect: Rect }>;
  /** Where each side can use the shop. */
  buy: { attack: Rect; defend: Rect };
}

export interface MapDef {
  size: number;
  /** Distances where the fog starts and where it fully hides the view. */
  fog: [number, number];
  boxes: BoxDef[];
  ramps: RampDef[];
  props?: PropDef[];
  ffaSpawns: SpawnDef[];
  teamSpawns: Record<Team, SpawnDef[]>;
  pickups: PickupDef[];
  baseMarks: BaseMark[];
  bomb?: BombDef;
}

interface PropOpts {
  turn?: number;
  y?: number;
  /** False for scenery nobody can reach. */
  solid?: boolean;
  /** Collision width, depth and height when it differs from the model, like a tree trunk. */
  col?: [number, number, number];
}

function builder(): {
  boxes: BoxDef[];
  props: PropDef[];
  /** Model centered on (cx, cz), filling w x d x h. Solid unless told otherwise. */
  P: (model: string, cx: number, cz: number, w: number, d: number, h: number, opts?: PropOpts) => void;
  /** Straight fence between two points on the same axis. */
  fence: (x0: number, z0: number, x1: number, z1: number) => void;
  B: (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKind) => void;
  C: (cx: number, cz: number, w: number, d: number, y0: number, h: number, mat: MatKind) => void;
  crate: (x: number, z: number, s?: number, h?: number, y0?: number) => void;
  /** Solid block of buildings: a single collision box, with models only along the edges anyone can see. */
  block: (x0: number, z0: number, x1: number, z1: number, h: number, models: string[]) => void;
  shell: (half: number, wallH: number, floor: MatKind) => void;
} {
  const boxes: BoxDef[] = [];
  const props: PropDef[] = [];
  const P = (model: string, cx: number, cz: number, w: number, d: number, h: number, opts: PropOpts = {}): void => {
    const y = opts.y ?? 0;
    props.push({ model, x: cx, y, z: cz, turn: opts.turn ?? 0, size: [w, h, d] });
    if (opts.solid === false) return;
    const [cw, cd, ch] = opts.col ?? [w, d, h];
    boxes.push({ min: [cx - cw / 2, y, cz - cd / 2], max: [cx + cw / 2, y + ch, cz + cd / 2], mat: 'trim', hidden: true });
  };
  const fence = (x0: number, z0: number, x1: number, z1: number): void => {
    const alongX = z0 === z1;
    const length = Math.abs(x1 - x0) + Math.abs(z1 - z0);
    const count = Math.max(1, Math.round(length / FENCE_PANEL));
    const panel = length / count;
    for (let i = 0; i < count; i++) {
      const t = (i + 0.5) / count;
      const x = x0 + (x1 - x0) * t;
      const z = z0 + (z1 - z0) * t;
      P('suburban/fence', x, z, alongX ? panel : 0.25, alongX ? 0.25 : panel, FENCE_H, { turn: alongX ? 0 : 1, solid: false });
    }
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const [hw, hd] = alongX ? [length / 2, 0.13] : [0.13, length / 2];
    boxes.push({ min: [cx - hw, 0, cz - hd], max: [cx + hw, FENCE_H, cz + hd], mat: 'trim', hidden: true });
  };
  const B = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKind): void => {
    boxes.push({ min: [Math.min(x0, x1), y0, Math.min(z0, z1)], max: [Math.max(x0, x1), y1, Math.max(z0, z1)], mat });
  };
  /** Box centered on (cx, cz) with footprint w x d. */
  const C = (cx: number, cz: number, w: number, d: number, y0: number, h: number, mat: MatKind): void =>
    B(cx - w / 2, cz - d / 2, cx + w / 2, cz + d / 2, y0, y0 + h, mat);
  const crate = (x: number, z: number, s = 2, h = s, y0 = 0): void => C(x, z, s, s, y0, h, 'crate');
  const block = (x0: number, z0: number, x1: number, z1: number, h: number, models: string[]): void => {
    boxes.push({ min: [x0, 0, z0], max: [x1, h, z1], mat: 'trim', hidden: true });
    const nx = Math.max(1, Math.round((x1 - x0) / BLOCK_TILE));
    const nz = Math.max(1, Math.round((z1 - z0) / BLOCK_TILE));
    const w = (x1 - x0) / nx;
    const d = (z1 - z0) / nz;
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (i > 0 && i < nx - 1 && j > 0 && j < nz - 1) continue;
        const model = models[(i * 2 + j * 3 + Math.abs(Math.round(x0 + z0))) % models.length];
        P(model, x0 + w * (i + 0.5), z0 + d * (j + 0.5), w, d, h - ((i + j) % 2), { solid: false, turn: (i + j) % 4 });
      }
    }
  };
  /** Floor and the four outer walls. */
  const shell = (half: number, wallH: number, floor: MatKind): void => {
    B(-half - 1, -half - 1, half + 1, half + 1, -1, 0, floor);
    B(-half - 1, -half - 1, half + 1, -half, 0, wallH, 'wall');
    B(-half - 1, half, half + 1, half + 1, 0, wallH, 'wall');
    B(-half - 1, -half, -half, half, 0, wallH, 'wall');
    B(half, -half, half + 1, half, 0, wallH, 'wall');
  };
  return { boxes, props, P, fence, B, C, crate, block, shell };
}

/** Hides the body and leaves the head showing, and is just too tall to mantle onto. */
const PARAPET = 1.5;
const FENCE_PANEL = 2;
/** Stops a standing player's body but not a shot at their head, and a mantle clears it. */
const FENCE_H = 1.25;
/** Width of each building along the edge of a block. */
const BLOCK_TILE = 13;

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

/** Runs `fn` for both halves of a map, each the other turned 180°, so neither side has an edge. */
function halves(fn: (s: number, turn: (t: number) => number) => void): void {
  for (const s of [1, -1]) fn(s, (t) => (s === 1 ? t : (t + 2) % 4));
}

/** Small residential map, 60 m: three lanes around houses set corner to corner. */
function vila(): MapDef {
  const { boxes, props, B, C, P, fence, shell } = builder();
  const HALF = 30;
  const DECK = 2.4;
  const ROOM = 3.2;
  const LINTEL = 2.3;
  const ramps: RampDef[] = [];

  shell(HALF, 4, 'grass');
  B(-HALF, -6, HALF, 6, 0, 0.02, 'asphalt');
  B(-4.5, -HALF, 4.5, -6, 0, 0.02, 'floor');
  B(-4.5, 6, 4.5, HALF, 0, 0.02, 'floor');
  C(0, 0, 1.2, 3.2, 0, 2.4, 'concrete');

  halves((s, turn) => {
    const R = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKind): void =>
      B(s * x0, s * z0, s * x1, s * z1, y0, y1, mat);
    const K = (x: number, z: number, w: number, d: number, y0: number, h: number, mat: MatKind): void => C(s * x, s * z, w, d, y0, h, mat);

    // House you can walk through, joining the street, the back yards and the alley.
    R(-17, -7.3, -12.4, -7, 0, ROOM, 'brick');
    R(-12.4, -7.3, -10.6, -7, LINTEL, ROOM, 'brick');
    R(-10.6, -7.3, -6.4, -7, 0, 1, 'brick');
    R(-10.6, -7.3, -6.4, -7, 2.2, ROOM, 'brick');
    R(-6.4, -7.3, -5, -7, 0, ROOM, 'brick');
    R(-17, -16, -9.2, -15.7, 0, ROOM, 'brick');
    R(-9.2, -16, -7.4, -15.7, LINTEL, ROOM, 'brick');
    R(-7.4, -16, -5, -15.7, 0, ROOM, 'brick');
    for (const [x0, x1] of [[-5.3, -5], [-17, -16.7]]) {
      R(x0, -16, x1, -12.6, 0, ROOM, 'brick');
      R(x0, -12.6, x1, -10.8, LINTEL, ROOM, 'brick');
      R(x0, -10.8, x1, -7, 0, ROOM, 'brick');
    }
    R(-17.3, -16.3, -4.7, -6.7, ROOM, ROOM + 0.3, 'concrete');
    // Attic: tall enough that the decks can't see over the house.
    R(-17, -16, -5, -7, ROOM + 0.3, 5.4, 'brick');
    K(-11, -12.5, 3.6, 0.8, 0, 1.1, 'crate');

    // Solid house across the alley.
    P('suburban/building-type-b', s * 11, s * -11.5, 12, 9, 6.5, { turn: turn(0) });

    // Deck: the high ground each side gets, reached by a ramp from the back yard.
    R(-27, -15, -19, -7, 0, DECK, 'concrete');
    // Closes the strip behind the deck, which would otherwise see from wall to wall.
    R(-30, -12, -27, -10, 0, DECK, 'concrete');
    R(-19.3, -15, -19, -11.5, DECK, DECK + PARAPET, 'concrete');
    R(-19.3, -9, -19, -7, DECK, DECK + PARAPET, 'concrete');
    R(-27, -7.3, -19, -7, DECK, DECK + PARAPET, 'concrete');
    const [z0, z1] = [s * -22, s * -15].sort((a, b) => a - b);
    const [x0, x1] = [s * -27, s * -24].sort((a, b) => a - b);
    ramps.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0: 0, y1: DECK, axis: 'z', rise: s === 1 ? 1 : -1, mat: 'concrete' });

    // Back yard lane.
    // Shed, garage and a crate stack each close part of the lane, so it has to be walked as a zigzag.
    P('suburban/building-type-h', 0, s * -21, 6, 6, 4.2, { turn: turn(0) });
    P('suburban/building-type-i', s * -14, s * -26.5, 7, 7, 4.2, { turn: turn(0) });
    fence(s * 13, s * -22.5, s * 13, s * -16);
    fence(s * -21, s * -19.5, s * -15, s * -19.5);
    fence(s * 15, s * -25, s * 22, s * -25);
    K(-8, -24, 2, 2, 0, 1.3, 'crate');
    K(9, -17, 2, 2, 0, 3.8, 'concrete');
    K(-18, 20, 3, 1, 0, 2.6, 'concrete');
    K(0.8, -9, 1.4, 1.4, 0, 3, 'concrete');
    P('suburban/planter', s * -19, s * -25.5, 3, 1.6, 1, { turn: turn(0) });
    P('suburban/tree-large', s * 24, s * -20, 3, 3, 6.5, { col: [0.6, 0.6, 6] });
    P('suburban/tree-small', s * 8, s * -26, 2.6, 2.6, 4.5, { col: [0.5, 0.5, 4] });

    // Street: alternating cars, so no spot sees the whole road.
    P('cars/van', s * -3.8, s * -5.8, 5, 2.3, 2.4, { turn: turn(1) });
    P('cars/delivery', s * 10.5, s * 3, 4.8, 2.2, 2.4, { turn: turn(1) });
    P('cars/suv', s * -15, s * 2.8, 4.8, 2.3, 1.7, { turn: turn(3) });
    P('roads/dumpster', s * 21, s * -4, 2.6, 1.6, 1.6, { turn: turn(0) });

    // Scenery past the walls.
    P('suburban/building-type-t', s * -16, s * -40, 14, 12, 9, { solid: false, turn: turn(2) });
    P('suburban/building-type-n', s * 14, s * -40, 14, 12, 9, { solid: false, turn: turn(2) });
    P('suburban/building-type-d', s * -42, s * -6, 14, 12, 8, { solid: false, turn: turn(1) });
    P('suburban/tree-large', s * 2, s * -35, 5, 5, 11, { solid: false });
    P('suburban/tree-large', s * -38, s * 15, 5, 5, 11, { solid: false });
  });

  const redSpawns = [sp(-27, 0, -3), sp(-27, 0, 0), sp(-27, 0, 3), sp(-24, 0, -3), sp(-24, 0, 0), sp(-24, 0, 3), sp(-27, 0, 10), sp(-23, 0, 13)];
  const mirrored = (l: SpawnDef[]): SpawnDef[] => l.map((p) => sp(-p.pos[0], p.pos[1], -p.pos[2]));
  return {
    size: HALF * 2,
    fog: [70, 240],
    boxes,
    ramps,
    props,
    ffaSpawns: [
      sp(-27, 0, 0),
      sp(27, 0, 0),
      sp(-22, 0, -27),
      sp(22, 0, 27),
      sp(-22, 0, 22),
      sp(22, 0, -21),
      sp(-10, 0, -19),
      sp(10, 0, 19),
      sp(-23, DECK, -11),
      sp(23, DECK, 11),
    ],
    teamSpawns: { red: facing(redSpawns, -Math.PI / 2), blue: facing(mirrored(redSpawns), Math.PI / 2) },
    pickups: [
      { kind: 'ammo', pos: [-8.5, 0, -10] },
      { kind: 'ammo', pos: [8.5, 0, 10] },
      { kind: 'ammo', pos: [0, 0, -27.5] },
      { kind: 'ammo', pos: [0, 0, 27.5] },
    ],
    baseMarks: [
      { team: 'red', x: -26, z: 0, w: 6, d: 11 },
      { team: 'blue', x: 26, z: 0, w: 6, d: 11 },
    ],
  };
}

/** Downtown map, 84 m: an avenue, two back alleys and a shop to cut through. */
function centro(): MapDef {
  const { boxes, props, B, C, P, shell } = builder();
  const HALF = 42;
  const SHOP = 4;
  const ROOF = SHOP + 0.3;
  const ramps: RampDef[] = [];

  shell(HALF, 7, 'asphalt');
  C(0, 0, 10, 5, 0, 3, 'concrete');
  C(0, 0, 11, 6, 3, 0.3, 'concrete');

  halves((s, turn) => {
    const R = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKind): void =>
      B(s * x0, s * z0, s * x1, s * z1, y0, y1, mat);
    const K = (x: number, z: number, w: number, d: number, y0: number, h: number, mat: MatKind): void => C(s * x, s * z, w, d, y0, h, mat);

    // Row of buildings between the avenue and the alley.
    P('commercial/building-a', s * -24, s * -15.5, 20, 13, 15, { turn: turn(0) });
    P('commercial/building-c', s * 24, s * -15.5, 20, 13, 15, { turn: turn(0) });
    // Far side of the alley.
    P('commercial/building-e', s * -28, s * -37, 28, 10, 18, { turn: turn(0) });
    P('commercial/building-g', 0, s * -37, 28, 10, 18, { turn: turn(0) });
    P('commercial/building-j', s * 28, s * -37, 28, 10, 18, { turn: turn(0) });

    // Shop: windows on both streets, doors on all sides, shelves to fight around.
    R(-10, -9.3, -7, -9, 0, SHOP, 'brick');
    R(-7, -9.3, -2, -9, 0, 1, 'brick');
    R(-7, -9.3, -2, -9, 2.4, SHOP, 'brick');
    R(-2, -9.3, 2, -9, 2.6, SHOP, 'brick');
    R(2, -9.3, 7, -9, 0, 1, 'brick');
    R(2, -9.3, 7, -9, 2.4, SHOP, 'brick');
    R(7, -9.3, 10, -9, 0, SHOP, 'brick');
    R(-10, -22, -4, -21.7, 0, SHOP, 'brick');
    R(-4, -22, -1.5, -21.7, 2.6, SHOP, 'brick');
    R(-1.5, -22, 1.5, -21.7, 0, 1, 'brick');
    R(-1.5, -22, 1.5, -21.7, 2.4, SHOP, 'brick');
    R(1.5, -22, 4, -21.7, 2.6, SHOP, 'brick');
    R(4, -22, 10, -21.7, 0, SHOP, 'brick');
    for (const [x0, x1] of [[-10, -9.7], [9.7, 10]]) {
      R(x0, -21.7, x1, -16.5, 0, SHOP, 'brick');
      R(x0, -16.5, x1, -14.5, 2.6, SHOP, 'brick');
      R(x0, -14.5, x1, -9.3, 0, SHOP, 'brick');
    }
    R(-10.2, -22.2, 10.2, -8.8, SHOP, ROOF, 'concrete');
    K(0, -15.5, 7, 0.8, 0, 1.1, 'crate');
    K(-6, -18, 0.8, 3.5, 0, 1.7, 'metal');
    K(6, -13, 0.8, 3.5, 0, 1.7, 'metal');

    // Roof over the avenue, up a ramp beside the shop. The parapet has gaps, so it can be shot from below.
    const [x0, x1] = [s * 10, s * 14].sort((a, b) => a - b);
    const [z0, z1] = [s * -22, s * -12].sort((a, b) => a - b);
    ramps.push({ minX: x0, maxX: x1, minZ: z0, maxZ: z1, y0: 0, y1: ROOF, axis: 'z', rise: s === 1 ? 1 : -1, mat: 'concrete' });
    R(10, -12, 14, -9, 0, ROOF, 'concrete');
    R(-10.2, -9.1, -3, -8.8, ROOF, ROOF + PARAPET, 'concrete');
    R(3, -9.1, 14, -8.8, ROOF, ROOF + PARAPET, 'concrete');
    K(-5, -15, 2, 2, ROOF, 1.3, 'crate');
    K(4, -19, 2, 2, ROOF, 1.3, 'crate');

    // Alley: blockers from alternating walls make it zigzag.
    P('cars/truck', s * -23, s * -30.5, 6.5, 3, 3, { turn: turn(1) });
    K(5, -27, 2.4, 4.4, 0, 2.6, 'crate');
    P('cars/delivery', s * 17, s * -23.5, 6.5, 3, 3.2, { turn: turn(1) });
    P('roads/dumpster', s * 22, s * -30.6, 3, 1.9, 1.6, { turn: turn(0) });
    K(-11, -30.5, 2, 2, 0, 1.3, 'crate');
    K(32, -24, 2.4, 2.4, 0, 1.6, 'crate');
    // Across the spawn plazas: together they stop a shot from one alley to the other.
    K(-39.5, -14, 5, 2.4, 0, 2.6, 'crate');
    K(-35.5, 14, 3, 2.4, 0, 2.6, 'crate');

    // Avenue: wrecks staggered across the lanes.
    P('cars/firetruck', s * -18, s * 5, 7.5, 3, 3.3, { turn: turn(1) });
    // Bus across the spawn, so nobody fires straight down the avenue into it.
    P('cars/truck', s * -33, s * 0.5, 3, 8, 3.2, { turn: turn(0) });
    P('cars/sedan', s * -29, s * -5, 4.6, 2.2, 1.55, { turn: turn(1) });
    P('cars/taxi', s * 13, s * -5, 4.8, 2.3, 1.75, { turn: turn(3) });
    K(9, -7.6, 3, 2.6, 0, 2.4, 'crate');
    P('cars/van', s * 28, s * 7.7, 5, 2.3, 2.4, { turn: turn(1) });
    K(-8, 5.5, 3, 0.8, 0, 1.1, 'concrete');
    P('cars/delivery', s * 21, s * 1, 2.6, 6, 3.2, { turn: turn(0) });
  });

  const redSpawns = [sp(-39, 0, -6), sp(-39, 0, -2), sp(-39, 0, 2), sp(-39, 0, 6), sp(-36, 0, -6), sp(-36, 0, 6), sp(-38, 0, -26), sp(-38, 0, 26)];
  const mirrored = (l: SpawnDef[]): SpawnDef[] => l.map((p) => sp(-p.pos[0], p.pos[1], -p.pos[2]));
  return {
    size: HALF * 2,
    fog: [90, 280],
    boxes,
    ramps,
    props,
    ffaSpawns: [
      sp(-39, 0, 0),
      sp(39, 0, 0),
      sp(-38, 0, -27),
      sp(38, 0, 27),
      sp(-38, 0, 27),
      sp(38, 0, -27),
      sp(-5, 0, -27),
      sp(5, 0, 27),
      sp(-3, 0, -13),
      sp(3, 0, 13),
    ],
    teamSpawns: { red: facing(redSpawns, -Math.PI / 2), blue: facing(mirrored(redSpawns), Math.PI / 2) },
    pickups: [
      { kind: 'ammo', pos: [-3, 0, -18.5] },
      { kind: 'ammo', pos: [3, 0, 18.5] },
      { kind: 'ammo', pos: [0, ROOF, -13] },
      { kind: 'ammo', pos: [0, ROOF, 13] },
    ],
    baseMarks: [
      { team: 'red', x: -38, z: 0, w: 8, d: 18 },
      { team: 'blue', x: 38, z: 0, w: 8, d: 18 },
    ],
  };
}

/** Cargo yard, 68 m: container lanes on the ground, a level on top of them and a gantry over the center. */
function patio(): MapDef {
  const { boxes, props, B, C, P, shell } = builder();
  const HALF = 34;
  const BOX_H = 2.6;
  const DECK = BOX_H;
  const TOP = 5.5;
  const RAIL = PARAPET;
  const ramps: RampDef[] = [];

  shell(HALF, 6, 'floor');

  // Gantry over the center: exposed on purpose, with only low cover.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) C(sx * 5, sz * 4, 1, 1, 0, TOP - 0.3, 'metal');
  B(-6, -8, 6, 8, TOP - 0.3, TOP, 'metal');
  C(0, 0, 3, 3, TOP, RAIL, 'trim');
  C(0, 0, 3.4, 3.4, 0, 2.4, 'crate');
  // Hangs from the gantry: leaves the ground open and stops the platforms from dueling across the map.
  C(0, 0, 12, 0.4, 2.6, 2.6, 'metal');

  const container = (i: number, x: number, z: number, alongX: boolean, level: number): void =>
    P(`industrial/shipping-container-${'abc'[i % 3]}`, x, z, alongX ? 6.2 : 2.5, alongX ? 2.5 : 6.2, BOX_H, { turn: alongX ? 1 : 0, y: level * BOX_H });

  halves((s, turn) => {
    const R = (x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, mat: MatKind): void =>
      B(s * x0, s * z0, s * x1, s * z1, y0, y1, mat);
    const K = (x: number, z: number, w: number, d: number, y0: number, h: number, mat: MatKind): void => C(s * x, s * z, w, d, y0, h, mat);
    const span = (a: number, b: number): [number, number] => {
      const [lo, hi] = [s * a, s * b].sort((p, q) => p - q);
      return [lo, hi];
    };

    // Side platform, the middle height, and the two ramps that chain ground to gantry.
    R(-7, 20, 7, 26, 0, DECK, 'metal');
    const [gx0, gx1] = span(7, 15);
    const [gz0, gz1] = span(21.5, 24.5);
    ramps.push({ minX: gx0, maxX: gx1, minZ: gz0, maxZ: gz1, y0: 0, y1: DECK, axis: 'x', rise: s === 1 ? -1 : 1, mat: 'metal' });
    const [bx0, bx1] = span(-1.5, 1.5);
    const [bz0, bz1] = span(8, 20);
    ramps.push({ minX: bx0, maxX: bx1, minZ: bz0, maxZ: bz1, y0: DECK, y1: TOP, axis: 'z', rise: s === 1 ? -1 : 1, mat: 'metal' });
    R(-7, 20, -2.5, 20.3, DECK, DECK + RAIL, 'trim');
    R(2.5, 20, 7, 20.3, DECK, DECK + RAIL, 'trim');
    K(-4, 23, 2, 2, DECK, 1.6, 'crate');
    R(-6, 7.7, -1.5, 8, TOP, TOP + RAIL, 'trim');
    R(1.5, 7.7, 6, 8, TOP, TOP + RAIL, 'trim');

    // Containers: stacks of two block the view, single ones can be shot over from the platform.
    container(0, s * -24, s * -7, true, 0);
    container(1, s * -24, s * -7, true, 1);
    container(2, s * -25.5, s * 8, false, 0);
    container(0, s * -25.5, s * 8, false, 1);
    // Shields the spawn from the far side of the yard.
    container(1, s * -25, s * 1, false, 0);
    container(2, s * -25, s * 1, false, 1);
    container(1, s * -16, s * -15, false, 0);
    container(2, s * -16, s * -15, false, 1);
    container(0, s * -14, s * 2, true, 0);
    container(2, s * -14, s * 2, true, 1);
    container(0, s * -13, s * 13, false, 0);
    container(1, s * -13, s * 13, false, 1);
    container(2, s * 11, s * -14, true, 0);
    container(1, s * 22, s * -16, false, 0);
    container(2, s * 22, s * -16, false, 1);
    container(0, s * 3, s * -32.7, true, 0);
    container(1, s * 3, s * -32.7, true, 1);
    container(1, s * -20, s * -30.2, true, 0);
    container(2, s * -20, s * -30.2, true, 1);
    container(1, s * -19, s * -14, false, 0);
    container(0, s * -19, s * -14, false, 1);
    container(0, s * 18, s * -27, true, 0);
    container(2, s * 18, s * -27, true, 1);
    container(0, s * 16, s * 7, false, 0);
    container(2, s * 16, s * 7, false, 1);
    container(1, s * -7, s * -11, false, 0);
    container(0, s * -7, s * -11, false, 1);

    // Beside the gantry: closes the diagonals through the center.
    container(1, s * 9, s * -1, false, 0);
    container(0, s * 9, s * -1, false, 1);
    container(2, s * -6, s * 12, false, 0);
    container(1, s * -6, s * 12, false, 1);
    K(14, -7, 2, 2, 0, 1.3, 'crate');
    container(2, s * -28.9, s * -20, true, 0);
    container(1, s * -28.9, s * -20, true, 1);
    // Plugs the strip along the wall, which would otherwise run the length of the yard.
    K(-33, 20, 2, 2.5, 0, 2.6, 'crate');
    container(0, s * -28.9, s * 20, true, 0);
    container(2, s * -28.9, s * 20, true, 1);
    K(12.5, -22, 2, 2, 0, 1.3, 'crate');
    container(2, s * 8, s * -28.5, false, 0);
    container(1, s * 8, s * -28.5, false, 1);

    // Skyline.
    P('industrial/building-l', s * -24, s * -46, 24, 16, 16, { solid: false, turn: turn(2) });
    P('industrial/building-f', s * 16, s * -46, 22, 16, 18, { solid: false, turn: turn(2) });
    P('industrial/chimney-large', s * -46, s * 8, 6, 6, 24, { solid: false });
    P('industrial/water-tower', s * 46, s * 16, 7, 7, 22, { solid: false });
  });

  const redSpawns = [sp(-31, 0, -3), sp(-31, 0, 0), sp(-31, 0, 3), sp(-28, 0, -2), sp(-28, 0, 1), sp(-31, 0, 8), sp(-31, 0, -12), sp(-28, 0, -13)];
  const mirrored = (l: SpawnDef[]): SpawnDef[] => l.map((p) => sp(-p.pos[0], p.pos[1], -p.pos[2]));
  return {
    size: HALF * 2,
    fog: [80, 260],
    boxes,
    ramps,
    props,
    ffaSpawns: [
      sp(-31, 0, 0),
      sp(31, 0, 0),
      sp(-30, 0, -31),
      sp(30, 0, 31),
      sp(-30, 0, 24),
      sp(30, 0, -24),
      sp(-4, DECK, -23),
      sp(4, DECK, 23),
      sp(-5, 0, 0),
      sp(5, 0, 0),
    ],
    teamSpawns: { red: facing(redSpawns, -Math.PI / 2), blue: facing(mirrored(redSpawns), Math.PI / 2) },
    pickups: [
      { kind: 'ammo', pos: [4, TOP, 0] },
      { kind: 'ammo', pos: [-4, TOP, 0] },
      { kind: 'ammo', pos: [0, DECK, 23] },
      { kind: 'ammo', pos: [0, DECK, -23] },
    ],
    baseMarks: [
      { team: 'red', x: -30, z: 0, w: 7, d: 13 },
      { team: 'blue', x: 30, z: 0, w: 7, d: 13 },
    ],
  };
}

/** Everyone starts on their own side, facing the other. */
function bombSpawns(attack: SpawnDef[], defend: SpawnDef[]): Pick<MapDef, 'ffaSpawns' | 'teamSpawns' | 'pickups' | 'baseMarks'> {
  return { ffaSpawns: [...attack, ...defend], teamSpawns: { red: attack, blue: defend }, pickups: [], baseMarks: [] };
}

const WAREHOUSES = ['industrial/building-f', 'industrial/building-l', 'commercial/building-g'];
const BOX_H = 2.6;

/** Two yards at the far end. Attackers reach them along the walls or through the exposed middle; defenders hold the corridor behind. */
function usina(): MapDef {
  const { boxes, props, B, C, P, block, crate, shell } = builder();
  const HALF = 52;
  const H = 9;
  const ramps: RampDef[] = [];
  const container = (i: number, x: number, z: number, alongX: boolean, level = 0): void =>
    P(`industrial/shipping-container-${'abc'[i % 3]}`, x, z, alongX ? 6.2 : 2.5, alongX ? 2.5 : 6.2, BOX_H, { turn: alongX ? 1 : 0, y: level * BOX_H });
  const stack = (i: number, x: number, z: number, alongX: boolean): void => {
    container(i, x, z, alongX);
    container(i + 1, x, z, alongX, 1);
  };

  shell(HALF, H, 'asphalt');

  // Blocks between the three lanes.
  block(-44, 26, -5, 42, H, WAREHOUSES);
  block(5, 26, 44, 42, H, WAREHOUSES);
  block(-44, 6, -5, 20, H, WAREHOUSES);
  block(5, 6, 44, 20, H, WAREHOUSES);
  block(-44, -8, -12, 6, H, WAREHOUSES);
  block(12, -8, 44, 6, H, WAREHOUSES);
  B(-22, -10, -12, -8, 0, H, 'concrete');
  B(12, -10, 22, -8, 0, H, 'concrete');
  block(-22, -42, -12, -16, H, WAREHOUSES);
  block(12, -42, 22, -16, H, WAREHOUSES);
  block(-12, -42, -4, -18, H, WAREHOUSES);
  block(4, -42, 12, -18, H, WAREHOUSES);

  // Back wall of the yards, with one door each.
  B(-52, -44, -40, -42, 0, H, 'concrete');
  B(-34, -44, -4, -42, 0, H, 'concrete');
  B(4, -44, 34, -42, 0, H, 'concrete');
  B(40, -44, 52, -42, 0, H, 'concrete');

  // West lane ends in a tunnel, so B is taken from the dark.
  B(-52, -8, -44, 20, 3.6, H, 'concrete');
  B(-47.5, 0, -44, 2, 0, 3.6, 'concrete');
  B(-52, 8, -48.5, 10, 0, 3.6, 'concrete');

  // Bends: no lane is one long shot.
  B(44, 14, 49, 16, 0, H, 'concrete');
  B(47, 2, 52, 4, 0, H, 'concrete');
  B(-49, 34, -44, 36, 0, H, 'concrete');
  B(-52, 26, -47, 28, 0, H, 'concrete');
  B(-31, 42, -29, 47.5, 0, H, 'concrete');
  B(-37, 46.5, -35, 52, 0, H, 'concrete');
  B(23, 42, 25, 47.5, 0, H, 'concrete');
  B(29, 46.5, 31, 52, 0, H, 'concrete');
  stack(0, -21, 50.7, true);
  B(-20, 20, -18, 23.5, 0, H, 'concrete');
  B(-28, 22.5, -26, 26, 0, H, 'concrete');
  B(18, 22.5, 20, 26, 0, H, 'concrete');
  B(26, 20, 28, 23.5, 0, H, 'concrete');
  B(-24, -52, -22, -47.5, 0, H, 'concrete');
  B(-30, -48.5, -28, -44, 0, H, 'concrete');
  B(22, -52, 24, -47.5, 0, H, 'concrete');
  B(28, -48.5, 30, -44, 0, H, 'concrete');

  // Spawn cover.
  stack(0, -8, 41, true);
  stack(1, 8, 41, true);
  stack(2, 0, -44.5, true);

  // Mid lane: cover every few meters, and a wall that stops the door from seeing down it.
  B(-5, 36, 1, 37.2, 0, H, 'concrete');
  B(-1, 30, 5, 31.2, 0, H, 'concrete');
  crate(-3.5, 33, 2, 1.3);
  crate(-3, 15, 2, 1.3);
  container(0, 2.5, 11, false);
  C(0, -3, 11, 2.5, 0, 4.5, 'concrete');
  crate(-9, -13, 2, 1.3);
  crate(9, 3, 2, 1.3);
  crate(-9, 2, 2, 2.6);
  crate(8.5, -14, 2, 2.6);
  C(0, -13, 4, 3, 0, 4.5, 'concrete');

  C(25.5, -13, 2, 3, 0, 4.5, 'concrete');
  C(28, -16.5, 3, 2, 0, 4.5, 'concrete');

  // Yard A: open, with a platform along the east wall that reaches the whole site.
  B(44, -42, 52, -26, 0, BOX_H, 'metal');
  ramps.push({ minX: 45, maxX: 51, minZ: -26, maxZ: -14, y0: 0, y1: BOX_H, axis: 'z', rise: -1, mat: 'metal' });
  B(44, -30, 44.3, -26, BOX_H, BOX_H + PARAPET, 'trim');
  stack(0, 36, -13, true);
  container(1, 30, -24, false);
  container(2, 39, -25, true);
  stack(1, 32, -35, true);
  crate(42, -33, 2, 1.3);
  crate(26, -18, 2, 2.6);
  crate(26, -32, 2, 1.3);
  crate(42, -17, 2, 1.3);
  crate(35, -30, 2, 1.3);
  container(0, 25, -39, true);
  crate(48, -6, 2, 1.3);

  // Yard B: tighter, the corner closed by a building and the site full of cover.
  block(-52, -42, -41, -30, H, WAREHOUSES);
  block(-30, -14, -22, -8, H, WAREHOUSES);
  C(-28, -16.5, 3, 2, 0, 4.5, 'concrete');
  stack(2, -34, -24, false);
  container(0, -38, -14, true);
  container(1, -28, -30, false);
  crate(-40, -21, 2, 1.3);
  crate(-30, -19, 2, 2.6);
  crate(-36, -33, 2, 1.3);
  crate(-46, -12, 2, 2.6);
  crate(-26, -38, 2, 1.3);
  crate(-46, -26, 2, 1.3);

  // Skyline.
  P('industrial/chimney-large', -30, 66, 7, 7, 30, { solid: false });
  P('industrial/chimney-large', -18, 68, 7, 7, 26, { solid: false });
  P('industrial/water-tower', 34, -66, 8, 8, 24, { solid: false });
  P('industrial/building-l', 66, 10, 18, 30, 18, { solid: false });
  P('industrial/building-f', -66, -10, 18, 30, 20, { solid: false });

  const attack = facing([sp(-6, 0, 45), sp(0, 0, 45), sp(6, 0, 45), sp(-6, 0, 49), sp(0, 0, 49), sp(6, 0, 49), sp(-12, 0, 45), sp(12, 0, 45), sp(-12, 0, 49), sp(12, 0, 49)], 0);
  const defend = facing([sp(-6, 0, -48), sp(0, 0, -48), sp(6, 0, -48), sp(-10, 0, -50), sp(-4, 0, -50), sp(4, 0, -50), sp(10, 0, -50), sp(-12, 0, -46), sp(12, 0, -46), sp(0, 0, -50)], Math.PI);
  return {
    size: HALF * 2,
    fog: [90, 280],
    boxes,
    ramps,
    props,
    ...bombSpawns(attack, defend),
    bomb: {
      sites: [
        { name: 'A', rect: [29, -36, 44, -18] },
        { name: 'B', rect: [-41, -34, -27, -18] },
      ],
      buy: { attack: [-18, 40, 18, 52], defend: [-16, -52, 16, -44] },
    },
  };
}

const SHOPS = ['commercial/building-a', 'commercial/building-c', 'commercial/building-e', 'commercial/building-j', 'suburban/building-type-t'];

/** Attackers start in one corner and the defenders in the opposite one, with a site on each side of them and a square that joins the two. */
function mercado(): MapDef {
  const { boxes, props, B, C, P, block, crate, shell } = builder();
  const HALF = 46;
  const H = 9;
  const car = (model: string, x: number, z: number, alongX: boolean): void =>
    P(`cars/${model}`, x, z, alongX ? 4.6 : 2.1, alongX ? 2.1 : 4.6, 1.7, { turn: alongX ? 1 : 0, col: [alongX ? 4.6 : 2.1, alongX ? 2.1 : 4.6, 1.35] });
  const stall = (x: number, z: number, w: number, d: number): void => C(x, z, w, d, 0, 1.25, 'crate');

  shell(HALF, H, 'asphalt');

  block(-38, -36, -14, 22, H, SHOPS);
  block(-38, 22, -30, 30, H, SHOPS);
  block(-26, 30, -6, 38, H, SHOPS);
  block(-6, 16, 36, 38, H, SHOPS);
  block(-6, 10, 22, 16, H, SHOPS);
  // Around the square: one gap north to A, one gap east to B.
  block(-14, -20, -4, -14, H, SHOPS);
  block(4, -20, 22, -14, H, SHOPS);
  block(12, -14, 22, -4, H, SHOPS);
  block(12, 4, 22, 10, H, SHOPS);
  // The defenders' block, with a door to each site.
  block(22, -34, 34, -16, H, SHOPS);
  block(22, -46, 30, -42, H, SHOPS);
  B(24, -42, 26, -38.5, 0, H, 'brick');
  B(28, -36.5, 30, -34, 0, H, 'brick');
  C(43, -44.6, 6, 2.8, 0, 2.6, 'crate');

  // Bends.
  B(-46, 14, -41, 16, 0, H, 'brick');
  B(-43, -2, -38, 0, 0, H, 'brick');
  B(-46, -18, -41, -16, 0, H, 'brick');
  B(-30, -46, -28, -41, 0, H, 'brick');
  B(-24, -41, -22, -36, 0, H, 'brick');
  B(-16, -46, -14, -41.5, 0, H, 'brick');
  B(-14, 38, -12, 43, 0, H, 'brick');
  B(-8, 41, -6, 46, 0, H, 'brick');
  B(14, 38, 16, 43, 0, H, 'brick');
  B(20, 41, 22, 46, 0, H, 'brick');
  B(36, 30, 41, 32, 0, H, 'brick');
  B(41, 22, 46, 24, 0, H, 'brick');
  B(-24, 22, -22, 26.5, 0, H, 'brick');
  B(-19, 25.5, -17, 30, 0, H, 'brick');
  B(-14, 12, -9.5, 13.5, 0, H, 'brick');
  B(-10.5, 17.5, -6, 19, 0, H, 'brick');
  B(-10.5, 7, -6, 8.5, 0, H, 'brick');
  B(34, -26, 39, -24, 0, H, 'brick');
  B(41, -20, 46, -18, 0, H, 'brick');
  car('delivery', -42, 8, false);
  car('sedan', 2, 42, true);
  car('van', -20, 26, true);
  crate(-30, 41, 2, 1.3);
  crate(-34, 34, 2, 1.3);

  // The square: wide open, broken up by a kiosk and parked cars.
  C(-1, -2, 6, 4, 0, H - 4, 'brick');
  car('taxi', -9, 3, false);
  car('sedan', 7, 6, true);
  car('suv', 8, -9, true);
  stall(-9, -9, 3, 1.6);

  // Site A: the market itself, rows of stalls in the open.
  stall(-3, -30, 6, 1.6);
  stall(5, -30, 6, 1.6);
  stall(1, -36, 8, 1.6);
  C(-6, -38, 2, 2, 0, 2.6, 'crate');
  C(8, -38, 2, 2, 0, 2.6, 'crate');
  C(-11, -25, 2.6, 2.6, 0, 2.6, 'crate');
  C(14, -27, 3, 2, 0, 2.6, 'crate');
  stall(16, -38, 1.6, 6);
  stall(-11, -33, 1.6, 6);
  car('truck', 18, -23, true);
  stall(-6, -34, 1.6, 3);
  stall(8, -34, 1.6, 3);
  stall(1, -41, 5, 1.6);

  C(24, 2.5, 2, 3, 0, 4.5, 'brick');

  // Site B: a parking lot, tighter and lined with vans.
  car('van', 29, -6, false);
  car('delivery', 39, -6, false);
  car('sedan', 34, 2, true);
  car('truck', 27, 6, true);
  C(34, -11, 2, 2, 0, 2.6, 'crate');
  C(42, 3, 2, 2, 0, 2.6, 'crate');
  crate(24.5, -2, 2, 1.3);
  crate(39, 12, 2, 2.6);
  car('suv', 30, 12, true);
  crate(41, -1, 2, 1.3);
  crate(27, 0, 2, 1.3);
  crate(35, -3, 2, 1.3);
  crate(40, 7, 2, 1.3);

  // Skyline.
  P('commercial/building-g', -58, 10, 20, 30, 22, { solid: false });
  P('commercial/building-j', 10, -60, 30, 20, 24, { solid: false });
  P('commercial/building-a', 60, 16, 20, 30, 20, { solid: false });
  P('industrial/water-tower', 8, 60, 8, 8, 22, { solid: false });

  const attack = facing([sp(-42, 0, 36), sp(-38, 0, 36), sp(-34, 0, 40), sp(-42, 0, 40), sp(-38, 0, 40), sp(-42, 0, 44), sp(-38, 0, 44), sp(-34, 0, 44), sp(-30, 0, 44), sp(-34, 0, 36)], -Math.PI / 4);
  const defend = facing([sp(36, 0, -38), sp(40, 0, -38), sp(44, 0, -38), sp(36, 0, -34), sp(40, 0, -34), sp(44, 0, -34), sp(36, 0, -42), sp(40, 0, -42), sp(44, 0, -42), sp(32, 0, -38)], (3 * Math.PI) / 4);
  return {
    size: HALF * 2,
    fog: [90, 280],
    boxes,
    ramps: [],
    props,
    ...bombSpawns(attack, defend),
    bomb: {
      sites: [
        { name: 'A', rect: [-6, -42, 8, -28] },
        { name: 'B', rect: [28, -8, 42, 8] },
      ],
      buy: { attack: [-46, 30, -26, 46], defend: [30, -46, 46, -30] },
    },
  };
}

export const MAPS: Record<MapId, MapDef> = {
  arena: arena(),
  mirante: mirante(),
  galpao: galpao(),
  vila: vila(),
  centro: centro(),
  patio: patio(),
  usina: usina(),
  mercado: mercado(),
};

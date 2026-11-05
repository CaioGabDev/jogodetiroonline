export const PROTOCOL_VERSION = 5;
/** Prefix added to the room code to form the host's PeerJS id (avoids collisions on the public server). */
export const PEER_PREFIX = 'arenafps-v1-';

export const MAX_PLAYERS = 10;
export const INPUT_RATE = 30;
export const SNAPSHOT_RATE = 20;
export const INTERP_DELAY = 100;
export const MAX_INTERP_DELAY = 350;
/** Snapshots sample every player's position history this long in the past, so all positions are time-aligned. */
export const SNAP_SAMPLE_DELAY = 60;
export const HISTORY_MS = 1000;
export const RESPAWN_MS = 3000;
/** Time to choose weapons on the spawn screen. */
export const LOADOUT_PICK_MS = 5000;
/** Minimum time between team changes during a match. */
export const TEAM_SWITCH_COOLDOWN_MS = 10000;
export const SPAWN_PROTECT_MS = 2000;
export const PICKUP_RESPAWN_MS = 20000;
export const MAX_HP = 100;

export const NAME_MAX = 16;
export const CHAT_MAX = 120;

export const PLAYER = {
  radius: 0.4,
  height: 1.85,
  crouchHeight: 1.4,
  eye: 1.65,
  crouchEye: 1.2,
};

export const HITBOX = {
  bodyHalf: 0.34,
  headHalf: 0.21,
  standBodyTop: 1.45,
  standHeadTop: 1.87,
  crouchBodyTop: 1.0,
  crouchHeadTop: 1.42,
};

export const MOVE = {
  walk: 6,
  sprint: 8.5,
  knifeWalk: 10,
  knifeSprint: 14.5,
  knifeAirAccel: 7,
  /** High accel and friction: with the knife, starts, stops and turns are near-instant. */
  knifeAccel: 30,
  knifeFriction: 14,
  crouch: 3,
  ads: 3.6,
  accel: 12,
  airAccel: 2.5,
  /** Air control while sprinting. */
  sprintAirAccel: 6,
  /** Speed multiplier for jumping out of a sprint. Based on the run speed, so hops don't stack. */
  sprintJump: 1.25,
  friction: 7,
  stopSpeed: 1.5,
  gravity: 20,
  jump: 7.2,
  step: 0.5,
};

export type Team = 'red' | 'blue';

export const TEAM_COLORS: Record<Team, string> = { red: '#e8463c', blue: '#3a86ff' };
export const TEAM_NAMES: Record<Team, string> = { red: 'Vermelho', blue: 'Azul' };

export const FFA_COLORS = [
  '#f94144',
  '#f8961e',
  '#f9c74f',
  '#90be6d',
  '#43aa8b',
  '#4cc9f0',
  '#577590',
  '#9b5de5',
  '#f15bb5',
  '#e0e0e0',
];

export type GameMode = 'ffa' | 'tdm';

/** Which weapons a match allows. Independent from the mode, except Gun Game, which is always FFA. */
export type Arsenal = 'all' | 'sniper' | 'shotgun' | 'gungame';

export const ARSENAL_NAMES: Record<Arsenal, string> = {
  all: 'Todas as armas',
  sniper: 'Só sniper',
  shotgun: 'Só doze',
  gungame: 'Gun Game',
};

export type MapId = 'arena' | 'mirante' | 'galpao';

export const MAP_NAMES: Record<MapId, string> = { arena: 'Arena', mirante: 'Mirante', galpao: 'Galpão' };

export const MAP_HINTS: Record<MapId, string> = {
  arena: 'equilibrado',
  mirante: 'grande, tiro a distância',
  galpao: 'pequeno e frenético',
};

export interface MatchConfig {
  map: MapId;
  mode: GameMode;
  arsenal: Arsenal;
  /** 0 = no limit (practice). */
  killLimit: number;
  /** Minutes; 0 = no limit. */
  timeLimit: number;
  friendlyFire: boolean;
}

export const KILL_LIMITS = [10, 20, 30, 50];
export const TIME_LIMITS = [5, 10, 15, 20];

export const DEFAULT_CONFIG: MatchConfig = { map: 'arena', mode: 'ffa', arsenal: 'all', killLimit: 20, timeLimit: 10, friendlyFire: false };

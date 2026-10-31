export const PROTOCOL_VERSION = 2;
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
export const SPAWN_PROTECT_MS = 2000;
export const PICKUP_RESPAWN_MS = 20000;
export const MAX_HP = 100;
export const HEALTH_PICKUP = 50;

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
  crouch: 3,
  ads: 3.6,
  accel: 12,
  airAccel: 2.5,
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

export interface MatchConfig {
  mode: GameMode;
  /** 0 = no limit (practice). */
  killLimit: number;
  /** Minutes; 0 = no limit. */
  timeLimit: number;
  friendlyFire: boolean;
}

export const KILL_LIMITS = [10, 20, 30, 50];
export const TIME_LIMITS = [5, 10, 15, 20];

export const DEFAULT_CONFIG: MatchConfig = { mode: 'ffa', killLimit: 20, timeLimit: 10, friendlyFire: false };

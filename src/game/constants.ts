export const PROTOCOL_VERSION = 13;
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
export const LOADOUT_PICK_MS = 10000;
/** Minimum time between team changes during a match. */
export const TEAM_SWITCH_COOLDOWN_MS = 10000;
export const SPAWN_PROTECT_MS = 2000;
export const PICKUP_RESPAWN_MS = 20000;
export const MAX_HP = 100;
/** Health starts coming back this long after the last hit. */
export const REGEN_DELAY_MS = 5000;
/** HP per second while regenerating. */
export const REGEN_RATE = 50;

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
  walk: 5.4,
  sprint: 8.1,
  crouch: 2.6,
  ads: 2.9,
  accel: 14,
  airAccel: 2,
  friction: 8,
  stopSpeed: 1.5,
  gravity: 20,
  jump: 6.3,
  step: 0.5,
  /** Seconds of sprint on a full tank, and seconds regained per second. */
  sprintTime: 4,
  sprintRecover: 2,
  /** Fuel needed to start sprinting again, so an empty tank can't stutter. */
  sprintMin: 0.5,
  slideSpeed: 10,
  slideTime: 0.7,
  slideFriction: 1.6,
  /** Highest ledge a mantle reaches, from the ground and in mid-air. With `jump` this matches what a jump reached before. */
  mantleReach: 1.45,
  mantleAirReach: 0.45,
  mantleTime: 0.4,
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

export type GameMode = 'ffa' | 'tdm' | 'bomb';

/** Modes where players fight in two teams. */
export const teamMode = (mode: GameMode): boolean => mode !== 'ffa';

/** Which weapons a match allows. Independent from the mode, except Gun Game, which is always FFA. */
export type Arsenal = 'all' | 'sniper' | 'shotgun' | 'gungame' | 'shop';

export const ARSENAL_NAMES: Record<Arsenal, string> = {
  all: 'Todas as armas',
  sniper: 'Só sniper',
  shotgun: 'Só doze',
  gungame: 'Gun Game',
  shop: 'Compra por rodada',
};

export type MapId = 'arena' | 'mirante' | 'galpao' | 'vila' | 'centro' | 'patio' | 'usina' | 'mercado';

export const MAP_NAMES: Record<MapId, string> = {
  arena: 'Arena',
  mirante: 'Mirante',
  galpao: 'Galpão',
  vila: 'Vila',
  centro: 'Centro',
  patio: 'Pátio',
  usina: 'Usina',
  mercado: 'Mercado',
};

/** Built for attack and defense: the only maps of the bomb mode, which is the only mode they fit. */
export const BOMB_MAPS: MapId[] = ['usina', 'mercado'];

export const MAP_HINTS: Record<MapId, string> = {
  arena: 'equilibrado',
  mirante: 'grande, tiro a distância',
  galpao: 'pequeno e frenético',
  vila: 'pequeno, casas e quintais',
  centro: 'médio, três rotas',
  patio: 'contêineres, três alturas',
  usina: 'bomba, dois pátios e meio exposto',
  mercado: 'bomba, ataque na diagonal',
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
  /** Bomb mode: round wins that take the match. Sides swap halfway. */
  rounds: number;
}

export const KILL_LIMITS = [10, 20, 30, 50];
export const TIME_LIMITS = [5, 10, 15, 20];
export const ROUND_WINS = [7, 9, 13];

export const DEFAULT_CONFIG: MatchConfig = { map: 'arena', mode: 'ffa', arsenal: 'all', killLimit: 20, timeLimit: 10, friendlyFire: false, rounds: 13 };

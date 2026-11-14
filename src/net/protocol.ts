import type { MatchConfig, Team } from '../game/constants';
import { CHAT_MAX, NAME_MAX } from '../game/constants';
import { MAX_LEVEL, isKnifeSkin, isWeaponSkin } from '../game/progression';
import { WEAPON_COUNT } from '../game/weapons';
import { isFiniteNum, isVec3 } from '../core/util';

type Vec3 = [number, number, number];

// ---------------------------------------------------------------------------
// Shared data structures
// ---------------------------------------------------------------------------

export type Phase = 'lobby' | 'playing' | 'ended';

export interface PlayerInfo {
  id: number;
  name: string;
  team: Team;
  color: string;
  host: boolean;
  bot: boolean;
  /** Weapon skin everyone sees on this player's guns. */
  skin: string;
  /** Knife skin, seen on the knife. */
  knife: string;
  /** Level the player claims. Cosmetic: progress lives in each browser. */
  lv: number;
}

export interface LobbyState {
  phase: Phase;
  config: MatchConfig;
  players: PlayerInfo[];
  hostId: number;
  code: string;
  offline: boolean;
}

export interface MatchInfo {
  config: MatchConfig;
  pickups: boolean[];
}

/** Snapshot flag bits. */
export const F_ALIVE = 1;
export const F_CROUCH = 2;
export const F_PROTECTED = 4;
export const F_ADS = 8;
export const F_GROUND = 16;
export const F_RELOAD = 32;

export interface SnapPlayer {
  i: number;
  p: Vec3;
  yw: number;
  pt: number;
  f: number;
  hp: number;
  w: number;
}

export interface ScoreRow {
  i: number;
  k: number;
  d: number;
  pg: number;
  /** Gun Game level. */
  lv: number;
  /** Bomb mode: money, sent only to the player's own team. */
  m?: number;
}

export interface ResultRow {
  id: number;
  name: string;
  team: Team;
  color: string;
  kills: number;
  deaths: number;
  damage: number;
  headshots: number;
  /** Gun trigger pulls, the ones that hit someone, and those that hit a head. */
  shots: number;
  hits: number;
  headHits: number;
}

export type RejectReason = 'full' | 'version' | 'name' | 'closed';

// ---------------------------------------------------------------------------
// Client -> Host
// ---------------------------------------------------------------------------

export interface HelloMsg {
  type: 'hello';
  name: string;
  color: string;
  v: number;
  skin?: string;
  knife?: string;
  lv?: number;
}

export interface InputMsg {
  type: 'input';
  /** Teleport counter; inputs from before the last host teleport are ignored. */
  tp: number;
  /** Client simulation clock in ms (used to validate speed independent of network jitter). */
  ct: number;
  p: Vec3;
  yw: number;
  pt: number;
  c: boolean;
  w: number;
  a: boolean;
  g: boolean;
  /** Holding the key that plants or defuses. */
  u: boolean;
}

export interface ShootMsg {
  type: 'shoot';
  s: number;
  w: number;
  o: Vec3;
  /** Flattened unit direction vectors (one per pellet). */
  d: number[];
  /** Host-clock time the shooter was viewing (for lag compensation). */
  rt: number;
}

export interface ReloadMsg {
  type: 'reload';
  w: number;
}

export interface ChatSendMsg {
  type: 'chat';
  text: string;
  team: boolean;
}

export interface PongMsg {
  type: 'pong';
  t: number;
}

export interface SetTeamMsg {
  type: 'setTeam';
  team: Team;
}

export interface SetColorMsg {
  type: 'setColor';
  color: string;
}

export interface LoadoutMsg {
  type: 'loadout';
  /** Two primaries, a pistol, a lethal and a tactical. */
  w: number[];
  /** Player confirmed: spawn now instead of waiting for the timer. */
  go: boolean;
}

/** Bomb mode: a weapon id or an ITEM. */
export interface BuyMsg {
  type: 'buy';
  item: number;
}

export type ClientMsg = HelloMsg | InputMsg | ShootMsg | ReloadMsg | ChatSendMsg | PongMsg | SetTeamMsg | SetColorMsg | LoadoutMsg | BuyMsg;

// ---------------------------------------------------------------------------
// Host -> Client
// ---------------------------------------------------------------------------

export interface WelcomeMsg {
  type: 'welcome';
  id: number;
  lobby: LobbyState;
  match: MatchInfo | null;
}

export interface RejectMsg {
  type: 'reject';
  reason: RejectReason;
}

export interface LobbyMsg {
  type: 'lobby';
  lobby: LobbyState;
}

export interface StartMsg {
  type: 'start';
  match: MatchInfo;
}

export interface SnapMsg {
  type: 'snap';
  t: number;
  ps: SnapPlayer[];
}

export interface ScoreMsg {
  type: 'score';
  ps: ScoreRow[];
  teams: [number, number];
  /** Time left in ms, -1 when unlimited. */
  tl: number;
}

export interface SpawnMsg {
  type: 'spawn';
  p: Vec3;
  yw: number;
  tp: number;
  /** true = full respawn (reset hp/ammo); false = position correction only. */
  full: boolean;
  /** Weapons the player spawned with (full respawns). */
  ld?: number[];
  /** What the player can throw (full respawns). */
  eq?: number[];
}

export type RoundPhase = 'freeze' | 'live' | 'over';
export type RoundEnd = 'elimination' | 'time' | 'exploded' | 'defused';

/** Bomb mode: everything everyone needs to know about the round. Sent on every change, and once a second for the clock. */
export interface RoundMsg {
  type: 'round';
  n: number;
  phase: RoundPhase;
  /** Ms left in the phase; with the bomb planted, until it goes off. */
  left: number;
  /** Ms left to buy. */
  buy: number;
  /** Team on attack. */
  atk: Team;
  /** Who carries the bomb, or -1. */
  by: number;
  /** Where the bomb lies, dropped or planted. */
  spot: Vec3 | null;
  planted: boolean;
  /** Who is planting or defusing, or -1, and the ms left of it. */
  act: number;
  actLeft: number;
  win: Team | null;
  why: RoundEnd | null;
}

/** Bomb mode: weapons lying on the ground. */
export interface DropsMsg {
  type: 'drops';
  list: Array<{ id: number; w: number; p: Vec3 }>;
}

/** Bomb mode: this player's wallet and gear. */
export interface KitMsg {
  type: 'kit';
  money: number;
  ld: number[];
  eq: number[];
  armor: number;
  helmet: boolean;
  defuseKit: boolean;
}

/** Opens the spawn screen. */
export interface PickMsg {
  type: 'pick';
  ms: number;
}

/** A physical projectile left the weapon. Clients only draw it; the host decides what it hits. */
export interface ProjMsg {
  type: 'proj';
  id: number;
  i: number;
  w: number;
  o: Vec3;
  v: Vec3;
  /** It bounced: this corrects the path of one already in flight. */
  b?: boolean;
}

export interface ProjEndMsg {
  type: 'pimp';
  id: number;
  w: number;
  p: Vec3;
  /** 0 nothing, 1 world, 2 player. */
  h: number;
  n: Vec3;
}

export interface AmmoMsg {
  type: 'ammo';
  mag: number[];
  res: number[];
  /** Last shot sequence processed by the host. */
  ack: number;
}

export interface HitMsg {
  type: 'hit';
  dmg: number;
  hs: boolean;
  kill: boolean;
  /** Above the target's head, where the damage number appears. */
  p: Vec3;
}

export interface DamageMsg {
  type: 'dmg';
  from: number;
  /** Attacker position (for the direction indicator). */
  src: Vec3;
  amt: number;
}

export interface KillMsg {
  type: 'kill';
  k: number;
  v: number;
  w: number;
  hs: boolean;
}

/** The blast of a tactical reached this player. */
export interface StunMsg {
  type: 'stun';
  w: number;
  ms: number;
}

export interface ShotMsg {
  type: 'shot';
  i: number;
  w: number;
  o: Vec3;
  /** Flattened end points. */
  e: number[];
  /** Per pellet: 0 nothing, 1 world, 2 player. */
  h: number[];
  /** Flattened surface normals (world hits). */
  n: number[];
}

export interface PickupMsg {
  type: 'pickup';
  idx: number;
  on: boolean;
  by: number;
}

export interface ChatMsg {
  type: 'chat';
  from: number;
  text: string;
  team: boolean;
}

export interface SysMsg {
  type: 'sys';
  text: string;
}

export interface PingMsg {
  type: 'ping';
  t: number;
}

export interface EndMsg {
  type: 'end';
  winnerId: number;
  winnerTeam: Team | null;
  reason: 'kills' | 'time';
  results: ResultRow[];
  mvp: number;
  teams: [number, number];
}

export type HostMsg =
  | WelcomeMsg
  | RejectMsg
  | LobbyMsg
  | StartMsg
  | SnapMsg
  | ScoreMsg
  | SpawnMsg
  | AmmoMsg
  | HitMsg
  | DamageMsg
  | KillMsg
  | ShotMsg
  | PickMsg
  | ProjMsg
  | ProjEndMsg
  | StunMsg
  | RoundMsg
  | KitMsg
  | DropsMsg
  | PickupMsg
  | ChatMsg
  | SysMsg
  | PingMsg
  | EndMsg;

// ---------------------------------------------------------------------------
// Validation of untrusted client messages (run on the host)
// ---------------------------------------------------------------------------

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max * 4;
const isTeam = (v: unknown): v is Team => v === 'red' || v === 'blue';
const isWeapon = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) < WEAPON_COUNT;

export function parseClientMsg(raw: unknown): ClientMsg | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  switch (m.type) {
    case 'hello':
      return isStr(m.name, NAME_MAX) &&
        isStr(m.color, 16) &&
        isFiniteNum(m.v) &&
        (m.skin === undefined || isWeaponSkin(m.skin)) &&
        (m.knife === undefined || isKnifeSkin(m.knife)) &&
        (m.lv === undefined || (Number.isInteger(m.lv) && (m.lv as number) >= 1 && (m.lv as number) <= MAX_LEVEL))
        ? (m as unknown as HelloMsg)
        : null;
    case 'input':
      return isFiniteNum(m.tp) &&
        isFiniteNum(m.ct) &&
        isVec3(m.p) &&
        isFiniteNum(m.yw) &&
        isFiniteNum(m.pt) &&
        typeof m.c === 'boolean' &&
        isWeapon(m.w) &&
        typeof m.a === 'boolean' &&
        typeof m.g === 'boolean' &&
        typeof m.u === 'boolean'
        ? (m as unknown as InputMsg)
        : null;
    case 'shoot':
      return isFiniteNum(m.s) &&
        isWeapon(m.w) &&
        isVec3(m.o) &&
        Array.isArray(m.d) &&
        m.d.length >= 3 &&
        m.d.length <= 30 &&
        m.d.length % 3 === 0 &&
        m.d.every(isFiniteNum) &&
        isFiniteNum(m.rt)
        ? (m as unknown as ShootMsg)
        : null;
    case 'reload':
      return isWeapon(m.w) ? (m as unknown as ReloadMsg) : null;
    case 'loadout':
      return Array.isArray(m.w) && m.w.length === 5 && m.w.every(isWeapon) && typeof m.go === 'boolean' ? (m as unknown as LoadoutMsg) : null;
    case 'buy':
      return isFiniteNum(m.item) ? (m as unknown as BuyMsg) : null;
    case 'chat':
      return isStr(m.text, CHAT_MAX) && typeof m.team === 'boolean' ? (m as unknown as ChatSendMsg) : null;
    case 'pong':
      return isFiniteNum(m.t) ? (m as unknown as PongMsg) : null;
    case 'setTeam':
      return isTeam(m.team) ? (m as unknown as SetTeamMsg) : null;
    case 'setColor':
      return isStr(m.color, 16) ? (m as unknown as SetColorMsg) : null;
    default:
      return null;
  }
}

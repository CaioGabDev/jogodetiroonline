import type { DataConnection, Peer } from 'peerjs';
import {
  ARSENAL_NAMES,
  BOMB_MAPS,
  DEFAULT_CONFIG,
  MAP_NAMES,
  FFA_COLORS,
  HISTORY_MS,
  HITBOX,
  LOADOUT_PICK_MS,
  MAX_INTERP_DELAY,
  SNAP_SAMPLE_DELAY,
  MAX_HP,
  MAX_PLAYERS,
  MOVE,
  NAME_MAX,
  CHAT_MAX,
  PICKUP_RESPAWN_MS,
  PLAYER,
  PROTOCOL_VERSION,
  REGEN_DELAY_MS,
  REGEN_RATE,
  RESPAWN_MS,
  ROUND_WINS,
  SNAPSHOT_RATE,
  SPAWN_PROTECT_MS,
  TEAM_NAMES,
  TEAM_SWITCH_COOLDOWN_MS,
  teamMode,
  type MapId,
  type MatchConfig,
  type Team,
  KILL_LIMITS,
  TIME_LIMITS,
} from '../game/constants';
import { MAPS, type MapDef, type SpawnDef } from '../game/mapData';
import { CollisionWorld, eyeHeight } from '../game/physics';
import { PositionHistory, rayPlayer } from '../game/hitbox';
import { DEFAULT_KNIFE, DEFAULT_SKIN } from '../game/progression';
import { DEFAULT_PRACTICE, DRILL_COUNTDOWN_MS, DRILL_TARGETS, LEVELS, PRACTICE_LEVELS, type LevelTuning, type PracticeSetup } from '../game/practice';
import { DEFAULT_LOADOUT, W, WEAPONS, allowedWeapons, blastDamage, damageAt, fullAmmo, gunGameLadder, spawnEquipment, stunMs, validLoadout } from '../game/weapons';
import { ITEM, MAX_THROWN, ROUND, SHOP, gunHit, inRect, isThrowable, isWeaponItem, lossBonus, siteAt } from '../game/bomb';
import { clamp, now, r2, r3, randomCode, sanitizeText } from '../core/util';
import {
  F_ADS,
  F_ALIVE,
  F_CROUCH,
  F_GROUND,
  F_PROTECTED,
  F_RELOAD,
  parseClientMsg,
  type ClientMsg,
  type EndMsg,
  type HelloMsg,
  type HostMsg,
  type InputMsg,
  type LoadoutMsg,
  type LobbyState,
  type MatchInfo,
  type Phase,
  type PlayerInfo,
  type ResultRow,
  type RoundEnd,
  type RoundPhase,
  type ScoreRow,
  type ShootMsg,
  type SnapPlayer,
} from './protocol';
import { RoomAnnouncer, type RoomInfo } from './directory';
import { createLoopback, errorType, openPeer, PeerConn, peerIdForCode, type Conn } from './peer';

interface Slot {
  conn: Conn;
  local: boolean;
  rtt: number;
  lastRecv: number;
  chatTimes: number[];
}

interface Bot {
  ax: number;
  az: number;
  bx: number;
  bz: number;
  y: number;
  speed: number;
  phase: number;
  crouch: boolean;
  /** Duel: when it first saw its target (0 = not seeing anyone) and when it may shoot again. */
  seenAt: number;
  nextShotAt: number;
  /** Reflex drill: when the target came up and when it goes down by itself. */
  upAt: number;
  downAt: number;
}

/** One run of the reflex drill. */
interface Drill {
  running: boolean;
  goAt: number;
  nextAt: number;
  shown: number;
  kills: number;
  reactions: number[];
  /** The use key went down since the last tick. Kept until read, so a quick tap between ticks still counts. */
  pressed: boolean;
}

interface SPlayer {
  info: PlayerInfo;
  slot: Slot | null;
  bot: Bot | null;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  crouch: boolean;
  ads: boolean;
  onGround: boolean;
  weapon: number;
  hp: number;
  /** Health regenerates some time after this. */
  lastHurtAt: number;
  alive: boolean;
  protectedUntil: number;
  respawnAt: number;
  tp: number;
  kills: number;
  /** Gun Game level: index in the match's ladder. */
  level: number;
  deaths: number;
  damage: number;
  headshots: number;
  shots: number;
  hits: number;
  headHits: number;
  mag: number[];
  reserve: number[];
  reloadW: number;
  reloadUntil: number;
  credits: number;
  creditT: number;
  lastShotSeq: number;
  history: PositionHistory;
  lastMoveT: number;
  /** Client simulation clock (ms) of the last accepted input; -1 = none since spawn/correction. */
  lastCt: number;
  /** How far the client's clock has run ahead of real time (speed-hack guard), in ms. */
  clockAhead: number;
  /** Maps client clock to host clock (host ms = ct + ctOff), estimated from the least-delayed inputs. */
  ctOff: number | null;
  lastHistT: number;
  /** Host time until this player may change teams again. */
  teamLockUntil: number;
  /** Two primaries, a pistol, a lethal and a tactical. */
  loadout: number[];
  /** What this life can throw, set on spawning. */
  equip: number[];
  /** On the spawn screen, waiting for the timer or a confirmation. */
  picking: boolean;
  // Bomb mode.
  money: number;
  armor: number;
  helmet: boolean;
  defuseKit: boolean;
  /** Holding the key that plants or defuses. */
  using: boolean;
  /** The same key on the last tick: swapping a weapon takes a new press. */
  wasUsing: boolean;
}

/** A weapon on the ground, with the ammo it was left with. */
interface Drop {
  id: number;
  w: number;
  x: number;
  y: number;
  z: number;
  mag: number;
  reserve: number;
}

/** State of the bomb mode. */
interface Round {
  n: number;
  phase: RoundPhase;
  endsAt: number;
  buyEndsAt: number;
  attackers: Team;
  /** Rounds lost, which set the size of the loss bonus. */
  lossStreak: Record<Team, number>;
  carrier: SPlayer | null;
  /** Where the bomb lies, dropped or planted. */
  spot: [number, number, number] | null;
  planted: boolean;
  planter: SPlayer | null;
  explodeAt: number;
  /** Who is planting or defusing, from where, and until when. */
  worker: SPlayer | null;
  workX: number;
  workZ: number;
  workEndsAt: number;
  winner: Team | null;
  why: RoundEnd | null;
}

const otherTeam = (t: Team): Team => (t === 'red' ? 'blue' : 'red');
const scoreIndex = (t: Team): 0 | 1 => (t === 'red' ? 0 : 1);

/** A bolt or grenade in flight. */
interface Projectile {
  id: number;
  owner: SPlayer;
  w: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  bornAt: number;
  lastT: number;
}

/** Burning ground left by a molotov. */
interface Fire {
  owner: SPlayer;
  w: number;
  x: number;
  y: number;
  z: number;
  until: number;
  nextAt: number;
}

type DamageMap = Map<SPlayer, { dmg: number; hs: boolean }>;

/** Projectiles that hit nothing are dropped after this long. */
const PROJECTILE_MAX_MS = 8000;
/** Time between burns while standing in fire. */
const FIRE_TICK_MS = 250;

interface PickupState {
  active: boolean;
  respawnAt: number;
}

/** Ticker driven by a Web Worker so the host keeps simulating when its tab is in the background. */
class Ticker {
  private worker: Worker | null = null;
  private interval = 0;
  private url = '';

  constructor(ms: number, cb: () => void) {
    try {
      const src = 'let id=0;onmessage=(e)=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data);};';
      this.url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      this.worker = new Worker(this.url);
      this.worker.onmessage = () => cb();
      this.worker.postMessage(ms);
    } catch {
      this.worker = null;
      this.interval = window.setInterval(cb, ms);
    }
  }

  stop(): void {
    if (this.worker) {
      this.worker.postMessage(0);
      this.worker.terminate();
      URL.revokeObjectURL(this.url);
      this.worker = null;
    }
    if (this.interval) clearInterval(this.interval);
  }
}

export interface HostCallbacks {
  /** Signaling server lost; existing connections keep working. */
  onStatus?(text: string): void;
}

type BotDef = Omit<Bot, 'phase' | 'seenAt' | 'nextShotAt' | 'upAt' | 'downAt'> & { name: string };

const BOT_DEFS: BotDef[] = [
  { name: 'Alvo Parado', ax: 0, az: -12, bx: 0, bz: -12, y: 0, speed: 0, crouch: false },
  { name: 'Alvo Móvel', ax: -4, az: 11, bx: 4, bz: 11, y: 0, speed: 2.5, crouch: false },
  { name: 'Alvo Agachado', ax: 18, az: -6, bx: 18, bz: 6, y: 0, speed: 1.5, crouch: true },
  { name: 'Alvo Plataforma', ax: 0, az: -31, bx: 0, bz: -31, y: 3.5, speed: 0, crouch: false },
];

export class HostServer {
  code = '';
  readonly offline: boolean;
  private peer: Peer | null = null;
  private map: MapDef = MAPS.arena;
  private world = new CollisionWorld(this.map);
  private players = new Map<number, SPlayer>();
  private nextId = 1;
  private hostId = 0;
  private phase: Phase = 'lobby';
  private config: MatchConfig;
  private pickups: PickupState[] = this.map.pickups.map(() => ({ active: true, respawnAt: 0 }));
  private teamScore: [number, number] = [0, 0];
  private endsAt = 0;
  private ticker: Ticker | null = null;
  private announcer: RoomAnnouncer | null = null;
  private tickCount = 0;
  private destroyed = false;
  private pending = new Set<Conn>();
  private projectiles: Projectile[] = [];
  private nextProjectile = 1;
  private fires: Fire[] = [];
  private round: Round = this.newRound();
  private drops: Drop[] = [];
  private nextDrop = 1;
  private drill: Drill = { running: false, goAt: 0, nextAt: 0, shown: 0, kills: 0, reactions: [], pressed: false };

  constructor(
    offline: boolean,
    private cb: HostCallbacks = {},
    practiceMap: MapId = DEFAULT_CONFIG.map,
    private practice: PracticeSetup = DEFAULT_PRACTICE,
  ) {
    this.offline = offline;
    // Practice on a bomb map is the real mode, against targets that stand in the defenders' spawn.
    const practiceMode = MAPS[practiceMap].bomb ? ({ mode: 'bomb', arsenal: 'shop' } as const) : {};
    this.config = offline ? { ...DEFAULT_CONFIG, map: practiceMap, killLimit: 0, timeLimit: 0, ...practiceMode } : { ...DEFAULT_CONFIG };
    this.map = MAPS[this.config.map];
  }

  private get bombMode(): boolean {
    return this.config.mode === 'bomb';
  }

  /** Practice modes only run on the deathmatch maps; bomb maps have their own. */
  private get drillMode(): PracticeSetup['mode'] {
    return this.offline && !this.bombMode ? this.practice.mode : 'alvos';
  }

  private get tuning(): LevelTuning {
    return LEVELS[this.practice.level];
  }

  private get frozen(): boolean {
    return this.bombMode && this.round.phase === 'freeze';
  }

  /** Registers the room with PeerJS (retrying on code collisions). Returns the room code. */
  async start(): Promise<string> {
    if (this.offline) {
      this.code = 'TREINO';
    } else {
      let lastErr: unknown = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        const code = randomCode(6);
        try {
          this.peer = await openPeer(peerIdForCode(code));
          this.code = code;
          break;
        } catch (e) {
          lastErr = e;
          if (errorType(e) !== 'unavailable-id') throw e;
        }
      }
      if (!this.peer) throw lastErr;
      this.peer.on('connection', (dc) => this.onConnection(dc));
      this.peer.on('disconnected', () => {
        if (this.destroyed || !this.peer) return;
        this.cb.onStatus?.('Reconectando ao servidor de pareamento…');
        window.setTimeout(() => {
          if (!this.destroyed && this.peer && this.peer.disconnected && !this.peer.destroyed) {
            try {
              this.peer.reconnect();
            } catch {
              /* ignore */
            }
          }
        }, 1500);
      });
      this.peer.on('error', () => {
        /* errors after open are non-fatal for the host: existing connections keep working */
      });
    }
    if (this.peer) this.announcer = new RoomAnnouncer(this.peer, () => this.roomInfo());
    this.ticker = new Ticker(1000 / SNAPSHOT_RATE, () => this.tick());
    return this.code;
  }

  /** Creates the host's own in-memory client connection. */
  connectLocal(): Conn {
    const [serverEnd, clientEnd] = createLoopback();
    this.watchPending(serverEnd, true);
    return clientEnd;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ticker?.stop();
    this.announcer?.stop();
    for (const p of this.players.values()) {
      if (p.slot && !p.slot.local) {
        p.slot.conn.send({ type: 'reject', reason: 'closed' } satisfies HostMsg);
      }
    }
    // Close right away: during page unload, timers never fire. Closing the data
    // channels lets clients detect the host leaving immediately.
    for (const p of this.players.values()) p.slot?.conn.close();
    this.pending.forEach((c) => c.close());
    const peer = this.peer;
    window.setTimeout(() => {
      try {
        peer?.destroy();
      } catch {
        /* ignore */
      }
    }, 200);
  }

  // ---------------------------------------------------------------- connections

  private onConnection(dc: DataConnection): void {
    if (this.destroyed) {
      dc.close();
      return;
    }
    this.watchPending(new PeerConn(dc), false);
  }

  private watchPending(conn: Conn, local: boolean): void {
    this.pending.add(conn);
    const timer = window.setTimeout(() => {
      if (this.pending.has(conn)) {
        this.pending.delete(conn);
        conn.close();
      }
    }, 15000);
    conn.onMessage = (raw) => {
      const m = parseClientMsg(raw);
      if (m?.type !== 'hello') return;
      clearTimeout(timer);
      this.pending.delete(conn);
      this.acceptHello(conn, m, local);
    };
    conn.onClose = () => {
      clearTimeout(timer);
      this.pending.delete(conn);
    };
  }

  private humanCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (!p.bot) n++;
    return n;
  }

  private acceptHello(conn: Conn, hello: HelloMsg, local: boolean): void {
    const reject = (reason: 'full' | 'version' | 'name'): void => {
      conn.send({ type: 'reject', reason } satisfies HostMsg);
      window.setTimeout(() => conn.close(), 400);
    };
    if (hello.v !== PROTOCOL_VERSION) return reject('version');
    if (this.humanCount() >= MAX_PLAYERS) return reject('full');
    const name = sanitizeText(hello.name, NAME_MAX);
    if (!name) return reject('name');

    const id = this.nextId++;
    const slot: Slot = { conn, local, rtt: local ? 0 : 100, lastRecv: now(), chatTimes: [] };
    const p = this.createPlayer(id, name, slot, null);
    p.info.color = this.pickColor(hello.color);
    p.info.skin = hello.skin ?? DEFAULT_SKIN;
    p.info.knife = hello.knife ?? DEFAULT_KNIFE;
    p.info.lv = hello.lv ?? 1;
    if (local && this.hostId === 0) {
      this.hostId = id;
      p.info.host = true;
      if (this.offline) this.addBots();
    }
    this.players.set(id, p);

    conn.onMessage = (raw) => {
      slot.lastRecv = now();
      const m = parseClientMsg(raw);
      if (m) this.onClientMsg(p, m);
    };
    conn.onClose = () => this.removePlayer(id);

    // Joining during the results screen waits in the lobby: there's no match left to spawn into.
    const match = this.phase === 'playing' ? this.matchInfo() : null;
    this.send(p, { type: 'welcome', id, lobby: this.lobbyState(), match });
    this.broadcastLobby();
    if (!local) this.broadcast({ type: 'sys', text: `${name} entrou na sala` }, id);
    if (this.phase === 'playing') this.beginSpawn(p);
  }

  private createPlayer(id: number, name: string, slot: Slot | null, bot: Bot | null): SPlayer {
    const ammo = fullAmmo();
    return {
      info: { id, name, team: this.smallerTeam(), color: FFA_COLORS[0], host: false, bot: !!bot, skin: DEFAULT_SKIN, knife: DEFAULT_KNIFE, lv: 1 },
      slot,
      bot,
      x: 0,
      y: -50,
      z: 0,
      yaw: 0,
      pitch: 0,
      crouch: false,
      ads: false,
      onGround: true,
      weapon: 0,
      hp: MAX_HP,
      lastHurtAt: 0,
      alive: false,
      protectedUntil: 0,
      respawnAt: 0,
      tp: 0,
      kills: 0,
      level: 0,
      deaths: 0,
      damage: 0,
      headshots: 0,
      shots: 0,
      hits: 0,
      headHits: 0,
      mag: ammo.mag,
      reserve: ammo.reserve,
      reloadW: -1,
      reloadUntil: 0,
      credits: 2,
      creditT: now(),
      lastShotSeq: 0,
      history: new PositionHistory(),
      lastMoveT: now(),
      lastCt: -1,
      ctOff: null,
      lastHistT: 0,
      clockAhead: 0,
      teamLockUntil: 0,
      loadout: [...DEFAULT_LOADOUT],
      equip: [],
      picking: false,
      money: ROUND.startMoney,
      armor: 0,
      helmet: false,
      defuseKit: false,
      using: false,
      wasUsing: false,
    };
  }

  private addBots(): void {
    const mode = this.drillMode;
    const count = mode === 'duelo' ? this.tuning.duelists : mode === 'aleatorio' ? 6 : mode === 'reflexo' ? 3 : BOT_DEFS.length;
    const label = mode === 'duelo' ? 'Inimigo' : 'Alvo';
    for (let i = 0; i < count; i++) {
      const d: BotDef = mode === 'alvos' ? BOT_DEFS[i] : { ...BOT_DEFS[0], name: `${label} ${i + 1}` };
      const id = this.nextId++;
      const bot: Bot = { ...this.botSpot(d, i), phase: Math.random() * Math.PI * 2, seenAt: 0, nextShotAt: 0, upAt: 0, downAt: 0 };
      const p = this.createPlayer(id, d.name, null, bot);
      p.info.color = '#c9a227';
      p.info.team = 'blue';
      this.players.set(id, p);
    }
  }

  /** BOT_DEFS were placed by hand on the Arena. Elsewhere targets use the spawns, which are clear on every map. */
  private botSpot(d: BotDef, i: number): BotDef {
    if (this.config.map === 'arena') return d;
    if (this.map.bomb) {
      const [ax, y, az] = this.map.teamSpawns.blue[i].pos;
      return { ...d, ax, az, y, bx: ax, bz: az, speed: 0 };
    }
    // Every other spawn, so targets spread over the whole map.
    const s = this.map.ffaSpawns[(i * 3) % this.map.ffaSpawns.length];
    const [ax, y, az] = s.pos;
    return { ...d, ax, az, y, bx: ax + d.bx - d.ax, bz: az + d.bz - d.az };
  }

  private pickColor(requested: string): string {
    const used = new Set([...this.players.values()].map((p) => p.info.color));
    if (FFA_COLORS.includes(requested) && !used.has(requested)) return requested;
    return FFA_COLORS.find((c) => !used.has(c)) ?? FFA_COLORS[0];
  }

  private smallerTeam(): Team {
    let red = 0;
    let blue = 0;
    for (const p of this.players.values()) {
      if (p.bot) continue;
      if (p.info.team === 'red') red++;
      else blue++;
    }
    return red <= blue ? 'red' : 'blue';
  }

  private removePlayer(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.projectiles = this.projectiles.filter((pr) => pr.owner !== p);
    this.fires = this.fires.filter((f) => f.owner !== p);
    this.broadcast({ type: 'sys', text: `${p.info.name} saiu da partida` });
    this.broadcastLobby();
    if (this.bombMode && this.phase === 'playing') {
      if (this.round.carrier === p) this.dropBomb(p);
      if (this.round.worker === p) this.stopWork();
      if (p.alive) this.dropWeapon(p);
      this.checkElimination();
    }
  }

  // ---------------------------------------------------------------- messaging

  private send(p: SPlayer, msg: HostMsg): void {
    p.slot?.conn.send(msg);
  }

  private broadcast(msg: HostMsg, exceptId = -1): void {
    for (const p of this.players.values()) if (p.info.id !== exceptId && p.slot) p.slot.conn.send(msg);
  }

  lobbyState(): LobbyState {
    return {
      phase: this.phase,
      config: { ...this.config },
      players: [...this.players.values()].map((p) => ({ ...p.info })),
      hostId: this.hostId,
      code: this.code,
      offline: this.offline,
    };
  }

  private broadcastLobby(): void {
    this.broadcast({ type: 'lobby', lobby: this.lobbyState() });
  }

  private roomInfo(): RoomInfo {
    return {
      code: this.code,
      host: this.players.get(this.hostId)?.info.name ?? 'Sala',
      map: this.config.map,
      mode: this.config.mode,
      arsenal: this.config.arsenal,
      players: this.humanCount(),
      phase: this.phase,
    };
  }

  private matchInfo(): MatchInfo {
    return { config: { ...this.config }, pickups: this.pickups.map((p) => p.active) };
  }

  private onClientMsg(p: SPlayer, m: ClientMsg): void {
    switch (m.type) {
      case 'input':
        this.onInput(p, m);
        break;
      case 'shoot':
        this.onShoot(p, m);
        break;
      case 'reload':
        this.onReload(p, m.w);
        break;
      case 'pong':
        if (p.slot && !p.slot.local) {
          const sample = clamp(now() - m.t, 0, 5000);
          p.slot.rtt = p.slot.rtt * 0.7 + sample * 0.3;
        }
        break;
      case 'chat':
        this.onChat(p, m.text, m.team);
        break;
      case 'setTeam':
        this.onSetTeam(p, m.team);
        break;
      case 'loadout':
        this.onLoadout(p, m);
        break;
      case 'buy':
        this.onBuy(p, m.item);
        break;
      case 'setColor':
        if (this.phase !== 'playing') {
          const used = [...this.players.values()].some((o) => o !== p && o.info.color === m.color);
          if (FFA_COLORS.includes(m.color) && !used) {
            p.info.color = m.color;
            this.broadcastLobby();
          }
        }
        break;
      case 'hello':
        break;
    }
  }

  private onSetTeam(p: SPlayer, team: Team): void {
    if (!teamMode(this.config.mode) || p.bot || p.info.team === team) return;
    const playing = this.phase === 'playing';
    if (playing && this.bombMode) return;
    if (playing) {
      const t = now();
      if (t < p.teamLockUntil) {
        this.send(p, { type: 'sys', text: 'Espere um pouco para trocar de time de novo.' });
        return;
      }
      p.teamLockUntil = t + TEAM_SWITCH_COOLDOWN_MS;
    }
    p.info.team = team;
    this.broadcastLobby();
    if (!playing) return;
    this.broadcast({ type: 'sys', text: `${p.info.name} foi para o time ${TEAM_NAMES[team]}` });
    // Alive players move to the new team's spawn right away, without a death. The dead just wait for the respawn.
    if (p.alive) this.spawnPlayer(p);
  }

  private onLoadout(p: SPlayer, m: LoadoutMsg): void {
    if (!validLoadout(m.w, this.config.grenades)) return;
    // Outside the spawn screen this is the inventory, which only exists with every weapon enabled.
    if (!p.picking && (this.phase !== 'playing' || this.config.arsenal !== 'all')) return;
    p.loadout = [...m.w];
    if (p.picking && m.go) p.respawnAt = now();
  }

  private onChat(p: SPlayer, raw: string, teamOnly: boolean): void {
    const text = sanitizeText(raw, CHAT_MAX);
    if (!text || !p.slot) return;
    const t = now();
    p.slot.chatTimes = p.slot.chatTimes.filter((x) => t - x < 5000);
    if (p.slot.chatTimes.length >= 5) {
      this.send(p, { type: 'sys', text: 'Calma! Você está enviando mensagens rápido demais.' });
      return;
    }
    p.slot.chatTimes.push(t);
    const team = teamOnly && teamMode(this.config.mode);
    for (const o of this.players.values()) {
      if (!o.slot) continue;
      if (team && o.info.team !== p.info.team) continue;
      o.slot.conn.send({ type: 'chat', from: p.info.id, text, team } satisfies HostMsg);
    }
  }

  // ---------------------------------------------------------------- host controls

  get isPlaying(): boolean {
    return this.phase === 'playing';
  }

  setConfig(patch: Partial<MatchConfig>): void {
    if (this.phase === 'playing' || this.offline) return;
    const c = { ...this.config, ...patch };
    if (c.mode !== 'ffa' && c.mode !== 'tdm' && c.mode !== 'bomb') c.mode = 'ffa';
    if (!(c.arsenal in ARSENAL_NAMES)) c.arsenal = 'all';
    if (!Object.hasOwn(MAP_NAMES, c.map)) c.map = 'arena';
    if (c.arsenal === 'gungame') c.mode = 'ffa';
    // The bomb mode brings its own weapons and maps, and they don't fit the other modes.
    if (c.mode === 'bomb') {
      c.arsenal = 'shop';
      if (!BOMB_MAPS.includes(c.map)) c.map = BOMB_MAPS[0];
      if (!ROUND_WINS.includes(c.rounds)) c.rounds = DEFAULT_CONFIG.rounds;
    } else {
      if (c.arsenal === 'shop') c.arsenal = 'all';
      if (BOMB_MAPS.includes(c.map)) c.map = 'arena';
    }
    if (!KILL_LIMITS.includes(c.killLimit)) c.killLimit = DEFAULT_CONFIG.killLimit;
    if (!TIME_LIMITS.includes(c.timeLimit)) c.timeLimit = DEFAULT_CONFIG.timeLimit;
    c.friendlyFire = !!c.friendlyFire;
    c.grenades = c.grenades !== false;
    this.config = c;
    this.broadcastLobby();
  }

  autoBalance(): void {
    if (this.phase === 'playing') return;
    const humans = [...this.players.values()].filter((p) => !p.bot).sort((a, b) => a.info.id - b.info.id);
    humans.forEach((p, i) => {
      p.info.team = i % 2 === 0 ? 'red' : 'blue';
    });
    this.broadcastLobby();
  }

  startMatch(): void {
    if (this.destroyed) return;
    this.phase = 'playing';
    this.teamScore = [0, 0];
    this.endsAt = this.config.timeLimit > 0 && !this.bombMode ? now() + this.config.timeLimit * 60000 : 0;
    this.map = MAPS[this.config.map];
    this.world = new CollisionWorld(this.map);
    this.pickups = this.map.pickups.map(() => ({ active: true, respawnAt: 0 }));
    this.projectiles = [];
    this.fires = [];
    for (const p of this.players.values()) {
      p.kills = 0;
      p.level = 0;
      p.deaths = 0;
      p.damage = 0;
      p.headshots = 0;
      p.shots = 0;
      p.hits = 0;
      p.headHits = 0;
      p.alive = false;
      p.y = -50;
    }
    this.broadcastLobby();
    this.broadcast({ type: 'start', match: this.matchInfo() });
    if (this.bombMode) {
      this.round = this.newRound();
      for (const p of this.players.values()) {
        p.money = ROUND.startMoney;
        this.clearGear(p);
      }
      this.startRound();
      this.sendScores();
      return;
    }
    // Spawn humans first (bots have fixed spots).
    const order = [...this.players.values()].sort(() => Math.random() - 0.5);
    for (const p of order) this.beginSpawn(p);
    this.sendScores();
  }

  backToLobby(): void {
    if (this.offline) return;
    this.phase = 'lobby';
    for (const p of this.players.values()) p.alive = false;
    this.broadcastLobby();
  }

  // ---------------------------------------------------------------- simulation

  private allowed(p: SPlayer): number[] {
    return allowedWeapons(this.config.arsenal, p.level, p.loadout, this.config.grenades);
  }

  private isEnemy(a: SPlayer, b: SPlayer): boolean {
    if (a === b) return false;
    if (this.config.mode === 'ffa') return true;
    return a.info.team !== b.info.team;
  }

  private chooseSpawn(p: SPlayer): SpawnDef {
    if (p.bot) {
      if (this.drillMode !== 'alvos') this.placeBot(p, p.bot, 10, 45);
      return { pos: [p.bot.ax, p.bot.y, p.bot.az], yaw: Math.atan2(p.bot.ax, p.bot.az) };
    }
    const side = p.info.team === this.round.attackers ? this.map.teamSpawns.red : this.map.teamSpawns.blue;
    const list = this.bombMode ? side : this.config.mode === 'tdm' ? this.map.teamSpawns[p.info.team] : this.map.ffaSpawns;
    const enemies = [...this.players.values()].filter((o) => o.alive && this.isEnemy(p, o));
    const others = [...this.players.values()].filter((o) => o.alive && o !== p);
    const scored = list.map((s) => {
      let minEnemy = enemies.length ? Infinity : 1000 + Math.random() * 100;
      for (const e of enemies) minEnemy = Math.min(minEnemy, Math.hypot(e.x - s.pos[0], e.z - s.pos[2]));
      const occupied = others.some((o) => Math.hypot(o.x - s.pos[0], o.z - s.pos[2]) < 1.6 && Math.abs(o.y - s.pos[1]) < 2);
      return { s, score: occupied ? -1 : minEnemy + Math.random() * 2 };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].s;
  }

  /** First spawn of a match: players choose weapons first when the mode lets them. */
  private beginSpawn(p: SPlayer): void {
    if (this.bombMode) {
      // Coming in mid-round means waiting for the next one.
      this.clearGear(p);
      if (this.frozen) this.spawnPlayer(p);
      this.sendKit(p);
      this.sendRound();
      this.sendDrops();
      return;
    }
    // Reflex targets wait out of sight until the drill brings them up.
    if (p.bot && this.drillMode === 'reflexo') {
      this.hideBot(p);
      return;
    }
    if (p.bot || this.config.arsenal !== 'all') {
      this.spawnPlayer(p);
      return;
    }
    p.loadout = [...DEFAULT_LOADOUT];
    p.picking = true;
    p.respawnAt = now() + LOADOUT_PICK_MS;
    this.send(p, { type: 'pick', ms: LOADOUT_PICK_MS });
  }

  private spawnPlayer(p: SPlayer): void {
    const t = now();
    p.picking = false;
    const s = this.chooseSpawn(p);
    p.x = s.pos[0];
    p.y = s.pos[1];
    p.z = s.pos[2];
    p.yaw = s.yaw;
    p.pitch = 0;
    p.crouch = p.bot?.crouch ?? false;
    p.hp = MAX_HP;
    p.alive = true;
    p.protectedUntil = this.bombMode ? 0 : t + SPAWN_PROTECT_MS;
    const ammo = fullAmmo();
    // Grenades are bought, and the ones not thrown stay for the next round.
    if (this.bombMode) WEAPONS.forEach((def, w) => isThrowable(def) && (ammo.mag[w] = p.mag[w]));
    p.mag = ammo.mag;
    p.reserve = ammo.reserve;
    p.reloadW = -1;
    p.equip = this.bombMode ? this.heldThrowables(p) : spawnEquipment(this.config.arsenal, p.loadout, this.config.grenades);
    p.weapon = this.allowed(p)[0];
    p.tp++;
    p.lastCt = -1;
    p.clockAhead = 0;
    p.ctOff = null;
    p.lastMoveT = t;
    p.history.clear();
    p.history.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch });
    p.lastHistT = t;
    this.send(p, { type: 'spawn', p: [p.x, p.y, p.z], yw: p.yaw, tp: p.tp, full: true, ld: p.loadout, eq: p.equip });
    this.sendAmmo(p);
    if (this.bombMode) this.sendKit(p);
  }

  private sendAmmo(p: SPlayer): void {
    this.send(p, { type: 'ammo', mag: [...p.mag], res: [...p.reserve], ack: p.lastShotSeq });
  }

  private correct(p: SPlayer): void {
    p.tp++;
    p.lastCt = -1;
    this.send(p, { type: 'spawn', p: [r2(p.x), r2(p.y), r2(p.z)], yw: p.yaw, tp: p.tp, full: false });
  }

  private onInput(p: SPlayer, m: InputMsg): void {
    if (m.tp !== p.tp) return;
    p.yaw = m.yw;
    p.pitch = clamp(m.pt, -1.6, 1.6);
    p.ads = m.a;
    if (m.u && !p.using && !p.bot) this.drill.pressed = true;
    p.using = m.u;
    if (m.w !== p.weapon && this.allowed(p).includes(m.w)) {
      p.weapon = m.w;
      p.reloadW = -1;
    }
    if (!p.alive || this.phase !== 'playing' || this.frozen) return;

    // Movement is validated against the client's own simulation clock, so network
    // jitter (inputs arriving in bursts) never looks like speed hacking. A separate
    // check makes sure that clock doesn't run faster than real time.
    const t = now();
    const realDt = t - p.lastMoveT;
    p.lastMoveT = t;
    let dct: number;
    if (p.lastCt < 0) {
      dct = 1000 / 30;
    } else {
      dct = m.ct - p.lastCt;
      if (dct <= 0) return; // duplicate/out of order
      dct = Math.min(dct, 1000);
      p.clockAhead = Math.max(-1000, p.clockAhead + dct - realDt);
    }
    p.lastCt = m.ct;
    const [nx, ny, nz] = m.p;
    const horiz = Math.hypot(nx - p.x, nz - p.z);
    const up = Math.max(0, ny - p.y);
    const h = m.c ? PLAYER.crouchHeight : PLAYER.height;
    const half = this.map.size / 2;
    // Not per weapon: speed carries over for a moment after switching away from the knife.
    const maxHoriz = (MOVE.knifeSprint * MOVE.sprintJump * 1.25 * dct) / 1000 + 0.3;
    const maxUp = (9 * dct) / 1000 + 0.35;
    const invalid =
      p.clockAhead > 1500 ||
      horiz > maxHoriz ||
      up > maxUp ||
      Math.abs(nx) > half ||
      Math.abs(nz) > half ||
      ny < -2 ||
      ny > 20 ||
      this.world.overlapsSolid(nx, ny + 0.05, nz, h - 0.1, PLAYER.radius * 0.7);
    if (invalid) {
      p.clockAhead = 0;
      this.correct(p);
      return;
    }
    p.x = nx;
    p.y = ny;
    p.z = nz;
    p.crouch = m.c;
    p.onGround = m.g;
    // Timestamp the sample with when it actually happened on the client (mapped to host
    // time via the least-delayed input), not when it arrived. Bursty arrival no longer
    // distorts the motion others see or the lag-compensation history.
    const off = t - m.ct;
    p.ctOff = p.ctOff === null ? off : Math.min(p.ctOff + realDt * 0.01, off);
    const sampleT = Math.max(p.lastHistT + 1, Math.min(t, m.ct + p.ctOff));
    p.lastHistT = sampleT;
    p.history.push({ t: sampleT, x: nx, y: ny, z: nz, yaw: m.yw, crouch: m.c });
    this.checkPickups(p);
  }

  private checkPickups(p: SPlayer): void {
    this.map.pickups.forEach((def, i) => {
      const st = this.pickups[i];
      if (!st.active) return;
      if (Math.abs(p.x - def.pos[0]) > 1.1 || Math.abs(p.z - def.pos[2]) > 1.1 || Math.abs(p.y - def.pos[1]) > 1.2) return;
      if (!this.refillEquipped(p)) return;
      st.active = false;
      st.respawnAt = now() + PICKUP_RESPAWN_MS;
      // Before the ammo update: the client cancels a running reload on this message.
      this.broadcast({ type: 'pickup', idx: i, on: false, by: p.info.id });
      this.sendAmmo(p);
    });
  }

  /** Fills the magazine and reserve of the weapon in hand. Returns false when there was nothing to fill. */
  private refillEquipped(p: SPlayer): boolean {
    const w = p.weapon;
    const def = WEAPONS[w];
    if (def.melee || (p.mag[w] >= def.mag && (def.infiniteReserve || p.reserve[w] >= def.reserve))) return false;
    p.mag[w] = def.mag;
    if (!def.infiniteReserve) p.reserve[w] = Math.max(p.reserve[w], def.reserve);
    if (p.reloadW === w) p.reloadW = -1;
    return true;
  }

  private onReload(p: SPlayer, w: number): void {
    if (!p.alive) return;
    const def = WEAPONS[w];
    if (def.melee || !this.allowed(p).includes(w)) return;
    if (p.reloadW === w || p.mag[w] >= def.mag) return;
    if (!def.infiniteReserve && p.reserve[w] <= 0) return;
    p.weapon = w;
    p.reloadW = w;
    // Small tolerance so the client's first shot after its local reload isn't rejected.
    p.reloadUntil = now() + def.reloadTime * 1000 - 250;
  }

  private finishReload(p: SPlayer): void {
    const w = p.reloadW;
    if (w < 0) return;
    const def = WEAPONS[w];
    const need = def.mag - p.mag[w];
    const take = def.infiniteReserve ? need : Math.min(need, p.reserve[w]);
    p.mag[w] += take;
    if (!def.infiniteReserve) p.reserve[w] -= take;
    // Practice never runs out.
    if (this.offline) p.reserve[w] = Math.max(p.reserve[w], def.reserve);
    p.reloadW = -1;
    this.sendAmmo(p);
  }

  private onShoot(p: SPlayer, m: ShootMsg): void {
    if (this.phase !== 'playing' || !p.alive) return;
    const t = now();
    const w = m.w;
    const def = WEAPONS[w];
    const reject = (): void => {
      p.lastShotSeq = Math.max(p.lastShotSeq, m.s);
      this.sendAmmo(p);
    };
    if (this.frozen) return reject();
    const eye = p.y + eyeHeight(p.crouch);
    if (Math.hypot(m.o[0] - p.x, m.o[1] - eye, m.o[2] - p.z) > 3) return reject();
    // Thrown with the gun still in hand. What limits it is the count, not a fire rate.
    if (p.equip.includes(w)) {
      if (p.mag[w] <= 0) return reject();
      p.mag[w]--;
      p.lastShotSeq = m.s;
      p.protectedUntil = 0;
      p.reloadW = -1;
      this.launch(p, w, m);
      return;
    }
    if (!this.allowed(p).includes(w)) return reject();
    if (w !== p.weapon) {
      p.weapon = w;
      if (p.reloadW !== w) p.reloadW = -1;
    }
    if (p.reloadW === w) {
      if (t >= p.reloadUntil - 350) this.finishReload(p);
      else return reject();
    }
    if (!def.melee && p.mag[w] <= 0) return reject();

    // Fire-rate token bucket (tolerates network jitter, caps sustained rate).
    p.credits = Math.min(2, p.credits + (t - p.creditT) / (def.interval * 0.92));
    p.creditT = t;
    if (p.credits < 1) return reject();
    p.credits -= 1;

    const pellets = m.d.length / 3;
    if (pellets > def.pellets) return reject();

    if (!def.melee) p.mag[w]--;
    p.lastShotSeq = m.s;
    p.protectedUntil = 0;

    if (def.projectile) {
      this.launch(p, w, m);
      return;
    }

    const rtt = p.slot?.rtt ?? 0;
    // Clients see positions sampled SNAP_SAMPLE_DELAY in the past (see tick()).
    const minT = t - Math.min(HISTORY_MS, rtt + MAX_INTERP_DELAY + SNAP_SAMPLE_DELAY + 200);
    const rewindT = clamp(m.rt - SNAP_SAMPLE_DELAY, minT, t);

    const targets: Array<{ pl: SPlayer; pos: { x: number; y: number; z: number; yaw: number; crouch: boolean } }> = [];
    for (const o of this.players.values()) {
      if (o === p || !o.alive) continue;
      if (!this.isEnemy(p, o) && !this.config.friendlyFire) continue;
      const pos = o.history.at(rewindT) ?? { x: o.x, y: o.y, z: o.z, yaw: o.yaw, crouch: o.crouch };
      targets.push({ pl: o, pos });
    }

    const [ox, oy, oz] = m.o;
    const e: number[] = [];
    const hk: number[] = [];
    const n: number[] = [];
    const dmgMap: DamageMap = new Map();
    for (let i = 0; i < pellets; i++) {
      let dx = m.d[i * 3];
      let dy = m.d[i * 3 + 1];
      let dz = m.d[i * 3 + 2];
      const len = Math.hypot(dx, dy, dz);
      if (len < 0.5 || len > 1.5) continue;
      dx /= len;
      dy /= len;
      dz /= len;
      const wh = this.world.raycast(ox, oy, oz, dx, dy, dz, def.range);
      let maxT = wh ? wh.dist : def.range;
      let best: { pl: SPlayer; head: boolean } | null = null;
      for (const tg of targets) {
        const hit = rayPlayer(ox, oy, oz, dx, dy, dz, tg.pos, maxT);
        if (hit && hit.dist < maxT) {
          maxT = hit.dist;
          best = { pl: tg.pl, head: hit.head };
        }
      }
      e.push(r2(ox + dx * maxT), r2(oy + dy * maxT), r2(oz + dz * maxT));
      if (best) {
        hk.push(2);
        n.push(0, 0, 0);
        const acc = dmgMap.get(best.pl) ?? { dmg: 0, hs: false };
        acc.dmg += this.bulletDamage(def, maxT, best.head, best.pl);
        acc.hs ||= best.head;
        dmgMap.set(best.pl, acc);
      } else if (wh) {
        hk.push(1);
        n.push(r3(wh.nx), r3(wh.ny), r3(wh.nz));
      } else {
        hk.push(0);
        n.push(0, 0, 0);
      }
    }
    this.broadcast({ type: 'shot', i: p.info.id, w, o: [r2(ox), r2(oy), r2(oz)], e, h: hk, n }, p.info.id);

    // Accuracy for the profile: guns only, one count per trigger pull whatever the pellets.
    if (!def.melee) {
      p.shots++;
      if (dmgMap.size > 0) p.hits++;
      if ([...dmgMap.values()].some((d) => d.hs)) p.headHits++;
    }
    this.dealDamage(p, dmgMap, w);
  }

  /** `src` is where the indicator on the victim's screen points to; by default, the attacker. */
  private dealDamage(p: SPlayer, dmgMap: DamageMap, w: number, src?: [number, number, number]): void {
    const t = now();
    for (const [target, { dmg, hs }] of dmgMap) {
      if (!target.alive || t < target.protectedUntil) continue;
      const amount = Math.round(dmg);
      if (amount <= 0) continue;
      const dealt = Math.min(amount, target.hp);
      target.hp -= amount;
      target.lastHurtAt = t;
      if (target !== p) p.damage += dealt;
      this.send(target, { type: 'dmg', from: p.info.id, src: src ?? [r2(p.x), r2(p.y + 1.4), r2(p.z)], amt: amount });
      const killed = target.hp <= 0;
      if (killed) this.kill(p, target, w, hs);
      if (target !== p) this.send(p, { type: 'hit', dmg: amount, hs, kill: killed, p: this.overHead(target) });
      if (this.bombMode) this.sendKit(target);
    }
  }

  /** In the bomb mode armor takes its share, and wears down doing it. */
  private bulletDamage(def: (typeof WEAPONS)[number], dist: number, head: boolean, target: SPlayer): number {
    if (!this.bombMode) return damageAt(def, dist, head);
    const hit = gunHit(def, dist, head, target.armor, target.helmet);
    target.armor = Math.max(0, target.armor - hit.armor);
    return hit.hp;
  }

  private overHead(p: SPlayer): [number, number, number] {
    return [r2(p.x), r2(p.y + (p.crouch ? HITBOX.crouchHeadTop : HITBOX.standHeadTop)), r2(p.z)];
  }

  private announceProjectile(pr: Projectile, bounced: boolean): void {
    const m: HostMsg = { type: 'proj', id: pr.id, i: pr.owner.info.id, w: pr.w, o: [r2(pr.x), r2(pr.y), r2(pr.z)], v: [r2(pr.vx), r2(pr.vy), r2(pr.vz)] };
    this.broadcast(bounced ? { ...m, b: true } : m);
  }

  private launch(p: SPlayer, w: number, m: ShootMsg): void {
    const speed = WEAPONS[w].projectile?.speed ?? 0;
    const [dx, dy, dz] = m.d;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.5 || len > 1.5) return;
    const t = now();
    const pr: Projectile = {
      id: this.nextProjectile++,
      owner: p,
      w,
      x: m.o[0],
      y: m.o[1],
      z: m.o[2],
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      vz: (dz / len) * speed,
      bornAt: t,
      lastT: t,
    };
    this.projectiles.push(pr);
    this.announceProjectile(pr, false);
  }

  /** Moves projectiles along their arc, checking the path they cover this tick. */
  private updateProjectiles(t: number): void {
    this.projectiles = this.projectiles.filter((pr) => {
      const def = WEAPONS[pr.w];
      const dt = Math.min(0.1, (t - pr.lastT) / 1000);
      pr.lastT = t;
      const fuse = def.projectile?.fuse;
      if (fuse !== undefined) {
        if (t - pr.bornAt >= fuse * 1000) {
          this.projectileHit(pr, null, [0, 1, 0]);
          return false;
        }
        if (this.world.stepThrown(pr, def.projectile?.gravity ?? 0, dt)) this.announceProjectile(pr, true);
        return true;
      }
      pr.vy -= (def.projectile?.gravity ?? 0) * dt;
      const sx = pr.vx * dt;
      const sy = pr.vy * dt;
      const sz = pr.vz * dt;
      const len = Math.hypot(sx, sy, sz);
      if (len < 1e-6) return true;
      const [dx, dy, dz] = [sx / len, sy / len, sz / len];
      const wh = this.world.raycast(pr.x, pr.y, pr.z, dx, dy, dz, len);
      let dist = wh ? wh.dist : len;
      let hit: { pl: SPlayer; head: boolean } | null = null;
      for (const o of this.players.values()) {
        if (o === pr.owner || !o.alive) continue;
        if (!this.isEnemy(pr.owner, o) && !this.config.friendlyFire) continue;
        const h = rayPlayer(pr.x, pr.y, pr.z, dx, dy, dz, o, dist);
        if (h && h.dist < dist) {
          dist = h.dist;
          hit = { pl: o, head: h.head };
        }
      }
      pr.x += dx * dist;
      pr.y += dy * dist;
      pr.z += dz * dist;
      if (hit || wh) {
        this.projectileHit(pr, hit, wh ? [wh.nx, wh.ny, wh.nz] : [0, 0, 0]);
        return false;
      }
      if (t - pr.bornAt > PROJECTILE_MAX_MS) {
        this.broadcast({ type: 'pimp', id: pr.id, w: pr.w, p: [r2(pr.x), r2(pr.y), r2(pr.z)], h: 0, n: [0, 0, 0] });
        return false;
      }
      return true;
    });
  }

  private projectileHit(pr: Projectile, hit: { pl: SPlayer; head: boolean } | null, n: [number, number, number]): void {
    const def = WEAPONS[pr.w];
    if (def.fire) this.ignite(pr, n, def.fire.ms);
    this.broadcast({ type: 'pimp', id: pr.id, w: pr.w, p: [r2(pr.x), r2(pr.y), r2(pr.z)], h: hit ? 2 : 1, n: [r3(n[0]), r3(n[1]), r3(n[2])] });
    const cy = pr.y + n[1] * 0.2;
    const cx = pr.x + n[0] * 0.2;
    const cz = pr.z + n[2] * 0.2;
    if (def.stun) this.stunBlast(pr, cx, cy, cz, def.stun.radius);
    const dmgMap: DamageMap = new Map();
    if (def.splash) {
      const scale = this.bombMode ? (SHOP[pr.w]?.damage ?? def.damage) / def.damage : 1;
      for (const { pl, d } of this.blastHits(pr.owner, pr.w, cx, cy, cz, def.splash.radius)) dmgMap.set(pl, { dmg: blastDamage(def, d) * scale, hs: false });
    } else if (hit) {
      dmgMap.set(hit.pl, { dmg: this.bulletDamage(def, 0, hit.head, hit.pl), hs: hit.head });
    }
    this.dealDamage(pr.owner, dmgMap, pr.w, def.splash ? [r2(cx), r2(cy), r2(cz)] : undefined);
  }

  /** Who a blast reaches: walls block it, and thrown equipment catches its thrower too. The launcher never hurts the shooter. */
  private blastHits(owner: SPlayer, w: number, x: number, y: number, z: number, radius: number): Array<{ pl: SPlayer; d: number }> {
    const thrown = isThrowable(WEAPONS[w]);
    const out: Array<{ pl: SPlayer; d: number }> = [];
    for (const o of this.players.values()) {
      if (!o.alive) continue;
      if (o === owner ? !thrown : !this.isEnemy(owner, o) && !this.config.friendlyFire) continue;
      const d = Math.hypot(o.x - x, o.y + 1 - y, o.z - z);
      if (d <= radius && this.world.lineOfSight(x, y, z, o.x, o.y + 1, o.z)) out.push({ pl: o, d });
    }
    return out;
  }

  private stunBlast(pr: Projectile, x: number, y: number, z: number, radius: number): void {
    const t = now();
    for (const { pl, d } of this.blastHits(pr.owner, pr.w, x, y, z, radius)) {
      if (t < pl.protectedUntil) continue;
      const dy = y - (pl.y + eyeHeight(pl.crouch));
      const len = Math.max(0.01, Math.hypot(x - pl.x, dy, z - pl.z));
      const flat = Math.cos(pl.pitch);
      const facing = (-Math.sin(pl.yaw) * flat * (x - pl.x) + Math.sin(pl.pitch) * dy - Math.cos(pl.yaw) * flat * (z - pl.z)) / len;
      this.send(pl, { type: 'stun', w: pr.w, ms: Math.round(stunMs(WEAPONS[pr.w], d, facing)) });
      if (pl !== pr.owner) this.send(pr.owner, { type: 'hit', dmg: 0, hs: false, kill: false, p: this.overHead(pl) });
    }
  }

  /** The fire settles on the ground under where the bottle broke, so a throw at a wall burns at its foot. */
  private ignite(pr: Projectile, n: [number, number, number], ms: number): void {
    pr.x += n[0] * 0.3;
    pr.z += n[2] * 0.3;
    const y = this.world.groundHeight(pr.x, pr.z, pr.y + 0.6, 40);
    if (y === -Infinity) return;
    pr.y = y;
    const t = now();
    this.fires.push({ owner: pr.owner, w: pr.w, x: pr.x, y, z: pr.z, until: t + ms, nextAt: t });
  }

  private updateFires(t: number): void {
    this.fires = this.fires.filter((f) => {
      if (t >= f.until) return false;
      if (t < f.nextAt) return true;
      f.nextAt = t + FIRE_TICK_MS;
      const fire = WEAPONS[f.w].fire;
      if (!fire) return false;
      const dmgMap: DamageMap = new Map();
      for (const { pl } of this.blastHits(f.owner, f.w, f.x, f.y + 1, f.z, fire.radius)) {
        dmgMap.set(pl, { dmg: (fire.dps * FIRE_TICK_MS) / 1000, hs: false });
      }
      this.dealDamage(f.owner, dmgMap, f.w, [r2(f.x), r2(f.y + 1), r2(f.z)]);
      return true;
    });
  }

  private kill(killer: SPlayer, victim: SPlayer, w: number, hs: boolean): void {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.reloadW = -1;
    victim.respawnAt = this.bombMode ? 0 : now() + RESPAWN_MS;
    if (victim.bot && this.drillMode !== 'alvos') this.botKilled(victim, victim.bot);
    const suicide = killer === victim;
    const teamKill = teamMode(this.config.mode) && killer.info.team === victim.info.team;
    // In the bomb mode kills pay money, and it's rounds that score.
    const point = this.bombMode ? 0 : 1;
    if (suicide) {
      // Only the death counts.
    } else if (teamKill) {
      killer.kills--;
      this.teamScore[scoreIndex(killer.info.team)] -= point;
    } else {
      killer.kills++;
      if (hs) killer.headshots++;
      if (this.config.arsenal === 'gungame') this.gunGameKill(killer, victim, w);
      this.teamScore[scoreIndex(killer.info.team)] += point;
      // Deathmatch and practice: a kill gives full health and a full weapon. The bomb mode has its economy instead.
      if (!this.bombMode && killer.alive && !killer.bot) {
        killer.hp = MAX_HP;
        if (this.refillEquipped(killer)) this.sendAmmo(killer);
      }
    }
    if (this.bombMode) {
      if (teamKill && !suicide) this.pay(killer, -ROUND.teamKillFine);
      else if (!suicide) this.pay(killer, SHOP[w]?.reward ?? 0);
      this.dropWeapon(victim);
      this.clearGear(victim);
      this.sendKit(victim);
      if (this.round.carrier === victim) this.dropBomb(victim);
      if (this.round.worker === victim) this.stopWork();
    }
    this.broadcast({ type: 'kill', k: killer.info.id, v: victim.info.id, w, hs });
    this.sendScores();
    if (this.bombMode) this.checkElimination();
    else this.checkWin();
  }

  // ---------------------------------------------------------------- bomb mode

  private newRound(): Round {
    return {
      n: 0,
      phase: 'freeze',
      endsAt: 0,
      buyEndsAt: 0,
      attackers: 'red',
      lossStreak: { red: 0, blue: 0 },
      carrier: null,
      spot: null,
      planted: false,
      planter: null,
      explodeAt: 0,
      worker: null,
      workX: 0,
      workZ: 0,
      workEndsAt: 0,
      winner: null,
      why: null,
    };
  }

  private heldThrowables(p: SPlayer): number[] {
    return WEAPONS.filter((def) => isThrowable(def) && p.mag[def.id] > 0).map((def) => def.id);
  }

  /** Dying, and the swap at the half, take everything but the money. */
  private clearGear(p: SPlayer): void {
    p.loadout = [W.PISTOL];
    p.armor = 0;
    p.helmet = false;
    p.defuseKit = false;
    p.equip = [];
    WEAPONS.forEach((def, w) => isThrowable(def) && (p.mag[w] = 0));
  }

  private pay(p: SPlayer, amount: number): void {
    p.money = clamp(p.money + amount, 0, ROUND.maxMoney);
    this.sendKit(p);
  }

  private sendKit(p: SPlayer): void {
    this.send(p, { type: 'kit', money: p.money, ld: [...p.loadout], eq: this.heldThrowables(p), armor: Math.round(p.armor), helmet: p.helmet, defuseKit: p.defuseKit });
  }

  private sendRound(): void {
    const r = this.round;
    const t = now();
    this.broadcast({
      type: 'round',
      n: r.n,
      phase: r.phase,
      left: Math.max(0, Math.round((r.planted && r.phase === 'live' ? r.explodeAt : r.endsAt) - t)),
      buy: Math.max(0, Math.round(r.buyEndsAt - t)),
      atk: r.attackers,
      by: r.carrier?.info.id ?? -1,
      spot: r.spot,
      planted: r.planted,
      act: r.worker?.info.id ?? -1,
      actLeft: r.worker ? Math.max(0, Math.round(r.workEndsAt - t)) : 0,
      win: r.winner,
      why: r.why,
    });
  }

  private startRound(): void {
    const r = this.round;
    const t = now();
    r.n++;
    r.phase = 'freeze';
    r.endsAt = t + ROUND.freezeMs;
    r.buyEndsAt = r.endsAt + ROUND.buyMs;
    r.spot = null;
    r.planted = false;
    r.planter = null;
    r.worker = null;
    r.winner = null;
    r.why = null;
    this.projectiles = [];
    this.fires = [];
    this.drops = [];
    this.sendDrops();
    const players = [...this.players.values()];
    for (const p of players) p.alive = false;
    for (const p of players) this.spawnPlayer(p);
    const attackers = players.filter((p) => p.info.team === r.attackers && !p.bot);
    r.carrier = attackers[Math.floor(Math.random() * attackers.length)] ?? null;
    this.sendRound();
  }

  private sideCount(team: Team): { all: number; alive: number } {
    const side = [...this.players.values()].filter((p) => p.info.team === team);
    return { all: side.length, alive: side.filter((p) => p.alive).length };
  }

  /** A side that never had anyone can't lose this way, so one person can walk through a round. */
  private checkElimination(): void {
    const r = this.round;
    if (r.phase !== 'live') return;
    const defenders = otherTeam(r.attackers);
    const def = this.sideCount(defenders);
    const atk = this.sideCount(r.attackers);
    if (def.all > 0 && def.alive === 0) this.endRound(r.attackers, 'elimination');
    else if (atk.all > 0 && atk.alive === 0 && !r.planted) this.endRound(defenders, 'elimination');
  }

  private endRound(winner: Team, why: RoundEnd): void {
    const r = this.round;
    if (r.phase === 'over') return;
    r.phase = 'over';
    r.endsAt = now() + ROUND.overMs;
    r.winner = winner;
    r.why = why;
    r.worker = null;
    this.teamScore[scoreIndex(winner)]++;
    const loser = otherTeam(winner);
    r.lossStreak[loser] = Math.min(ROUND.lossSteps, r.lossStreak[loser] + 1);
    r.lossStreak[winner] = Math.max(0, r.lossStreak[winner] - 1);
    const win = why === 'exploded' || why === 'defused' ? ROUND.winObjective : ROUND.winElimination;
    const loss = lossBonus(r.lossStreak[loser]) + (loser === r.attackers && r.planted ? ROUND.plantedLossBonus : 0);
    for (const p of this.players.values()) {
      if (p.info.team === winner) this.pay(p, win);
      // Attackers who sit out the clock alive don't get paid for it.
      else if (!(why === 'time' && p.alive)) this.pay(p, loss);
    }
    this.sendScores();
    this.sendRound();
  }

  private nextRound(): void {
    const r = this.round;
    const need = this.config.rounds;
    if (this.teamScore[0] >= need || this.teamScore[1] >= need) return this.endMatch('kills');
    // Practice has no one to swap with.
    if (!this.offline) {
      if (r.n >= (need - 1) * 2) return this.endMatch('kills');
      if (r.n === need - 1) this.swapSides();
    }
    this.startRound();
  }

  private swapSides(): void {
    const r = this.round;
    r.attackers = otherTeam(r.attackers);
    r.lossStreak = { red: 0, blue: 0 };
    for (const p of this.players.values()) {
      p.money = ROUND.startMoney;
      this.clearGear(p);
    }
    this.broadcast({ type: 'sys', text: 'Metade da partida: os times trocam de lado, e o dinheiro volta ao início.' });
  }

  private sendDrops(): void {
    this.broadcast({ type: 'drops', list: this.drops.map((d) => ({ id: d.id, w: d.w, p: [r2(d.x), r2(d.y), r2(d.z)] })) });
  }

  /** Puts a weapon down where the player stands. */
  private leaveWeapon(p: SPlayer, w: number): void {
    const ground = this.world.groundHeight(p.x, p.z, p.y + 0.1, 40);
    this.drops.push({ id: this.nextDrop++, w, x: p.x, y: ground > -Infinity ? ground : p.y, z: p.z, mag: p.mag[w], reserve: p.reserve[w] });
  }

  /** Dying leaves the best weapon behind: the primary, or the pistol for someone without one. */
  private dropWeapon(p: SPlayer): void {
    this.leaveWeapon(p, p.loadout[0]);
    this.sendDrops();
  }

  /** Whether the use key is busy with the bomb. The bomb always comes first. */
  private usingForBomb(p: SPlayer): boolean {
    const r = this.round;
    const site = this.map.bomb;
    if (r.carrier === p) return site !== undefined && siteAt(site, p.x, p.z) !== undefined;
    return r.planted && p.info.team !== r.attackers && this.inDefuseReach(p);
  }

  private takeDrop(p: SPlayer, d: Drop): void {
    const primary = WEAPONS[d.w].category === 'primary';
    const empty = primary && p.loadout.length < 2;
    const slot = primary ? 0 : p.loadout.length - 1;
    this.drops = this.drops.filter((o) => o !== d);
    if (empty) {
      p.loadout = [d.w, ...p.loadout];
    } else {
      const old = p.loadout[slot];
      this.leaveWeapon(p, old);
      if (p.reloadW === old) p.reloadW = -1;
      p.loadout = p.loadout.map((w, i) => (i === slot ? d.w : w));
    }
    p.mag[d.w] = d.mag;
    p.reserve[d.w] = d.reserve;
    this.sendAmmo(p);
    this.sendKit(p);
    this.sendDrops();
  }

  /** Walking over a primary takes it if the slot is free. Anything else takes a press of the use key, and swaps. */
  private updateDrops(): void {
    for (const p of this.players.values()) {
      const pressed = p.using && !p.wasUsing;
      p.wasUsing = p.using;
      if (!p.alive || p.bot) continue;
      const near = this.drops.filter((d) => Math.hypot(d.x - p.x, d.z - p.z) <= ROUND.dropReach && Math.abs(d.y - p.y) < 2 && !p.loadout.includes(d.w));
      const free = near.find((d) => WEAPONS[d.w].category === 'primary' && p.loadout.length < 2);
      if (free) this.takeDrop(p, free);
      else if (pressed && near.length > 0 && !this.usingForBomb(p)) this.takeDrop(p, near[0]);
    }
  }

  private dropBomb(from: SPlayer): void {
    const r = this.round;
    r.carrier = null;
    const ground = this.world.groundHeight(from.x, from.z, from.y + 0.1, 40);
    r.spot = [r2(from.x), r2(ground > -Infinity ? ground : from.y), r2(from.z)];
    this.sendRound();
  }

  private stopWork(): void {
    this.round.worker = null;
    this.sendRound();
  }

  private startWork(p: SPlayer, ms: number, t: number): void {
    const r = this.round;
    r.worker = p;
    r.workX = p.x;
    r.workZ = p.z;
    r.workEndsAt = t + ms;
    this.sendRound();
  }

  private updateRound(t: number): void {
    const r = this.round;
    if (r.phase !== 'freeze') this.updateDrops();
    if (r.phase === 'freeze') {
      if (t < r.endsAt) return;
      r.phase = 'live';
      r.endsAt = t + ROUND.roundMs;
      this.sendRound();
      this.checkElimination();
    } else if (r.phase === 'over') {
      if (t >= r.endsAt) this.nextRound();
    } else if (r.planted) {
      if (t >= r.explodeAt) this.explode();
      else this.updateDefuse(t);
    } else if (t >= r.endsAt) {
      this.endRound(otherTeam(r.attackers), 'time');
    } else {
      this.updatePickup();
      this.updatePlant(t);
    }
  }

  private updatePickup(): void {
    const r = this.round;
    const spot = r.spot;
    if (!spot || r.carrier) return;
    for (const p of this.players.values()) {
      if (!p.alive || p.bot || p.info.team !== r.attackers) continue;
      if (Math.hypot(p.x - spot[0], p.z - spot[2]) > ROUND.pickupReach || Math.abs(p.y - spot[1]) > 2) continue;
      r.carrier = p;
      r.spot = null;
      this.sendRound();
      return;
    }
  }

  private updatePlant(t: number): void {
    const r = this.round;
    const c = r.carrier;
    const site = this.map.bomb;
    const able = c !== null && c.alive && c.using && c.onGround && site !== undefined && siteAt(site, c.x, c.z) !== undefined;
    if (!able || !c) {
      if (r.worker) this.stopWork();
      return;
    }
    if (r.worker !== c) return this.startWork(c, ROUND.plantMs, t);
    if (Math.hypot(c.x - r.workX, c.z - r.workZ) > 0.5) return this.stopWork();
    if (t < r.workEndsAt) return;
    r.planted = true;
    r.planter = c;
    r.spot = [r2(c.x), r2(c.y), r2(c.z)];
    r.carrier = null;
    r.worker = null;
    r.explodeAt = t + ROUND.bombMs;
    this.pay(c, ROUND.objectiveBonus);
    this.sendRound();
  }

  private inDefuseReach(p: SPlayer): boolean {
    const spot = this.round.spot;
    return !!spot && p.alive && p.using && Math.hypot(p.x - spot[0], p.z - spot[2]) <= ROUND.defuseReach && Math.abs(p.y - spot[1]) < 2;
  }

  private updateDefuse(t: number): void {
    const r = this.round;
    if (r.worker) {
      if (!this.inDefuseReach(r.worker)) return this.stopWork();
      if (t < r.workEndsAt) return;
      this.pay(r.worker, ROUND.objectiveBonus);
      this.endRound(otherTeam(r.attackers), 'defused');
      return;
    }
    for (const p of this.players.values()) {
      if (p.info.team === r.attackers || !this.inDefuseReach(p)) continue;
      this.startWork(p, p.defuseKit ? ROUND.defuseKitMs : ROUND.defuseMs, t);
      return;
    }
  }

  private explode(): void {
    const r = this.round;
    const spot = r.spot;
    const planter = r.planter;
    this.endRound(r.attackers, 'exploded');
    if (!spot || !planter) return;
    const dmgMap: DamageMap = new Map();
    for (const p of this.players.values()) {
      const d = Math.hypot(p.x - spot[0], p.y + 1 - spot[1], p.z - spot[2]);
      if (p.alive && d < ROUND.blastRadius) dmgMap.set(p, { dmg: ROUND.blastDamage * (1 - d / ROUND.blastRadius), hs: false });
    }
    this.dealDamage(planter, dmgMap, W.BOMB, spot);
  }

  private onBuy(p: SPlayer, item: number): void {
    const r = this.round;
    const zone = this.map.bomb?.buy[p.info.team === r.attackers ? 'attack' : 'defend'];
    if (!this.bombMode || this.phase !== 'playing' || !p.alive || !zone || !inRect(zone, p.x, p.z) || now() >= r.buyEndsAt) return;
    const price = SHOP[item]?.price;
    if (!price || price > p.money || !this.give(p, item)) return;
    p.money -= price;
    this.sendAmmo(p);
    this.sendKit(p);
  }

  /** Returns false when the player can't take it. */
  private give(p: SPlayer, item: number): boolean {
    if (item === ITEM.KEVLAR) {
      if (p.armor >= 100) return false;
      p.armor = 100;
      return true;
    }
    if (item === ITEM.HELMET) {
      if (p.helmet || p.armor <= 0) return false;
      p.helmet = true;
      return true;
    }
    if (item === ITEM.KIT) {
      if (p.defuseKit || p.info.team === this.round.attackers) return false;
      p.defuseKit = true;
      return true;
    }
    if (!isWeaponItem(item)) return false;
    const def = WEAPONS[item];
    if (isThrowable(def)) {
      const carried = p.equip.reduce((sum, w) => sum + p.mag[w], 0);
      if (p.mag[item] >= (SHOP[item]?.max ?? 0) || carried >= MAX_THROWN) return false;
      p.mag[item]++;
      p.equip = this.heldThrowables(p);
      return true;
    }
    if (p.loadout.includes(item)) return false;
    const pistol = p.loadout[p.loadout.length - 1];
    if (def.category === 'primary') p.loadout = [item, pistol];
    else if (def.category === 'pistol') p.loadout = [...p.loadout.slice(0, -1), item];
    else return false;
    p.mag[item] = def.mag;
    p.reserve[item] = def.reserve;
    return true;
  }

  /** Only the weapon of the current level moves a player up. The knife sends the victim back one instead. */
  private gunGameKill(killer: SPlayer, victim: SPlayer, w: number): void {
    const ladder = gunGameLadder(this.config.grenades);
    if (w === ladder[killer.level]) {
      killer.level++;
      if (killer.level === ladder.length - 1) this.broadcast({ type: 'sys', text: `${killer.info.name} chegou na faca!` });
    } else if (w === W.KNIFE) {
      victim.level = Math.max(0, victim.level - 1);
    }
  }

  private checkWin(): void {
    if (this.phase !== 'playing') return;
    if (this.config.arsenal === 'gungame') {
      if ([...this.players.values()].some((p) => !p.bot && p.level >= gunGameLadder(this.config.grenades).length)) this.endMatch('kills');
      return;
    }
    const lim = this.config.killLimit;
    if (lim <= 0) return;
    if (this.config.mode === 'ffa') {
      if ([...this.players.values()].some((p) => !p.bot && p.kills >= lim)) this.endMatch('kills');
    } else if (this.teamScore[0] >= lim || this.teamScore[1] >= lim) {
      this.endMatch('kills');
    }
  }

  private endMatch(reason: 'kills' | 'time'): void {
    this.phase = 'ended';
    const humans = [...this.players.values()].filter((p) => !p.bot);
    const ranked = [...humans].sort(
      (a, b) => b.level - a.level || b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage || a.info.id - b.info.id,
    );
    const results: ResultRow[] = ranked.map((p) => ({
      id: p.info.id,
      name: p.info.name,
      team: p.info.team,
      color: p.info.color,
      kills: p.kills,
      deaths: p.deaths,
      damage: Math.round(p.damage),
      headshots: p.headshots,
      shots: p.shots,
      hits: p.hits,
      headHits: p.headHits,
    }));
    let winnerTeam: Team | null = null;
    if (teamMode(this.config.mode)) {
      if (this.teamScore[0] > this.teamScore[1]) winnerTeam = 'red';
      else if (this.teamScore[1] > this.teamScore[0]) winnerTeam = 'blue';
    }
    const top = ranked[0];
    const tie = this.config.mode === 'ffa' && ranked.length > 1 && ranked[1].kills === top.kills && ranked[1].level === top.level;
    const msg: EndMsg = {
      type: 'end',
      winnerId: this.config.mode === 'ffa' && top && !tie ? top.info.id : -1,
      winnerTeam,
      reason,
      results,
      mvp: top ? top.info.id : -1,
      teams: [...this.teamScore] as [number, number],
    };
    for (const p of this.players.values()) p.alive = false;
    this.broadcast(msg);
    this.broadcastLobby();
  }

  private sendScores(): void {
    const t = now();
    const players = [...this.players.values()];
    const row = (p: SPlayer): ScoreRow => ({ i: p.info.id, k: p.kills, d: p.deaths, lv: p.level, pg: p.slot ? Math.round(p.slot.rtt) : 0 });
    const teams = [...this.teamScore] as [number, number];
    const tl = this.endsAt > 0 ? Math.max(0, Math.round(this.endsAt - t)) : -1;
    if (!this.bombMode) {
      this.broadcast({ type: 'score', ps: players.map(row), teams, tl });
      return;
    }
    // Everyone sees their own team's money, and nobody sees the other team's.
    for (const to of players) {
      this.send(to, { type: 'score', ps: players.map((p) => (p.info.team === to.info.team ? { ...row(p), m: p.money } : row(p))), teams, tl });
    }
  }

  // ---------------------------------------------------------------- practice

  /** A clear spot with floor under it, near a spawn, at a distance from every human. */
  private findSpot(minDist: number, maxDist: number, seen: boolean): [number, number, number] | null {
    const humans = [...this.players.values()].filter((o) => !o.bot && o.alive);
    const bots = [...this.players.values()].filter((o) => o.bot && o.alive);
    const bases = [...this.map.ffaSpawns, ...this.map.teamSpawns.red, ...this.map.teamSpawns.blue].map((s) => s.pos);
    for (let i = 0; i < 60; i++) {
      const [bx, by, bz] = bases[Math.floor(Math.random() * bases.length)];
      const a = Math.random() * Math.PI * 2;
      const r = i < 40 ? Math.random() * 4 : 0;
      const x = bx + Math.cos(a) * r;
      const z = bz + Math.sin(a) * r;
      const y = r === 0 ? by : this.world.groundHeight(x, z, by + 0.6, 1.5);
      if (!Number.isFinite(y) || Math.abs(y - by) > 0.7 || this.world.overlapsSolid(x, y + 0.05, z, PLAYER.height - 0.1, PLAYER.radius)) continue;
      if (bots.some((o) => Math.hypot(o.x - x, o.z - z) < 2.5)) continue;
      const ok = humans.every((h) => {
        const d = Math.hypot(h.x - x, h.z - z);
        if (d < minDist || d > maxDist) return false;
        return !seen || this.world.lineOfSight(h.x, h.y + eyeHeight(h.crouch), h.z, x, y + 1.3, z);
      });
      if (ok) return [x, y, z];
    }
    return null;
  }

  /** Moves a target to a new spot, with a short side-to-side path when there is room. */
  private placeBot(p: SPlayer, b: Bot, minDist: number, maxDist: number, seen = false): boolean {
    const spot = this.findSpot(minDist, maxDist, seen) ?? this.findSpot(4, 200, false);
    if (!spot) return false;
    const [x, y, z] = spot;
    b.ax = b.bx = x;
    b.az = b.bz = z;
    b.y = y;
    b.speed = 0;
    if (this.drillMode !== 'reflexo') {
      const a = Math.random() * Math.PI * 2;
      const len = 2 + Math.random() * 2;
      const ex = x + Math.cos(a) * len;
      const ez = z + Math.sin(a) * len;
      const ey = this.world.groundHeight(ex, ez, y + 0.6, 1.5);
      if (Number.isFinite(ey) && Math.abs(ey - y) < 0.3 && this.world.lineOfSight(x, y + 1, z, ex, y + 1, ez) && !this.world.overlapsSolid(ex, y + 0.05, ez, PLAYER.height - 0.1, PLAYER.radius)) {
        b.bx = ex;
        b.bz = ez;
        b.speed = this.tuning.strafe;
      }
    }
    p.x = x;
    p.y = y;
    p.z = z;
    return true;
  }

  private hideBot(p: SPlayer): void {
    p.alive = false;
    p.respawnAt = 0;
    p.y = -50;
    p.history.clear();
    p.history.push({ t: now(), x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: false });
  }

  private botKilled(p: SPlayer, b: Bot): void {
    if (this.drillMode !== 'reflexo') {
      p.respawnAt = now() + this.tuning.respawnMs;
      return;
    }
    if (this.drill.running && b.upAt > 0) {
      this.drill.kills++;
      this.drill.reactions.push(now() - b.upAt);
    }
    b.upAt = 0;
    this.hideBot(p);
  }

  private tell(text: string): void {
    this.broadcast({ type: 'sys', text });
  }

  /** Duelists shoot the closest human they can see, after a reaction time. */
  private botFire(p: SPlayer, b: Bot, t: number): void {
    const lv = this.tuning;
    const ex = p.x;
    const ey = p.y + eyeHeight(p.crouch);
    const ez = p.z;
    let target: SPlayer | null = null;
    let best = Infinity;
    for (const o of this.players.values()) {
      if (o.bot || !o.alive) continue;
      const d = Math.hypot(o.x - ex, o.z - ez);
      if (d < best && d < 70 && this.world.lineOfSight(ex, ey, ez, o.x, o.y + 1.2, o.z)) {
        best = d;
        target = o;
      }
    }
    if (!target) {
      b.seenAt = 0;
      return;
    }
    if (b.seenAt === 0) b.seenAt = t;
    if (t - b.seenAt < lv.reaction || t < b.nextShotAt) return;
    b.nextShotAt = t + lv.fireMs * (0.8 + Math.random() * 0.4);

    const hit = Math.random() < lv.accuracy * clamp(1.25 - best / 40, 0.35, 1.2);
    const head = hit && Math.random() < lv.headshot;
    const aimY = target.y + (head ? eyeHeight(target.crouch) : target.crouch ? 0.8 : 1.15);
    let tx = target.x;
    let ty = aimY;
    let tz = target.z;
    if (!hit) {
      // A miss goes past the target, not into it.
      const side = (Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.8);
      const len = Math.max(best, 0.1);
      tx += (-(target.z - ez) / len) * side;
      tz += ((target.x - ex) / len) * side;
      ty += (Math.random() - 0.4) * 0.8;
    }
    let dx = tx - ex;
    let dy = ty - ey;
    let dz = tz - ez;
    const len = Math.hypot(dx, dy, dz);
    dx /= len;
    dy /= len;
    dz /= len;
    const end = hit ? len : 80;
    const wall = hit ? null : this.world.raycast(ex, ey, ez, dx, dy, dz, end);
    const dist = wall ? wall.dist : end;
    this.broadcast({
      type: 'shot',
      i: p.info.id,
      w: W.RIFLE,
      o: [r2(ex), r2(ey), r2(ez)],
      e: [r2(ex + dx * dist), r2(ey + dy * dist), r2(ez + dz * dist)],
      h: [hit ? 2 : wall ? 1 : 0],
      n: wall ? [wall.nx, wall.ny, wall.nz] : [0, 0, 0],
    });
    if (hit) this.dealDamage(p, new Map([[target, { dmg: lv.damage * (head ? 2 : 1), hs: head }]]), W.RIFLE);
  }

  /** Reflex drill: press E, targets come up one after another in sight, and each one is up for a moment only. */
  private updateDrill(t: number): void {
    if (this.drillMode !== 'reflexo') return;
    const d = this.drill;
    const human = [...this.players.values()].find((o) => !o.bot);
    const pressed = d.pressed;
    d.pressed = false;
    const targets = [...this.players.values()].filter((o) => o.bot);
    if (!d.running) {
      if (!pressed || !human?.alive) return;
      targets.forEach((o) => this.hideBot(o));
      this.drill = { running: true, goAt: t + DRILL_COUNTDOWN_MS, nextAt: t + DRILL_COUNTDOWN_MS, shown: 0, kills: 0, reactions: [], pressed: false };
      this.tell(`Reflexo ${PRACTICE_LEVELS[this.practice.level]}: ${DRILL_TARGETS} alvos. Começa em 3 segundos!`);
      return;
    }
    if (t < d.goAt) return;
    const lv = this.tuning;
    for (const o of targets) {
      if (o.alive && o.bot && o.bot.downAt > 0 && t >= o.bot.downAt) {
        o.bot.upAt = 0;
        this.hideBot(o);
      }
    }
    const up = targets.filter((o) => o.alive).length;
    const idle = targets.find((o) => !o.alive);
    if (d.shown < DRILL_TARGETS && up < lv.together && idle?.bot && t >= d.nextAt) {
      if (this.placeBot(idle, idle.bot, 7, 32, true)) {
        idle.hp = 1;
        idle.alive = true;
        idle.protectedUntil = 0;
        idle.bot.upAt = t;
        idle.bot.downAt = t + lv.lifeMs;
        idle.history.clear();
        idle.history.push({ t, x: idle.x, y: idle.y, z: idle.z, yaw: idle.yaw, crouch: false });
        d.shown++;
      }
      d.nextAt = t + lv.gapMs * (0.6 + Math.random() * 0.8);
    }
    if (d.shown >= DRILL_TARGETS && up === 0) {
      d.running = false;
      const avg = d.reactions.length ? Math.round(d.reactions.reduce((a, b) => a + b, 0) / d.reactions.length) : 0;
      const bestMs = d.reactions.length ? Math.round(Math.min(...d.reactions)) : 0;
      const pct = Math.round((d.kills / DRILL_TARGETS) * 100);
      this.tell(d.kills ? `Fim: ${d.kills}/${DRILL_TARGETS} (${pct}%) · reação média ${avg} ms · melhor ${bestMs} ms` : `Fim: 0/${DRILL_TARGETS}. Bora de novo!`);
      this.tell('Aperte E para tentar de novo.');
    }
  }

  private updateBots(t: number): void {
    for (const p of this.players.values()) {
      const b = p.bot;
      if (!b || !p.alive) continue;
      if (this.drillMode === 'duelo') this.botFire(p, b, t);
      if (b.speed > 0) {
        const len = Math.hypot(b.bx - b.ax, b.bz - b.az);
        const k = (Math.sin((t / 1000) * (b.speed / Math.max(len, 0.1)) * Math.PI + b.phase) + 1) / 2;
        p.x = b.ax + (b.bx - b.ax) * k;
        p.z = b.az + (b.bz - b.az) * k;
      }
      // Face the closest human.
      let best: SPlayer | null = null;
      let bd = Infinity;
      for (const o of this.players.values()) {
        if (o.bot || !o.alive) continue;
        const d = Math.hypot(o.x - p.x, o.z - p.z);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) p.yaw = Math.atan2(-(best.x - p.x), -(best.z - p.z));
      p.history.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch });
      p.lastHistT = t;
    }
  }

  private tick(): void {
    if (this.destroyed) return;
    const t = now();
    this.tickCount++;
    // Runs from here because this tick keeps going when the tab is in the background.
    if (this.tickCount % (SNAPSHOT_RATE * 3) === 1) this.announcer?.tick();

    if (this.phase === 'playing') {
      for (const p of this.players.values()) {
        if (p.reloadW >= 0 && t >= p.reloadUntil) this.finishReload(p);
        if (!this.bombMode && p.alive && p.hp < MAX_HP && t - p.lastHurtAt >= REGEN_DELAY_MS) p.hp = Math.min(MAX_HP, p.hp + REGEN_RATE / SNAPSHOT_RATE);
        if (!p.alive && p.respawnAt > 0 && t >= p.respawnAt) {
          p.respawnAt = 0;
          this.spawnPlayer(p);
        }
      }
      this.pickups.forEach((pk, i) => {
        if (!pk.active && t >= pk.respawnAt) {
          pk.active = true;
          this.broadcast({ type: 'pickup', idx: i, on: true, by: -1 });
        }
      });
      this.updateBots(t);
      this.updateDrill(t);
      this.updateProjectiles(t);
      this.updateFires(t);
      if (this.endsAt > 0 && t >= this.endsAt) this.endMatch('time');
      if (this.bombMode && this.phase === 'playing') {
        this.updateRound(t);
        if (this.tickCount % SNAPSHOT_RATE === 0) this.sendRound();
      }
    }

    if (this.phase === 'playing') {
      const ps: SnapPlayer[] = [];
      for (const p of this.players.values()) {
        let f = 0;
        if (p.alive) f |= F_ALIVE;
        if (p.crouch) f |= F_CROUCH;
        if (p.alive && t < p.protectedUntil) f |= F_PROTECTED;
        if (p.ads) f |= F_ADS;
        if (p.onGround) f |= F_GROUND;
        if (p.reloadW >= 0) f |= F_RELOAD;
        // Everyone is sampled at the same instant so motion between snapshots is consistent.
        const h = p.alive ? p.history.at(t - SNAP_SAMPLE_DELAY) : null;
        const x = h ? h.x : p.x;
        const y = h ? h.y : p.y;
        const z = h ? h.z : p.z;
        ps.push({ i: p.info.id, p: [r2(x), r2(y), r2(z)], yw: r3(p.yaw), pt: r3(p.pitch), f, hp: Math.max(0, p.hp), w: p.weapon });
      }
      const snap: HostMsg = { type: 'snap', t: Math.round(t), ps };
      for (const p of this.players.values()) {
        // Old snapshots are worthless: drop them instead of queueing on a slow link.
        if (p.slot && !p.slot.conn.congested()) p.slot.conn.send(snap);
      }
      if (this.tickCount % 10 === 0) this.sendScores();
    }

    if (this.tickCount % SNAPSHOT_RATE === 0) {
      for (const p of [...this.players.values()]) {
        if (!p.slot || p.slot.local) continue;
        if (t - p.slot.lastRecv > 10000) {
          p.slot.conn.close();
          this.removePlayer(p.info.id);
          continue;
        }
        this.send(p, { type: 'ping', t: Math.round(t) });
      }
    }
  }
}

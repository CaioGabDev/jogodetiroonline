import type { DataConnection, Peer } from 'peerjs';
import {
  ARSENAL_NAMES,
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
  RESPAWN_MS,
  SNAPSHOT_RATE,
  SPAWN_PROTECT_MS,
  TEAM_NAMES,
  TEAM_SWITCH_COOLDOWN_MS,
  type MatchConfig,
  type Team,
  KILL_LIMITS,
  TIME_LIMITS,
} from '../game/constants';
import { MAPS, type MapDef, type SpawnDef } from '../game/mapData';
import { CollisionWorld, eyeHeight } from '../game/physics';
import { PositionHistory, rayPlayer } from '../game/hitbox';
import { DEFAULT_LOADOUT, W, WEAPONS, allowedWeapons, damageAt, fullAmmo, gunGameLadder, validLoadout } from '../game/weapons';
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
  /** Two primaries and a pistol. */
  loadout: number[];
  /** On the spawn screen, waiting for the timer or a confirmation. */
  picking: boolean;
}

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

type DamageMap = Map<SPlayer, { dmg: number; hs: boolean }>;

/** Projectiles that hit nothing are dropped after this long. */
const PROJECTILE_MAX_MS = 8000;

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

const BOT_DEFS: Array<Omit<Bot, 'phase'> & { name: string }> = [
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

  constructor(
    offline: boolean,
    private cb: HostCallbacks = {},
  ) {
    this.offline = offline;
    this.config = offline ? { ...DEFAULT_CONFIG, killLimit: 0, timeLimit: 0 } : { ...DEFAULT_CONFIG };
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
      info: { id, name, team: this.smallerTeam(), color: FFA_COLORS[0], host: false, bot: !!bot },
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
      alive: false,
      protectedUntil: 0,
      respawnAt: 0,
      tp: 0,
      kills: 0,
      level: 0,
      deaths: 0,
      damage: 0,
      headshots: 0,
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
      picking: false,
    };
  }

  private addBots(): void {
    for (const d of BOT_DEFS) {
      const id = this.nextId++;
      const bot: Bot = { ...d, phase: Math.random() * Math.PI * 2 };
      const p = this.createPlayer(id, d.name, null, bot);
      p.info.color = '#c9a227';
      p.info.team = 'blue';
      this.players.set(id, p);
    }
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
    this.broadcast({ type: 'sys', text: `${p.info.name} saiu da partida` });
    this.broadcastLobby();
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
    if (this.config.mode !== 'tdm' || p.bot || p.info.team === team) return;
    const playing = this.phase === 'playing';
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
    const team = teamOnly && this.config.mode === 'tdm';
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
    if (c.mode !== 'ffa' && c.mode !== 'tdm') c.mode = 'ffa';
    if (!(c.arsenal in ARSENAL_NAMES)) c.arsenal = 'all';
    if (!Object.hasOwn(MAP_NAMES, c.map)) c.map = 'arena';
    if (c.arsenal === 'gungame') c.mode = 'ffa';
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
    this.endsAt = this.config.timeLimit > 0 ? now() + this.config.timeLimit * 60000 : 0;
    this.map = MAPS[this.config.map];
    this.world = new CollisionWorld(this.map);
    this.pickups = this.map.pickups.map(() => ({ active: true, respawnAt: 0 }));
    this.projectiles = [];
    for (const p of this.players.values()) {
      p.kills = 0;
      p.level = 0;
      p.deaths = 0;
      p.damage = 0;
      p.headshots = 0;
      p.alive = false;
      p.y = -50;
    }
    this.broadcastLobby();
    this.broadcast({ type: 'start', match: this.matchInfo() });
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
      return { pos: [p.bot.ax, p.bot.y, p.bot.az], yaw: Math.atan2(p.bot.ax, p.bot.az) };
    }
    const list = this.config.mode === 'tdm' ? this.map.teamSpawns[p.info.team] : this.map.ffaSpawns;
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
    p.protectedUntil = t + SPAWN_PROTECT_MS;
    const ammo = fullAmmo();
    p.mag = ammo.mag;
    p.reserve = ammo.reserve;
    p.reloadW = -1;
    p.weapon = this.allowed(p)[0];
    p.tp++;
    p.lastCt = -1;
    p.clockAhead = 0;
    p.ctOff = null;
    p.lastMoveT = t;
    p.history.clear();
    p.history.push({ t, x: p.x, y: p.y, z: p.z, yaw: p.yaw, crouch: p.crouch });
    p.lastHistT = t;
    this.send(p, { type: 'spawn', p: [p.x, p.y, p.z], yw: p.yaw, tp: p.tp, full: true, ld: p.loadout });
    this.sendAmmo(p);
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
    if (m.w !== p.weapon && this.allowed(p).includes(m.w)) {
      p.weapon = m.w;
      p.reloadW = -1;
    }
    if (!p.alive || this.phase !== 'playing') return;

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
      if (def.kind === 'health') {
        if (p.hp >= MAX_HP) return;
        p.hp = MAX_HP;
      } else if (!this.refillEquipped(p)) {
        return;
      }
      st.active = false;
      st.respawnAt = now() + PICKUP_RESPAWN_MS;
      // Before the ammo update: the client cancels a running reload on this message.
      this.broadcast({ type: 'pickup', idx: i, on: false, by: p.info.id });
      if (def.kind === 'ammo') this.sendAmmo(p);
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

    const eye = p.y + eyeHeight(p.crouch);
    if (Math.hypot(m.o[0] - p.x, m.o[1] - eye, m.o[2] - p.z) > 3) return reject();
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
        acc.dmg += damageAt(def, maxT, best.head);
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

    this.dealDamage(p, dmgMap, w);
  }

  private dealDamage(p: SPlayer, dmgMap: DamageMap, w: number): void {
    const t = now();
    for (const [target, { dmg, hs }] of dmgMap) {
      if (!target.alive || t < target.protectedUntil) continue;
      const amount = Math.round(dmg);
      if (amount <= 0) continue;
      const dealt = Math.min(amount, target.hp);
      target.hp -= amount;
      p.damage += dealt;
      this.send(target, { type: 'dmg', from: p.info.id, src: [r2(p.x), r2(p.y + 1.4), r2(p.z)], amt: amount });
      const killed = target.hp <= 0;
      if (killed) this.kill(p, target, w, hs);
      const top = target.y + (target.crouch ? HITBOX.crouchHeadTop : HITBOX.standHeadTop);
      this.send(p, { type: 'hit', dmg: amount, hs, kill: killed, p: [r2(target.x), r2(top), r2(target.z)] });
    }
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
    this.broadcast({ type: 'proj', id: pr.id, i: p.info.id, w, o: [r2(pr.x), r2(pr.y), r2(pr.z)], v: [r2(pr.vx), r2(pr.vy), r2(pr.vz)] });
  }

  /** Moves projectiles along their arc, checking the path they cover this tick. */
  private updateProjectiles(t: number): void {
    this.projectiles = this.projectiles.filter((pr) => {
      const def = WEAPONS[pr.w];
      const dt = Math.min(0.1, (t - pr.lastT) / 1000);
      pr.lastT = t;
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
    this.broadcast({ type: 'pimp', id: pr.id, w: pr.w, p: [r2(pr.x), r2(pr.y), r2(pr.z)], h: hit ? 2 : 1, n: [r3(n[0]), r3(n[1]), r3(n[2])] });
    const dmgMap: DamageMap = new Map();
    if (def.splash) {
      // Walls block the blast, and the shooter takes no damage from their own explosion.
      const { radius, min } = def.splash;
      const cy = pr.y + n[1] * 0.2;
      const cx = pr.x + n[0] * 0.2;
      const cz = pr.z + n[2] * 0.2;
      for (const o of this.players.values()) {
        if (o === pr.owner || !o.alive) continue;
        if (!this.isEnemy(pr.owner, o) && !this.config.friendlyFire) continue;
        const d = Math.hypot(o.x - cx, o.y + 1 - cy, o.z - cz);
        if (d > radius || !this.world.lineOfSight(cx, cy, cz, o.x, o.y + 1, o.z)) continue;
        dmgMap.set(o, { dmg: def.damage * (1 - (d / radius) * (1 - min)), hs: false });
      }
    } else if (hit) {
      dmgMap.set(hit.pl, { dmg: damageAt(def, 0, hit.head), hs: hit.head });
    }
    this.dealDamage(pr.owner, dmgMap, pr.w);
  }

  private kill(killer: SPlayer, victim: SPlayer, w: number, hs: boolean): void {
    victim.hp = 0;
    victim.alive = false;
    victim.deaths++;
    victim.reloadW = -1;
    victim.respawnAt = now() + RESPAWN_MS;
    const teamKill = this.config.mode === 'tdm' && killer.info.team === victim.info.team;
    if (teamKill) {
      killer.kills--;
      this.teamScore[killer.info.team === 'red' ? 0 : 1]--;
    } else {
      killer.kills++;
      if (hs) killer.headshots++;
      if (this.config.arsenal === 'gungame') this.gunGameKill(killer, victim, w);
      this.teamScore[killer.info.team === 'red' ? 0 : 1]++;
    }
    this.broadcast({ type: 'kill', k: killer.info.id, v: victim.info.id, w, hs });
    if (!teamKill && killer.alive) {
      // Reward: full health and a full magazine in the weapon in hand.
      killer.hp = MAX_HP;
      const def = WEAPONS[killer.weapon];
      if (!def.melee) {
        killer.mag[killer.weapon] = def.mag;
        if (killer.reloadW === killer.weapon) killer.reloadW = -1;
        this.sendAmmo(killer);
      }
    }
    this.sendScores();
    this.checkWin();
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
    }));
    let winnerTeam: Team | null = null;
    if (this.config.mode === 'tdm') {
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
    this.broadcast({
      type: 'score',
      ps: [...this.players.values()].map((p) => ({
        i: p.info.id,
        k: p.kills,
        d: p.deaths,
        lv: p.level,
        pg: p.slot ? Math.round(p.slot.rtt) : 0,
      })),
      teams: [...this.teamScore] as [number, number],
      tl: this.endsAt > 0 ? Math.max(0, Math.round(this.endsAt - t)) : -1,
    });
  }

  private updateBots(t: number): void {
    for (const p of this.players.values()) {
      const b = p.bot;
      if (!b || !p.alive) continue;
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
      this.updateProjectiles(t);
      if (this.endsAt > 0 && t >= this.endsAt) this.endMatch('time');
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

import type { DataConnection, Peer } from 'peerjs';
import { sanitizeText } from '../core/util';
import { ARSENAL_NAMES, MAX_PLAYERS, NAME_MAX, PEER_PREFIX, PROTOCOL_VERSION, type Arsenal, type GameMode } from '../game/constants';
import { errorType, openPeer } from './peer';
import type { Phase } from './protocol';

/**
 * Public room list without a server: one of the open rooms claims a fixed PeerJS id and keeps the
 * list, the other rooms report to it, and the menu asks it. PeerJS guarantees only one browser can
 * hold the id, so when that room closes, the next one to claim it takes over. With no room open
 * nobody holds the id, which is exactly an empty list.
 */
const DIRECTORY_ID = `${PEER_PREFIX}salas-v${PROTOCOL_VERSION}`;
const ROOM_TTL_MS = 12000;
const MAX_ROOMS = 50;
const CONNECT_TIMEOUT_MS = 7000;
const REFRESH_MS = 3000;
const RETRY_MS = 4000;

export interface RoomInfo {
  code: string;
  host: string;
  mode: GameMode;
  arsenal: Arsenal;
  players: number;
  phase: Phase;
}

type DirectoryMsg = { t: 'announce'; room: RoomInfo } | { t: 'gone'; code: string } | { t: 'list' } | { t: 'rooms'; rooms: RoomInfo[] };

/** Everything here comes from other players' browsers, so it's validated like any network input. */
function parseRoom(raw: unknown): RoomInfo | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const host = sanitizeText(r.host, NAME_MAX);
  const valid =
    typeof r.code === 'string' &&
    /^[A-Z0-9]{6}$/.test(r.code) &&
    host !== '' &&
    (r.mode === 'ffa' || r.mode === 'tdm') &&
    typeof r.arsenal === 'string' &&
    r.arsenal in ARSENAL_NAMES &&
    Number.isInteger(r.players) &&
    (r.players as number) >= 0 &&
    (r.players as number) <= MAX_PLAYERS &&
    (r.phase === 'lobby' || r.phase === 'playing' || r.phase === 'ended');
  return valid ? ({ ...r, host } as unknown as RoomInfo) : null;
}

function connectDirectory(peer: Peer): DataConnection {
  return peer.connect(DIRECTORY_ID, { reliable: true, serialization: 'json' });
}

/** Keeps a room on the list. `tick()` must be called regularly, and it also takes over the list when needed. */
export class RoomAnnouncer {
  private state: 'idle' | 'claiming' | 'keeper' | 'connecting' | 'reporting' = 'idle';
  private keeperPeer: Peer | null = null;
  private dc: DataConnection | null = null;
  private rooms = new Map<string, { room: RoomInfo; seen: number }>();
  private stopped = false;

  constructor(
    private peer: Peer,
    private info: () => RoomInfo,
  ) {}

  tick(): void {
    if (this.stopped) return;
    const room = this.info();
    if (this.state === 'keeper') this.rooms.set(room.code, { room, seen: performance.now() });
    else if (this.state === 'reporting') this.sendReport({ t: 'announce', room });
    else if (this.state === 'idle') void this.claim();
  }

  stop(): void {
    this.stopped = true;
    this.sendReport({ t: 'gone', code: this.info().code });
    this.keeperPeer?.destroy();
    this.keeperPeer = null;
    // Closing right after sending would drop the message; the page may be unloading, so no timers.
    this.dc = null;
  }

  private sendReport(msg: DirectoryMsg): void {
    if (this.dc?.open) void this.dc.send(msg);
  }

  private async claim(): Promise<void> {
    this.state = 'claiming';
    try {
      const peer = await openPeer(DIRECTORY_ID, CONNECT_TIMEOUT_MS);
      if (this.stopped) {
        peer.destroy();
        return;
      }
      this.becomeKeeper(peer);
    } catch (e) {
      if (this.stopped) return;
      if (errorType(e) === 'unavailable-id') this.report();
      else this.state = 'idle';
    }
  }

  private becomeKeeper(peer: Peer): void {
    this.keeperPeer = peer;
    this.state = 'keeper';
    this.tick();
    peer.on('connection', (dc) => {
      dc.on('data', (raw) => this.onKeeperMsg(dc, raw));
      dc.on('error', () => dc.close());
    });
    // Losing the signaling server means someone else can claim the id: step down instead of keeping a stale list.
    const stepDown = (): void => {
      if (this.keeperPeer !== peer) return;
      this.keeperPeer = null;
      peer.destroy();
      this.rooms.clear();
      this.state = 'idle';
    };
    peer.on('disconnected', stepDown);
    peer.on('close', stepDown);
    peer.on('error', () => {
      /* a viewer that couldn't connect isn't a problem for the list */
    });
  }

  private onKeeperMsg(dc: DataConnection, raw: unknown): void {
    const m = raw as Partial<DirectoryMsg> | null;
    if (!m || typeof m !== 'object') return;
    if (m.t === 'list') {
      const t = performance.now();
      for (const [code, r] of this.rooms) if (t - r.seen > ROOM_TTL_MS) this.rooms.delete(code);
      void dc.send({ t: 'rooms', rooms: [...this.rooms.values()].map((r) => r.room) } satisfies DirectoryMsg);
    } else if (m.t === 'announce') {
      const room = parseRoom(m.room);
      if (room && (this.rooms.has(room.code) || this.rooms.size < MAX_ROOMS)) {
        this.rooms.set(room.code, { room, seen: performance.now() });
      }
    } else if (m.t === 'gone' && typeof m.code === 'string') {
      this.rooms.delete(m.code);
    }
  }

  private report(): void {
    this.state = 'connecting';
    const dc = connectDirectory(this.peer);
    this.dc = dc;
    const lost = (): void => {
      if (this.dc !== dc) return;
      this.dc = null;
      this.state = 'idle';
    };
    const timer = window.setTimeout(() => {
      if (!dc.open) {
        lost();
        dc.close();
      }
    }, CONNECT_TIMEOUT_MS);
    dc.once('open', () => {
      clearTimeout(timer);
      if (this.dc !== dc) return;
      this.state = 'reporting';
      this.tick();
    });
    dc.on('close', lost);
    dc.on('error', lost);
  }
}

/** Follows the room list for the menu. `onRooms` gets the current rooms, or [] when none are open. */
export class RoomBrowser {
  private peer: Peer | null = null;
  private refresh = 0;
  private retry = 0;
  private running = false;

  constructor(private onRooms: (rooms: RoomInfo[]) => void) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.connect();
  }

  stop(): void {
    this.running = false;
    clearInterval(this.refresh);
    clearTimeout(this.retry);
    this.peer?.destroy();
    this.peer = null;
  }

  private scheduleRetry(): void {
    clearInterval(this.refresh);
    clearTimeout(this.retry);
    if (this.running) this.retry = window.setTimeout(() => void this.connect(), RETRY_MS);
  }

  private async connect(): Promise<void> {
    if (!this.peer) {
      try {
        const peer = await openPeer(undefined, CONNECT_TIMEOUT_MS);
        if (!this.running) {
          peer.destroy();
          return;
        }
        this.peer = peer;
        // peer-unavailable lands here: nobody holds the list, so there are no rooms.
        peer.on('error', () => {
          this.onRooms([]);
          this.scheduleRetry();
        });
      } catch {
        this.scheduleRetry();
        return;
      }
    }
    const dc = connectDirectory(this.peer);
    const timer = window.setTimeout(() => {
      if (dc.open) return;
      dc.close();
      this.onRooms([]);
      this.scheduleRetry();
    }, CONNECT_TIMEOUT_MS);
    dc.once('open', () => {
      clearTimeout(timer);
      const ask = (): void => void dc.send({ t: 'list' } satisfies DirectoryMsg);
      ask();
      clearInterval(this.refresh);
      this.refresh = window.setInterval(ask, REFRESH_MS);
    });
    dc.on('data', (raw) => {
      const m = raw as Partial<DirectoryMsg> | null;
      if (m?.t !== 'rooms' || !Array.isArray(m.rooms)) return;
      const rooms = m.rooms.slice(0, MAX_ROOMS).map(parseRoom);
      this.onRooms(rooms.filter((r): r is RoomInfo => r !== null));
    });
    dc.on('close', () => {
      clearTimeout(timer);
      this.scheduleRetry();
    });
  }
}

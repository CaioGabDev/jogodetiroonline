import type { Peer } from 'peerjs';
import { clamp, now } from '../core/util';
import { INTERP_DELAY, MAX_INTERP_DELAY, PROTOCOL_VERSION, SNAPSHOT_RATE } from '../game/constants';
import type { ClientMsg, HostMsg, WelcomeMsg } from './protocol';
import { connectToHost, openPeer, PeerConn, type Conn } from './peer';

export type DisconnectReason = 'host-left' | 'timeout' | 'closed';

/**
 * Client side of the connection to the host. Handles the handshake,
 * ping/pong, host-clock estimation and host-loss detection.
 */
export class NetClient {
  localId = -1;
  ping = 0;
  private offset = 0;
  private offsetInit = false;
  private lastSnapAt = 0;
  private jitter = 0;
  /** Interpolation buffer (ms). Grows on jittery links so remote players don't freeze. */
  interpDelay = INTERP_DELAY;
  private lastRecv = now();
  private watchdog = 0;
  private closed = false;
  private handler: ((m: HostMsg) => void) | null = null;
  /** Messages that arrive between the welcome and the app attaching a handler. */
  private queue: HostMsg[] = [];
  onDisconnect: ((r: DisconnectReason) => void) | null = null;

  constructor(
    private conn: Conn,
    private peer: Peer | null,
  ) {}

  /** Performs the hello/welcome handshake. */
  handshake(name: string, color: string, timeoutMs = 12000): Promise<WelcomeMsg> {
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error('Tempo esgotado aguardando resposta do host.')), timeoutMs);
      this.conn.onMessage = (raw) => {
        const m = raw as HostMsg;
        if (!m || typeof m !== 'object') return;
        if (m.type === 'reject') {
          clearTimeout(timer);
          const reasons: Record<string, string> = {
            full: 'Sala cheia (máximo de 10 jogadores).',
            version: 'Versão do jogo diferente da do host. Recarregue a página (Ctrl+F5).',
            name: 'Nickname inválido.',
            closed: 'A sala foi fechada pelo host.',
          };
          reject(new Error(reasons[m.reason] ?? 'Conexão recusada pelo host.'));
          return;
        }
        if (m.type === 'welcome') {
          clearTimeout(timer);
          this.localId = m.id;
          this.attach();
          resolve(m);
        }
      };
      this.conn.onClose = () => {
        clearTimeout(timer);
        reject(new Error('A conexão com o host foi encerrada.'));
      };
      this.send({ type: 'hello', name, color, v: PROTOCOL_VERSION });
    });
  }

  private attach(): void {
    this.lastRecv = now();
    this.conn.onMessage = (raw) => {
      const m = raw as HostMsg;
      if (!m || typeof m !== 'object' || typeof m.type !== 'string') return;
      this.lastRecv = now();
      if (m.type === 'ping') {
        this.send({ type: 'pong', t: m.t });
        return;
      }
      if (m.type === 'snap') this.updateClock(m.t);
      if (m.type === 'reject' && m.reason === 'closed') {
        this.fail('host-left');
        return;
      }
      if (this.handler) this.handler(m);
      else this.queue.push(m);
    };
    this.conn.onClose = () => this.fail('host-left');
    // Remote hosts ping every second; the in-memory loopback can't time out.
    if (this.peer) {
      this.watchdog = window.setInterval(() => {
        if (now() - this.lastRecv > 8000) this.fail('timeout');
      }, 1000);
    }
  }

  setHandler(h: (m: HostMsg) => void): void {
    this.handler = h;
    const q = this.queue;
    this.queue = [];
    q.forEach((m) => h(m));
  }

  /** Smoothed estimate of host clock = local clock + offset. */
  private updateClock(hostT: number): void {
    const t = now();
    if (this.lastSnapAt > 0) {
      const dev = Math.abs(t - this.lastSnapAt - 1000 / SNAPSHOT_RATE);
      this.jitter += (Math.min(dev, 1000) - this.jitter) * 0.1;
      const target = clamp(60 + this.jitter * 2.5, INTERP_DELAY, MAX_INTERP_DELAY);
      this.interpDelay += (target - this.interpDelay) * 0.05;
    }
    this.lastSnapAt = t;
    const sample = hostT - t;
    if (!this.offsetInit) {
      this.offset = sample;
      this.offsetInit = true;
      return;
    }
    // Packets that arrive "early" are closer to the true one-way latency: adapt faster toward them.
    const k = sample > this.offset ? 0.2 : 0.02;
    this.offset += (sample - this.offset) * k;
  }

  hostNow(): number {
    return now() + this.offset;
  }

  private rtClock = 0;
  private rtAt = 0;
  private rtInit = false;

  /**
   * Advances the clock remote players are rendered at. It runs at real-time speed and
   * eases toward (host clock - interpolation delay) instead of jumping whenever the
   * clock estimate changes, which keeps other players' motion smooth. Call once per frame.
   */
  tickRenderClock(): number {
    const t = now();
    const target = this.hostNow() - this.interpDelay;
    if (!this.rtInit || Math.abs(target - this.rtClock) > 300) {
      this.rtClock = target;
      this.rtInit = true;
    } else {
      const dt = t - this.rtAt;
      this.rtClock += dt + (target - this.rtClock) * Math.min(1, dt / 500);
    }
    this.rtAt = t;
    return this.rtClock;
  }

  /** Host-clock time at which remote players are currently rendered. */
  renderTime(): number {
    return this.rtInit ? this.rtClock + (now() - this.rtAt) : this.hostNow() - this.interpDelay;
  }

  send(msg: ClientMsg): void {
    if (this.closed) return;
    // Position updates are superseded by the next one; don't pile them up on a slow link.
    if (msg.type === 'input' && this.conn.congested()) return;
    this.conn.send(msg);
  }

  /** 'relay' when traffic goes through a TURN server, 'direct' for P2P, null if unknown/local. */
  route(): Promise<'relay' | 'direct' | null> {
    return this.conn instanceof PeerConn ? this.conn.route() : Promise.resolve(null);
  }

  private fail(r: DisconnectReason): void {
    if (this.closed) return;
    this.close();
    this.onDisconnect?.(r);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    clearInterval(this.watchdog);
    this.conn.onMessage = null;
    this.conn.onClose = null;
    this.conn.close();
    if (this.peer) {
      const p = this.peer;
      window.setTimeout(() => {
        try {
          p.destroy();
        } catch {
          /* ignore */
        }
      }, 100);
    }
  }
}

/** Connects to a remote host by room code. */
export async function joinRemote(code: string): Promise<NetClient> {
  const peer = await openPeer();
  try {
    const conn = await connectToHost(peer, code);
    peer.on('error', () => {
      /* post-connection signaling errors are not fatal */
    });
    return new NetClient(conn, peer);
  } catch (e) {
    peer.destroy();
    throw e;
  }
}

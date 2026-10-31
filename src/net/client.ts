import type { Peer } from 'peerjs';
import { now } from '../core/util';
import { INTERP_DELAY, PROTOCOL_VERSION } from '../game/constants';
import type { ClientMsg, HostMsg, WelcomeMsg } from './protocol';
import { connectToHost, openPeer, type Conn } from './peer';

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
    const sample = hostT - now();
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

  /** Host-clock time at which remote players are rendered. */
  renderTime(): number {
    return this.hostNow() - INTERP_DELAY;
  }

  send(msg: ClientMsg): void {
    if (!this.closed) this.conn.send(msg);
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

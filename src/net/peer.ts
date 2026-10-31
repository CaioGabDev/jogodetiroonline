import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { ICE_SERVERS, PEER_SERVER } from './iceConfig';
import { PEER_PREFIX } from '../game/constants';

/** Bidirectional message channel. Implemented by PeerJS connections and by an in-memory loopback for the host. */
export interface Conn {
  send(msg: unknown): void;
  close(): void;
  onMessage: ((data: unknown) => void) | null;
  onClose: (() => void) | null;
}

class LoopbackEnd implements Conn {
  other!: LoopbackEnd;
  onMessage: ((data: unknown) => void) | null = null;
  onClose: (() => void) | null = null;
  closed = false;

  send(msg: unknown): void {
    if (this.closed) return;
    const o = this.other;
    queueMicrotask(() => {
      if (!o.closed) o.onMessage?.(msg);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.other.closed = true;
    queueMicrotask(() => {
      this.onClose?.();
      this.other.onClose?.();
    });
  }
}

/** In-memory pair used by the host's own client (zero latency). */
export function createLoopback(): [Conn, Conn] {
  const a = new LoopbackEnd();
  const b = new LoopbackEnd();
  a.other = b;
  b.other = a;
  return [a, b];
}

export class PeerConn implements Conn {
  onMessage: ((data: unknown) => void) | null = null;
  onClose: (() => void) | null = null;
  private closed = false;

  constructor(readonly dc: DataConnection) {
    dc.on('data', (d) => this.onMessage?.(d));
    dc.on('close', () => this.fireClose());
    dc.on('error', () => this.fireClose());
  }

  private fireClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.onClose?.();
  }

  send(msg: unknown): void {
    if (this.closed || !this.dc.open) return;
    try {
      void this.dc.send(msg);
    } catch {
      /* channel closing */
    }
  }

  close(): void {
    try {
      this.dc.close();
    } catch {
      /* ignore */
    }
    this.fireClose();
  }
}

function debugLevel(): 0 | 3 {
  try {
    // Set localStorage['arenafps.peerdebug'] = '1' to log PeerJS internals in the console.
    return localStorage.getItem('arenafps.peerdebug') ? 3 : 0;
  } catch {
    return 0;
  }
}

export function peerOptions(): PeerOptions {
  const opts: PeerOptions = { debug: debugLevel(), config: { iceServers: ICE_SERVERS } };
  if (PEER_SERVER) Object.assign(opts, PEER_SERVER);
  return opts;
}

export const peerIdForCode = (code: string): string => PEER_PREFIX + code;

interface PeerErrorLike {
  type?: string;
  message?: string;
}

export function errorType(err: unknown): string {
  return (err as PeerErrorLike | null)?.type ?? 'unknown';
}

/** Turns PeerJS error codes into clear Portuguese messages. */
export function friendlyPeerError(err: unknown): string {
  switch (errorType(err)) {
    case 'peer-unavailable':
      return 'Sala não encontrada. Confira o código e se o host ainda está com a sala aberta.';
    case 'unavailable-id':
      return 'Este código de sala já está em uso. Tente novamente.';
    case 'browser-incompatible':
      return 'Seu navegador não suporta WebRTC. Use Chrome, Edge ou Firefox atualizados.';
    case 'network':
    case 'socket-error':
    case 'socket-closed':
    case 'server-error':
      return 'Falha ao conectar ao servidor de pareamento (PeerJS). Verifique sua internet e tente novamente.';
    case 'disconnected':
      return 'Desconectado do servidor de pareamento.';
    case 'webrtc':
      return 'Falha na conexão WebRTC. Pode ser necessário um servidor TURN (veja o README).';
    default:
      return 'Erro de conexão: ' + ((err as PeerErrorLike | null)?.message ?? 'desconhecido');
  }
}

/** User-facing message for any connection failure (PeerJS errors carry a `type`). */
export function describeError(err: unknown): string {
  if (err && typeof err === 'object' && typeof (err as PeerErrorLike).type === 'string') return friendlyPeerError(err);
  if (err instanceof Error) return err.message;
  return friendlyPeerError(err);
}

/** Creates a Peer and resolves once registered with the signaling server. */
export function openPeer(id?: string, timeoutMs = 12000): Promise<Peer> {
  return new Promise((resolve, reject) => {
    let peer: Peer;
    try {
      peer = id ? new Peer(id, peerOptions()) : new Peer(peerOptions());
    } catch (e) {
      reject(e);
      return;
    }
    let done = false;
    const timer = window.setTimeout(() => {
      if (done) return;
      done = true;
      peer.destroy();
      reject({ type: 'network', message: 'timeout' });
    }, timeoutMs);
    peer.once('open', () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(peer);
    });
    peer.once('error', (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.destroy();
      reject(err);
    });
  });
}

/** Opens a data connection to the host of `code`. Rejects with friendly-mappable errors. */
export function connectToHost(peer: Peer, code: string, timeoutMs = 15000): Promise<PeerConn> {
  return new Promise((resolve, reject) => {
    let done = false;
    const dc = peer.connect(peerIdForCode(code), { reliable: true, serialization: 'json' });
    const finish = (err: unknown | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.off('error', onErr);
      if (err) {
        try {
          dc.close();
        } catch {
          /* ignore */
        }
        reject(err);
      } else resolve(new PeerConn(dc));
    };
    const onErr = (err: unknown): void => finish(err);
    const timer = window.setTimeout(
      () => finish({ type: 'webrtc', message: 'timeout' }),
      timeoutMs,
    );
    peer.on('error', onErr);
    dc.once('open', () => finish(null));
    dc.once('error', (e) => finish({ type: 'webrtc', message: String(e) }));
  });
}

/**
 * ICE servers used by WebRTC (PeerJS).
 *
 * STUN alone works when both players are on "friendly" networks. School/company
 * Wi-Fi, hotel networks and 4G often block direct P2P connections; those players
 * need a TURN relay. TURN can be configured WITHOUT editing code, through
 * environment variables (Vercel → Project → Settings → Environment Variables,
 * or a local `.env` file), then redeploy:
 *
 *   Option A — Metered (free tier, credentials fetched at runtime):
 *     VITE_METERED_DOMAIN=yourapp.metered.live
 *     VITE_METERED_API_KEY=xxxxxxxxxxxxxxxx
 *
 *   Option B — any TURN server with fixed credentials (e.g. your own coturn):
 *     VITE_TURN_URLS=turn:turn.example.com:3478,turns:turn.example.com:443?transport=tcp
 *     VITE_TURN_USERNAME=user
 *     VITE_TURN_CREDENTIAL=password
 *
 * Servers can also be hardcoded in EXTRA_ICE_SERVERS below.
 */

const STUN_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/** Hardcoded extra servers (TURN), if you prefer editing code over env vars. */
const EXTRA_ICE_SERVERS: RTCIceServer[] = [];

/**
 * Optional custom PeerJS signaling server. Leave undefined to use the free
 * public PeerJS cloud server (0.peerjs.com).
 */
export const PEER_SERVER: { host: string; port: number; path: string; secure: boolean; key?: string } | undefined =
  undefined;

const env = import.meta.env;

function staticTurn(): RTCIceServer[] {
  const urls = (env.VITE_TURN_URLS ?? '')
    .split(',')
    .map((u) => u.trim())
    .filter(Boolean);
  if (urls.length === 0) return [];
  return [{ urls, username: env.VITE_TURN_USERNAME ?? '', credential: env.VITE_TURN_CREDENTIAL ?? '' }];
}

async function meteredTurn(): Promise<RTCIceServer[]> {
  const domain = (env.VITE_METERED_DOMAIN ?? '').trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const key = (env.VITE_METERED_API_KEY ?? '').trim();
  if (!domain || !key) return [];
  const ctrl = new AbortController();
  const timer = window.setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(`https://${domain}/api/v1/turn/credentials?apiKey=${encodeURIComponent(key)}`, {
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as unknown;
    if (!Array.isArray(data)) throw new Error('resposta inválida');
    return data.filter((s): s is RTCIceServer => !!s && typeof s === 'object' && 'urls' in s);
  } catch (e) {
    console.warn('[arenafps] Não foi possível obter credenciais TURN do Metered:', e);
    return [];
  } finally {
    clearTimeout(timer);
  }
}

/** True when some TURN relay is configured (affects error messages). */
export const turnConfigured = (): boolean =>
  EXTRA_ICE_SERVERS.length > 0 || staticTurn().length > 0 || !!(env.VITE_METERED_DOMAIN && env.VITE_METERED_API_KEY);

let cached: Promise<RTCIceServer[]> | null = null;

/** Full ICE server list (STUN + any configured TURN). Fetched once per page load. */
export function loadIceServers(): Promise<RTCIceServer[]> {
  if (!cached) {
    cached = meteredTurn().then((metered) => [...STUN_SERVERS, ...EXTRA_ICE_SERVERS, ...staticTurn(), ...metered]);
  }
  return cached;
}

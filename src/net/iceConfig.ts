/**
 * ICE servers used by WebRTC (PeerJS).
 *
 * STUN alone works for most home networks. If friends can't connect
 * (symmetric NAT, corporate/school networks, 4G), add a TURN server, e.g.:
 *
 *   {
 *     urls: ['turn:your-turn.example.com:3478', 'turns:your-turn.example.com:5349'],
 *     username: 'user',
 *     credential: 'password',
 *   },
 */
export const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

/**
 * Optional custom PeerJS signaling server. Leave undefined to use the free
 * public PeerJS cloud server (0.peerjs.com).
 */
export const PEER_SERVER: { host: string; port: number; path: string; secure: boolean; key?: string } | undefined =
  undefined;

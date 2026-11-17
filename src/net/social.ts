import { sanitizeText } from '../core/util';
import { NAME_MAX } from '../game/constants';
import { supabase } from './supabase';

/** Friends, invites, party and the ranked queue. Everything is checked by the database functions. */

export interface Friend {
  id: string;
  username: string;
  avatar: string | null;
  status: 'accepted' | 'incoming' | 'outgoing';
  online: boolean;
  /** Room code they are in, when online in one. */
  room: string | null;
}

export interface Invite {
  id: number;
  kind: 'room' | 'party';
  room: string | null;
  from: string;
  name: string;
}

export interface Party {
  id: string;
  leader: string;
  room: string | null;
  members: Array<{ id: string; username: string; online: boolean }>;
}

export interface SocialState {
  friends: Friend[];
  invites: Invite[];
  party: Party | null;
}

const ROOM = /^[A-Z0-9]{6}$/;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const room = (v: unknown): string | null => (typeof v === 'string' && ROOM.test(v) ? v : null);
const name = (v: unknown): string => sanitizeText(v, NAME_MAX) || '???';

/** What comes back is other players' data: kept to the expected shapes. */
function parseState(raw: unknown): SocialState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Record<string, unknown>[]) : []);
  const friends: Friend[] = list(r.friends).map((f) => ({
    id: str(f.id),
    username: name(f.username),
    avatar: typeof f.avatar === 'string' ? f.avatar : null,
    status: f.status === 'accepted' || f.status === 'incoming' ? f.status : 'outgoing',
    online: f.online === true,
    room: room(f.room),
  }));
  const invites: Invite[] = list(r.invites)
    .map((i) => ({ id: Number(i.id), kind: i.kind === 'party' ? ('party' as const) : ('room' as const), room: room(i.room), from: str(i.from), name: name(i.name) }))
    .filter((i) => Number.isFinite(i.id) && (i.kind === 'party' || i.room));
  const p = r.party && typeof r.party === 'object' ? (r.party as Record<string, unknown>) : null;
  const party: Party | null = p
    ? { id: str(p.id), leader: str(p.leader), room: room(p.room), members: list(p.members).map((m) => ({ id: str(m.id), username: name(m.username), online: m.online === true })) }
    : null;
  return { friends, invites, party };
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    console.warn(`Falha em ${fn}`, error.message);
    return null;
  }
  return data as T;
}

export const social = {
  async poll(roomCode: string | null): Promise<SocialState | null> {
    const d = await rpc<unknown>('social_poll', { p_room: roomCode });
    return d === null ? null : parseState(d);
  },
  request: (username: string) => rpc<string>('friend_request', { p_username: username }),
  respond: (user: string, accept: boolean) => rpc<boolean>('friend_respond', { p_user: user, p_accept: accept }),
  remove: (user: string) => rpc<void>('friend_remove', { p_user: user }),
  inviteRoom: (user: string, code: string) => rpc<string>('invite_friend', { p_user: user, p_kind: 'room', p_room: code }),
  inviteParty: (user: string) => rpc<string>('invite_friend', { p_user: user, p_kind: 'party', p_room: null }),
  answer: (invite: number, accept: boolean) => rpc<string>('invite_answer', { p_invite: invite, p_accept: accept }),
  leaveParty: () => rpc<void>('party_leave'),
};

export interface QueueState {
  state: 'idle' | 'searching' | 'found';
  window?: number;
  nearby?: number;
  code?: string;
  host?: boolean;
  map?: string;
  players?: number;
}

export const ranked = {
  join: () => rpc<void>('mm_join'),
  leave: () => rpc<void>('mm_leave'),
  async poll(): Promise<QueueState | null> {
    const d = await rpc<Record<string, unknown>>('mm_poll');
    if (!d) return null;
    if (d.state === 'found' && room(d.code)) {
      return { state: 'found', code: room(d.code)!, host: d.host === true, map: str(d.map), players: Number(d.players) || 2 };
    }
    if (d.state === 'searching') return { state: 'searching', window: Number(d.window) || 150, nearby: Number(d.nearby) || 1 };
    return { state: 'idle' };
  },
};

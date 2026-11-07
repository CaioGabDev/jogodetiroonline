import { account } from './account';
import { supabase } from './supabase';

export interface RankRow {
  place: number;
  user_id: string;
  username: string;
  avatar_url: string | null;
  rating: number;
  kills: number;
  deaths: number;
  matches: number;
}

const TOP_SIZE = 50;

/** Null when the ranking couldn't be reached. */
export async function loadRanking(): Promise<{ top: RankRow[]; me: RankRow | null } | null> {
  if (!supabase) return null;
  const board = supabase.from('leaderboard').select('*');
  const id = account.profile?.id;
  const [top, me] = await Promise.all([
    board.order('place').order('username').limit(TOP_SIZE),
    id ? supabase.from('leaderboard').select('*').eq('user_id', id).maybeSingle() : null,
  ]);
  if (top.error || me?.error) {
    console.error('Falha ao carregar o ranking', top.error ?? me?.error);
    return null;
  }
  return { top: top.data as RankRow[], me: (me?.data as RankRow | null | undefined) ?? null };
}

/** The database's own clock starts here, so a client can't claim a match took longer than it did. */
export async function beginMatch(): Promise<void> {
  const res = await supabase?.rpc('begin_match');
  if (res?.error) console.warn('Partida fora do ranking', res.error.message);
}

export type RankedMode = 'ffa' | 'tdm' | 'bomb' | 'gungame';

export type MatchResult = 'win' | 'draw' | 'loss';

/** Returns the player's new rating, or null when the match was refused. */
export async function submitMatch(kills: number, deaths: number, mode: RankedMode, result: MatchResult): Promise<number | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('submit_match', { p_kills: kills, p_deaths: deaths, p_mode: mode, p_result: result });
  if (error) console.warn('Partida recusada pelo ranking', error.message);
  return error ? null : (data as number);
}

/** A player without matches starts at 0. Null when it couldn't be read. */
export async function loadMyRating(): Promise<number | null> {
  const id = account.profile?.id;
  if (!supabase || !id) return null;
  const { data, error } = await supabase.from('player_stats').select('rating').eq('user_id', id).maybeSingle();
  if (error) console.warn('Falha ao carregar o elo', error.message);
  return error ? null : ((data?.rating as number | undefined) ?? 0);
}

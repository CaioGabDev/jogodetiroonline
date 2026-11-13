import { account } from './account';
import { EMPTY_STATS, type CareerStats } from '../game/stats';
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

export interface MatchReport {
  kills: number;
  deaths: number;
  headshots: number;
  damage: number;
  mvp: boolean;
  shots: number;
  hits: number;
  headHits: number;
  mode: RankedMode;
  result: MatchResult;
}

/** What the database paid: the new rating, and XP and coins (totals after the match and what it gave). */
export interface MatchPayout {
  rating: number;
  xp: number;
  coins: number;
  xpGain: number;
  coinGain: number;
  levelCoins: number;
}

const int = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : 0);

/** Null when the match was refused (too short, impossible numbers, no open match). */
export async function submitMatch(r: MatchReport): Promise<MatchPayout | null> {
  if (!supabase) return null;
  const { data, error } = await supabase.rpc('submit_match', {
    p_kills: r.kills,
    p_deaths: r.deaths,
    p_mode: r.mode,
    p_result: r.result,
    p_headshots: r.headshots,
    p_damage: Math.round(r.damage),
    p_mvp: r.mvp,
    p_shots: r.shots,
    p_hits: r.hits,
    p_head_hits: r.headHits,
  });
  if (error || !data || typeof data !== 'object') {
    if (error) console.warn('Partida recusada pelo ranking', error.message);
    return null;
  }
  const d = data as Record<string, unknown>;
  return {
    rating: int(d.rating),
    xp: int(d.xp),
    coins: int(d.coins),
    xpGain: int(d.xp_gain),
    coinGain: int(d.coin_gain),
    levelCoins: int(d.level_coins),
  };
}

/** A player without matches starts at 0. Null when it couldn't be read. */
export async function loadMyRating(): Promise<number | null> {
  const id = account.profile?.id;
  if (!supabase || !id) return null;
  const { data, error } = await supabase.from('player_stats').select('rating').eq('user_id', id).maybeSingle();
  if (error) console.warn('Falha ao carregar o elo', error.message);
  return error ? null : ((data?.rating as number | undefined) ?? 0);
}

/** The logged-in player's career totals. Null when they couldn't be read. */
export async function loadMyStats(): Promise<CareerStats | null> {
  const id = account.profile?.id;
  if (!supabase || !id) return null;
  const { data, error } = await supabase
    .from('player_stats')
    .select('matches, wins, kills, deaths, headshots, damage, shots, hits, head_hits, mvps, best_kills')
    .eq('user_id', id)
    .maybeSingle();
  if (error) {
    console.warn('Falha ao carregar as estatísticas', error.message);
    return null;
  }
  if (!data) return { ...EMPTY_STATS };
  const d = data as Record<string, unknown>;
  const n = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
  return {
    matches: n(d.matches),
    wins: n(d.wins),
    kills: n(d.kills),
    deaths: n(d.deaths),
    headshots: n(d.headshots),
    damage: n(d.damage),
    shots: n(d.shots),
    hits: n(d.hits),
    headHits: n(d.head_hits),
    mvps: n(d.mvps),
    bestKills: n(d.best_kills),
  };
}

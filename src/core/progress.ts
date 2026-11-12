import {
  DEFAULT_SKIN,
  LEVEL_UP_COINS,
  SKINS,
  isSkinId,
  levelFromXp,
  matchReward,
  rankFor,
  skinById,
  type MatchStats,
  type Rank,
  type Reward,
  type SkinDef,
} from '../game/progression';

const STORAGE_KEY = 'arenafps.progress.v1';

/** What is saved. Kept small and flat so it can move to a server later as is. */
export interface ProgressData {
  xp: number;
  coins: number;
  /** Skins bought. Level skins are owned by reaching the level and are not listed. */
  bought: string[];
  equipped: string;
  matches: number;
  wins: number;
  kills: number;
}

export interface MatchSummary {
  reward: Reward;
  levelBefore: number;
  levelAfter: number;
  rankBefore: Rank;
  rankAfter: Rank;
  /** Coins from the levels gained, on top of `reward.coins`. */
  levelCoins: number;
  /** Skins the levels gained gave for free, and the ones that became available to buy. */
  unlocked: SkinDef[];
  buyable: SkinDef[];
}

export type BuyResult = 'ok' | 'owned' | 'level' | 'coins';

function fresh(): ProgressData {
  return { xp: 0, coins: 0, bought: [], equipped: DEFAULT_SKIN, matches: 0, wins: 0, kills: 0 };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function sanitize(raw: unknown): ProgressData {
  const d = fresh();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  d.xp = count(r.xp);
  d.coins = count(r.coins);
  d.matches = count(r.matches);
  d.wins = count(r.wins);
  d.kills = count(r.kills);
  if (Array.isArray(r.bought)) d.bought = [...new Set(r.bought.filter(isSkinId))];
  if (isSkinId(r.equipped)) d.equipped = r.equipped;
  return d;
}

type Listener = (p: ProgressStore) => void;

class ProgressStore {
  private data: ProgressData;
  private listeners = new Set<Listener>();

  constructor() {
    let raw: unknown = null;
    try {
      const txt = localStorage.getItem(STORAGE_KEY);
      raw = txt ? JSON.parse(txt) : null;
    } catch {
      raw = null;
    }
    this.data = sanitize(raw);
    if (!this.owns(this.data.equipped)) this.data.equipped = DEFAULT_SKIN;
  }

  get xp(): number {
    return this.data.xp;
  }
  get coins(): number {
    return this.data.coins;
  }
  get level(): number {
    return levelFromXp(this.data.xp).level;
  }
  get levelInfo(): ReturnType<typeof levelFromXp> {
    return levelFromXp(this.data.xp);
  }
  get rank(): Rank {
    return rankFor(this.level);
  }
  get equipped(): string {
    return this.data.equipped;
  }
  get stats(): Pick<ProgressData, 'matches' | 'wins' | 'kills'> {
    return { matches: this.data.matches, wins: this.data.wins, kills: this.data.kills };
  }

  owns(id: string): boolean {
    const s = skinById(id);
    if (s.id !== id) return false;
    if (s.price === 0) return this.level >= s.level;
    return this.data.bought.includes(id);
  }

  buy(id: string): BuyResult {
    const s = skinById(id);
    if (this.owns(id)) return 'owned';
    if (this.level < s.level) return 'level';
    if (this.data.coins < s.price) return 'coins';
    this.data.coins -= s.price;
    this.data.bought.push(id);
    this.commit();
    return 'ok';
  }

  equip(id: string): boolean {
    if (!this.owns(id)) return false;
    this.data.equipped = id;
    this.commit();
    return true;
  }

  /** Pays out a finished online match. */
  addMatch(stats: MatchStats): MatchSummary {
    const reward = matchReward(stats);
    const levelBefore = this.level;
    this.data.xp += reward.xp;
    const levelAfter = this.level;
    const levelCoins = (levelAfter - levelBefore) * LEVEL_UP_COINS;
    this.data.coins += reward.coins + levelCoins;
    this.data.matches++;
    if (stats.won) this.data.wins++;
    this.data.kills += Math.max(0, Math.floor(stats.kills));
    this.commit();
    const reached = SKINS.filter((s) => s.level > levelBefore && s.level <= levelAfter);
    return {
      reward,
      levelBefore,
      levelAfter,
      rankBefore: rankFor(levelBefore),
      rankAfter: rankFor(levelAfter),
      levelCoins,
      unlocked: reached.filter((s) => s.price === 0),
      buyable: reached.filter((s) => s.price > 0),
    };
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private commit(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable (private mode): progress lasts until the tab closes */
    }
    this.listeners.forEach((l) => l(this));
  }
}

export const progress = new ProgressStore();

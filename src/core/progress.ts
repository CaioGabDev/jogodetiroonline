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

/** What is saved: in this browser for guests, in the account (player_stats) when logged in. */
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

export type BuyResult = 'ok' | 'owned' | 'level' | 'coins' | 'error';

/** Where an account's progress lives. The database checks every purchase and pays every match. */
export interface ProgressBackend {
  load(): Promise<ProgressData | null>;
  buy(id: string): Promise<BuyResult>;
  equip(id: string): Promise<boolean>;
}

/** What the database answered for a match: totals after it, and what it paid. */
export interface ServerMatch {
  xp: number;
  coins: number;
  xpGain: number;
  coinGain: number;
  levelCoins: number;
}

function fresh(): ProgressData {
  return { xp: 0, coins: 0, bought: [], equipped: DEFAULT_SKIN, matches: 0, wins: 0, kills: 0 };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

export function sanitizeProgress(raw: unknown): ProgressData {
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

function loadLocal(): ProgressData {
  try {
    const txt = localStorage.getItem(STORAGE_KEY);
    return sanitizeProgress(txt ? JSON.parse(txt) : null);
  } catch {
    return fresh();
  }
}

type Listener = (p: ProgressStore) => void;

class ProgressStore {
  private data: ProgressData;
  private backend: ProgressBackend | null = null;
  private listeners = new Set<Listener>();
  /** True while an account's progress is on its way. */
  loading = false;

  constructor() {
    this.data = loadLocal();
    this.fixEquipped();
  }

  /** Saved in the account (true) or in this browser (false). */
  get remote(): boolean {
    return this.backend !== null;
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

  /** Logging in switches to the account's progress; logging out (null) back to this browser's. */
  async useBackend(backend: ProgressBackend | null): Promise<void> {
    this.backend = backend;
    if (!backend) {
      this.loading = false;
      this.data = loadLocal();
      this.fixEquipped();
      this.notify();
      return;
    }
    this.loading = true;
    this.data = fresh();
    this.notify();
    await this.reload();
  }

  /** Reads the account again. Keeps what is on screen when it fails. */
  async reload(): Promise<void> {
    const backend = this.backend;
    if (!backend) return;
    const d = await backend.load().catch(() => null);
    if (backend !== this.backend) return;
    this.loading = false;
    if (d) this.data = d;
    this.notify();
  }

  owns(id: string): boolean {
    const s = skinById(id);
    if (s.id !== id) return false;
    if (s.price === 0) return this.level >= s.level;
    return this.data.bought.includes(id);
  }

  /** Buys and equips. */
  async buy(id: string): Promise<BuyResult> {
    const s = skinById(id);
    if (this.owns(id)) return 'owned';
    if (this.level < s.level) return 'level';
    if (this.data.coins < s.price) return 'coins';
    if (this.backend) {
      const r = await this.backend.buy(id).catch((): BuyResult => 'error');
      await this.reload();
      return r;
    }
    this.data.coins -= s.price;
    this.data.bought.push(id);
    this.data.equipped = id;
    this.commit();
    return 'ok';
  }

  async equip(id: string): Promise<boolean> {
    if (!this.owns(id)) return false;
    if (this.backend) {
      const ok = await this.backend.equip(id).catch(() => false);
      if (ok) {
        this.data.equipped = id;
        this.notify();
      }
      return ok;
    }
    this.data.equipped = id;
    this.commit();
    return true;
  }

  /** Pays out a finished online match, for a guest. */
  addMatch(stats: MatchStats): MatchSummary {
    const reward = matchReward(stats);
    const before = this.data.xp;
    const levelCoins = (levelFromXp(before + reward.xp).level - levelFromXp(before).level) * LEVEL_UP_COINS;
    this.data.xp += reward.xp;
    this.data.coins += reward.coins + levelCoins;
    this.count(stats);
    this.commit();
    return this.summary(reward, before, levelCoins);
  }

  /** Takes what the database paid for a match (logged in). The lines are for show; the totals are the server's. */
  applyServerMatch(stats: MatchStats, server: ServerMatch): MatchSummary {
    const reward = matchReward(stats);
    reward.xp = server.xpGain;
    reward.coins = server.coinGain;
    const before = server.xp - server.xpGain;
    this.data.xp = server.xp;
    this.data.coins = server.coins;
    this.count(stats);
    this.notify();
    return this.summary(reward, before, server.levelCoins);
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private count(stats: MatchStats): void {
    this.data.matches++;
    if (stats.won) this.data.wins++;
    this.data.kills += Math.max(0, Math.floor(stats.kills) || 0);
  }

  private summary(reward: Reward, xpBefore: number, levelCoins: number): MatchSummary {
    const levelBefore = levelFromXp(xpBefore).level;
    const levelAfter = this.level;
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

  private fixEquipped(): void {
    if (!this.owns(this.data.equipped)) this.data.equipped = DEFAULT_SKIN;
  }

  private commit(): void {
    if (!this.backend) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      } catch {
        /* storage unavailable (private mode): progress lasts until the tab closes */
      }
    }
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((l) => l(this));
  }
}

export const progress = new ProgressStore();

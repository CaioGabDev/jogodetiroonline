import { MISSIONS, missionById, periodKey, type MissionDef, type MissionEvent, type MissionPeriod } from '../game/missions';
import { progress } from './progress';

/** One finished online match, newest first in the history. */
export interface HistoryEntry {
  /** When it ended (ms since 1970). */
  t: number;
  map: string;
  mode: string;
  kills: number;
  deaths: number;
  headshots: number;
  damage: number;
  won: boolean;
  mvp: boolean;
}

interface PeriodState {
  key: string;
  counts: Record<string, number>;
  claimed: string[];
}

interface SavedState {
  daily: PeriodState;
  weekly: PeriodState;
  history: HistoryEntry[];
}

export type ClaimResult = 'ok' | 'claimed' | 'incomplete' | 'error';

/** Pays a mission in the account; null without one. */
export type ClaimBackend = ((id: string) => Promise<'ok' | 'claimed' | 'error'>) | null;

const KEY = 'arenafps.missions.v1';
const HISTORY_MAX = 30;

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

function freshPeriod(period: MissionPeriod): PeriodState {
  return { key: periodKey(period), counts: {}, claimed: [] };
}

function readPeriod(raw: unknown, period: MissionPeriod): PeriodState {
  const p = raw as Partial<PeriodState> | null;
  if (!p || p.key !== periodKey(period)) return freshPeriod(period);
  const counts: Record<string, number> = {};
  for (const m of MISSIONS) if (m.period === period) counts[m.id] = count(p.counts?.[m.id]);
  const claimed = Array.isArray(p.claimed) ? p.claimed.filter((id) => missionById(id)?.period === period) : [];
  return { key: p.key, counts, claimed };
}

function readHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((h): h is HistoryEntry => !!h && typeof h === 'object' && typeof h.t === 'number' && typeof h.map === 'string' && typeof h.mode === 'string')
    .map((h) => ({ t: h.t, map: h.map, mode: h.mode, kills: count(h.kills), deaths: count(h.deaths), headshots: count(h.headshots), damage: count(h.damage), won: h.won === true, mvp: h.mvp === true }))
    .slice(0, HISTORY_MAX);
}

/**
 * Mission progress and match history, kept in this browser per account (or guest).
 * Coins are paid by the database for an account, each mission once per period, and in this browser for a guest.
 */
class MissionStore {
  private owner = 'guest';
  private state: SavedState = this.load();
  private backend: ClaimBackend = null;
  private listeners = new Set<() => void>();

  /** Logging in or out switches to that player's missions and history. */
  use(owner: string | null, backend: ClaimBackend): void {
    this.owner = owner ?? 'guest';
    this.backend = backend;
    this.state = this.load();
    this.notify();
  }

  onChange(l: () => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private load(): SavedState {
    try {
      const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
      const mine = (all[this.owner] ?? {}) as Partial<SavedState>;
      return { daily: readPeriod(mine.daily, 'daily'), weekly: readPeriod(mine.weekly, 'weekly'), history: readHistory(mine.history) };
    } catch {
      return { daily: freshPeriod('daily'), weekly: freshPeriod('weekly'), history: [] };
    }
  }

  private save(): void {
    try {
      const all = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, unknown>;
      all[this.owner] = this.state;
      localStorage.setItem(KEY, JSON.stringify(all));
    } catch {
      /* storage unavailable: progress lasts until the tab closes */
    }
    this.notify();
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  /** Starts a new day or week when it has turned. */
  private roll(): void {
    if (this.state.daily.key !== periodKey('daily')) this.state.daily = freshPeriod('daily');
    if (this.state.weekly.key !== periodKey('weekly')) this.state.weekly = freshPeriod('weekly');
  }

  private period(m: MissionDef): PeriodState {
    return m.period === 'daily' ? this.state.daily : this.state.weekly;
  }

  record(event: MissionEvent, n = 1): void {
    if (n <= 0) return;
    this.roll();
    let changed = false;
    for (const m of MISSIONS) {
      if (m.event !== event) continue;
      const p = this.period(m);
      const before = p.counts[m.id] ?? 0;
      if (before >= m.goal) continue;
      p.counts[m.id] = Math.min(m.goal, before + n);
      changed = true;
    }
    if (changed) this.save();
  }

  progressOf(m: MissionDef): { done: number; claimed: boolean } {
    this.roll();
    const p = this.period(m);
    return { done: p.counts[m.id] ?? 0, claimed: p.claimed.includes(m.id) };
  }

  /** Missions done and not yet claimed. */
  get ready(): number {
    return MISSIONS.filter((m) => {
      const s = this.progressOf(m);
      return !s.claimed && s.done >= m.goal;
    }).length;
  }

  async claim(id: string): Promise<ClaimResult> {
    const m = missionById(id);
    if (!m) return 'error';
    const s = this.progressOf(m);
    if (s.claimed) return 'claimed';
    if (s.done < m.goal) return 'incomplete';
    const owner = this.owner;
    let result: ClaimResult;
    if (this.backend) {
      result = await this.backend(id).catch((): ClaimResult => 'error');
      if (result !== 'error') await progress.reload();
    } else {
      progress.addCoins(m.reward);
      result = 'ok';
    }
    // The player may have logged out meanwhile: the claim belongs to the one who asked.
    if (owner !== this.owner) return result;
    if (result === 'ok' || result === 'claimed') {
      this.period(m).claimed.push(id);
      this.save();
    }
    return result;
  }

  get history(): HistoryEntry[] {
    return [...this.state.history];
  }

  addHistory(h: HistoryEntry): void {
    this.state.history = [h, ...this.state.history].slice(0, HISTORY_MAX);
    this.save();
  }
}

export const missions = new MissionStore();

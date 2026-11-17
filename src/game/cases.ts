/**
 * Cases: the special skins (every skin that is not given by level) only come out of a case.
 * Pure data and math, like progression.ts. The database has the same cases, prices and odds
 * (supabase/migrations/20261117000100_caixas.sql) and rolls for logged-in players.
 */
import { SKINS, type Season, type SkinDef } from './progression';

export type Tier = 'comum' | 'raro' | 'epico' | 'lendario';

export interface TierInfo {
  name: string;
  color: string;
}

export const TIERS: Record<Tier, TierInfo> = {
  comum: { name: 'Comum', color: '#5b9bd5' },
  raro: { name: 'Raro', color: '#8a5cff' },
  epico: { name: 'Épico', color: '#e04fd0' },
  lendario: { name: 'Lendário', color: '#f5c542' },
};

export type CaseId = 'armas' | 'facas' | 'natal' | 'halloween';

export interface CaseDef {
  id: CaseId;
  name: string;
  price: number;
  /** What it holds: weapon skins, knives, or both (the seasonal cases). */
  slot: 'arma' | 'faca' | 'misto';
  /** Seasonal cases hold that season's skins only, and open only between these days (month, day; Brasília). */
  season?: Season;
  window?: { from: [number, number]; to: [number, number] };
  /** Chance of each tier, in percent. Adds up to 100. */
  odds: Partial<Record<Tier, number>>;
  color: string;
}

export const CASES: CaseDef[] = [
  { id: 'armas', name: 'Caixa de Armas', price: 1200, slot: 'arma', odds: { comum: 60, raro: 26, epico: 10, lendario: 4 }, color: '#4cb3f0' },
  { id: 'facas', name: 'Caixa de Facas', price: 2500, slot: 'faca', odds: { raro: 70, epico: 23, lendario: 7 }, color: '#e06cd8' },
  {
    id: 'natal',
    name: 'Caixa de Natal',
    price: 1800,
    slot: 'misto',
    season: 'natal',
    window: { from: [11, 15], to: [1, 15] },
    odds: { comum: 55, raro: 28, epico: 12, lendario: 5 },
    color: '#d1182b',
  },
  {
    id: 'halloween',
    name: 'Caixa de Halloween',
    price: 1800,
    slot: 'misto',
    season: 'halloween',
    window: { from: [10, 1], to: [11, 7] },
    odds: { comum: 55, raro: 28, epico: 12, lendario: 5 },
    color: '#ff7a1a',
  },
];

/** Chance, in percent, that a skin from a case comes with a kill counter. */
export const COUNTER_CHANCE = 10;

/** Brasília month and day, as the database checks the seasons. */
function today(now: Date): [number, number] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return [get('month'), get('day')];
}

/** Seasonal cases open only in their window, which may go over the new year. Others are always open. */
export function caseOpen(c: CaseDef, now = new Date()): boolean {
  if (!c.window) return true;
  const [m, d] = today(now);
  const v = m * 100 + d;
  const from = c.window.from[0] * 100 + c.window.from[1];
  const to = c.window.to[0] * 100 + c.window.to[1];
  return from <= to ? v >= from && v <= to : v >= from || v <= to;
}

/** Part of the case price given back when the skin is already owned. */
export const DUPLICATE_REFUND = 0.5;

/** Skins from a case (price > 0) by what they used to cost. Level skins have no tier. */
export function tierOf(s: SkinDef): Tier | null {
  if (s.price <= 0) return null;
  if (s.slot === 'faca') return s.price < 3000 ? 'raro' : s.price < 8000 ? 'epico' : 'lendario';
  return s.price < 2000 ? 'comum' : s.price < 5000 ? 'raro' : s.price < 10000 ? 'epico' : 'lendario';
}

export function caseById(id: string): CaseDef | null {
  return CASES.find((c) => c.id === id) ?? null;
}

/** What can come out of the case. */
export function caseItems(c: CaseDef): SkinDef[] {
  return SKINS.filter((s) => tierOf(s) !== null && (s.season ?? null) === (c.season ?? null) && (c.slot === 'misto' || (s.slot === 'faca' ? 'faca' : 'arma') === c.slot));
}

/** The case a special skin comes from. */
export function caseFor(s: SkinDef): CaseDef | null {
  if (tierOf(s) === null) return null;
  return CASES.find((c) => caseItems(c).includes(s)) ?? null;
}

/** Draws a skin: first the tier by its odds, then one of its skins. `rand` gives 0..1. */
export function rollCase(c: CaseDef, rand: () => number = Math.random): SkinDef {
  const items = caseItems(c);
  let r = rand() * 100;
  let tier: Tier | null = null;
  // Rarest first, the same order as the database.
  for (const t of ['lendario', 'epico', 'raro', 'comum'] as Tier[]) {
    const p = c.odds[t] ?? 0;
    if (p <= 0) continue;
    tier = t;
    if (r < p) break;
    r -= p;
  }
  const pool = items.filter((s) => tierOf(s) === tier);
  const list = pool.length ? pool : items;
  return list[Math.min(list.length - 1, Math.floor(rand() * list.length))];
}

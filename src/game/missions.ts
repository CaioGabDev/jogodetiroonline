/**
 * Daily and weekly missions. Pure data, like progression.ts. The database has the same ids, rewards and periods
 * (supabase/migrations/20261118000100_missoes.sql) and pays each mission once per period.
 */

/** What counts toward a mission. Practice events come from offline training, the others from online matches. */
export type MissionEvent = 'practiceKill' | 'practiceHeadshot' | 'aimRun' | 'kill' | 'headshot' | 'win' | 'match';
export type MissionPeriod = 'daily' | 'weekly';

export interface MissionDef {
  id: string;
  text: string;
  event: MissionEvent;
  goal: number;
  reward: number;
  period: MissionPeriod;
}

export const MISSIONS: MissionDef[] = [
  { id: 'd_alvos', text: 'Derrube 100 alvos no treino', event: 'practiceKill', goal: 100, reward: 300, period: 'daily' },
  { id: 'd_alvos_hs', text: 'Acerte 30 headshots em alvos do treino', event: 'practiceHeadshot', goal: 30, reward: 200, period: 'daily' },
  { id: 'd_mira', text: 'Complete 2 treinos de mira', event: 'aimRun', goal: 2, reward: 200, period: 'daily' },
  { id: 'd_abates', text: 'Faça 15 abates online', event: 'kill', goal: 15, reward: 250, period: 'daily' },
  { id: 'd_vitoria', text: 'Vença 1 partida online', event: 'win', goal: 1, reward: 300, period: 'daily' },
  { id: 'w_alvos', text: 'Derrube 1.000 alvos no treino', event: 'practiceKill', goal: 1000, reward: 1500, period: 'weekly' },
  { id: 'w_mira', text: 'Complete 10 treinos de mira', event: 'aimRun', goal: 10, reward: 1000, period: 'weekly' },
  { id: 'w_abates', text: 'Faça 100 abates online', event: 'kill', goal: 100, reward: 1500, period: 'weekly' },
  { id: 'w_hs', text: 'Faça 50 headshots online', event: 'headshot', goal: 50, reward: 1000, period: 'weekly' },
  { id: 'w_vitorias', text: 'Vença 5 partidas online', event: 'win', goal: 5, reward: 2000, period: 'weekly' },
];

export function missionById(id: string): MissionDef | null {
  return MISSIONS.find((m) => m.id === id) ?? null;
}

/** Brasília time, as the database (America/Sao_Paulo): days start at midnight there. */
function saoPauloDate(now: Date): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (t: string): number => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), m: get('month'), d: get('day') };
}

const iso = (dt: Date): string => dt.toISOString().slice(0, 10);

/** The day ('2026-11-18') or the Monday of the week the mission runs in. */
export function periodKey(period: MissionPeriod, now = new Date()): string {
  const { y, m, d } = saoPauloDate(now);
  const day = new Date(Date.UTC(y, m - 1, d));
  if (period === 'daily') return iso(day);
  const back = (day.getUTCDay() + 6) % 7;
  day.setUTCDate(day.getUTCDate() - back);
  return iso(day);
}

/** Milliseconds until the period resets. */
export function msUntilReset(period: MissionPeriod, now = new Date()): number {
  const key = periodKey(period, now);
  const start = new Date(key + 'T03:00:00Z').getTime(); // midnight in Brasília (UTC-3)
  const len = (period === 'daily' ? 1 : 7) * 86400000;
  return Math.max(0, start + len - now.getTime());
}

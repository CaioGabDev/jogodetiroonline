/** Career totals shown on the profile. Same fields in player_stats (accounts) and in localStorage (guests). */
export interface CareerStats {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  /** Kills with a headshot. */
  headshots: number;
  damage: number;
  /** Trigger pulls with a gun (a shotgun blast is one), and the ones that hit someone. */
  shots: number;
  hits: number;
  /** Hits that landed on the head. */
  headHits: number;
  mvps: number;
  /** Most kills in a single match. */
  bestKills: number;
}

export const EMPTY_STATS: CareerStats = { matches: 0, wins: 0, kills: 0, deaths: 0, headshots: 0, damage: 0, shots: 0, hits: 0, headHits: 0, mvps: 0, bestKills: 0 };

export interface StatLine {
  label: string;
  value: string;
  /** Small text under the value. */
  note?: string;
}

const pct = (part: number, whole: number): string => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '—');
const per = (a: number, b: number, digits = 1): string => (b > 0 ? (a / b).toFixed(digits).replace('.', ',') : '—');
const n = (v: number): string => v.toLocaleString('pt-BR');

export function statLines(s: CareerStats): StatLine[] {
  return [
    { label: 'K/D', value: s.deaths > 0 ? per(s.kills, s.deaths, 2) : s.kills > 0 ? n(s.kills) : '—', note: `${n(s.kills)} abates · ${n(s.deaths)} mortes` },
    { label: 'Acertos na cabeça', value: pct(s.headHits, s.hits), note: `${n(s.headHits)} de ${n(s.hits)} acertos` },
    { label: 'Precisão', value: pct(s.hits, s.shots), note: `${n(s.hits)} de ${n(s.shots)} tiros` },
    { label: 'Abates com headshot', value: pct(s.headshots, s.kills), note: `${n(s.headshots)} abates` },
    { label: 'Vitórias', value: pct(s.wins, s.matches), note: `${n(s.wins)} de ${n(s.matches)} partidas` },
    { label: 'Abates por partida', value: per(s.kills, s.matches) },
    { label: 'Dano por partida', value: s.matches > 0 ? n(Math.round(s.damage / s.matches)) : '—', note: `${n(s.damage)} no total` },
    { label: 'MVP', value: n(s.mvps), note: pct(s.mvps, s.matches) + ' das partidas' },
    { label: 'Melhor partida', value: n(s.bestKills), note: 'abates' },
  ];
}

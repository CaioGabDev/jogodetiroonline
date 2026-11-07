/** Ranks climbed with rating points. The points themselves are calculated by the database (submit_match). */
const TIERS = [
  { name: 'Ferro', color: '#7f8389' },
  { name: 'Bronze', color: '#b0793f' },
  { name: 'Prata', color: '#c3ccd6' },
  { name: 'Ouro', color: '#f2c14e' },
  { name: 'Platina', color: '#4fd1c5' },
  { name: 'Diamante', color: '#7aa7ff' },
  { name: 'Mestre', color: '#b57bff' },
  { name: 'Lenda', color: '#ff5a5f' },
];
const POINTS_PER_DIVISION = 100;
const DIVISIONS = ['I', 'II', 'III'];
/** The last tier has no divisions: from here on, points just add up. */
const TOP_RATING = (TIERS.length - 1) * DIVISIONS.length * POINTS_PER_DIVISION;

export interface Rank {
  /** Tier and division, such as "Prata II". */
  label: string;
  /** Empty on the top tier. */
  division: string;
  color: string;
  /** Points inside the division. */
  points: number;
  /** Points a division holds, or null on the top tier. */
  goal: number | null;
}

export function rankOf(rating: number): Rank {
  const r = Math.max(0, rating);
  if (r >= TOP_RATING) {
    const top = TIERS[TIERS.length - 1];
    return { label: top.name, division: '', color: top.color, points: r - TOP_RATING, goal: null };
  }
  const step = Math.floor(r / POINTS_PER_DIVISION);
  const tier = TIERS[Math.floor(step / DIVISIONS.length)];
  const division = DIVISIONS[step % DIVISIONS.length];
  return { label: `${tier.name} ${division}`, division, color: tier.color, points: r % POINTS_PER_DIVISION, goal: POINTS_PER_DIVISION };
}

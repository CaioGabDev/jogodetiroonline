/** Offline practice: what the targets do, and how hard they make it. Bomb maps keep their own practice. */
export type PracticeMode = 'alvos' | 'aleatorio' | 'duelo' | 'reflexo';
export type PracticeLevel = 'normal' | 'medio' | 'dificil';

export interface PracticeSetup {
  mode: PracticeMode;
  level: PracticeLevel;
}

export const DEFAULT_PRACTICE: PracticeSetup = { mode: 'alvos', level: 'normal' };

export const PRACTICE_MODES: Record<PracticeMode, string> = {
  alvos: 'Alvos fixos',
  aleatorio: 'Spawn aleatório',
  duelo: 'Duelo (atiram em você)',
  reflexo: 'Reflexo (aperte E)',
};

export const PRACTICE_LEVELS: Record<PracticeLevel, string> = {
  normal: 'Normal',
  medio: 'Médio',
  dificil: 'Difícil',
};

export interface LevelTuning {
  /** Side to side speed of a target, m/s. */
  strafe: number;
  /** Bots in the duel. */
  duelists: number;
  /** Time a duelist needs to see you before the first shot, ms. */
  reaction: number;
  /** Time between a duelist's shots, ms. */
  fireMs: number;
  /** Chance that a shot at 10 m hits; it falls with distance. */
  accuracy: number;
  /** Share of hits that land on the head (double damage). */
  headshot: number;
  damage: number;
  /** Time before a dead target comes back somewhere else, ms. */
  respawnMs: number;
  /** Reflex drill: how long a target stays up, how long between targets, and how many at once. */
  lifeMs: number;
  gapMs: number;
  together: number;
}

export const LEVELS: Record<PracticeLevel, LevelTuning> = {
  normal: { strafe: 1.5, duelists: 2, reaction: 700, fireMs: 520, accuracy: 0.28, headshot: 0.08, damage: 12, respawnMs: 1800, lifeMs: 2200, gapMs: 650, together: 1 },
  medio: { strafe: 2.6, duelists: 3, reaction: 450, fireMs: 380, accuracy: 0.4, headshot: 0.14, damage: 15, respawnMs: 1300, lifeMs: 1500, gapMs: 450, together: 2 },
  dificil: { strafe: 3.6, duelists: 4, reaction: 260, fireMs: 260, accuracy: 0.55, headshot: 0.22, damage: 18, respawnMs: 900, lifeMs: 950, gapMs: 300, together: 2 },
};

/** Targets in one reflex drill. */
export const DRILL_TARGETS = 30;
export const DRILL_COUNTDOWN_MS = 3000;

export function isPracticeSetup(v: unknown): v is PracticeSetup {
  const s = v as PracticeSetup | null;
  return !!s && Object.hasOwn(PRACTICE_MODES, s.mode) && Object.hasOwn(PRACTICE_LEVELS, s.level);
}

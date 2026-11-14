/**
 * Levels, ranks, rewards and the weapon skin catalog. Pure data and math, with no DOM or storage,
 * so `scripts/check-progression.mjs` can test it.
 */

export const MAX_LEVEL = 55;

/** XP from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return 800 + 150 * (level - 1);
}

/** Total XP needed to reach `level` from level 1. */
export function totalXpFor(level: number): number {
  let sum = 0;
  for (let l = 1; l < level; l++) sum += xpForLevel(l);
  return sum;
}

export interface LevelInfo {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level takes; 0 at the top level. */
  need: number;
}

export function levelFromXp(xp: number): LevelInfo {
  let level = 1;
  let rest = Math.max(0, Math.floor(xp));
  while (level < MAX_LEVEL && rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return level === MAX_LEVEL ? { level, into: 0, need: 0 } : { level, into: rest, need: xpForLevel(level) };
}

export interface Rank {
  name: string;
  /** Level the rank starts at. */
  level: number;
  color: string;
  /** Short badge text. */
  icon: string;
}

export const RANKS: Rank[] = [
  { name: 'Recruta', level: 1, color: '#9aa3ad', icon: '○' },
  { name: 'Soldado', level: 3, color: '#b8c4cf', icon: '▲' },
  { name: 'Cabo', level: 6, color: '#8fc97a', icon: '▲▲' },
  { name: 'Sargento', level: 10, color: '#5cc1a6', icon: '▲▲▲' },
  { name: 'Subtenente', level: 15, color: '#4cb3f0', icon: '◆' },
  { name: 'Tenente', level: 20, color: '#6f8cff', icon: '◆◆' },
  { name: 'Capitão', level: 26, color: '#a77bff', icon: '◆◆◆' },
  { name: 'Major', level: 33, color: '#e06cd8', icon: '★' },
  { name: 'Coronel', level: 40, color: '#ff8f4a', icon: '★★' },
  { name: 'General', level: 50, color: '#f5c542', icon: '★★★' },
];

export function rankFor(level: number): Rank {
  let r = RANKS[0];
  for (const k of RANKS) if (level >= k.level) r = k;
  return r;
}

/** What a finished match gives the local player. */
export interface MatchStats {
  kills: number;
  deaths: number;
  headshots: number;
  damage: number;
  won: boolean;
  mvp: boolean;
  shots: number;
  hits: number;
  headHits: number;
}

export interface Reward {
  xp: number;
  coins: number;
  /** Lines shown on the results screen. */
  lines: Array<{ label: string; xp: number; coins: number }>;
}

/** Caps keep an endless match or a kill limit of 500 from paying out absurd amounts. */
const KILL_CAP = 60;
const DAMAGE_CAP = 8000;

export function matchReward(s: MatchStats): Reward {
  const kills = Math.min(KILL_CAP, Math.max(0, Math.floor(s.kills)));
  const hs = Math.min(kills, Math.max(0, Math.floor(s.headshots)));
  const dmg = Math.min(DAMAGE_CAP, Math.max(0, Math.floor(s.damage)));
  const lines: Reward['lines'] = [{ label: 'Partida jogada', xp: 150, coins: 25 }];
  if (kills > 0) lines.push({ label: `${kills} abates`, xp: kills * 50, coins: kills * 5 });
  if (hs > 0) lines.push({ label: `${hs} headshots`, xp: hs * 25, coins: hs * 2 });
  if (dmg >= 10) lines.push({ label: `${dmg} de dano`, xp: Math.floor(dmg / 10), coins: 0 });
  if (s.won) lines.push({ label: 'Vitória', xp: 300, coins: 40 });
  if (s.mvp) lines.push({ label: 'MVP', xp: 150, coins: 20 });
  return {
    xp: lines.reduce((n, l) => n + l.xp, 0),
    coins: lines.reduce((n, l) => n + l.coins, 0),
    lines,
  };
}

/** Coins for each level gained. */
export const LEVEL_UP_COINS = 100;

// ---------------------------------------------------------------------------
// Weapon skins
// ---------------------------------------------------------------------------

/** How the colors are laid over the gun. Must match the shader in `render/skins.ts`. */
export type SkinPattern = 'solid' | 'camo' | 'digital' | 'stripes' | 'flow' | 'scan' | 'prisma';

/** Extra parts that change the gun's shape. Built in render/skinKits.ts. */
export type SkinKit = 'plasma' | 'cristal' | 'brasa' | 'vazio' | 'tempestade' | 'holograma' | 'aurora';

/** How the gun moves in hand when inspected (Y). */
export type InspectStyle = 'default' | 'spin' | 'flip' | 'twirl' | 'butterfly';

/** Knife models, built in render/knives.ts. */
export type BladeShape = 'baioneta' | 'karambit' | 'borboleta' | 'cutelo' | 'tanto';

export interface KnifeLook {
  blade: BladeShape;
  /** Glowing edge that pulses and flares on a swing, as #rrggbb. */
  edge?: string;
  inspect: InspectStyle;
}

/** What only premium skins have: their own parts, shot colors, kill effect and inspection. */
export interface SkinFx {
  kit: SkinKit;
  /** Tracer, muzzle flash and kill burst, as #rrggbb. */
  tracer: string;
  flash: string;
  kill: string;
  inspect: InspectStyle;
}

export interface SkinDef {
  id: string;
  name: string;
  pattern: SkinPattern;
  /** One to four colors. */
  colors: string[];
  /** Level needed to own (free) or to buy it. */
  level: number;
  /** 0 = given when the level is reached. */
  price: number;
  /** 0 matte, 1 polished metal. */
  shine: number;
  /** How much the colors glow in the dark. */
  glow: number;
  /** Premium only. */
  fx?: SkinFx;
  /** Knife skins go on the knife only, equipped apart from the weapon skin. */
  slot?: 'faca';
  knife?: KnifeLook;
  /** One line about the skin, shown in the Arsenal. */
  tagline?: string;
}

export const DEFAULT_SKIN = 'padrao';
export const DEFAULT_KNIFE = 'faca_padrao';

export const SKINS: SkinDef[] = [
  { id: 'padrao', name: 'Padrão', pattern: 'solid', colors: [], level: 1, price: 0, shine: 0, glow: 0 },
  { id: 'floresta', name: 'Floresta', pattern: 'camo', colors: ['#2f3a22', '#55663a', '#1f2418', '#7d7a4c'], level: 3, price: 0, shine: 0, glow: 0 },
  { id: 'deserto', name: 'Deserto', pattern: 'camo', colors: ['#b39a6c', '#8d7650', '#d8c69a', '#6e5c40'], level: 6, price: 0, shine: 0, glow: 0 },
  { id: 'urbano', name: 'Urbano', pattern: 'digital', colors: ['#4f545b', '#80868e', '#2b2e33', '#a9aeb5'], level: 10, price: 0, shine: 0.2, glow: 0 },
  { id: 'artico', name: 'Ártico', pattern: 'camo', colors: ['#e6edf1', '#b4c2cc', '#8395a3', '#f7fbfd'], level: 15, price: 0, shine: 0.1, glow: 0 },
  { id: 'tigre', name: 'Tigre', pattern: 'stripes', colors: ['#d9731a', '#161616'], level: 1, price: 600, shine: 0.1, glow: 0 },
  { id: 'oceano', name: 'Oceano', pattern: 'digital', colors: ['#0d3b66', '#1f6fae', '#5fb0e5', '#0a2540'], level: 1, price: 800, shine: 0.2, glow: 0 },
  { id: 'carmesim', name: 'Carmesim', pattern: 'solid', colors: ['#9b1426'], level: 4, price: 1200, shine: 0.8, glow: 0 },
  { id: 'neon', name: 'Neon', pattern: 'stripes', colors: ['#0c0c14', '#39ff14'], level: 8, price: 1800, shine: 0.3, glow: 0.9 },
  { id: 'cerejeira', name: 'Cerejeira', pattern: 'camo', colors: ['#f4bfd3', '#e58aae', '#fff0f5', '#b4587a'], level: 12, price: 2200, shine: 0.2, glow: 0 },
  { id: 'lava', name: 'Lava', pattern: 'flow', colors: ['#1a0a05', '#ff4d00', '#ffc400'], level: 20, price: 3500, shine: 0.2, glow: 1 },
  { id: 'galaxia', name: 'Galáxia', pattern: 'flow', colors: ['#0b0630', '#5a2ca0', '#ff8ac0'], level: 26, price: 4500, shine: 0.4, glow: 0.7 },
  { id: 'ouro', name: 'Ouro', pattern: 'solid', colors: ['#d9ae3a'], level: 33, price: 6000, shine: 1, glow: 0.08 },
  { id: 'diamante', name: 'Diamante', pattern: 'digital', colors: ['#b9f2ff', '#e8ffff', '#7fd6ff', '#d2f6ff'], level: 50, price: 10000, shine: 1, glow: 0.25 },
  // Premium: parts that change the gun's shape, colored shots, a kill effect everyone sees and their own inspection.
  {
    id: 'plasma',
    name: 'Plasma',
    pattern: 'flow',
    colors: ['#0a1430', '#123a6b', '#38e8ff'],
    level: 8,
    price: 5000,
    shine: 0.6,
    glow: 0.8,
    tagline: 'Anéis de energia que giram em volta do cano.',
    fx: { kit: 'plasma', tracer: '#45f0ff', flash: '#7af6ff', kill: '#38e8ff', inspect: 'spin' },
  },
  {
    id: 'cristal',
    name: 'Cristal Gélido',
    pattern: 'camo',
    colors: ['#cfefff', '#8fd0f0', '#f4fcff', '#5aa6d6'],
    level: 14,
    price: 6500,
    shine: 1,
    glow: 0.2,
    tagline: 'Lascas de gelo crescem do corpo da arma.',
    fx: { kit: 'cristal', tracer: '#bdf3ff', flash: '#d8f8ff', kill: '#9fe6ff', inspect: 'flip' },
  },
  {
    id: 'brasa',
    name: 'Brasa Infernal',
    pattern: 'flow',
    colors: ['#120604', '#7a1606', '#ff7a1a'],
    level: 20,
    price: 8000,
    shine: 0.3,
    glow: 1,
    tagline: 'Aletas de obsidiana e brasas que sobem da arma.',
    fx: { kit: 'brasa', tracer: '#ff8a2a', flash: '#ffb04a', kill: '#ff5a10', inspect: 'twirl' },
  },
  {
    id: 'vazio',
    name: 'Vazio',
    pattern: 'flow',
    colors: ['#05030c', '#2a0f55', '#b06bff'],
    level: 28,
    price: 10000,
    shine: 0.8,
    glow: 0.9,
    tagline: 'Fragmentos de outra dimensão orbitam a arma.',
    fx: { kit: 'vazio', tracer: '#c08bff', flash: '#d4a8ff', kill: '#a34dff', inspect: 'flip' },
  },
  {
    id: 'tempestade',
    name: 'Tempestade',
    pattern: 'flow',
    colors: ['#070b1a', '#1b2f6b', '#8fd8ff'],
    level: 16,
    price: 9000,
    shine: 0.5,
    glow: 0.9,
    tagline: 'Raios estalam pela arma o tempo todo, e uma esfera de energia pulsa no cano.',
    fx: { kit: 'tempestade', tracer: '#9fe8ff', flash: '#d6f6ff', kill: '#6fd0ff', inspect: 'spin' },
  },
  {
    id: 'holograma',
    name: 'Holograma',
    pattern: 'scan',
    colors: ['#06202a', '#0b5f73', '#7dfff0'],
    level: 22,
    price: 11000,
    shine: 0.4,
    glow: 1,
    tagline: 'Arma de luz: linhas de varredura descem por ela e placas hexagonais orbitam.',
    fx: { kit: 'holograma', tracer: '#7dfff0', flash: '#bafff7', kill: '#36f0d8', inspect: 'twirl' },
  },
  {
    id: 'aurora',
    name: 'Aurora',
    pattern: 'prisma',
    colors: ['#ffffff'],
    level: 30,
    price: 14000,
    shine: 0.7,
    glow: 0.8,
    tagline: 'Todas as cores correndo pela arma, com fitas de luz ondulando em volta.',
    fx: { kit: 'aurora', tracer: '#ff7ad9', flash: '#ffffff', kill: '#9b7bff', inspect: 'flip' },
  },
  // Knives: their own model, finish and inspection. Equipped apart from the weapon skin.
  { id: 'faca_padrao', name: 'Baioneta', pattern: 'solid', colors: [], level: 1, price: 0, shine: 0, glow: 0, slot: 'faca', knife: { blade: 'baioneta', inspect: 'default' }, tagline: 'A faca de sempre.' },
  { id: 'faca_tanto', name: 'Tantō Carbono', pattern: 'digital', colors: ['#1a1c20', '#2c3036', '#0e0f12', '#3d424a'], level: 1, price: 1500, shine: 0.4, glow: 0, slot: 'faca', knife: { blade: 'tanto', inspect: 'twirl' }, tagline: 'Ponta reta japonesa, em fibra de carbono.' },
  { id: 'faca_cutelo', name: 'Cutelo Rubro', pattern: 'solid', colors: ['#8f1020'], level: 5, price: 2500, shine: 0.9, glow: 0, slot: 'faca', knife: { blade: 'cutelo', inspect: 'flip' }, tagline: 'Lâmina larga e vermelha polida. Girada no ar ao inspecionar.' },
  { id: 'faca_karambit', name: 'Karambit Sombrio', pattern: 'stripes', colors: ['#0b0b10', '#6b2bff'], level: 10, price: 4500, shine: 0.5, glow: 0.6, slot: 'faca', knife: { blade: 'karambit', edge: '#8b5cff', inspect: 'spin' }, tagline: 'Garra curva com argola, e o fio da lâmina brilhando roxo.' },
  { id: 'faca_borboleta', name: 'Borboleta Neon', pattern: 'stripes', colors: ['#0c0c14', '#ff2bd6'], level: 15, price: 7000, shine: 0.3, glow: 0.9, slot: 'faca', knife: { blade: 'borboleta', edge: '#ff4fe0', inspect: 'butterfly' }, tagline: 'Canivete borboleta: inspecione e ele abre e fecha os cabos.' },
  { id: 'faca_dragao', name: 'Tantō do Dragão', pattern: 'flow', colors: ['#120502', '#8a1c05', '#ffb020'], level: 24, price: 9500, shine: 0.3, glow: 1, slot: 'faca', knife: { blade: 'tanto', edge: '#ffb020', inspect: 'twirl' }, tagline: 'Brasa correndo pela lâmina e o fio em chamas.' },
  { id: 'faca_plasma', name: 'Lâmina de Plasma', pattern: 'scan', colors: ['#03141c', '#0a6b8a', '#5ff4ff'], level: 35, price: 15000, shine: 0.6, glow: 1, slot: 'faca', knife: { blade: 'baioneta', edge: '#5ff4ff', inspect: 'flip' }, tagline: 'Energia pura: linhas de varredura e um fio que acende a cada golpe.' },
];

const SKIN_BY_ID = new Map(SKINS.map((s) => [s.id, s]));

export function skinById(id: string): SkinDef {
  return SKIN_BY_ID.get(id) ?? SKIN_BY_ID.get(DEFAULT_SKIN)!;
}

export function isSkinId(id: unknown): id is string {
  return typeof id === 'string' && SKIN_BY_ID.has(id);
}

export function isKnifeSkin(id: unknown): id is string {
  return isSkinId(id) && SKIN_BY_ID.get(id)!.slot === 'faca';
}

export function isWeaponSkin(id: unknown): id is string {
  return isSkinId(id) && !SKIN_BY_ID.get(id)!.slot;
}

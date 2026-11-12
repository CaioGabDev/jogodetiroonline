import { clamp } from './util';

export type Action =
  | 'forward'
  | 'back'
  | 'left'
  | 'right'
  | 'jump'
  | 'crouch'
  | 'sprint'
  | 'reload'
  | 'inspect'
  | 'fire'
  | 'aim'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'weapon4'
  | 'melee'
  | 'lethal'
  | 'tactical'
  | 'smoke'
  | 'use'
  | 'inventory'
  | 'scoreboard'
  | 'chat'
  | 'teamChat';

export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Frente',
  back: 'Trás',
  left: 'Esquerda',
  right: 'Direita',
  jump: 'Pular',
  crouch: 'Agachar',
  sprint: 'Correr',
  reload: 'Recarregar',
  inspect: 'Inspecionar arma',
  fire: 'Atirar',
  aim: 'Mirar (ADS)',
  weapon1: 'Primária 1',
  weapon2: 'Primária 2',
  weapon3: 'Pistola',
  weapon4: 'Faca',
  melee: 'Golpe rápido',
  lethal: 'Equipamento letal',
  tactical: 'Equipamento tático',
  smoke: 'Fumaça',
  use: 'Plantar / desarmar',
  inventory: 'Inventário',
  scoreboard: 'Placar',
  chat: 'Chat (todos)',
  teamChat: 'Chat (time)',
};

export type CrosshairStyle = 'cross' | 'dot' | 'circle';
export type Quality = 'low' | 'medium' | 'high';
export type HoldMode = 'hold' | 'toggle';

export interface CrosshairSettings {
  style: CrosshairStyle;
  color: string;
  size: number;
  thickness: number;
  gap: number;
  outline: boolean;
  centerDot: boolean;
}

/**
 * Degrees the view turns per mouse count at sensitivity 1: the same as Valorant, so the same number with the
 * same DPI turns the same distance (cm per 360°).
 */
export const DEG_PER_COUNT = 0.07;
export const LOOK_RAD_PER_COUNT = (DEG_PER_COUNT * Math.PI) / 180;
/** Radians per count per sensitivity point before the Valorant scale: old saves are converted with it. */
const OLD_RAD_PER_COUNT = 0.0005;
export const SENS_MIN = 0.01;
export const SENS_MAX = 10;

export interface Settings {
  /** In Valorant's scale (see DEG_PER_COUNT). */
  sensitivity: number;
  adsSensitivity: number;
  invertY: boolean;
  adsMode: HoldMode;
  crouchMode: HoldMode;
  binds: Record<Action, [string, string]>;
  fov: number;
  quality: Quality;
  shadows: boolean;
  fpsLimit: number;
  resolutionScale: number;
  masterVolume: number;
  sfxVolume: number;
  uiVolume: number;
  crosshair: CrosshairSettings;
  showFps: boolean;
  showPing: boolean;
  showDamage: boolean;
  killfeedSize: number;
  /** Mouse wheel order of the slots (0-1 primaries, 2 pistol, 3 knife). The first one is the starting weapon. */
  wheel: number[];
  /** Marks a save already in Valorant's scale; without it, the sensitivities are converted once. */
  sensScale: 'valorant';
}

export const DEFAULT_SETTINGS: Settings = {
  // About what 2.5 was before the Valorant scale, and Valorant's own default.
  sensitivity: 1,
  adsSensitivity: 1,
  invertY: false,
  adsMode: 'hold',
  crouchMode: 'hold',
  binds: {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    jump: ['Space', ''],
    crouch: ['KeyC', 'ControlLeft'],
    sprint: ['ShiftLeft', ''],
    reload: ['KeyR', ''],
    inspect: ['KeyY', ''],
    fire: ['Mouse0', ''],
    aim: ['Mouse2', ''],
    weapon1: ['Digit1', ''],
    weapon2: ['Digit2', ''],
    weapon3: ['Digit3', ''],
    weapon4: ['Digit4', ''],
    melee: ['KeyV', ''],
    lethal: ['KeyG', ''],
    tactical: ['KeyQ', ''],
    smoke: ['KeyX', ''],
    use: ['KeyE', ''],
    inventory: ['KeyB', ''],
    scoreboard: ['Tab', ''],
    chat: ['Enter', ''],
    teamChat: ['KeyU', ''],
  },
  fov: 90,
  quality: 'medium',
  shadows: true,
  fpsLimit: 0,
  resolutionScale: 1,
  masterVolume: 0.8,
  sfxVolume: 0.8,
  uiVolume: 0.7,
  crosshair: {
    style: 'cross',
    color: '#00ff88',
    size: 8,
    thickness: 2,
    gap: 4,
    outline: true,
    centerDot: false,
  },
  showFps: false,
  showPing: true,
  showDamage: true,
  killfeedSize: 5,
  wheel: [0, 1, 2, 3],
  sensScale: 'valorant',
};

export const FPS_LIMITS = [0, 30, 60, 90, 120, 144, 165, 240];

const STORAGE_KEY = 'arenafps.settings.v1';

function cloneDefaults(): Settings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
}

/** Saves from before weapon inspection have team chat on Y. A key the player rebound on purpose is left alone. */
function freeInspectKey(s: Settings): void {
  const taken = (code: string): boolean => Object.entries(s.binds).some(([a, keys]) => a !== 'inspect' && keys.includes(code));
  const slot = s.binds.teamChat.indexOf('KeyY');
  if (slot >= 0) s.binds.teamChat[slot] = taken('KeyU') ? '' : 'KeyU';
  if (taken('KeyY')) s.binds.inspect = ['', ''];
}

/** Merges stored data over defaults, validating every field. */
function sanitize(raw: unknown): Settings {
  const s = cloneDefaults();
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  const num = (k: string, min: number, max: number, def: number): number => {
    const v = r[k];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(v, min, max) : def;
  };
  const bool = (k: string, def: boolean): boolean => (typeof r[k] === 'boolean' ? (r[k] as boolean) : def);
  // A save from before keeps its feel: the same turn per mouse count, in the new numbers.
  const k = r.sensScale === 'valorant' ? 1 : OLD_RAD_PER_COUNT / LOOK_RAD_PER_COUNT;
  const sens = (key: string, def: number): number => {
    const v = r[key];
    return typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v * k * 1000) / 1000, SENS_MIN, SENS_MAX) : def;
  };
  s.sensitivity = sens('sensitivity', s.sensitivity);
  s.adsSensitivity = sens('adsSensitivity', s.adsSensitivity);
  s.invertY = bool('invertY', s.invertY);
  s.adsMode = r.adsMode === 'toggle' ? 'toggle' : 'hold';
  s.crouchMode = r.crouchMode === 'toggle' ? 'toggle' : 'hold';
  s.fov = num('fov', 70, 110, s.fov);
  s.quality = r.quality === 'low' || r.quality === 'high' ? r.quality : 'medium';
  s.shadows = bool('shadows', s.shadows);
  s.fpsLimit = FPS_LIMITS.includes(r.fpsLimit as number) ? (r.fpsLimit as number) : 0;
  s.resolutionScale = num('resolutionScale', 0.5, 1, s.resolutionScale);
  s.masterVolume = num('masterVolume', 0, 1, s.masterVolume);
  s.sfxVolume = num('sfxVolume', 0, 1, s.sfxVolume);
  s.uiVolume = num('uiVolume', 0, 1, s.uiVolume);
  s.showFps = bool('showFps', s.showFps);
  s.showPing = bool('showPing', s.showPing);
  s.showDamage = bool('showDamage', s.showDamage);
  s.killfeedSize = Math.round(num('killfeedSize', 2, 10, s.killfeedSize));
  if (Array.isArray(r.wheel) && s.wheel.every((slot) => (r.wheel as unknown[]).includes(slot)) && r.wheel.length === s.wheel.length) {
    s.wheel = r.wheel as number[];
  }
  if (r.binds && typeof r.binds === 'object') {
    const b = r.binds as Record<string, unknown>;
    for (const a of Object.keys(s.binds) as Action[]) {
      const v = b[a];
      if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && x.length < 32)) {
        s.binds[a] = [v[0] as string, v[1] as string];
      }
    }
    if (!('inspect' in b)) freeInspectKey(s);
  }
  if (r.crosshair && typeof r.crosshair === 'object') {
    const c = r.crosshair as Record<string, unknown>;
    const cn = (k: string, min: number, max: number, def: number): number =>
      typeof c[k] === 'number' && Number.isFinite(c[k]) ? clamp(c[k] as number, min, max) : def;
    s.crosshair.style = c.style === 'dot' || c.style === 'circle' ? c.style : 'cross';
    s.crosshair.color = typeof c.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(c.color) ? c.color : s.crosshair.color;
    s.crosshair.size = cn('size', 1, 30, s.crosshair.size);
    s.crosshair.thickness = cn('thickness', 1, 8, s.crosshair.thickness);
    s.crosshair.gap = cn('gap', 0, 20, s.crosshair.gap);
    s.crosshair.outline = typeof c.outline === 'boolean' ? c.outline : s.crosshair.outline;
    s.crosshair.centerDot = typeof c.centerDot === 'boolean' ? c.centerDot : s.crosshair.centerDot;
  }
  return s;
}

type Listener = (s: Settings) => void;

class SettingsStore {
  current: Settings;
  private listeners = new Set<Listener>();

  constructor() {
    let raw: unknown = null;
    try {
      const txt = localStorage.getItem(STORAGE_KEY);
      raw = txt ? JSON.parse(txt) : null;
    } catch {
      raw = null;
    }
    this.current = sanitize(raw);
  }

  get(): Settings {
    return this.current;
  }

  /** Applies a mutation, validates, persists and notifies listeners. */
  update(mutator: (s: Settings) => void): void {
    const draft = JSON.parse(JSON.stringify(this.current)) as Settings;
    mutator(draft);
    this.current = sanitize(draft);
    this.save();
    this.listeners.forEach((l) => l(this.current));
  }

  /** Replaces everything with settings from outside this browser, such as the player's account. */
  apply(raw: unknown): void {
    this.current = sanitize(raw);
    this.save();
    this.listeners.forEach((l) => l(this.current));
  }

  reset(): void {
    this.current = cloneDefaults();
    this.save();
    this.listeners.forEach((l) => l(this.current));
  }

  onChange(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.current));
    } catch {
      /* storage unavailable (private mode); settings stay in memory */
    }
  }
}

export const settings = new SettingsStore();

const NICK_KEY = 'arenafps.nick';
const COLOR_KEY = 'arenafps.color';

export function loadNick(): string {
  try {
    return localStorage.getItem(NICK_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveNick(n: string): void {
  try {
    localStorage.setItem(NICK_KEY, n);
  } catch {
    /* ignore */
  }
}

export function loadColor(): string {
  try {
    return localStorage.getItem(COLOR_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveColor(c: string): void {
  try {
    localStorage.setItem(COLOR_KEY, c);
  } catch {
    /* ignore */
  }
}

/** Human readable label for a key code ("KeyW" -> "W"). */
export function keyLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  const map: Record<string, string> = {
    Mouse0: 'Mouse Esq.',
    Mouse1: 'Mouse Meio',
    Mouse2: 'Mouse Dir.',
    Mouse3: 'Mouse 4',
    Mouse4: 'Mouse 5',
    Space: 'Espaço',
    ShiftLeft: 'Shift Esq.',
    ShiftRight: 'Shift Dir.',
    ControlLeft: 'Ctrl Esq.',
    ControlRight: 'Ctrl Dir.',
    AltLeft: 'Alt Esq.',
    AltRight: 'Alt Dir.',
    ArrowUp: '↑',
    ArrowDown: '↓',
    ArrowLeft: '←',
    ArrowRight: '→',
    Enter: 'Enter',
    Tab: 'Tab',
    CapsLock: 'Caps',
    Backquote: '`',
  };
  return map[code] ?? code;
}

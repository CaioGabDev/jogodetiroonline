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
  | 'fire'
  | 'aim'
  | 'weapon1'
  | 'weapon2'
  | 'weapon3'
  | 'weapon4'
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
  fire: 'Atirar',
  aim: 'Mirar (ADS)',
  weapon1: 'Rifle',
  weapon2: 'Pistola',
  weapon3: 'Escopeta',
  weapon4: 'Sniper',
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

export interface Settings {
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
  killfeedSize: number;
}

export const DEFAULT_SETTINGS: Settings = {
  sensitivity: 2.5,
  adsSensitivity: 2.5,
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
    fire: ['Mouse0', ''],
    aim: ['Mouse2', ''],
    weapon1: ['Digit1', ''],
    weapon2: ['Digit2', ''],
    weapon3: ['Digit3', ''],
    weapon4: ['Digit4', ''],
    scoreboard: ['Tab', ''],
    chat: ['Enter', ''],
    teamChat: ['KeyY', ''],
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
  killfeedSize: 5,
};

export const FPS_LIMITS = [0, 30, 60, 90, 120, 144, 165, 240];

const STORAGE_KEY = 'arenafps.settings.v1';

function cloneDefaults(): Settings {
  return JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as Settings;
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
  s.sensitivity = num('sensitivity', 0.1, 10, s.sensitivity);
  s.adsSensitivity = num('adsSensitivity', 0.1, 10, s.adsSensitivity);
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
  s.killfeedSize = Math.round(num('killfeedSize', 2, 10, s.killfeedSize));
  if (r.binds && typeof r.binds === 'object') {
    const b = r.binds as Record<string, unknown>;
    for (const a of Object.keys(s.binds) as Action[]) {
      const v = b[a];
      if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string' && x.length < 32)) {
        s.binds[a] = [v[0] as string, v[1] as string];
      }
    }
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

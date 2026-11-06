export const clamp = (v: number, min: number, max: number): number => (v < min ? min : v > max ? max : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/** Interpolates angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Exponential smoothing factor that is frame-rate independent. */
export const damp = (rate: number, dt: number): number => 1 - Math.exp(-rate * dt);

/** Rounds to 2 decimals (keeps network payloads small). */
export const r2 = (v: number): number => Math.round(v * 100) / 100;
export const r3 = (v: number): number => Math.round(v * 1000) / 1000;
/** Shot directions need this much: 3 decimals drift up to 17 cm at 200 m. */
export const r5 = (v: number): number => Math.round(v * 100000) / 100000;

const range = (a: number, b: number): string => String.fromCharCode(a) + '-' + String.fromCharCode(b);
/** Control chars, zero-width chars and bidi overrides. */
const STRIP_RE = new RegExp(
  '[' + range(0, 0x1f) + range(0x7f, 0x9f) + range(0x200b, 0x200f) + range(0x2028, 0x202e) + range(0x2060, 0x206f) + String.fromCharCode(0xfeff) + ']',
  'g',
);

/**
 * Normalizes user text: strips control/zero-width chars, collapses whitespace,
 * trims and limits length. Output is always rendered via textContent.
 */
export function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(STRIP_RE, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomCode(len = 6): string {
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let s = '';
  for (let i = 0; i < len; i++) s += CODE_CHARS[arr[i] % CODE_CHARS.length];
  return s;
}

export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export const now = (): number => performance.now();

/** Deterministic PRNG (mulberry32) for procedural textures. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function formatTime(ms: number): string {
  if (ms < 0) return '∞';
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function isVec3(v: unknown): v is [number, number, number] {
  return Array.isArray(v) && v.length === 3 && v.every(isFiniteNum);
}

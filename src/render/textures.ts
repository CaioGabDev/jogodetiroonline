import * as THREE from 'three';
import { mulberry32 } from '../core/util';
import type { MatKind } from '../game/mapData';

type Painter = (ctx: CanvasRenderingContext2D, size: number, rnd: () => number) => void;

function makeCanvas(size: number, paint: Painter, seed: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  paint(ctx, size, mulberry32(seed));
  return c;
}

function noise(ctx: CanvasRenderingContext2D, size: number, rnd: () => number, amount: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const v = rnd() < 0.5 ? 0 : 255;
    ctx.fillStyle = `rgba(${v},${v},${v},${rnd() * amount})`;
    const s = 1 + rnd() * 2;
    ctx.fillRect(rnd() * size, rnd() * size, s, s);
  }
}

const painters: Record<MatKind, Painter> = {
  floor: (ctx, s, rnd) => {
    ctx.fillStyle = '#5d6168';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, rnd, 0.12, 5000);
    ctx.strokeStyle = 'rgba(20,22,26,0.55)';
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, s - 3, s - 3);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(s / 2, 0);
    ctx.lineTo(s / 2, s);
    ctx.moveTo(0, s / 2);
    ctx.lineTo(s, s / 2);
    ctx.stroke();
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + rnd() * 0.08})`;
      ctx.beginPath();
      ctx.arc(rnd() * s, rnd() * s, 10 + rnd() * 30, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  wall: (ctx, s, rnd) => {
    ctx.fillStyle = '#7b8088';
    ctx.fillRect(0, 0, s, s);
    const rows = 8;
    const h = s / rows;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? h : 0;
      for (let x = -h * 2; x < s; x += h * 2) {
        const g = 110 + Math.floor(rnd() * 25);
        ctx.fillStyle = `rgb(${g},${g + 3},${g + 8})`;
        ctx.fillRect(x + off + 2, r * h + 2, h * 2 - 4, h - 4);
      }
    }
    noise(ctx, s, rnd, 0.1, 4000);
  },
  concrete: (ctx, s, rnd) => {
    ctx.fillStyle = '#9a9690';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, rnd, 0.15, 7000);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    for (const [x, y] of [
      [0.15, 0.15],
      [0.85, 0.15],
      [0.15, 0.85],
      [0.85, 0.85],
    ]) {
      ctx.beginPath();
      ctx.arc(x * s, y * s, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  crate: (ctx, s, rnd) => {
    ctx.fillStyle = '#8a6136';
    ctx.fillRect(0, 0, s, s);
    const planks = 6;
    for (let i = 0; i < planks; i++) {
      const g = rnd() * 30;
      ctx.fillStyle = `rgb(${130 + g},${90 + g * 0.7},${50 + g * 0.4})`;
      ctx.fillRect(0, (i * s) / planks + 1, s, s / planks - 2);
    }
    noise(ctx, s, rnd, 0.12, 3000);
    ctx.strokeStyle = '#4a3218';
    ctx.lineWidth = s * 0.07;
    ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, s - ctx.lineWidth, s - ctx.lineWidth);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(s, s);
    ctx.stroke();
  },
  metal: (ctx, s, rnd) => {
    ctx.fillStyle = '#5a636e';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    const step = s / 8;
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        ctx.save();
        ctx.translate(x * step + step / 2, y * step + step / 2);
        ctx.rotate((x + y) % 2 ? Math.PI / 4 : -Math.PI / 4);
        ctx.fillRect(-step * 0.3, -2, step * 0.6, 4);
        ctx.restore();
      }
    }
    noise(ctx, s, rnd, 0.08, 3000);
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, s, s);
  },
  trim: (ctx, s) => {
    ctx.fillStyle = '#2a2d33';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#e8b923';
    const w = s / 8;
    for (let i = -8; i < 16; i += 2) {
      ctx.beginPath();
      ctx.moveTo(i * w, 0);
      ctx.lineTo(i * w + w, 0);
      ctx.lineTo(i * w + w + s, s);
      ctx.lineTo(i * w + s, s);
      ctx.closePath();
      ctx.fill();
    }
  },
  sand: (ctx, s, rnd) => {
    ctx.fillStyle = '#a8895c';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, rnd, 0.1, 7000);
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = `rgba(70,48,24,${0.04 + rnd() * 0.07})`;
      ctx.beginPath();
      ctx.ellipse(rnd() * s, rnd() * s, 12 + rnd() * 34, 5 + rnd() * 12, rnd() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
  },
  red: (ctx, s, rnd) => {
    ctx.fillStyle = '#8c2a26';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, rnd, 0.12, 4000);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(0, s * 0.45, s, s * 0.1);
  },
  blue: (ctx, s, rnd) => {
    ctx.fillStyle = '#244f8c';
    ctx.fillRect(0, 0, s, s);
    noise(ctx, s, rnd, 0.12, 4000);
    ctx.fillStyle = 'rgba(255,255,255,0.15)';
    ctx.fillRect(0, s * 0.45, s, s * 0.1);
  },
};

/** Meters covered by one texture repeat per material. */
export const TEX_SCALE: Record<MatKind, number> = {
  floor: 4,
  sand: 6,
  wall: 4,
  concrete: 2,
  crate: 2,
  metal: 3,
  trim: 1.5,
  red: 3,
  blue: 3,
};

const cache = new Map<MatKind, THREE.CanvasTexture>();

export function getTexture(kind: MatKind, anisotropy: number): THREE.CanvasTexture {
  let t = cache.get(kind);
  if (!t) {
    t = new THREE.CanvasTexture(makeCanvas(256, painters[kind], kind.length * 977 + kind.charCodeAt(0)));
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = THREE.SRGBColorSpace;
    cache.set(kind, t);
  }
  t.anisotropy = anisotropy;
  t.needsUpdate = true;
  return t;
}

/** Radial soft blob used for muzzle flashes and pickups glow. */
export function makeGlowTexture(inner: string, outer: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, inner);
  g.addColorStop(0.35, outer);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Bullet hole decal. */
export function makeDecalTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 30);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.3, 'rgba(15,15,15,0.95)');
  g.addColorStop(0.55, 'rgba(40,40,40,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Text label texture for name tags. */
export function makeLabelTexture(text: string, color: string): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement('canvas');
  const ctx = c.getContext('2d')!;
  const font = 'bold 40px system-ui, Segoe UI, Arial, sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 28;
  c.width = w;
  c.height = 60;
  ctx.font = font;
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  const r = 14;
  ctx.beginPath();
  ctx.roundRect(0, 4, w, 52, r);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, 31);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = THREE.LinearFilter;
  return { tex, aspect: w / 60 };
}

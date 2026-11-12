import type { CrosshairSettings } from '../core/settings';

/**
 * Draws the configurable crosshair centered in the canvas.
 * `spread` (px) widens the gap dynamically while moving/shooting.
 */
export function drawCrosshair(canvas: HTMLCanvasElement, c: CrosshairSettings, spread = 0): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  const cx = Math.round(w / 2);
  const cy = Math.round(h / 2);
  const t = c.thickness;
  const gap = c.gap + spread;
  const len = c.size;
  const outline = c.outline ? 1 : 0;

  const rect = (x: number, y: number, rw: number, rh: number): void => {
    if (outline) {
      ctx.fillStyle = 'rgba(0,0,0,0.85)';
      ctx.fillRect(x - 1, y - 1, rw + 2, rh + 2);
    }
    ctx.fillStyle = c.color;
    ctx.fillRect(x, y, rw, rh);
  };
  const off = Math.floor(t / 2);

  if (c.style === 'cross') {
    rect(cx - off, cy - gap - len, t, len);
    rect(cx - off, cy + gap + (t % 2 ? 1 : 0), t, len);
    rect(cx - gap - len, cy - off, len, t);
    rect(cx + gap + (t % 2 ? 1 : 0), cy - off, len, t);
    if (c.centerDot) rect(cx - off, cy - off, t, t);
  } else if (c.style === 'dot') {
    const r = Math.max(1, len / 4 + t / 2);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (outline) {
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.stroke();
    }
    ctx.fillStyle = c.color;
    ctx.fill();
  } else {
    const r = gap + len / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    if (outline) {
      ctx.lineWidth = t + 2;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)';
      ctx.stroke();
    }
    ctx.lineWidth = t;
    ctx.strokeStyle = c.color;
    ctx.stroke();
    if (c.centerDot) rect(cx - off, cy - off, t, t);
  }
}

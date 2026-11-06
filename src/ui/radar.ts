import type { MapDef } from '../game/mapData';
import { el } from './dom';

const SIZE = 200;
/** Above this height a box blocks the way; below it, it's cover. */
const TALL = 1.8;
/** Boxes that start above this are roofs: what matters on a radar is what's under them. */
const ROOF = 2.5;

export interface RadarView {
  /** Where the player is, while alive. */
  self: { x: number; z: number; yaw: number } | null;
  mates: Array<{ x: number; z: number; color: string; carrier: boolean }>;
  enemies: Array<{ x: number; z: number; color: string }>;
  bomb: { x: number; z: number; planted: boolean } | null;
}

/** Top-down map of the bomb mode. North stays up, so everyone names places the same way. */
export class Radar {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D | null;
  private layout: HTMLCanvasElement;
  private scale: number;

  constructor(
    parent: HTMLElement,
    map: MapDef,
  ) {
    this.canvas = el('canvas', { class: 'radar' });
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d');
    this.scale = SIZE / map.size;
    this.layout = this.drawLayout(map);
    parent.append(this.canvas);
  }

  private px(v: number): number {
    return (v * this.scale) + SIZE / 2;
  }

  /** The map itself never changes, so it's drawn once. */
  private drawLayout(map: MapDef): HTMLCanvasElement {
    const layer = document.createElement('canvas');
    layer.width = layer.height = SIZE;
    const ctx = layer.getContext('2d');
    if (!ctx) return layer;
    ctx.fillStyle = 'rgba(18, 22, 28, 0.8)';
    ctx.fillRect(0, 0, SIZE, SIZE);
    for (const site of map.bomb?.sites ?? []) {
      const [x0, z0, x1, z1] = site.rect;
      ctx.fillStyle = 'rgba(216, 52, 42, 0.35)';
      ctx.fillRect(this.px(x0), this.px(z0), (x1 - x0) * this.scale, (z1 - z0) * this.scale);
    }
    for (const b of map.boxes) {
      if (b.max[1] <= 0 || b.min[1] > ROOF) continue;
      ctx.fillStyle = b.max[1] >= TALL ? '#66707c' : '#3f4752';
      ctx.fillRect(this.px(b.min[0]), this.px(b.min[2]), (b.max[0] - b.min[0]) * this.scale, (b.max[2] - b.min[2]) * this.scale);
    }
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const site of map.bomb?.sites ?? []) {
      const [x0, z0, x1, z1] = site.rect;
      ctx.fillText(site.name, this.px((x0 + x1) / 2), this.px((z0 + z1) / 2));
    }
    return layer;
  }

  draw(view: RadarView): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.clearRect(0, 0, SIZE, SIZE);
    ctx.drawImage(this.layout, 0, 0);
    const dot = (x: number, z: number, r: number, color: string): void => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(this.px(x), this.px(z), r, 0, Math.PI * 2);
      ctx.fill();
    };
    if (view.bomb) {
      dot(view.bomb.x, view.bomb.z, view.bomb.planted ? 6 : 4.5, '#ffd23f');
      dot(view.bomb.x, view.bomb.z, 2, '#d8342a');
    }
    for (const e of view.enemies) dot(e.x, e.z, 4, e.color);
    for (const m of view.mates) {
      if (m.carrier) dot(m.x, m.z, 6.5, '#ffd23f');
      dot(m.x, m.z, 4, m.color);
    }
    if (view.self) {
      const { x, z, yaw } = view.self;
      ctx.save();
      ctx.translate(this.px(x), this.px(z));
      ctx.rotate(-yaw);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5, 6);
      ctx.lineTo(-5, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  }

  dispose(): void {
    this.canvas.remove();
  }
}

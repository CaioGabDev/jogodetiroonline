import { HISTORY_MS, HITBOX } from './constants';
import { rayBox, type Box } from './physics';

export interface PosSample {
  t: number;
  x: number;
  y: number;
  z: number;
  crouch: boolean;
}

/** Body and head AABBs for a player standing at (x,y,z). */
export function hitboxes(x: number, y: number, z: number, crouch: boolean): { body: Box; head: Box } {
  const bodyTop = crouch ? HITBOX.crouchBodyTop : HITBOX.standBodyTop;
  const headTop = crouch ? HITBOX.crouchHeadTop : HITBOX.standHeadTop;
  const b = HITBOX.bodyHalf;
  const hh = HITBOX.headHalf;
  return {
    body: { minX: x - b, maxX: x + b, minY: y, maxY: y + bodyTop, minZ: z - b, maxZ: z + b },
    head: { minX: x - hh, maxX: x + hh, minY: y + bodyTop, maxY: y + headTop, minZ: z - hh, maxZ: z + hh },
  };
}

export interface PlayerRayHit {
  dist: number;
  head: boolean;
}

export function rayPlayer(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  p: { x: number; y: number; z: number; crouch: boolean },
  maxT: number,
): PlayerRayHit | null {
  const hb = hitboxes(p.x, p.y, p.z, p.crouch);
  const h = rayBox(ox, oy, oz, dx, dy, dz, hb.head, maxT);
  const b = rayBox(ox, oy, oz, dx, dy, dz, hb.body, maxT);
  if (h && (!b || h.dist <= b.dist)) return { dist: h.dist, head: true };
  if (b) return { dist: b.dist, head: false };
  return null;
}

/** Ring of recent positions used by the host for lag compensation. */
export class PositionHistory {
  private samples: PosSample[] = [];

  push(s: PosSample): void {
    this.samples.push(s);
    const cutoff = s.t - HISTORY_MS - 100;
    let i = 0;
    while (i < this.samples.length - 2 && this.samples[i].t < cutoff) i++;
    if (i > 0) this.samples.splice(0, i);
  }

  clear(): void {
    this.samples.length = 0;
  }

  /** Interpolated position at time t (clamped to the stored range). */
  at(t: number): PosSample | null {
    const s = this.samples;
    if (s.length === 0) return null;
    if (t <= s[0].t) return s[0];
    const last = s[s.length - 1];
    if (t >= last.t) return last;
    for (let i = s.length - 1; i > 0; i--) {
      const a = s[i - 1];
      const b = s[i];
      if (t >= a.t && t <= b.t) {
        const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
        // Big jumps (respawn teleports) are not interpolated.
        if (Math.abs(b.x - a.x) + Math.abs(b.z - a.z) > 4) return k < 0.5 ? a : b;
        return {
          t,
          x: a.x + (b.x - a.x) * k,
          y: a.y + (b.y - a.y) * k,
          z: a.z + (b.z - a.z) * k,
          crouch: k < 0.5 ? a.crouch : b.crouch,
        };
      }
    }
    return last;
  }
}

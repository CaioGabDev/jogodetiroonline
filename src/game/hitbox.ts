import { lerpAngle } from '../core/util';
import { HISTORY_MS, HITBOX } from './constants';
import { rayBox, type Box } from './physics';

export interface PosSample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  crouch: boolean;
}

const part = (minX: number, maxX: number, minY: number, maxY: number, minZ: number, maxZ: number): Box => ({ minX, maxX, minY, maxY, minZ, maxZ });

/**
 * Boxes in the player's own space (feet at the origin, facing -Z), measured from the vertices of the soldier model.
 * Its stance isn't centered: the head sits ahead of the feet and to the right, and the arms reach far forward.
 * Arms count as body. The gun doesn't: shots at it pass through. Arms stay level when the player looks up or down.
 */
const STAND = {
  head: [part(-0.1, 0.17, HITBOX.standBodyTop, HITBOX.standHeadTop, -0.32, 0)],
  body: [
    part(-0.23, 0.23, 1.03, HITBOX.standBodyTop, -0.2, 0.17), // chest and vest
    part(-0.18, 0.15, 0.8, 1.03, -0.15, 0.18), // hips
    part(-0.17, 0.07, 0.48, 0.8, -0.35, 0.01), // left thigh
    part(-0.17, 0.11, 0, 0.48, -0.45, -0.18), // left shin and boot
    part(-0.06, 0.26, 0.44, 0.86, -0.09, 0.19), // right thigh
    part(-0.03, 0.26, 0, 0.44, 0.06, 0.37), // right shin and boot
    part(-0.23, -0.09, 1.13, 1.4, -0.33, -0.08), // left upper arm
    part(-0.16, 0.26, 1.18, 1.42, -0.73, -0.3), // left forearm and hand
    part(0.15, 0.32, 1.1, 1.44, -0.3, 0), // right upper arm
    part(0, 0.3, 1.1, 1.42, -0.56, -0.23), // right forearm and hand
  ],
};
/** Crouching squashes the whole body, so the same stance comes out lower. */
const CROUCH = {
  head: [part(-0.1, 0.17, HITBOX.crouchBodyTop, HITBOX.crouchHeadTop, -0.32, 0)],
  body: [
    part(-0.23, 0.23, 0.78, HITBOX.crouchBodyTop, -0.2, 0.17), // chest and vest
    part(-0.18, 0.15, 0.6, 0.78, -0.15, 0.18), // hips
    part(-0.17, 0.07, 0.37, 0.6, -0.35, 0.01), // left thigh
    part(-0.17, 0.11, 0, 0.37, -0.45, -0.18), // left shin and boot
    part(-0.06, 0.26, 0.34, 0.65, -0.09, 0.19), // right thigh
    part(-0.03, 0.26, 0, 0.34, 0.06, 0.37), // right shin and boot
    part(-0.23, -0.09, 0.86, 1.06, -0.33, -0.08), // left upper arm
    part(-0.16, 0.17, 0.79, 0.89, -0.76, -0.3), // left forearm and hand
    part(0.15, 0.3, 0.91, 1.06, -0.22, 0.02), // right upper arm
    part(0.01, 0.27, 0.82, 0.93, -0.57, -0.2), // right forearm and hand
  ],
};

export interface PlayerRayHit {
  dist: number;
  head: boolean;
}

/** Turns the ray into the player's own space, so the boxes follow where the player is facing. */
export function rayPlayer(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  p: { x: number; y: number; z: number; yaw: number; crouch: boolean },
  maxT: number,
): PlayerRayHit | null {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  const rx = ox - p.x;
  const rz = oz - p.z;
  const lx = rx * c - rz * s;
  const ly = oy - p.y;
  const lz = rx * s + rz * c;
  const ldx = dx * c - dz * s;
  const ldz = dx * s + dz * c;
  const parts = p.crouch ? CROUCH : STAND;
  const nearest = (boxes: Box[]): number => {
    let best = Infinity;
    for (const box of boxes) {
      const hit = rayBox(lx, ly, lz, ldx, dy, ldz, box, maxT);
      if (hit && hit.dist < best) best = hit.dist;
    }
    return best;
  };
  const head = nearest(parts.head);
  const body = nearest(parts.body);
  if (head === Infinity && body === Infinity) return null;
  return head <= body ? { dist: head, head: true } : { dist: body, head: false };
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
          yaw: lerpAngle(a.yaw, b.yaw, k),
          crouch: k < 0.5 ? a.crouch : b.crouch,
        };
      }
    }
    return last;
  }
}

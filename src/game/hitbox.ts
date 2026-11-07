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
 * Boxes in the player's own space (feet at the origin, facing -Z), measured from PlayerModel.
 * Arms count as body. The gun doesn't: shots at it pass through. Arms stay level when the player looks up or down.
 */
const STAND = {
  head: [part(-0.17, 0.17, HITBOX.standBodyTop, 1.74, -0.195, 0.17), part(-0.19, 0.19, 1.74, HITBOX.standHeadTop, -0.19, 0.19)],
  body: [
    part(-0.25, 0.25, 0, 0.12, -0.18, 0.12), // feet
    part(-0.24, 0.24, 0.12, 0.8, -0.12, 0.12), // legs
    part(-0.3, 0.3, 0.8, 0.9, -0.18, 0.18), // belt
    part(-0.28, 0.28, 0.9, HITBOX.standBodyTop, -0.16, 0.16), // torso
    part(-0.2, 0.2, 1.0, 1.3, 0.16, 0.25), // backpack
    part(0.175, 0.31, 1.23, 1.37, -0.52, 0.03), // right arm
    part(-0.25, -0.11, 1.23, 1.37, -0.57, -0.02), // left arm
  ],
};
/** The torso leans forward when crouched, and takes the head and arms with it. */
const CROUCH = {
  head: [part(-0.19, 0.19, HITBOX.crouchBodyTop, HITBOX.crouchHeadTop, -0.33, 0.05)],
  body: [
    part(-0.25, 0.25, 0, 0.36, -0.18, 0.12), // legs
    part(-0.3, 0.3, 0.36, 0.68, -0.22, 0.17), // lower torso
    part(-0.28, 0.28, 0.68, HITBOX.crouchBodyTop, -0.26, 0.13), // upper torso
    part(-0.2, 0.2, 0.55, 0.85, 0.13, 0.22), // backpack
    part(0.175, 0.31, 0.72, 0.93, -0.61, -0.08), // right arm
    part(-0.25, -0.11, 0.72, 0.93, -0.66, -0.1), // left arm
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

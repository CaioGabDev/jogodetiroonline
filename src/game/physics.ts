import { MOVE, PLAYER } from './constants';
import type { MapDef, RampDef } from './mapData';

export interface Box {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

interface Plane {
  nx: number;
  ny: number;
  nz: number;
  d: number;
}

interface Ramp extends RampDef {
  planes: Plane[];
}

/** Something in flight that bounces. */
export interface Thrown {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
}

export interface RayHit {
  dist: number;
  nx: number;
  ny: number;
  nz: number;
}

const EPS = 1e-4;
/**
 * Feet this close below the top of a box walk onto it instead of being stopped. Ramps need this: the player
 * ends up a hair under the platform they lead to. Covers the height lag at top speed on the steepest ramp.
 */
const LEDGE_SKIN = 0.15;
/** How far ahead of the player a mantle looks for a ledge, and ends up standing. */
const MANTLE_PROBE = 0.55;
/** Lower ledges are just jumped onto. */
const MANTLE_MIN = 0.3;
/** Share of the mantle spent going up. */
const MANTLE_RISE = 0.6;
/** Speed a thrown object keeps off a surface, and along it. */
const BOUNCE = 0.4;
const BOUNCE_GRIP = 0.6;
/** Slower than this on the ground, it stops. */
const REST_SPEED = 1.5;

/** Ray vs AABB (slab method). Returns entry distance and face normal. */
export function rayBox(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  b: Box,
  maxT: number,
): RayHit | null {
  let tmin = 0;
  let tmax = maxT;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  const o = [ox, oy, oz];
  const d = [dx, dy, dz];
  const mn = [b.minX, b.minY, b.minZ];
  const mx = [b.maxX, b.maxY, b.maxZ];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) {
      if (o[a] < mn[a] || o[a] > mx[a]) return null;
      continue;
    }
    const inv = 1 / d[a];
    let t1 = (mn[a] - o[a]) * inv;
    let t2 = (mx[a] - o[a]) * inv;
    let sign = -1;
    if (t1 > t2) {
      const tmp = t1;
      t1 = t2;
      t2 = tmp;
      sign = 1;
    }
    if (t1 > tmin) {
      tmin = t1;
      nx = a === 0 ? sign : 0;
      ny = a === 1 ? sign : 0;
      nz = a === 2 ? sign : 0;
    }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { dist: tmin, nx, ny, nz };
}

/** Ray vs convex polyhedron given as inward half-spaces n·p <= d (Cyrus–Beck). */
function rayConvex(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  planes: Plane[],
  maxT: number,
): RayHit | null {
  let tE = 0;
  let tL = maxT;
  let hit: Plane | null = null;
  for (const p of planes) {
    const denom = p.nx * dx + p.ny * dy + p.nz * dz;
    const num = p.d - (p.nx * ox + p.ny * oy + p.nz * oz);
    if (Math.abs(denom) < 1e-9) {
      if (num < 0) return null;
      continue;
    }
    const t = num / denom;
    if (denom < 0) {
      if (t > tE) {
        tE = t;
        hit = p;
      }
    } else if (t < tL) tL = t;
    if (tE > tL) return null;
  }
  if (!hit) return null;
  return { dist: tE, nx: hit.nx, ny: hit.ny, nz: hit.nz };
}

function buildRampPlanes(r: RampDef): Plane[] {
  const planes: Plane[] = [
    { nx: -1, ny: 0, nz: 0, d: -r.minX },
    { nx: 1, ny: 0, nz: 0, d: r.maxX },
    { nx: 0, ny: 0, nz: -1, d: -r.minZ },
    { nx: 0, ny: 0, nz: 1, d: r.maxZ },
    { nx: 0, ny: -1, nz: 0, d: -r.y0 },
  ];
  const lo = r.axis === 'x' ? r.minX : r.minZ;
  const hi = r.axis === 'x' ? r.maxX : r.maxZ;
  const k = (r.y1 - r.y0) / (hi - lo);
  // Slope surface: y <= y0 + k*(c - lo) (rise +1) or y <= y0 + k*(hi - c) (rise -1)
  let nc: number;
  let d: number;
  if (r.rise === 1) {
    nc = -k;
    d = r.y0 - k * lo;
  } else {
    nc = k;
    d = r.y0 + k * hi;
  }
  const len = Math.hypot(nc, 1);
  planes.push({
    nx: r.axis === 'x' ? nc / len : 0,
    ny: 1 / len,
    nz: r.axis === 'z' ? nc / len : 0,
    d: d / len,
  });
  return planes;
}

export interface PState {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  onGround: boolean;
  crouch: boolean;
  /** Seconds of slide left. */
  slide: number;
  mantle: Mantle | null;
}

/** Climb onto a ledge: straight up, then forward onto it. `k` goes from 0 to 1. */
export interface Mantle {
  k: number;
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
}

export interface PInput {
  fwd: number;
  side: number;
  jump: boolean;
  crouch: boolean;
  sprint: boolean;
  /** Starts a slide this step. */
  slide: boolean;
  /** Speed multiplier of the weapon in hand. */
  speedMul: number;
  ads: boolean;
  yaw: number;
}

export interface StepResult {
  jumped: boolean;
  landed: boolean;
  fallSpeed: number;
  slid: boolean;
  mantled: boolean;
}

export class CollisionWorld {
  boxes: Box[];
  ramps: Ramp[];

  constructor(map: MapDef) {
    this.boxes = map.boxes.map((b) => ({
      minX: b.min[0],
      minY: b.min[1],
      minZ: b.min[2],
      maxX: b.max[0],
      maxY: b.max[1],
      maxZ: b.max[2],
    }));
    this.ramps = map.ramps.map((r) => ({ ...r, planes: buildRampPlanes(r) }));
  }

  /** Highest ramp surface over the rect, or -Infinity when not overlapping. */
  rampHeight(r: RampDef, x0: number, x1: number, z0: number, z1: number): number {
    if (x1 <= r.minX || x0 >= r.maxX || z1 <= r.minZ || z0 >= r.maxZ) return -Infinity;
    const lo = r.axis === 'x' ? r.minX : r.minZ;
    const hi = r.axis === 'x' ? r.maxX : r.maxZ;
    let t: number;
    if (r.rise === 1) {
      const c = Math.min(r.axis === 'x' ? x1 : z1, hi);
      t = (c - lo) / (hi - lo);
    } else {
      const c = Math.max(r.axis === 'x' ? x0 : z0, lo);
      t = (hi - c) / (hi - lo);
    }
    return r.y0 + (r.y1 - r.y0) * Math.min(1, Math.max(0, t));
  }

  /** Whether a player-sized AABB at (x,y,z) intersects any solid. */
  overlapsSolid(x: number, y: number, z: number, h: number, radius = PLAYER.radius): boolean {
    const x0 = x - radius;
    const x1 = x + radius;
    const z0 = z - radius;
    const z1 = z + radius;
    for (const b of this.boxes) {
      if (x0 < b.maxX && x1 > b.minX && y < b.maxY && y + h > b.minY && z0 < b.maxZ && z1 > b.minZ) return true;
    }
    for (const r of this.ramps) {
      const rh = this.rampHeight(r, x0, x1, z0, z1);
      if (rh > y + 0.02 && y + h > r.y0) return true;
    }
    return false;
  }

  /** Highest walkable surface under the footprint between feetY-maxDrop and feetY. */
  groundHeight(x: number, z: number, feetY: number, maxDrop: number): number {
    const r0 = PLAYER.radius;
    const x0 = x - r0;
    const x1 = x + r0;
    const z0 = z - r0;
    const z1 = z + r0;
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x0 < b.maxX && x1 > b.minX && z0 < b.maxZ && z1 > b.minZ) {
        if (b.maxY <= feetY + 0.05 && b.maxY >= feetY - maxDrop && b.maxY > best) best = b.maxY;
      }
    }
    for (const r of this.ramps) {
      const rh = this.rampHeight(r, x0, x1, z0, z1);
      if (rh <= feetY + 0.05 && rh >= feetY - maxDrop && rh > best) best = rh;
    }
    return best;
  }

  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): RayHit | null {
    let best: RayHit | null = null;
    let limit = maxDist;
    for (const b of this.boxes) {
      const h = rayBox(ox, oy, oz, dx, dy, dz, b, limit);
      if (h && h.dist < limit) {
        best = h;
        limit = h.dist;
      }
    }
    for (const r of this.ramps) {
      const h = rayConvex(ox, oy, oz, dx, dy, dz, r.planes, limit);
      if (h && h.dist < limit) {
        best = h;
        limit = h.dist;
      }
    }
    return best;
  }

  /** True when nothing blocks the segment a→b. */
  lineOfSight(ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    const len = Math.hypot(dx, dy, dz);
    if (len < 1e-6) return true;
    return this.raycast(ax, ay, az, dx / len, dy / len, dz / len, len) === null;
  }

  /** Advances a thrown object by dt. Returns true when it bounced, which changes its path. */
  stepThrown(o: Thrown, gravity: number, dt: number): boolean {
    if (o.vx === 0 && o.vy === 0 && o.vz === 0) return false;
    o.vy -= gravity * dt;
    const speed = Math.hypot(o.vx, o.vy, o.vz);
    const dx = o.vx / speed;
    const dy = o.vy / speed;
    const dz = o.vz / speed;
    const len = speed * dt;
    const hit = this.raycast(o.x, o.y, o.z, dx, dy, dz, len);
    const dist = hit ? Math.max(0, hit.dist - 0.03) : len;
    o.x += dx * dist;
    o.y += dy * dist;
    o.z += dz * dist;
    if (!hit) return false;
    const into = o.vx * hit.nx + o.vy * hit.ny + o.vz * hit.nz;
    o.vx = (o.vx - hit.nx * into) * BOUNCE_GRIP - hit.nx * into * BOUNCE;
    o.vy = (o.vy - hit.ny * into) * BOUNCE_GRIP - hit.ny * into * BOUNCE;
    o.vz = (o.vz - hit.nz * into) * BOUNCE_GRIP - hit.nz * into * BOUNCE;
    if (hit.ny > 0.5 && Math.hypot(o.vx, o.vy, o.vz) < REST_SPEED) o.vx = o.vy = o.vz = 0;
    return true;
  }

  private moveAxis(s: PState, axis: 'x' | 'z', d: number, h: number): void {
    if (d === 0) return;
    const r = PLAYER.radius;
    if (axis === 'x') s.x += d;
    else s.z += d;
    for (const b of this.boxes) {
      // Only when not rising: the vertical step would push a rising player out through the bottom of the box.
      const top = s.vy <= 0 ? b.maxY - LEDGE_SKIN : b.maxY;
      if (
        s.x - r < b.maxX &&
        s.x + r > b.minX &&
        s.y < top &&
        s.y + h > b.minY &&
        s.z - r < b.maxZ &&
        s.z + r > b.minZ
      ) {
        if (axis === 'x') {
          s.x = d > 0 ? b.minX - r - EPS : b.maxX + r + EPS;
          s.vx = 0;
        } else {
          s.z = d > 0 ? b.minZ - r - EPS : b.maxZ + r + EPS;
          s.vz = 0;
        }
      }
    }
    for (const rp of this.ramps) {
      const rh = this.rampHeight(rp, s.x - r, s.x + r, s.z - r, s.z + r);
      // Too steep to step onto (side of the wedge): block the move.
      if (rh > s.y + MOVE.step && s.y + h > rp.y0) {
        if (axis === 'x') {
          s.x -= d;
          s.vx = 0;
        } else {
          s.z -= d;
          s.vz = 0;
        }
      }
    }
  }

  /** Starts a mantle when a low enough ledge with room on top is straight ahead. */
  private tryMantle(s: PState, fx: number, fz: number, reach: number): boolean {
    const px = s.x + fx * MANTLE_PROBE;
    const pz = s.z + fz * MANTLE_PROBE;
    const r = PLAYER.radius;
    let top = -Infinity;
    // Boxes only: a ramp is walked, not climbed.
    for (const b of this.boxes) {
      const reachable = b.maxY >= s.y + MANTLE_MIN && b.maxY <= s.y + reach && b.maxY > top;
      if (reachable && px - r < b.maxX && px + r > b.minX && pz - r < b.maxZ && pz + r > b.minZ) top = b.maxY;
    }
    if (top === -Infinity || this.overlapsSolid(px, top + 0.02, pz, PLAYER.height)) return false;
    s.mantle = { k: 0, x0: s.x, y0: s.y, z0: s.z, x1: px, y1: top + 0.01, z1: pz };
    s.vx = s.vy = s.vz = 0;
    s.crouch = false;
    s.slide = 0;
    return true;
  }

  private stepMantle(s: PState, m: Mantle, dt: number): void {
    m.k = Math.min(1, m.k + dt / MOVE.mantleTime);
    const up = Math.min(1, m.k / MANTLE_RISE);
    const forward = Math.max(0, (m.k - MANTLE_RISE) / (1 - MANTLE_RISE));
    s.x = m.x0 + (m.x1 - m.x0) * forward;
    s.y = m.y0 + (m.y1 - m.y0) * up;
    s.z = m.z0 + (m.z1 - m.z0) * forward;
    s.onGround = m.k >= 1;
    if (s.onGround) s.mantle = null;
  }

  /** Advances player movement by dt with collision. Shared by client prediction and bots. */
  step(s: PState, inp: PInput, dt: number): StepResult {
    const res: StepResult = { jumped: false, landed: false, fallSpeed: 0, slid: false, mantled: false };
    if (s.mantle) {
      this.stepMantle(s, s.mantle, dt);
      return res;
    }
    if (inp.slide && s.onGround && !s.crouch) {
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 0) {
        s.vx *= MOVE.slideSpeed / sp;
        s.vz *= MOVE.slideSpeed / sp;
        s.slide = MOVE.slideTime;
        res.slid = true;
      }
    }
    const sliding = s.slide > 0;
    s.slide = s.onGround ? Math.max(0, s.slide - dt) : 0;
    if (inp.crouch || sliding) s.crouch = true;
    else if (s.crouch && !this.overlapsSolid(s.x, s.y + 0.01, s.z, PLAYER.height)) s.crouch = false;
    const h = s.crouch ? PLAYER.crouchHeight : PLAYER.height;

    const sin = Math.sin(inp.yaw);
    const cos = Math.cos(inp.yaw);
    if (inp.fwd > 0 && (inp.jump || !s.onGround)) {
      const reach = s.onGround ? MOVE.mantleReach : MOVE.mantleAirReach;
      if (this.tryMantle(s, -sin, -cos, reach)) {
        res.mantled = true;
        return res;
      }
    }
    let wx = -sin * inp.fwd + cos * inp.side;
    let wz = -cos * inp.fwd - sin * inp.side;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) {
      wx /= wl;
      wz /= wl;
    }
    const maxSpeed = s.crouch ? MOVE.crouch : inp.ads ? MOVE.ads : inp.sprint && inp.fwd > 0 ? MOVE.sprint : MOVE.walk;
    // A slide keeps its direction until it runs out.
    const wishSpeed = wl > 1e-4 && !sliding ? maxSpeed * inp.speedMul : 0;
    const friction = sliding ? MOVE.slideFriction : MOVE.friction;

    const wasOnGround = s.onGround;
    if (s.onGround) {
      const sp = Math.hypot(s.vx, s.vz);
      if (sp > 0) {
        const control = Math.max(sp, MOVE.stopSpeed);
        const ns = Math.max(sp - control * friction * dt, 0) / sp;
        s.vx *= ns;
        s.vz *= ns;
      }
      accelerate(s, wx, wz, wishSpeed, MOVE.accel, dt);
      if (inp.jump) {
        s.vy = MOVE.jump;
        s.onGround = false;
        s.slide = 0;
        res.jumped = true;
      }
    } else {
      const before = Math.hypot(s.vx, s.vz);
      accelerate(s, wx, wz, wishSpeed, MOVE.airAccel, dt);
      // Air control steers but never adds speed, so strafing can't build past the run speed.
      const after = Math.hypot(s.vx, s.vz);
      const limit = Math.max(before, maxSpeed);
      if (after > limit) {
        s.vx *= limit / after;
        s.vz *= limit / after;
      }
    }
    s.vy = Math.max(s.vy - MOVE.gravity * dt, -40);

    this.moveAxis(s, 'x', s.vx * dt, h);
    this.moveAxis(s, 'z', s.vz * dt, h);

    // Vertical
    const preVy = s.vy;
    s.onGround = false;
    s.y += s.vy * dt;
    const r = PLAYER.radius;
    for (const b of this.boxes) {
      if (
        s.x - r < b.maxX &&
        s.x + r > b.minX &&
        s.y < b.maxY &&
        s.y + h > b.minY &&
        s.z - r < b.maxZ &&
        s.z + r > b.minZ
      ) {
        if (s.vy <= 0) {
          s.y = b.maxY;
          s.onGround = true;
        } else {
          s.y = b.minY - h - EPS;
        }
        s.vy = 0;
      }
    }
    for (const rp of this.ramps) {
      const rh = this.rampHeight(rp, s.x - r, s.x + r, s.z - r, s.z + r);
      if (rh > -Infinity && s.y < rh) {
        s.y = rh;
        if (s.vy <= 0) {
          s.vy = 0;
          s.onGround = true;
        }
      }
    }
    // Stick to the ground when walking down slopes/small ledges.
    if (!s.onGround && wasOnGround && !res.jumped && s.vy <= 0) {
      const gh = this.groundHeight(s.x, s.z, s.y, 0.6);
      if (gh > -Infinity) {
        s.y = gh;
        s.vy = 0;
        s.onGround = true;
      }
    }
    if (s.onGround && !wasOnGround) {
      res.landed = true;
      res.fallSpeed = -preVy;
    }
    return res;
  }
}

function accelerate(s: PState, wx: number, wz: number, wishSpeed: number, accel: number, dt: number): void {
  const cur = s.vx * wx + s.vz * wz;
  const add = wishSpeed - cur;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishSpeed, add);
  s.vx += a * wx;
  s.vz += a * wz;
}

export function eyeHeight(crouch: boolean): number {
  return crouch ? PLAYER.crouchEye : PLAYER.eye;
}

import { lerp, lerpAngle } from '../core/util';
import { F_ADS, F_ALIVE, F_CROUCH, F_GROUND, F_PROTECTED, type SnapPlayer } from '../net/protocol';
import { PlayerModel } from '../render/models';

interface Sample {
  t: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  f: number;
  w: number;
  hp: number;
}

/** A player controlled by someone else, rendered with snapshot interpolation. */
export class RemotePlayer {
  readonly model: PlayerModel;
  private buf: Sample[] = [];
  x = 0;
  y = -50;
  z = 0;
  yaw = 0;
  pitch = 0;
  crouch = false;
  alive = false;
  protected = false;
  ads = false;
  onGround = true;
  weapon = 0;
  hp = 100;
  speed = 0;
  stepAcc = 0;
  labelVisible = false;
  private lastX = 0;
  private lastZ = 0;
  private hasPos = false;

  constructor(
    readonly id: number,
    color: string,
  ) {
    this.model = new PlayerModel(color);
    this.model.root.visible = false;
  }

  push(t: number, s: SnapPlayer): void {
    const last = this.buf[this.buf.length - 1];
    if (last && t <= last.t) return;
    this.buf.push({ t, x: s.p[0], y: s.p[1], z: s.p[2], yaw: s.yw, pitch: s.pt, f: s.f, w: s.w, hp: s.hp });
    while (this.buf.length > 2 && this.buf[1].t < t - 1000) this.buf.shift();
  }

  /** Interpolates the buffered snapshots at host time `rt`. Returns horizontal distance moved this frame. */
  interpolate(rt: number, dt: number): number {
    const b = this.buf;
    if (b.length === 0) return 0;
    let s0 = b[0];
    let s1 = b[0];
    let k = 0;
    if (rt >= b[b.length - 1].t) {
      s0 = s1 = b[b.length - 1];
    } else if (rt > b[0].t) {
      for (let i = b.length - 1; i > 0; i--) {
        if (b[i - 1].t <= rt) {
          s0 = b[i - 1];
          s1 = b[i];
          k = (rt - s0.t) / Math.max(1, s1.t - s0.t);
          break;
        }
      }
    }
    // Teleports (respawn) snap instead of sliding across the map.
    if (Math.abs(s1.x - s0.x) + Math.abs(s1.z - s0.z) > 4) k = k < 0.5 ? 0 : 1;
    this.x = lerp(s0.x, s1.x, k);
    this.y = lerp(s0.y, s1.y, k);
    this.z = lerp(s0.z, s1.z, k);
    this.yaw = lerpAngle(s0.yaw, s1.yaw, k);
    this.pitch = lerp(s0.pitch, s1.pitch, k);
    const f = k < 0.5 ? s0.f : s1.f;
    const wasAlive = this.alive;
    this.alive = (f & F_ALIVE) !== 0;
    this.crouch = (f & F_CROUCH) !== 0;
    this.protected = (f & F_PROTECTED) !== 0;
    this.ads = (f & F_ADS) !== 0;
    this.onGround = (f & F_GROUND) !== 0;
    this.weapon = k < 0.5 ? s0.w : s1.w;
    this.hp = s1.hp;

    let moved = 0;
    if (this.hasPos && wasAlive && this.alive) {
      moved = Math.hypot(this.x - this.lastX, this.z - this.lastZ);
      if (moved > 3) moved = 0;
    }
    this.hasPos = true;
    this.lastX = this.x;
    this.lastZ = this.z;
    const inst = dt > 0 ? moved / dt : 0;
    this.speed += (inst - this.speed) * Math.min(1, dt * 10);
    return moved;
  }

  get hasData(): boolean {
    return this.buf.length > 0;
  }

  dispose(): void {
    this.model.root.removeFromParent();
    this.model.dispose();
  }
}

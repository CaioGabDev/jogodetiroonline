import * as THREE from 'three';
import type { ProjectileKind } from '../game/weapons';
import { gunAssets } from './assets';
import { WEAPONS } from '../game/weapons';
import { makeDecalTexture, makeGlowTexture } from './textures';

const MAX_TRACERS = 48;
const MAX_DECALS = 160;
const MAX_PARTICLES = 600;
/** Flames drawn per molotov. */
const FIRE_FLAMES = 44;
/** Seconds a fire takes to die down at the end. */
const FIRE_FADE = 0.6;
const SMOKE_PUFFS = 46;
const SMOKE_OPACITY = 0.96;
/** Seconds a smoke takes to fill out and to thin away. */
const SMOKE_GROW = 1.2;
const SMOKE_FADE = 2;

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
}

/** Drawn only: the host decides where a projectile ends. */
interface Projectile {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  gravity: number;
  life: number;
}

interface Fire {
  group: THREE.Group;
  life: number;
}

interface Smoke {
  group: THREE.Group;
  material: THREE.SpriteMaterial;
  life: number;
}

/** Pooled world-space effects. Everything is preallocated to avoid GC hitches and shader recompiles. */
export class Effects {
  readonly group = new THREE.Group();
  private tracers: Tracer[] = [];
  private tracerIdx = 0;
  private decals: THREE.InstancedMesh;
  private decalIdx = 0;
  private decalCount = 0;
  private particles: THREE.Points;
  private pPos: Float32Array;
  private pVel: Float32Array;
  private pCol: Float32Array;
  private pLife: Float32Array;
  private pIdx = 0;
  private flashes: Flash[] = [];
  private flashIdx = 0;
  private light: THREE.PointLight;
  private lightLife = 0;
  private projectiles = new Map<number, Projectile>();
  private projectileLook: Record<ProjectileKind, [THREE.BufferGeometry, THREE.Material]> = {
    bolt: [new THREE.BoxGeometry(0.03, 0.03, 0.55), new THREE.MeshBasicMaterial({ color: 0xc9b98a })],
    grenade: [new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: 0x3a4030 })],
    knife: [new THREE.BoxGeometry(0.02, 0.05, 0.32), new THREE.MeshBasicMaterial({ color: 0xc8ccd0 })],
    bottle: [new THREE.CylinderGeometry(0.045, 0.065, 0.26, 8), new THREE.MeshBasicMaterial({ color: 0x4f7a3a })],
    can: [new THREE.CylinderGeometry(0.055, 0.055, 0.16, 8), new THREE.MeshBasicMaterial({ color: 0xa8acb0 })],
  };
  private fires: Fire[] = [];
  /** Marks the ground that burns, so the danger reads from far away. */
  private scorchGeo = new THREE.CircleGeometry(1, 24).rotateX(-Math.PI / 2);
  private scorchMat = new THREE.MeshBasicMaterial({ color: 0x140a04, transparent: true, opacity: 0.72, depthWrite: false });
  private smokes: Smoke[] = [];
  private smokeMat = new THREE.SpriteMaterial({
    map: makeGlowTexture('rgba(205,205,205,1)', 'rgba(185,185,185,0.95)'),
    transparent: true,
    depthWrite: false,
  });
  /** Weapons on the ground, by id. */
  private drops = new Map<number, THREE.Group>();
  private dropGlow = new THREE.SpriteMaterial({
    map: makeGlowTexture('rgba(255,255,255,0.55)', 'rgba(255,220,140,0.15)'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  private dropFallback = new THREE.MeshStandardMaterial({ color: 0x24262b, roughness: 0.6 });
  /** The bomb on the ground. A single one exists per round. */
  private bomb = new THREE.Group();
  private bombBlink: THREE.Sprite;
  private bombGlow: THREE.Sprite;
  private flameMat = new THREE.SpriteMaterial({
    map: makeGlowTexture('rgba(255,225,130,1)', 'rgba(255,90,15,0.75)'),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  constructor() {
    const tracerGeo = new THREE.BoxGeometry(0.025, 0.025, 1);
    tracerGeo.translate(0, 0, 0.5);
    for (let i = 0; i < MAX_TRACERS; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd27a,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      });
      const mesh = new THREE.Mesh(tracerGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.tracers.push({ mesh, life: 0, max: 1 });
    }

    const decalGeo = new THREE.PlaneGeometry(0.14, 0.14);
    const decalMat = new THREE.MeshBasicMaterial({
      map: makeDecalTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
    });
    this.decals = new THREE.InstancedMesh(decalGeo, decalMat, MAX_DECALS);
    this.decals.count = 0;
    this.decals.frustumCulled = false;
    this.group.add(this.decals);

    this.pPos = new Float32Array(MAX_PARTICLES * 3).fill(-9999);
    this.pVel = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.pLife = new Float32Array(MAX_PARTICLES);
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3).setUsage(THREE.DynamicDrawUsage));
    pg.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3).setUsage(THREE.DynamicDrawUsage));
    this.particles = new THREE.Points(
      pg,
      new THREE.PointsMaterial({ size: 0.07, vertexColors: true, transparent: true, depthWrite: false }),
    );
    this.particles.frustumCulled = false;
    this.group.add(this.particles);

    const flashTex = makeGlowTexture('rgba(255,255,230,1)', 'rgba(255,170,40,0.7)');
    for (let i = 0; i < 12; i++) {
      const s = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: flashTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      s.visible = false;
      this.group.add(s);
      this.flashes.push({ sprite: s, life: 0 });
    }

    this.light = new THREE.PointLight(0xffb050, 0, 9, 2);
    this.group.add(this.light);

    const body = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.14, 0.3), new THREE.MeshStandardMaterial({ color: 0x3b3f2c, roughness: 0.7 }));
    body.position.y = 0.07;
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.02, 0.16), new THREE.MeshBasicMaterial({ color: 0x111111 }));
    panel.position.y = 0.15;
    const blink = makeGlowTexture('rgba(255,70,50,1)', 'rgba(255,0,0,0.5)');
    this.bombBlink = new THREE.Sprite(new THREE.SpriteMaterial({ map: blink, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.bombBlink.scale.setScalar(0.5);
    this.bombBlink.position.y = 0.2;
    // Shows through walls: the attackers' way of finding a dropped bomb.
    this.bombGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: blink, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.bombGlow.scale.setScalar(1.4);
    this.bombGlow.position.y = 1;
    this.bomb.add(body, panel, this.bombBlink, this.bombGlow);
    this.bomb.visible = false;
    this.group.add(this.bomb);
  }

  /** `spot` is null while someone carries it. */
  setBomb(spot: THREE.Vector3 | null, planted: boolean, glow: boolean): void {
    this.bomb.visible = spot !== null;
    if (spot) this.bomb.position.copy(spot);
    this.bombBlink.visible = planted;
    this.bombGlow.visible = glow;
  }

  /** Keeps what's on the ground in step with the host's list. */
  setDrops(list: Array<{ id: number; w: number; p: [number, number, number] }>): void {
    for (const [id, group] of this.drops) {
      if (list.some((d) => d.id === id)) continue;
      group.removeFromParent();
      this.drops.delete(id);
    }
    for (const d of list) {
      if (this.drops.has(d.id)) continue;
      const group = this.dropModel(d.w);
      group.position.set(d.p[0], d.p[1], d.p[2]);
      group.rotation.y = d.id * 2.4;
      this.group.add(group);
      this.drops.set(d.id, group);
    }
  }

  /** The gun on its side, with a faint glow so it can be found on a dark floor. */
  private dropModel(w: number): THREE.Group {
    const group = new THREE.Group();
    const { len, h } = WEAPONS[w].shape;
    const asset = gunAssets.get(w);
    if (asset) {
      const model = asset.object.clone();
      model.scale.setScalar(len / asset.len);
      model.position.set(0, 0.06, len / 2);
      model.rotation.z = Math.PI / 2;
      group.add(model);
    } else {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, len), this.dropFallback);
      box.position.y = h / 2;
      group.add(box);
    }
    const glow = new THREE.Sprite(this.dropGlow);
    glow.scale.setScalar(0.7);
    glow.position.y = 0.25;
    group.add(glow);
    return group;
  }

  smoke(pos: THREE.Vector3, radius: number, ms: number): void {
    const group = new THREE.Group();
    group.position.copy(pos);
    const material = this.smokeMat.clone();
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const puff = new THREE.Sprite(material);
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.cbrt(Math.random()) * 0.85;
      puff.position.set(Math.cos(a) * r, 0.5 + Math.random() * radius * 0.85, Math.sin(a) * r);
      puff.scale.setScalar(radius * 0.95);
      group.add(puff);
    }
    this.group.add(group);
    this.smokes.push({ group, material, life: ms / 1000 });
  }

  /** A new round starts on a clean map. */
  clearRound(): void {
    for (const f of this.fires) f.group.removeFromParent();
    this.fires = [];
    for (const s of this.smokes) {
      s.group.removeFromParent();
      s.material.dispose();
    }
    this.smokes = [];
    for (const id of [...this.projectiles.keys()]) this.removeProjectile(id);
    this.setBomb(null, false, false);
  }

  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number): void {
    const dist = from.distanceTo(to);
    if (dist < 0.5) return;
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % MAX_TRACERS;
    t.mesh.position.copy(from);
    t.mesh.lookAt(to);
    t.mesh.scale.set(1, 1, dist);
    (t.mesh.material as THREE.MeshBasicMaterial).color.setHex(color);
    t.mesh.visible = true;
    t.max = t.life = 0.07;
  }

  /** Calling it again with the same id replaces that one: the host does that when it bounces. */
  addProjectile(id: number, pos: THREE.Vector3, vel: THREE.Vector3, gravity: number, kind: ProjectileKind): void {
    this.removeProjectile(id);
    const mesh = new THREE.Mesh(...this.projectileLook[kind]);
    mesh.position.copy(pos);
    this.group.add(mesh);
    this.projectiles.set(id, { mesh, vel, gravity, life: 9 });
  }

  removeProjectile(id: number): void {
    const p = this.projectiles.get(id);
    if (!p) return;
    p.mesh.removeFromParent();
    this.projectiles.delete(id);
  }

  explosion(pos: THREE.Vector3, radius: number): void {
    this.muzzleFlash(pos, radius * 1.3, true, 0.18);
    this.muzzleFlash(pos, radius * 0.8, false, 0.28);
    this.impact(pos, null, 'world', 45);
  }

  fire(pos: THREE.Vector3, radius: number, ms: number): void {
    const group = new THREE.Group();
    group.position.copy(pos);
    const scorch = new THREE.Mesh(this.scorchGeo, this.scorchMat);
    scorch.scale.setScalar(radius);
    scorch.position.y = 0.03;
    group.add(scorch);
    for (let i = 0; i < FIRE_FLAMES; i++) {
      const flame = new THREE.Sprite(this.flameMat);
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random());
      flame.position.set(Math.cos(a) * r, 0.35, Math.sin(a) * r);
      group.add(flame);
    }
    this.group.add(group);
    this.fires.push({ group, life: ms / 1000 });
  }

  muzzleFlash(pos: THREE.Vector3, scale = 0.6, light = true, life = 0.05): void {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    f.sprite.position.copy(pos);
    f.sprite.scale.setScalar(scale * (0.8 + Math.random() * 0.4));
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.sprite.visible = true;
    f.life = life;
    if (light) {
      this.light.position.copy(pos);
      this.light.intensity = 6;
      this.lightLife = 0.06;
    }
  }

  private static tmpM = new THREE.Matrix4();
  private static tmpQ = new THREE.Quaternion();
  private static tmpN = new THREE.Vector3();
  private static zAxis = new THREE.Vector3(0, 0, 1);

  decal(pos: THREE.Vector3, normal: THREE.Vector3): void {
    const n = Effects.tmpN.copy(normal).normalize();
    if (n.lengthSq() < 0.5) return;
    Effects.tmpQ.setFromUnitVectors(Effects.zAxis, n);
    const s = 0.8 + Math.random() * 0.5;
    Effects.tmpM.compose(pos.clone().addScaledVector(n, 0.005), Effects.tmpQ, new THREE.Vector3(s, s, s));
    this.decals.setMatrixAt(this.decalIdx, Effects.tmpM);
    this.decalIdx = (this.decalIdx + 1) % MAX_DECALS;
    this.decalCount = Math.min(MAX_DECALS, this.decalCount + 1);
    this.decals.count = this.decalCount;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  /** Spray of particles at an impact point. kind: world dust/sparks or blood. */
  impact(pos: THREE.Vector3, normal: THREE.Vector3 | null, kind: 'world' | 'player', count = 8): void {
    for (let i = 0; i < count; i++) {
      const k = this.pIdx;
      this.pIdx = (this.pIdx + 1) % MAX_PARTICLES;
      this.pPos[k * 3] = pos.x;
      this.pPos[k * 3 + 1] = pos.y;
      this.pPos[k * 3 + 2] = pos.z;
      const sp = kind === 'player' ? 2.5 : 3.5;
      let vx = (Math.random() - 0.5) * sp;
      let vy = Math.random() * sp * 0.8;
      let vz = (Math.random() - 0.5) * sp;
      if (normal) {
        vx += normal.x * sp * 0.8;
        vy += normal.y * sp * 0.8;
        vz += normal.z * sp * 0.8;
      }
      this.pVel[k * 3] = vx;
      this.pVel[k * 3 + 1] = vy;
      this.pVel[k * 3 + 2] = vz;
      this.pLife[k] = 0.35 + Math.random() * 0.35;
      if (kind === 'player') {
        this.pCol[k * 3] = 0.75;
        this.pCol[k * 3 + 1] = 0.05;
        this.pCol[k * 3 + 2] = 0.05;
      } else if (Math.random() < 0.3) {
        this.pCol[k * 3] = 1;
        this.pCol[k * 3 + 1] = 0.8;
        this.pCol[k * 3 + 2] = 0.3;
      } else {
        const g = 0.45 + Math.random() * 0.25;
        this.pCol[k * 3] = g;
        this.pCol[k * 3 + 1] = g * 0.95;
        this.pCol[k * 3 + 2] = g * 0.9;
      }
    }
  }

  update(dt: number): void {
    for (const [id, p] of this.projectiles) {
      p.life -= dt;
      if (p.life <= 0) {
        this.removeProjectile(id);
        continue;
      }
      p.vel.y -= p.gravity * dt;
      p.mesh.position.addScaledVector(p.vel, dt);
      p.mesh.lookAt(Effects.tmpN.copy(p.mesh.position).add(p.vel));
    }
    this.fires = this.fires.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) {
        f.group.removeFromParent();
        return false;
      }
      const size = Math.min(1, f.life / FIRE_FADE);
      const clock = performance.now() / 90;
      f.group.children.forEach((flame, i) => {
        if (!(flame instanceof THREE.Sprite)) return;
        const flicker = 0.75 + 0.35 * Math.sin(clock + i * 2.1);
        flame.scale.set(0.6 * size, 1.25 * size * flicker, 1);
      });
      return true;
    });
    this.smokes = this.smokes.filter((s) => {
      s.life -= dt;
      if (s.life <= 0) {
        s.group.removeFromParent();
        s.material.dispose();
        return false;
      }
      s.material.opacity = SMOKE_OPACITY * Math.min(1, s.life / SMOKE_FADE);
      const grown = Math.min(1, s.group.scale.x + dt / SMOKE_GROW);
      s.group.scale.setScalar(Math.max(0.2, grown));
      return true;
    });
    if (this.bombBlink.visible) this.bombBlink.material.opacity = Math.sin(performance.now() / 110) > 0 ? 1 : 0.15;
    for (const t of this.tracers) {
      if (!t.mesh.visible) continue;
      t.life -= dt;
      if (t.life <= 0) {
        t.mesh.visible = false;
        continue;
      }
      (t.mesh.material as THREE.MeshBasicMaterial).opacity = (t.life / t.max) * 0.9;
    }
    for (const f of this.flashes) {
      if (!f.sprite.visible) continue;
      f.life -= dt;
      if (f.life <= 0) f.sprite.visible = false;
    }
    if (this.lightLife > 0) {
      this.lightLife -= dt;
      if (this.lightLife <= 0) this.light.intensity = 0;
    }
    let any = false;
    for (let k = 0; k < MAX_PARTICLES; k++) {
      if (this.pLife[k] <= 0) continue;
      any = true;
      this.pLife[k] -= dt;
      if (this.pLife[k] <= 0) {
        this.pPos[k * 3 + 1] = -9999;
        continue;
      }
      this.pVel[k * 3 + 1] -= 12 * dt;
      this.pPos[k * 3] += this.pVel[k * 3] * dt;
      this.pPos[k * 3 + 1] += this.pVel[k * 3 + 1] * dt;
      this.pPos[k * 3 + 2] += this.pVel[k * 3 + 2] * dt;
    }
    if (any) {
      this.particles.geometry.attributes.position.needsUpdate = true;
      this.particles.geometry.attributes.color.needsUpdate = true;
    }
  }

  clearDecals(): void {
    this.decalCount = 0;
    this.decalIdx = 0;
    this.decals.count = 0;
  }
}

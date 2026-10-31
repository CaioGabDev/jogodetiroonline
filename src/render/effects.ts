import * as THREE from 'three';
import { makeDecalTexture, makeGlowTexture } from './textures';

const MAX_TRACERS = 48;
const MAX_DECALS = 160;
const MAX_PARTICLES = 600;

interface Tracer {
  mesh: THREE.Mesh;
  life: number;
  max: number;
}

interface Flash {
  sprite: THREE.Sprite;
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

  muzzleFlash(pos: THREE.Vector3, scale = 0.6, light = true): void {
    const f = this.flashes[this.flashIdx];
    this.flashIdx = (this.flashIdx + 1) % this.flashes.length;
    f.sprite.position.copy(pos);
    f.sprite.scale.setScalar(scale * (0.8 + Math.random() * 0.4));
    f.sprite.material.rotation = Math.random() * Math.PI;
    f.sprite.visible = true;
    f.life = 0.05;
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

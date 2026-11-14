import * as THREE from 'three';
import type { InspectStyle, SkinDef, SkinKit } from '../game/progression';

/**
 * Premium skin parts: pieces added around a gun that change its silhouette, with their own animation.
 * They are sized from the gun's bounding box, so one design fits every weapon. Barrels point to -Z.
 */

interface Frame {
  /** Muzzle end (smallest z) and rear end. */
  z0: number;
  z1: number;
  len: number;
  top: number;
  bottom: number;
  cx: number;
  cy: number;
  w: number;
  h: number;
  minX: number;
  maxX: number;
  /** Rough height of the barrel. */
  barrelY: number;
  /** Top of the receiver: the bounding box top is usually the sights, which would leave parts floating. */
  bodyTop: number;
}

interface Kit {
  group: THREE.Group;
  /** 0..1 while the gun is being inspected. */
  inspect: number;
  update(dt: number, t: number): void;
  dispose(): void;
}

const kits = new WeakMap<THREE.Object3D, Kit>();
const active = new Set<Kit>();
let clock = 0;

export function tickKits(dt: number): void {
  clock += dt;
  for (const k of active) k.update(dt, clock);
}

/** Marks a part so skins and bounding boxes leave it alone. */
function part<T extends THREE.Object3D>(o: T): T {
  o.userData.kitPart = true;
  if (o instanceof THREE.Mesh) o.castShadow = false;
  return o;
}

export function isKitPart(o: THREE.Object3D): boolean {
  return o.userData.kitPart === true;
}

const _box = new THREE.Box3();
const _inv = new THREE.Matrix4();
const _rel = new THREE.Matrix4();

function frameOf(root: THREE.Object3D, skip?: ReadonlySet<THREE.Material>): Frame | null {
  root.updateMatrixWorld(true);
  _inv.copy(root.matrixWorld).invert();
  const box = new THREE.Box3();
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || isKitPart(o) || !o.visible) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    if (skip && mats.every((m) => skip.has(m))) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    _rel.multiplyMatrices(_inv, o.matrixWorld);
    box.union(_box.copy(o.geometry.boundingBox!).applyMatrix4(_rel));
  });
  if (box.isEmpty()) return null;
  const len = box.max.z - box.min.z;
  const h = box.max.y - box.min.y;
  return {
    z0: box.min.z,
    z1: box.max.z,
    len,
    top: box.max.y,
    bottom: box.min.y,
    cx: (box.min.x + box.max.x) / 2,
    cy: (box.min.y + box.max.y) / 2,
    w: box.max.x - box.min.x,
    h,
    minX: box.min.x,
    maxX: box.max.x,
    barrelY: box.max.y - h * 0.25,
    bodyTop: (box.min.y + box.max.y) / 2 + h * 0.2,
  };
}

/** Same layout every time for the same gun. */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const glowMat = (color: string): THREE.MeshBasicMaterial =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

// ---------------------------------------------------------------------------------------------- kits

function plasma(f: Frame, skin: SkinDef): Kit {
  const g = new THREE.Group();
  const fx = skin.fx!;
  const glow = glowMat(fx.tracer);
  const soft = glowMat(fx.flash);
  soft.opacity = 0.55;
  const ringR = Math.max(f.w * 0.95, f.len * 0.075);
  const rings: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const r = ringR * (1 - i * 0.12);
    const ring = part(new THREE.Mesh(new THREE.TorusGeometry(r, r * 0.08, 8, 40), i === 1 ? soft : glow));
    ring.position.set(f.cx, f.barrelY, f.z0 + f.len * (0.08 + i * 0.09));
    ring.userData.z = ring.position.z;
    g.add(ring);
    rings.push(ring);
  }
  // A glowing spine on top and a strip down each side.
  const spine = part(new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.004, f.w * 0.2), f.len * 0.01, f.len * 0.55), glow));
  spine.position.set(f.cx, f.bodyTop + f.len * 0.004, f.z0 + f.len * 0.55);
  g.add(spine);
  for (const x of [f.minX - 0.0015, f.maxX + 0.0015]) {
    const strip = part(new THREE.Mesh(new THREE.BoxGeometry(0.003, Math.max(0.004, f.h * 0.05), f.len * 0.42), soft));
    strip.position.set(x, f.cy + f.h * 0.1, f.z0 + f.len * 0.55);
    g.add(strip);
  }
  const core = part(new THREE.Mesh(new THREE.IcosahedronGeometry(f.len * 0.028, 0), glow));
  core.position.set(f.cx, f.bodyTop + f.len * 0.05, f.z1 - f.len * 0.32);
  g.add(core);

  const kit: Kit = {
    group: g,
    inspect: 0,
    update(dt, t) {
      const boost = 1 + kit.inspect * 5;
      rings.forEach((ring, i) => {
        ring.rotation.z += dt * (i % 2 ? -2.2 : 2.6) * boost;
        ring.position.z = ring.userData.z - kit.inspect * f.len * 0.07 * (i + 1);
        ring.scale.setScalar(1 + Math.sin(t * 4 + i) * 0.05 + kit.inspect * 0.35);
      });
      core.rotation.x += dt * 1.3;
      core.rotation.y += dt * 2;
      core.position.y = f.bodyTop + f.len * (0.05 + Math.sin(t * 2.5) * 0.008);
      glow.opacity = 0.8 + Math.sin(t * 6) * 0.15 + kit.inspect * 0.2;
    },
    dispose() {
      glow.dispose();
      soft.dispose();
    },
  };
  return kit;
}

function cristal(f: Frame, skin: SkinDef): Kit {
  const g = new THREE.Group();
  const fx = skin.fx!;
  const ice = new THREE.MeshPhongMaterial({
    color: '#cdf3ff',
    emissive: fx.kill,
    emissiveIntensity: 0.45,
    specular: '#ffffff',
    shininess: 150,
    transparent: true,
    opacity: 0.86,
    flatShading: true,
  });
  const shardGeo = new THREE.OctahedronGeometry(1, 0);
  const rand = seeded(Math.round(f.len * 1000) + 7);
  const unit = f.len * 0.055;
  // Along the top, leaning back like frost grown by the wind.
  const n = 6;
  for (let i = 0; i < n; i++) {
    const s = unit * (0.7 + rand() * 0.7);
    const shard = part(new THREE.Mesh(shardGeo, ice));
    shard.scale.set(s * 0.32, s * 1.7, s * 0.32);
    const along = 0.3 + (i / (n - 1)) * 0.55;
    shard.position.set(f.cx + (rand() - 0.5) * f.w * 0.6, f.bodyTop + s * 0.7, f.z0 + f.len * along);
    shard.rotation.set(0.75 + rand() * 0.3, 0, (rand() - 0.5) * 0.7);
    g.add(shard);
  }
  // Two under the front, pointing down and forward.
  for (const side of [-1, 1]) {
    const s = unit * 1.1;
    const shard = part(new THREE.Mesh(shardGeo, ice));
    shard.scale.set(s * 0.3, s * 1.5, s * 0.3);
    shard.position.set(f.cx + side * f.w * 0.3, f.barrelY - f.h * 0.12, f.z0 + f.len * 0.22);
    shard.rotation.set(Math.PI - 0.6, 0, side * 0.35);
    g.add(shard);
  }
  // Small pieces floating over the grip.
  const floaters: THREE.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const shard = part(new THREE.Mesh(shardGeo, ice));
    shard.scale.set(unit * 0.25, unit * 0.6, unit * 0.25);
    g.add(shard);
    floaters.push(shard);
  }
  const center = new THREE.Vector3(f.cx, f.bodyTop + f.len * 0.08, f.z1 - f.len * 0.28);

  const kit: Kit = {
    group: g,
    inspect: 0,
    update(dt, t) {
      const speed = 1.2 + kit.inspect * 4;
      const r = f.len * (0.05 + kit.inspect * 0.04);
      floaters.forEach((m, i) => {
        const a = t * speed + (i * Math.PI * 2) / 3;
        m.position.set(center.x + Math.cos(a) * r, center.y + Math.sin(t * 2 + i) * f.len * 0.01, center.z + Math.sin(a) * r);
        m.rotation.y += dt * 2;
      });
      ice.emissiveIntensity = 0.4 + Math.sin(t * 2) * 0.12 + kit.inspect * 1.4;
    },
    dispose() {
      ice.dispose();
      shardGeo.dispose();
    },
  };
  return kit;
}

function brasa(f: Frame, skin: SkinDef): Kit {
  const g = new THREE.Group();
  const fx = skin.fx!;
  const rock = new THREE.MeshPhongMaterial({ color: '#1c0b07', emissive: '#3a0a02', specular: '#ff7a3a', shininess: 70, flatShading: true });
  const glow = glowMat(fx.flash);
  const finGeo = new THREE.ConeGeometry(1, 1, 4);
  // Grows from its base, so the fin sits on the gun instead of floating over it.
  finGeo.translate(0, 0.5, 0);
  // Fins swept back along the top, smaller toward the muzzle.
  for (let i = 0; i < 3; i++) {
    const k = 1 - i * 0.25;
    const fin = part(new THREE.Mesh(finGeo, rock));
    fin.scale.set(f.len * 0.04 * k, f.len * 0.26 * k, f.len * 0.014);
    fin.position.set(f.cx, f.bodyTop - f.len * 0.005, f.z0 + f.len * (0.42 + i * 0.16));
    fin.rotation.x = 1.0;
    g.add(fin);
  }
  // Wings out to the sides at the back.
  for (const side of [-1, 1]) {
    const wing = part(new THREE.Mesh(finGeo, rock));
    wing.scale.set(f.len * 0.035, f.len * 0.22, f.len * 0.012);
    wing.position.set(side < 0 ? f.minX + 0.003 : f.maxX - 0.003, f.cy + f.h * 0.12, f.z1 - f.len * 0.25);
    wing.rotation.set(0.9, 0, -side * 1.15);
    g.add(wing);
  }
  // Glowing vents down the sides.
  for (const x of [f.minX - 0.0015, f.maxX + 0.0015]) {
    for (let i = 0; i < 3; i++) {
      const vent = part(new THREE.Mesh(new THREE.BoxGeometry(0.003, Math.max(0.004, f.h * 0.06), f.len * 0.06), glow));
      vent.position.set(x, f.cy + f.h * 0.12, f.z0 + f.len * (0.42 + i * 0.1));
      g.add(vent);
    }
  }
  // Embers rising off the gun.
  const N = 26;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N);
  const rand = seeded(97);
  const respawn = (i: number): void => {
    pos[i * 3] = f.cx + (rand() - 0.5) * f.w * 1.6;
    pos[i * 3 + 1] = f.bodyTop - rand() * f.h * 0.2;
    pos[i * 3 + 2] = f.z0 + f.len * (0.3 + rand() * 0.65);
    vel[i] = f.len * (0.12 + rand() * 0.2);
  };
  for (let i = 0; i < N; i++) {
    respawn(i);
    pos[i * 3 + 1] += rand() * f.len * 0.15;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  const emberMat = new THREE.PointsMaterial({
    color: fx.tracer,
    size: f.len * 0.014,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const embers = part(new THREE.Points(geo, emberMat));
  embers.frustumCulled = false;
  g.add(embers);

  const kit: Kit = {
    group: g,
    inspect: 0,
    update(dt, t) {
      const speed = 1 + kit.inspect * 3;
      for (let i = 0; i < N; i++) {
        pos[i * 3 + 1] += vel[i] * dt * speed;
        pos[i * 3] += Math.sin(t * 3 + i) * dt * f.len * 0.02;
        if (pos[i * 3 + 1] > f.bodyTop + f.len * 0.2) respawn(i);
      }
      geo.attributes.position.needsUpdate = true;
      glow.opacity = 0.7 + Math.sin(t * 9) * 0.2 + kit.inspect * 0.3;
      rock.emissiveIntensity = 1 + kit.inspect * 2.5;
    },
    dispose() {
      rock.dispose();
      glow.dispose();
      finGeo.dispose();
      geo.dispose();
      emberMat.dispose();
    },
  };
  return kit;
}

function vazio(f: Frame, skin: SkinDef): Kit {
  const g = new THREE.Group();
  const fx = skin.fx!;
  const glow = glowMat(fx.tracer);
  const dark = new THREE.MeshPhongMaterial({ color: '#08040f', emissive: '#1a0833', specular: '#b06bff', shininess: 110, flatShading: true });
  const bitGeo = new THREE.OctahedronGeometry(f.len * 0.017, 0);
  const center = new THREE.Vector3(f.cx, f.cy + f.h * 0.1, f.z0 + f.len * 0.45);
  const baseR = Math.max(f.h * 0.75, f.len * 0.1);
  const bits: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const bit = part(new THREE.Mesh(bitGeo, i % 3 === 0 ? glow : dark));
    g.add(bit);
    bits.push(bit);
  }
  // A thin halo standing at the back, and two dark blades at the muzzle.
  const halo = part(new THREE.Mesh(new THREE.TorusGeometry(Math.max(f.h * 0.55, f.len * 0.06), f.len * 0.004, 6, 48), glow));
  halo.position.set(f.cx, f.cy + f.h * 0.1, f.z1 - f.len * 0.12);
  g.add(halo);
  const bladeGeo = new THREE.TetrahedronGeometry(1, 0);
  for (const side of [-1, 1]) {
    const blade = part(new THREE.Mesh(bladeGeo, dark));
    blade.scale.set(f.len * 0.015, f.len * 0.06, f.len * 0.015);
    blade.position.set(f.cx + side * Math.max(f.w * 0.7, f.len * 0.025), f.barrelY, f.z0 + f.len * 0.05);
    blade.rotation.set(-Math.PI / 2, 0, side * 0.4);
    g.add(blade);
  }

  const kit: Kit = {
    group: g,
    inspect: 0,
    update(dt, t) {
      const speed = 0.9 + kit.inspect * 4;
      const r = baseR * (1 + kit.inspect * 0.6);
      bits.forEach((b, i) => {
        const a = t * speed + (i * Math.PI * 2) / bits.length;
        b.position.set(center.x + Math.cos(a) * r, center.y + Math.sin(a) * r, center.z + Math.sin(t * 1.5 + i) * f.len * 0.12);
        b.rotation.x += dt * 2;
        b.rotation.y += dt * 3;
      });
      halo.rotation.z -= dt * (0.6 + kit.inspect * 3);
      halo.scale.setScalar(1 + Math.sin(t * 3) * 0.04 + kit.inspect * 0.5);
      glow.opacity = 0.75 + Math.sin(t * 5) * 0.2;
    },
    dispose() {
      glow.dispose();
      dark.dispose();
      bitGeo.dispose();
      bladeGeo.dispose();
    },
  };
  return kit;
}

/** Lightning arcs that jump across the gun, redrawn many times a second, and a crackling orb at the muzzle. */
function tempestade(f: Frame, skin: SkinDef): Kit {
  const g = new THREE.Group();
  const fx = skin.fx!;
  const bolt = new THREE.LineBasicMaterial({ color: fx.tracer, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });
  const orbMat = glowMat(fx.flash);
  const POINTS = 9;
  const arcs = Array.from({ length: 4 }, () => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(POINTS * 3), 3));
    const line = part(new THREE.Line(geo, bolt));
    g.add(line);
    return line;
  });
  const onGun = (): THREE.Vector3 =>
    new THREE.Vector3(
      Math.random() < 0.5 ? f.minX - 0.003 : f.maxX + 0.003,
      f.bottom + (f.bodyTop - f.bottom) * (0.3 + Math.random() * 0.7),
      f.z0 + f.len * (0.1 + Math.random() * 0.8),
    );
  const zap = (line: THREE.Line, boost: number): void => {
    const a = onGun();
    const b = onGun();
    b.z = a.z + (Math.random() - 0.5) * f.len * 0.35 * (1 + boost);
    const pos = line.geometry.getAttribute('position') as THREE.BufferAttribute;
    const amp = Math.max(f.h, f.w) * (0.25 + boost * 0.4);
    for (let i = 0; i < POINTS; i++) {
      const k = i / (POINTS - 1);
      const j = i === 0 || i === POINTS - 1 ? 0 : 1;
      pos.setXYZ(i, a.x + (b.x - a.x) * k + (Math.random() - 0.5) * amp * j, a.y + (b.y - a.y) * k + (Math.random() - 0.3) * amp * j, a.z + (b.z - a.z) * k);
    }
    pos.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  };
  const orb = part(new THREE.Mesh(new THREE.IcosahedronGeometry(Math.max(f.w, f.h) * 0.2, 1), orbMat));
  orb.position.set(f.cx, f.barrelY, f.z0 - f.len * 0.02);
  g.add(orb);
  const timers = arcs.map(() => 0);
  const kit: Kit = {
    group: g,
    inspect: 0,
    update(dt) {
      arcs.forEach((line, i) => {
        timers[i] -= dt;
        if (timers[i] > 0) return;
        zap(line, kit.inspect);
        timers[i] = 0.05 + Math.random() * 0.12 * (1 - kit.inspect * 0.6);
        line.visible = Math.random() < 0.75 + kit.inspect * 0.25;
      });
      bolt.opacity = 0.6 + Math.random() * 0.4;
      orb.scale.setScalar(0.7 + Math.random() * 0.5 + kit.inspect * 0.8);
      orb.rotation.y += dt * 6;
    },
    dispose() {
      bolt.dispose();
      orbMat.dispose();
    },
  };
  return kit;
}

/** Hexagonal plates orbiting the gun and a scanning ring that sweeps along it. */
function holograma(f: Frame, skin: SkinDef): Kit {
  const g = new THREE.Group();
  const fx = skin.fx!;
  const plateMat = glowMat(fx.tracer);
  plateMat.opacity = 0.5;
  plateMat.side = THREE.DoubleSide;
  const ringMat = glowMat(fx.flash);
  ringMat.side = THREE.DoubleSide;
  const r = Math.max(f.w, f.h) * 0.9 + f.len * 0.04;
  const plates: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const plate = part(new THREE.Mesh(new THREE.CircleGeometry(f.len * 0.035, 6), plateMat));
    g.add(plate);
    plates.push(plate);
  }
  const scan = part(new THREE.Mesh(new THREE.RingGeometry(r * 0.88, r, 6, 1), ringMat));
  g.add(scan);
  const kit: Kit = {
    group: g,
    inspect: 0,
    update(_dt, t) {
      const speed = 1.4 * (1 + kit.inspect * 2.5);
      plates.forEach((plate, i) => {
        const a = t * speed + (i * Math.PI) / 3;
        const z = f.z0 + f.len * (0.25 + 0.25 * (i % 3));
        const rr = r * (1.15 + kit.inspect * 0.5);
        plate.position.set(f.cx + Math.cos(a) * rr, f.cy + Math.sin(a) * rr, z);
        plate.rotation.set(t * 2 + i, t * 1.5, a);
      });
      scan.position.set(f.cx, f.cy, f.z0 + f.len * (0.5 + 0.47 * Math.sin(t * 1.8)));
      scan.rotation.z = t;
      scan.scale.setScalar(1 + kit.inspect * 0.4);
      ringMat.opacity = 0.5 + Math.sin(t * 9) * 0.3;
    },
    dispose() {
      plateMat.dispose();
      ringMat.dispose();
    },
  };
  return kit;
}

/** Three ribbons of light, one per color, waving along the gun. */
function aurora(f: Frame, skin: SkinDef): Kit {
  const g = new THREE.Group();
  const fx = skin.fx!;
  const colors = [fx.tracer, fx.kill, '#7af7ff'];
  const ribbons = colors.map((color, i) => {
    const geo = new THREE.PlaneGeometry(f.len * 0.95, Math.max(0.01, f.h * 0.16), 32, 1);
    geo.rotateY(Math.PI / 2);
    const mat = glowMat(color);
    mat.opacity = 0.45;
    mat.side = THREE.DoubleSide;
    const mesh = part(new THREE.Mesh(geo, mat));
    mesh.position.set(i === 1 ? f.cx : i === 0 ? f.minX - 0.012 : f.maxX + 0.012, i === 1 ? f.bodyTop + f.h * 0.25 : f.cy, f.z0 + f.len * 0.5);
    mesh.frustumCulled = false;
    g.add(mesh);
    const base = Float32Array.from(geo.getAttribute('position').array as Float32Array);
    return { mesh, mat, base };
  });
  const kit: Kit = {
    group: g,
    inspect: 0,
    update(_dt, t) {
      const amp = f.h * (0.18 + kit.inspect * 0.4);
      ribbons.forEach(({ mesh, mat, base }, i) => {
        const pos = mesh.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let v = 0; v < pos.count; v++) {
          const z = base[v * 3 + 2];
          const wave = Math.sin((z / f.len) * 9 + t * (2.2 + i * 0.5) + i * 2);
          pos.setXYZ(v, base[v * 3] + Math.cos(z * 7 + t * 2 + i) * amp * 0.35, base[v * 3 + 1] + wave * amp, z);
        }
        pos.needsUpdate = true;
        mat.opacity = 0.35 + Math.sin(t * 2 + i) * 0.12 + kit.inspect * 0.3;
      });
    },
    dispose() {
      ribbons.forEach((r) => r.mat.dispose());
    },
  };
  return kit;
}

const BUILDERS: Record<SkinKit, (f: Frame, skin: SkinDef) => Kit> = { plasma, cristal, brasa, vazio, tempestade, holograma, aurora };

/**
 * Puts the skin's parts around the gun under `root`, replacing any earlier ones. A skin without parts just removes them.
 * Meshes using a material in `skip` (hands) don't count toward the gun's size.
 */
export function setKit(root: THREE.Object3D, skin: SkinDef, skip?: ReadonlySet<THREE.Material>): void {
  removeKit(root);
  if (!skin.fx) return;
  const f = frameOf(root, skip);
  if (!f || f.len <= 0) return;
  const kit = BUILDERS[skin.fx.kit](f, skin);
  part(kit.group);
  kit.group.traverse((o) => part(o));
  root.add(kit.group);
  kits.set(root, kit);
  active.add(kit);
}

export function setKitInspect(root: THREE.Object3D, amount: number): void {
  const k = kits.get(root);
  if (k) k.inspect = amount;
}

export function removeKit(root: THREE.Object3D): void {
  const old = kits.get(root);
  if (!old) return;
  old.group.removeFromParent();
  old.group.traverse((o) => {
    if (o instanceof THREE.Mesh || o instanceof THREE.Points || o instanceof THREE.Line) o.geometry.dispose();
  });
  old.dispose();
  active.delete(old);
  kits.delete(root);
}

// ------------------------------------------------------------------------------------------ inspection

export interface InspectPose {
  rx: number;
  ry: number;
  rz: number;
  /** Lift, in meters. */
  dy: number;
  /** 0..1: how far into the trick, for the parts to react. */
  amount: number;
}

const smooth = THREE.MathUtils.smoothstep;

/** Extra turn of the gun in hand for the premium inspections, on top of the normal one. `p` is 0..1. */
export function inspectPose(style: InspectStyle, p: number): InspectPose {
  const pose: InspectPose = { rx: 0, ry: 0, rz: 0, dy: 0, amount: 0 };
  if (p < 0 || p > 1) return pose;
  pose.amount = smooth(p, 0.08, 0.2) * (1 - smooth(p, 0.82, 0.96));
  switch (style) {
    case 'spin': {
      // A full roll around the barrel.
      const a = smooth(p, 0.3, 0.7);
      pose.rz = a * Math.PI * 2;
      break;
    }
    case 'flip': {
      // Tossed end over end and caught.
      const a = smooth(p, 0.28, 0.64);
      pose.rx = -a * Math.PI * 2;
      pose.dy = Math.sin(a * Math.PI) * 0.09;
      break;
    }
    case 'butterfly': {
      // Held up and rocked while the handles fly open and shut (knives.ts moves them).
      const a = smooth(p, 0.12, 0.88);
      pose.ry = Math.sin(a * Math.PI * 2) * 0.6;
      pose.rz = Math.sin(a * Math.PI * 4) * 0.25;
      pose.dy = Math.sin(a * Math.PI) * 0.03;
      break;
    }
    case 'twirl': {
      // Two turns flat in the hand, like a gunslinger.
      const a = smooth(p, 0.24, 0.74);
      pose.ry = a * Math.PI * 4;
      break;
    }
    default:
      break;
  }
  return pose;
}
